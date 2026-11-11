/**
 * claude
 *
 * Server-side proxy for every Claude call the app makes. Replaces the
 * browser-side `@anthropic-ai/sdk` client with `dangerouslyAllowBrowser:
 * true` — which leaked our Anthropic API key in every customer's network
 * tab. This function now holds the key, verifies the caller's JWT, enforces
 * spend/tool caps authoritatively, and writes usage_events on the server
 * side where the client can't bypass it.
 *
 * One endpoint, two modes:
 *
 *   stream: false  → returns { text, content, stop_reason, usage: { input_tokens, output_tokens } }
 *   stream: true   → returns text/event-stream of normalized chunks:
 *                      data: {"type":"chunk","text":"..."}
 *                      data: {"type":"tool_use","id":"toolu_…","name":"run_tool","input":{…}}
 *                      ...
 *                      data: {"type":"done","stop_reason":"tool_use","usage":{"input_tokens":n,"output_tokens":n}}
 *                    or on error:
 *                      data: {"type":"error","message":"..."}
 *
 * ⭐ TOOL USE. `tools` is forwarded to Anthropic verbatim and tool_use blocks
 * come back through both modes. The loop itself lives in the BROWSER, not here
 * — see src/lib/solomonTools.js. That is deliberate: every tool Solomon can run
 * is a thing the app already does with the owner's own session, under RLS,
 * reusing the existing tool prompts. Running the loop server-side would mean
 * re-implementing all of that with the service-role key, which is both more
 * code and strictly less safe.
 *
 * Each leg of a tool loop is a separate request through here, so the cap check
 * and the usage write happen per leg. A runaway loop costs money at the same
 * rate as a runaway conversation and is stopped by the same limits.
 *
 * The normalized SSE format is deliberately simpler than Anthropic's
 * wire format. Browser only cares about text deltas; everything else
 * (content_block_start, message_stop, etc.) is noise from the caller's
 * perspective and we'd rather not couple the client to Anthropic's
 * event taxonomy.
 *
 * Request body (JSON):
 *   systemPrompt:  string                     — raw system text, OR
 *   systemBlocks:  Array<{type,text,cache_control?}>
 *                                             — pre-built blocks (for prompt caching)
 *   messages:      Array<{role,content}>       — Anthropic messages array
 *   model:         'claude-sonnet-4-6' | 'claude-haiku-4-5' | string
 *   maxTokens:     number
 *   json:          boolean                    — if true, appends a "respond JSON only" suffix
 *   stream:        boolean
 *
 *   toolId:        string  — for usage tracking ('advisor', 'gbp-optimizer', ...)
 *   kind:          'generate' | 'refine'   — for usage tracking
 *   (skipCaps is GONE — it was client-settable and disabled the cap check.
 *    Exemption from the per-tool COUNT is now decided server-side from toolId
 *    via TOOL_CAP_EXEMPT. Nothing is ever exempt from the spend cap.)
 *
 * Required env vars (set in Supabase → Edge Functions → Secrets):
 *   ANTHROPIC_API_KEY        sk-ant-...   — production Anthropic key
 *   SUPABASE_URL             auto-set by Supabase
 *   SUPABASE_SERVICE_ROLE_KEY  auto-set by Supabase
 */

// deno-lint-ignore-file no-external-import
import { corsHeaders, json, preflight } from '../_shared/cors.ts'
import * as PROMPTS from '../_shared/prompts.ts'
import { authedUser, serviceClient }    from '../_shared/supabase.ts'

// ── Pricing (mirrors src/lib/usage.js — keep in sync) ─────────────────────────
//
// Sonnet 4.6 — $3 in / $15 out per 1M tokens.
// Haiku 4.5 priced lower; the input/output rates differ but for now we
// log everything at Sonnet rates so we over-attribute cost rather than
// under-attribute (matches the conservative pre-edge-function code).
const CLAUDE_INPUT_PER_M  = 3.00
const CLAUDE_OUTPUT_PER_M = 15.00

// ⚠️ CACHED TOKENS ARE BILLED TOO. Anthropic reports them apart from
// input_tokens: a cache write costs 1.25x input (2x with the 1h TTL the
// conversation uses) and a cache read 0.1x. They were never recorded, so the
// cost log and the spend cap both left them out (11 Nov 2026 audit).
function computeClaudeCost(tokensIn: number, tokensOut: number, cacheWrite = 0, cacheRead = 0, writeMult = 1.25): number {
  const inCost  = ((tokensIn || 0) + (cacheWrite || 0) * writeMult + (cacheRead || 0) * 0.1) / 1_000_000 * CLAUDE_INPUT_PER_M
  const outCost = (tokensOut || 0) / 1_000_000 * CLAUDE_OUTPUT_PER_M
  return Number((inCost + outCost).toFixed(5))
}

// ⚠️ DAILY BURN LIMIT — a FRACTION of the monthly cap, not a fixed figure.
//
// I first wrote this as a flat $25 and it was useless: the default monthly cap
// is $10, so the monthly check always fired first and the backstop could never
// trigger. A backstop set above the limit it is meant to sit behind is
// decoration.
//
// Proportional works because it scales with whatever plan a company is on. At
// the $10 default this is $4 a day — roughly 40-80 Solomon turns, far beyond
// any real day's use, and minutes for a script.
const DAILY_FRACTION   = 0.4
const DAILY_FLOOR_USD  = 2.00   // so a very small cap still leaves room to work

// Largest max_tokens any caller may request. The client used to be able to ask
// for anything; a single request could be made arbitrarily expensive.
const MAX_TOKENS_CEILING = 8192

// ⭐ Tools exempt from the per-TOOL count cap (10 runs/month). They are NOT
// exempt from the spend cap — nothing is.
//
// This replaces a `skipCaps` boolean that was read straight out of the request
// body. The comment above the old check said "we re-check here because the
// browser is untrusted code", and then trusted a flag from the browser to
// disable the check. Any authenticated user could pass skipCaps:true and spend
// without limit on our Anthropic key.
//
// The exemption now lives on the server and is keyed on what the call IS.
// Conversation and internal bookkeeping should not burn a tool run; they must
// still respect the money.
const TOOL_CAP_EXEMPT = new Set([
  'advisor',          // Solomon conversation — metered by spend, not by count
  'morning-opener',   // generated greeting
  'solomon-memory',   // memory extraction, fires after an exchange
  'library-analysis', // reads the whole library after an upload — internal
  'untagged',         // low-level calls with no declared tool
  // ⭐ `wayout` is metered by spend, like the advisor, and must not be counted.
  // 🔴 The reason is the failure mode, not the volume: one intake is three
  // reflections plus the map, and the map is generated AFTER the person has
  // paid $39. A per-tool COUNT cap would mean the eleventh call of a month
  // returns 429 to someone who has already been charged — the one moment in
  // this product where a refusal is indefensible. The spend cap still applies;
  // nothing is exempt from the money.
  'wayout',
])

const DEFAULT_SPEND_CAP_USD = 10.00
const DEFAULT_TOOL_CAP      = 10

const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? ''
if (!ANTHROPIC_KEY) {
  console.warn('[claude] ANTHROPIC_API_KEY env var not set — every request will fail')
}

// Anthropic version header. Bump when we adopt new API features.
const ANTHROPIC_VERSION = '2023-06-01'

// ── Date helpers ──────────────────────────────────────────────────────────────

function firstOfThisMonth(): Date {
  const d = new Date()
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0))
}

// ── Cap checks (authoritative — duplicate the browser checks server-side) ────

interface CompanyCapRow {
  monthly_spend_cap: number | null
  monthly_tool_cap:  number | null
}

async function assertCapsServerSide(
  admin: ReturnType<typeof serviceClient>,
  companyId: string,
  toolId: string,
): Promise<void> {
  const since = firstOfThisMonth().toISOString()

  // Pull cap config + this month's usage in parallel. created_at comes back so
  // the last-24h window can be summed from the same rows — one query, both
  // limits, rather than a second round trip on every single request.
  const [companyRes, spendRes, toolRes] = await Promise.all([
    admin
      .from('companies')
      .select('monthly_spend_cap, monthly_tool_cap')
      .eq('id', companyId)
      .maybeSingle(),
    admin
      .from('usage_events')
      .select('cost_usd, created_at')
      .eq('company_id', companyId)
      .gte('created_at', since),
    admin
      .from('usage_events')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .eq('tool_id',    toolId)
      .eq('provider',   'anthropic')
      .gte('created_at', since),
  ])

  const company  = (companyRes.data ?? {}) as CompanyCapRow
  /**
   * ⭐ UNSTUCK MAP'S OWN MONTHLY CAP: $5 (WAYOUT_MONTHLY_CAP_USD). A whole plan's
   * lifetime costs about $1–1.50, so $5 is 3–5× genuine use and the worst case
   * per paying user is $5 of $29. Daniel, 2 Oct: no top-ups.
   * ⚠️ Every company row stores the column default of $10, so the $5 applies
   * unless the account was deliberately RAISED above $10 — which is how one
   * person's cap is lifted by hand: set their company's monthly_spend_cap to 20.
   */
  const wayoutCap = Number(Deno.env.get('WAYOUT_MONTHLY_CAP_USD') ?? '5')
  const stored    = company.monthly_spend_cap ?? DEFAULT_SPEND_CAP_USD
  const spendCap  = toolId === 'wayout' && stored <= DEFAULT_SPEND_CAP_USD && Number.isFinite(wayoutCap) && wayoutCap > 0
    ? wayoutCap
    : stored
  const toolCap  = company.monthly_tool_cap  ?? DEFAULT_TOOL_CAP

  // ⚠️ FAIL CLOSED. This used to proceed when the usage read errored, with the
  // comment "fail open on read errors — same policy as browser". Failing open
  // is right in the browser, where the server still backstops it, and wrong
  // here, where nothing does: a transient database error became uncapped spend.
  if (spendRes.error) {
    const err = new Error('Could not verify usage against your plan — try again in a moment.')
    ;(err as Error & { code?: string }).code = 'cap_check_failed'
    throw err
  }

  const spendRows = (spendRes.data ?? []) as Array<{ cost_usd: number | null; created_at: string }>
  const spent     = spendRows.reduce((s, r) => s + Number(r.cost_usd || 0), 0)

  // Daily burn, from the same rows. Checked BEFORE the monthly cap so a runaway
  // loop is stopped within hours rather than after it has eaten the month.
  const dayAgo    = Date.now() - 24 * 60 * 60 * 1000
  const dailyCap  = Math.max(DAILY_FLOOR_USD, spendCap * DAILY_FRACTION)
  const spentToday = spendRows
    .filter(r => new Date(r.created_at).getTime() >= dayAgo)
    .reduce((s, r) => s + Number(r.cost_usd || 0), 0)
  if (spentToday >= dailyCap) {
    const err = new Error(
      `Daily limit reached ($${spentToday.toFixed(2)} of $${dailyCap.toFixed(2)} in the last 24 hours). It resets automatically — get in touch if you need it raised.`,
    )
    ;(err as Error & { code?: string }).code = 'daily_limit_exceeded'
    throw err
  }

  if (spent >= spendCap) {
    const err = new Error(`Monthly spend cap of $${spendCap.toFixed(2)} reached ($${spent.toFixed(2)} used)`)
    ;(err as Error & { code?: string }).code = 'spend_cap_exceeded'
    throw err
  }

  // Per-tool count cap. Conversation and internal calls are exempt from the
  // COUNT but were already held to the spend cap above.
  if (!TOOL_CAP_EXEMPT.has(toolId)) {
    const used = toolRes.count ?? 0
    if (used >= toolCap) {
      const err = new Error(`Monthly cap reached for ${toolId}: ${used}/${toolCap}`)
      ;(err as Error & { code?: string }).code = 'cap_exceeded'
      throw err
    }
  }
}


/**
 * ⭐ A DAILY COUNT ON ONE KIND OF CALL. Daniel, on Unstuck Map's "Help me
 * choose": "maybe only can be used twice a day." Enforced HERE, where the money
 * is spent — a limit kept in the browser is a suggestion. Rolling 24 hours, so
 * it does not depend on anybody's timezone.
 * ⚠️ Counted from usage_events, which is written when a call completes; two
 * clicks inside the same second could both pass. The spend caps still stand
 * behind it, and that is an acceptable edge for a two-a-day courtesy limit.
 */
/**
 * ⭐⭐ ONE CEILING FOR UNSTUCK MAP ACROSS EVERY ACCOUNT.
 * 🔴 1 Oct audit: each account has its own $10 cap, signup needs no email
 * confirmation, so many accounts meant many caps — total spend had no limit.
 * This sums the whole product's last 24 hours. WAYOUT_DAILY_CEILING_USD sets it
 * (default $25/day); raise it as real use grows.
 */
async function assertWayoutCeiling(admin: ReturnType<typeof serviceClient>, toolId: string) {
  if (toolId !== 'wayout') return
  const ceiling = Number(Deno.env.get('WAYOUT_DAILY_CEILING_USD') ?? '25')
  if (!Number.isFinite(ceiling) || ceiling <= 0) return
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await admin
    .from('usage_events')
    .select('cost_usd')
    .eq('tool_id', 'wayout')
    .gte('created_at', since)
  if (error) {
    const err = new Error('Could not check today\'s limit — try again in a moment.')
    ;(err as Error & { code?: string }).code = 'cap_check_failed'
    throw err
  }
  const spent = (data ?? []).reduce((t: number, r: { cost_usd: number | null }) => t + Number(r.cost_usd || 0), 0)
  if (spent >= ceiling) {
    console.error('[claude] wayout daily ceiling reached', spent.toFixed(2), '>=', ceiling)
    const err = new Error('Unstuck Map is very busy right now. Your plan is safe — try again in a few hours.')
    ;(err as Error & { code?: string }).code = 'wayout_ceiling'
    throw err
  }
}

/**
 * ⭐ THE PAID WALKTHROUGH, GATED WHERE THE MONEY IS SPENT — ready, and OFF.
 * The playbook prompt could be called by any signed-in account; the database
 * only refused to SAVE it. When payments go live, set
 * WAYOUT_PLAYBOOK_REQUIRES_PAID=true and only a paid session can generate one.
 * ⚠️ Off by default, because today the walkthrough is free for everybody.
 */
async function assertPlaybookPaid(admin: ReturnType<typeof serviceClient>, user: { userId: string }, promptKey?: string) {
  if (!promptKey?.startsWith('WAYOUT_PLAYBOOK')) return
  if (Deno.env.get('WAYOUT_PLAYBOOK_REQUIRES_PAID') !== 'true') return
  const { count } = await admin
    .from('wayout_sessions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.userId)
    .eq('status', 'paid')
  if (!count) {
    const err = new Error('The step-by-step is part of the subscription.')
    ;(err as Error & { code?: string }).code = 'playbook_unpaid'
    throw err
  }
}

/** What a person reads at their allowance. Their plan is untouched either way. */
function wayoutAllowanceMessage(code: string): string {
  if (code === 'daily_limit_exceeded') {
    return 'You have used today’s allowance for new versions and replies. Your plan and everything in it stays exactly as it is — this opens again within 24 hours.'
  }
  const d = new Date()
  const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))
  const when = next.toLocaleDateString('en-CA', { month: 'long', day: 'numeric', timeZone: 'UTC' })
  return `You have used this month’s allowance for new versions and replies. Your plan and everything in it stays exactly as it is — it opens again on ${when}. If something is not working, tell us and we will look.`
}

/**
 * ⭐ ONE EMAIL TO DANIEL PER ACCOUNT PER DAY when an Unstuck Map account hits its
 * cap. A genuine user should never get here, so each case deserves a person:
 * a real paying user gets their cap lifted by hand; anything else is a bug or
 * abuse worth knowing about. Deduped by wayout_cap_alerts (migration 070).
 * ⚠️ Never blocks or changes the response — it is fired and forgotten.
 */
async function alertCapReached(admin: ReturnType<typeof serviceClient>, user: { userId: string; companyId: string }, code: string) {
  const { error: dupe } = await admin.from('wayout_cap_alerts').insert({ company_id: user.companyId, kind: code })
  if (dupe) return // already alerted today (primary key), or the table is unavailable
  const key  = Deno.env.get('RESEND_API_KEY')
  const from = Deno.env.get('RESEND_FROM')
  const to   = Deno.env.get('WAYOUT_ALERT_EMAIL') ?? 'dkalawarny@hotmail.com'
  if (!key || !from) return
  const since = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString()
  const { data } = await admin.from('usage_events').select('cost_usd').eq('company_id', user.companyId).gte('created_at', since)
  const spent = (data ?? []).reduce((t: number, r: { cost_usd: number | null }) => t + Number(r.cost_usd || 0), 0)
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from, to,
      subject: `Unstuck Map: an account hit its ${code === 'daily_limit_exceeded' ? 'daily' : 'monthly'} allowance`,
      text: [
        `An Unstuck Map account reached its ${code === 'daily_limit_exceeded' ? 'daily' : 'monthly'} allowance.`,
        ``,
        `Spent this month: $${spent.toFixed(2)}`,
        `User id: ${user.userId}`,
        `Company id: ${user.companyId}`,
        ``,
        `If this is a real person who needs more, raise their cap (SQL):`,
        `update companies set monthly_spend_cap = 20 where id = '${user.companyId}';`,
        ``,
        `If it looks like abuse or a loop, leave it — it resets on the 1st.`,
      ].join('\n'),
    }),
  })
}

const KIND_DAILY_CAP: Record<string, number> = {
  'wayout:choose': 2,
}

async function assertKindDailyCap(
  admin: ReturnType<typeof serviceClient>,
  companyId: string,
  toolId: string,
  kind: string,
) {
  const cap = KIND_DAILY_CAP[`${toolId}:${kind}`]
  if (!cap) return
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { count, error } = await admin
    .from('usage_events')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .eq('tool_id', toolId)
    .eq('kind', kind)
    .gte('created_at', since)
  // ⚠️ Fail closed, same as the spend check.
  if (error) {
    const err = new Error('Could not check today\'s limit — try again in a moment.')
    ;(err as Error & { code?: string }).code = 'cap_check_failed'
    throw err
  }
  if ((count ?? 0) >= cap) {
    const err = new Error(cap === 2
      ? 'You have used both comparisons for today. They come back within 24 hours.'
      : `You have used all ${cap} for today. They come back within 24 hours.`)
    ;(err as Error & { code?: string }).code = 'kind_daily_limit'
    throw err
  }
}


// ── Usage write ───────────────────────────────────────────────────────────────

async function recordUsage(
  admin: ReturnType<typeof serviceClient>,
  args: {
    companyId: string
    userId:    string | null
    toolId:    string
    kind:      string
    tokensIn:  number
    tokensOut: number
    cacheWrite?: number
    cacheRead?:  number
    cacheTtl?:   string
  },
): Promise<void> {
  const cacheWrite = args.cacheWrite ?? 0
  const cacheRead  = args.cacheRead  ?? 0
  const cost = computeClaudeCost(args.tokensIn, args.tokensOut, cacheWrite, cacheRead, args.cacheTtl === '1h' ? 2 : 1.25)
  const { error } = await admin.from('usage_events').insert({
    company_id: args.companyId,
    user_id:    args.userId,
    tool_id:    args.toolId,
    provider:   'anthropic',
    kind:       args.kind || 'generate',
    // Every input token the model read, cached or not.
    tokens_in:  args.tokensIn + cacheWrite + cacheRead,
    tokens_out: args.tokensOut,
    units:      1,
    cost_usd:   cost,
  })
  // Swallow on failure — same policy as the old browser-side code. We
  // never want a usage-log hiccup to fail a user-visible operation.
  if (error) console.warn('[claude] usage insert failed:', error.message)
}

// ── System payload builder ────────────────────────────────────────────────────
//
// The browser sends EITHER a `systemPrompt` string OR a pre-built
// `systemBlocks` array (when the caller has already structured cache_control
// markers). We accept both and forward whichever was set.
//
// `json: true` appends the standard "respond with valid JSON only" suffix.
// This mirrors the old browser logic so nothing breaks for tool-call sites
// that toggle the flag.

/**
 * Resolve a promptKey to its text. Unknown keys throw rather than silently
 * producing an empty system prompt — a Solomon with no instructions still
 * answers, just as a generic assistant, which is the worst possible failure
 * because it looks like it worked.
 */
function resolvePrompt(key: string): string {
  const text = (PROMPTS as Record<string, unknown>)[key]
  if (typeof text !== 'string' || !text) {
    throw new Error(`Unknown promptKey: ${key}`)
  }
  return text
}

function buildSystem(
  body: {
    promptKey?:       string
    stableContext?:   string
    volatileContext?: string
    cacheTtl?:        string
    systemPrompt?:    string
    systemBlocks?:    unknown[]
    json?:            boolean
  },
): string | unknown[] {
  const jsonSuffix = '\n\nRespond with valid JSON only. Do not include any text outside the JSON. Do not wrap the JSON in markdown code fences.'

  // Caller pre-built the blocks (used when they want prompt caching with
  // a specific cache_control marker). We trust the shape; if json mode is
  // on, append the suffix to the last text block.
  if (Array.isArray(body.systemBlocks)) {
    const blocks = body.systemBlocks.slice() as Array<{ type: string; text: string; cache_control?: unknown }>
    if (body.json && blocks.length > 0) {
      const last = blocks[blocks.length - 1]
      blocks[blocks.length - 1] = { ...last, text: (last.text || '') + jsonSuffix }
    }
    return blocks
  }

  // ⭐ promptKey path — the prompt text never crosses the wire.
  //
  // The blocks are assembled HERE rather than on the client, because the cache
  // marker has to sit at the end of the stable half and the stable half is
  // prompt + context. If the client built the blocks it would need the prompt,
  // which is the whole thing we are trying not to ship.
  //
  // Cache semantics are unchanged: one marked block containing prompt+context,
  // then an unmarked volatile block. The cache key is the exact text up to and
  // including the marker, so keeping this order preserves the ~90% saving.
  // ⭐ ONE punctuation rule for every prompt, both products (Daniel, 5 Oct:
  // dashes "look AI"). Added here once rather than in thirty prompts, so a
  // prompt written next month inherits it. Displays also clean what slips by.
  // Hoisted out of the promptKey branch 7 Oct: the newsletter sends an inline
  // systemPrompt (no promptKey) and was skipping this, so its drafts kept the
  // dashes ("Northgate is Done—and…"). Both paths get it now.
  const NO_DASHES = '\n\nPUNCTUATION: never use an em dash or an en dash between words in anything you write, including inside JSON values. Use a comma, a colon or a full stop instead.'
  if (body.promptKey) {
    /**
     * ⭐ Eliv8 OS speaks the owner's country (6 Oct, US readiness). The prompts
     * were written with Canadian examples (GST, HST, CRA); a US owner was being
     * told about "GST you're holding". One rule for every Eliv8 prompt, read
     * against the location in their business profile. Unstuck Map has its own
     * country handling (the region question) and is left alone.
     */
    const COUNTRY_TERMS = body.promptKey.startsWith('WAYOUT_') ? '' : `

THE OWNER'S COUNTRY: read it from their location in the business context. Use that country's words and authorities, never another's. Canada: GST, HST or PST, the CRA, T4, CPP and EI, provincial rules, dollars. United States: sales tax (it varies by state), the IRS, W-2 and 1099, payroll taxes, state rules, dollars. United Kingdom: VAT, HMRC, PAYE, National Insurance and workplace pensions, pounds. Ireland: VAT, Revenue, PAYE, PRSI and USC, euro. Australia: GST, the ATO, BAS, PAYG withholding and superannuation, state rules, Australian dollars. New Zealand: GST, Inland Revenue, PAYE, KiwiSaver and ACC, New Zealand dollars. Elsewhere: that country's equivalents and currency, named generally if you are not sure. Always write money in the owner's currency. Examples elsewhere in these instructions use Canadian terms; translate them, do not copy them. If the country is genuinely unclear and it changes the answer, ask once.`
    const prompt = resolvePrompt(body.promptKey) + NO_DASHES + COUNTRY_TERMS
    const stable = prompt + (body.stableContext ?? '')

    if (!body.volatileContext && !body.cacheTtl) {
      return stable + (body.json ? jsonSuffix : '')
    }

    const blocks: Array<Record<string, unknown>> = [{
      type: 'text',
      text: stable,
      cache_control: body.cacheTtl
        ? { type: 'ephemeral', ttl: body.cacheTtl }
        : { type: 'ephemeral' },
    }]
    if (body.volatileContext) {
      blocks.push({ type: 'text', text: body.volatileContext + (body.json ? jsonSuffix : '') })
    } else if (body.json) {
      blocks[0].text = stable + jsonSuffix
    }
    return blocks
  }

  // Plain-string path. The newsletter sends its system prompt this way (built
  // inline in Newsletter.jsx), and a stale client mid-deploy may too. It gets
  // NO_DASHES like every other prompt; country terms stay on the promptKey
  // path because they read the business context that path carries.
  const text = (body.systemPrompt ?? '') + NO_DASHES + (body.json ? jsonSuffix : '')
  return text
}

// ── SSE parsing for the observer side-channel ─────────────────────────────────
//
// We tee() Anthropic's stream into (a) the response body forwarded to the
// browser and (b) a side-channel we parse for usage tokens. Anthropic's
// streaming protocol emits:
//
//   event: message_start    { message: { usage: { input_tokens } } }
//   event: content_block_delta { delta: { type: 'text_delta', text: '...' } }
//   event: message_delta    { usage: { output_tokens } }
//   event: message_stop
//
// The side-channel watches for message_start (in tokens) and message_delta
// (out tokens running total) so we have authoritative usage to log on close.

interface ObservedUsage {
  tokensIn:   number
  tokensOut:  number
  cacheWrite: number
  cacheRead:  number
}

async function observeUpstream(
  observe: ReadableStream<Uint8Array>,
  out: ObservedUsage,
): Promise<void> {
  const reader  = observe.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      // SSE events are \n\n delimited
      const events = buffer.split('\n\n')
      buffer = events.pop() ?? ''
      for (const ev of events) {
        for (const line of ev.split('\n')) {
          if (!line.startsWith('data:')) continue
          const payload = line.slice(5).trim()
          if (!payload || payload === '[DONE]') continue
          try {
            const data = JSON.parse(payload)
            if (data.type === 'message_start') {
              const u = data.message?.usage ?? {}
              out.tokensIn   = u.input_tokens ?? out.tokensIn
              out.cacheWrite = u.cache_creation_input_tokens ?? out.cacheWrite
              out.cacheRead  = u.cache_read_input_tokens ?? out.cacheRead
            }
            if (data.type === 'message_delta') {
              out.tokensOut = data.usage?.output_tokens ?? out.tokensOut
            }
          } catch {
            // Ignore malformed lines — Anthropic occasionally sends
            // keepalive comments (lines starting with `: `) which
            // aren't valid JSON. Not worth bailing the stream over.
          }
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight()
  if (req.method !== 'POST')    return json({ error: 'POST only' }, 405)

  try {
    const user = await authedUser(req)

    // The public demo account is read-only: never spend AI on it, no matter
    // what a visitor or bot sends. The UI already blocks this; this is the
    // backstop that makes the demo free and abuse-proof.
    // Every demo company (template + per-visitor clones) is marked is_demo.
    // Never spend AI on them, no matter what a visitor or bot sends.
    const { data: demoCo } = await serviceClient().from('companies').select('is_demo').eq('id', user.companyId).maybeSingle()
    if (demoCo?.is_demo) {
      return json({ error: 'This is a read-only demo. Start a free account to run Solomon on your own business.' }, 403)
    }
    const body = await req.json().catch(() => ({})) as {
      systemPrompt?: string
      systemBlocks?: unknown[]
      messages?:     unknown[]
      model?:        string
      maxTokens?:    number
      json?:         boolean
      stream?:       boolean
      toolId?:       string
      kind?:         string
      tools?:        unknown[]
      toolChoice?:   unknown
      promptKey?:       string
      stableContext?:   string
      volatileContext?: string
      cacheTtl?:        string
      // ⚠️ skipCaps was here and is GONE. It let the caller disable the cap
      // check from the request body. If you are tempted to re-add a client
      // flag that turns off billing limits: that is the vulnerability.
    }

    if (!ANTHROPIC_KEY) {
      return json({ error: 'Server is missing ANTHROPIC_API_KEY' }, 500)
    }

    const admin    = serviceClient()
    /**
     * 🔴 THE CAP KEY USED TO BE WHATEVER THE CLIENT SAID IT WAS. "Help me
     * choose" is capped at two a day on `wayout:choose` — and a caller could send
     * the same promptKey with kind 'thread' and walk straight past it. Where the
     * prompt decides what the call IS, the server decides the label.
     */
    const PINNED: Record<string, { toolId: string; kind: string }> = {
      WAYOUT_CHOOSE_PROMPT: { toolId: 'wayout', kind: 'choose' },
    }
    const pinned   = body.promptKey ? PINNED[body.promptKey] : undefined
    const toolId   = pinned?.toolId ?? body.toolId ?? 'untagged'
    const kind     = pinned?.kind   ?? body.kind   ?? 'generate'
    // Clamped. An unbounded max_tokens makes any single request arbitrarily
    // expensive, which defeats a spend cap that can only measure after the fact.
    const maxTok   = Math.min(Math.max(1, body.maxTokens ?? 1024), MAX_TOKENS_CEILING)
    // ⚠️ Unstuck Map's prompts only ever run on Sonnet or Haiku. A caller asking
    // for anything else on them gets Sonnet — the model is not the client's to
    // escalate on somebody else's spend cap.
    const WAYOUT_MODELS = new Set(['claude-sonnet-4-6', 'claude-haiku-4-5'])
    const asked    = body.model ?? 'claude-sonnet-4-6'
    const model    = body.promptKey?.startsWith('WAYOUT_') && !WAYOUT_MODELS.has(asked) ? 'claude-sonnet-4-6' : asked

    /**
     * ⭐ WHO MAY RUN WHAT (migration 075, src/lib/access.js). The database
     * already stops a teammate READING what their role does not cover; this
     * stops them spending the company's allowance on it — and keeps Solomon
     * the owner's and whoever runs it, which is the whole design.
     * Unknown tool ids are lead-only; only the listed ones open wider.
     */
    const OFFICE_TOOLS = new Set(['cash-flow', 'cfo-dashboard', 'library-analysis'])
    const ALL_TOOLS    = new Set(['safety-vault', 'wayout', 'untagged'])
    const role         = user.role ?? 'member'
    const isLead       = role === 'owner' || role === 'admin'
    const isOffice     = isLead || role === 'cfo'
    if (!(isLead || ALL_TOOLS.has(toolId) || (isOffice && OFFICE_TOOLS.has(toolId)))) {
      return json({ error: 'Your role on this team does not include this. Ask the owner if you need it.', code: 'role_forbidden' }, 403)
    }

    // Authoritative cap check. The browser does its own optimistic check for
    // fast UX; this one is the real thing, and it runs on EVERY request.
    //
    // There is no longer any caller-supplied way around it. Whether a call is
    // exempt from the per-tool COUNT is decided here, from toolId, against
    // TOOL_CAP_EXEMPT. Nothing is exempt from the money.
    try {
      await assertCapsServerSide(admin, user.companyId, toolId)
      await assertKindDailyCap(admin, user.companyId, toolId, kind)
      await assertWayoutCeiling(admin, toolId)
      await assertPlaybookPaid(admin, user, body.promptKey)
    } catch (err) {
      const code = (err as Error & { code?: string }).code
      // ⭐ UNSTUCK MAP, AT ITS ALLOWANCE: a sentence a person can live with, and
      // an email to Daniel. The default message ("Monthly spend cap of $5.00
      // reached ($5.02 used)") showed our costs and read like a bill.
      if (toolId === 'wayout' && (code === 'spend_cap_exceeded' || code === 'daily_limit_exceeded')) {
        alertCapReached(admin, user, code).catch(e => console.error('[claude] cap alert failed', e))
        return json({ error: wayoutAllowanceMessage(code), code }, 429)
      }
      return json(
        { error: (err as Error).message, code },
        429,
      )
    }

    const system = buildSystem(body)

    // Tools ride in front of `system` in Anthropic's request, which means they
    // are part of the cached prefix. Keep the list stable and byte-identical
    // between turns (it is a module-level const on the client) or every turn
    // pays to write the cache again.
    const tools = Array.isArray(body.tools) && body.tools.length ? body.tools : null

    // ⭐⭐ TEMPERATURE, WHICH NOTHING HAS EVER SET. Every call this product has
    // ever made ran at the API default of 1.0 — maximum variability — and
    // Daniel found it the way anybody would: "why's this number keep changing
    // every time I regenerate? I haven't changed any of the write-up."
    //
    // 🔴 THAT IS A TRUST PROBLEM, NOT A TASTE ONE. This whole product rests on
    // "this is what your answers produce". If the same answers produce a
    // different plan each time, then no particular plan meant very much — and
    // a person who notices is right to stop trusting all of them.
    //
    // ⚠️ Clamped to the API's range and defaulted to 1 so nothing that does not
    // ask for it changes behaviour. Callers who want a stable answer ask for
    // one; a conversation can still want some air.
    const temperature = typeof body.temperature === 'number'
      ? Math.min(1, Math.max(0, body.temperature))
      : undefined

    const anthropicReq = {
      model,
      max_tokens: maxTok,
      system,
      messages:   body.messages ?? [],
      stream:     !!body.stream,
      ...(temperature !== undefined ? { temperature } : {}),
      ...(tools ? { tools } : {}),
      // `tool_choice: {type:'none'}` is how a caller ends a tool loop. Dropping
      // `tools` instead would fail: a conversation whose history already holds
      // tool_use blocks must still declare the tools those blocks refer to.
      ...(tools && body.toolChoice ? { tool_choice: body.toolChoice } : {}),
    }

    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':         ANTHROPIC_KEY,
        'anthropic-version': ANTHROPIC_VERSION,
        // Required for prompt-caching `cache_control` markers in the
        // system payload. Always-on is safe — for requests that don't
        // use cache_control, the header is a no-op.
        'anthropic-beta':    'prompt-caching-2024-07-31',
        'content-type':      'application/json',
      },
      body: JSON.stringify(anthropicReq),
    })

    // Non-2xx from Anthropic — bubble the message up cleanly so the
    // browser can show it. Don't leak the request body.
    if (!upstream.ok) {
      const text = await upstream.text().catch(() => '')
      console.error('[claude] upstream error', upstream.status, text.slice(0, 500))
      // ⭐ For ops-check: the status and the provider's own short message —
      // never the request, so nobody's words are kept. Fire and forget.
      admin.from('ops_events').insert({
        kind: 'ai_upstream_error',
        detail: `${upstream.status} ${text.replace(/\s+/g, ' ').slice(0, 240)}`,
      }).then(() => {}, () => {})
      return json(
        // 🔴 The raw provider error used to reach the person verbatim
        // ("Anthropic error 529: {json}"). It is logged above; they get a
        // sentence they can act on.
        { error: upstream.status === 529 || upstream.status === 503
            ? 'That is busy right now. Try again in a minute.'
            : 'That did not come back. Try again in a moment.',
          code: `upstream_${upstream.status}` },
        502,
      )
    }

    // ── Non-streaming path ────────────────────────────────────────────────
    if (!body.stream) {
      const data = await upstream.json() as {
        content?:     Array<{ type: string; text?: string }>
        stop_reason?: string
        usage?:       { input_tokens?: number; output_tokens?: number }
      }
      // Only text blocks concatenate into `text`. A tool_use block has no
      // `.text`, and joining it in would have produced an empty string that
      // looked like a normal (if unhelpful) answer — callers that use tools
      // read `content` and `stop_reason` instead.
      const text = (data.content ?? [])
        .filter(c => c.type === 'text')
        .map(c => c.text ?? '')
        .join('')
      const tokensIn   = data.usage?.input_tokens  ?? 0
      const tokensOut  = data.usage?.output_tokens ?? 0
      const cacheWrite = data.usage?.cache_creation_input_tokens ?? 0
      const cacheRead  = data.usage?.cache_read_input_tokens ?? 0

      // Log usage server-side. Don't await — if it fails, we still want
      // the response to reach the user. Edge functions hold open for
      // background work via waitUntil-style patterns, but a simple
      // fire-and-forget is fine here since the function lifecycle
      // hasn't returned the response yet.
      // ⚠️ ALWAYS RECORD. This was gated on !body.skipCaps, and streamClaude —
      // the Solomon conversation — sends skipCaps:true. So the product's single
      // largest cost driver wrote no usage_event at all, which meant the spend
      // cap summed zero for it and could never fire.
      //
      // The bypass and the blindness compounded: an attacker did not even need
      // the flag to spend freely, because ordinary conversation was already
      // uncounted. Recording is now unconditional; what a call is EXEMPT from
      // is decided by TOOL_CAP_EXEMPT, and that only ever waives the per-tool
      // count, never the money.
      await recordUsage(admin, {
        companyId: user.companyId,
        userId:    user.userId,
        toolId,
        kind,
        tokensIn,
        tokensOut,
        cacheWrite,
        cacheRead,
        cacheTtl: body.cacheTtl,
      })

      return json({
        text,
        content:     data.content ?? [],
        stop_reason: data.stop_reason ?? null,
        usage: { input_tokens: tokensIn, output_tokens: tokensOut, cache_creation_input_tokens: cacheWrite, cache_read_input_tokens: cacheRead },
      })
    }

    // ── Streaming path ────────────────────────────────────────────────────
    //
    // We tee Anthropic's SSE stream into two readers:
    //   1) `forward` — re-emitted to the client as our normalized SSE
    //   2) `observe` — parsed for usage tokens, fired into usage_events
    //                  on stream close
    //
    // The normalized SSE is deliberately tighter than Anthropic's raw
    // format. The client only cares about text deltas; everything
    // else is noise.

    if (!upstream.body) {
      return json({ error: 'No upstream stream body' }, 502)
    }

    const [forward, observe] = upstream.body.tee()
    const observedUsage: ObservedUsage = { tokensIn: 0, tokensOut: 0, cacheWrite: 0, cacheRead: 0 }

    // Kick off the side-channel observer. We *don't* await it here —
    // we want the forward stream to start flowing to the client
    // immediately. The observer runs in parallel; when it finishes
    // (i.e. when the upstream closes), it writes usage_events.
    const observerDone = observeUpstream(observe, observedUsage).then(async () => {
      // Unconditional — see the note on the non-streaming path. This is the
      // branch the Advisor actually uses, so it is the one that was silent.
      await recordUsage(admin, {
        companyId: user.companyId,
        userId:    user.userId,
        toolId,
        kind,
        tokensIn:   observedUsage.tokensIn,
        tokensOut:  observedUsage.tokensOut,
        cacheWrite: observedUsage.cacheWrite,
        cacheRead:  observedUsage.cacheRead,
        cacheTtl:   body.cacheTtl,
      })
    }).catch((err) => {
      console.error('[claude] observer failed:', err)
    })

    // Translate Anthropic SSE → normalized SSE on the fly.
    //
    // Parser state lives in closure variables rather than on `this`. Both are
    // per-request (the TransformStream is constructed inside the handler), and
    // a tool_use block needs three pieces of state that arrive across three
    // different event types — readable beats clever here.
    const enc = new TextEncoder()
    let sseBuffer  = ''
    let stopReason: string | null = null

    // A tool call arrives in pieces: content_block_start carries id + name with
    // an empty input, then the arguments stream in as input_json_delta
    // fragments, then content_block_stop closes it. Keyed by block index
    // because parallel tool calls interleave.
    const openTools = new Map<number, { id: string; name: string; json: string }>()

    const transformer = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        sseBuffer += new TextDecoder().decode(chunk, { stream: true })
        const events = sseBuffer.split('\n\n')
        sseBuffer    = events.pop() ?? ''
        for (const ev of events) {
          for (const line of ev.split('\n')) {
            if (!line.startsWith('data:')) continue
            const payload = line.slice(5).trim()
            if (!payload) continue
            try {
              const data = JSON.parse(payload)

              if (data.type === 'content_block_start' && data.content_block?.type === 'tool_use') {
                openTools.set(data.index, {
                  id:   data.content_block.id,
                  name: data.content_block.name,
                  json: '',
                })
              }

              if (data.type === 'content_block_delta') {
                if (data.delta?.type === 'text_delta' && typeof data.delta.text === 'string') {
                  const out = `data: ${JSON.stringify({ type: 'chunk', text: data.delta.text })}\n\n`
                  controller.enqueue(enc.encode(out))
                }
                if (data.delta?.type === 'input_json_delta' && typeof data.delta.partial_json === 'string') {
                  const open = openTools.get(data.index)
                  if (open) open.json += data.delta.partial_json
                }
              }

              if (data.type === 'content_block_stop' && openTools.has(data.index)) {
                const open = openTools.get(data.index)!
                openTools.delete(data.index)
                // A tool with no arguments streams no input_json_delta at all,
                // so an empty accumulator means `{}`, not a parse failure.
                let input: unknown = {}
                let parseFailed = false
                if (open.json.trim()) {
                  try { input = JSON.parse(open.json) } catch { parseFailed = true }
                }
                const out = parseFailed
                  ? `data: ${JSON.stringify({ type: 'error', message: `Could not read the arguments for ${open.name}.` })}\n\n`
                  : `data: ${JSON.stringify({ type: 'tool_use', id: open.id, name: open.name, input })}\n\n`
                controller.enqueue(enc.encode(out))
              }

              // Why the reply ended. `tool_use` here is what tells the client
              // to run the tools and come back rather than treat the turn as
              // finished — without it a tool call looks like a short answer.
              if (data.type === 'message_delta' && data.delta?.stop_reason) {
                stopReason = data.delta.stop_reason
              }

              if (data.type === 'error') {
                const out = `data: ${JSON.stringify({ type: 'error', message: data.error?.message ?? 'unknown error' })}\n\n`
                controller.enqueue(enc.encode(out))
              }
            } catch {
              // skip malformed lines
            }
          }
        }
      },
      async flush(controller) {
        // Wait for the observer (so usage is written and tokens are
        // accurate) before sending the final `done` event. This keeps
        // the client-side "stream ended" signal tied to the
        // server-side "usage logged" signal.
        try { await observerDone } catch { /* already logged */ }
        const out = `data: ${JSON.stringify({
          type:        'done',
          stop_reason: stopReason,
          usage: { input_tokens: observedUsage.tokensIn, output_tokens: observedUsage.tokensOut },
        })}\n\n`
        controller.enqueue(enc.encode(out))
      },
    })

    const sseStream = forward.pipeThrough(transformer)

    return new Response(sseStream, {
      status:  200,
      headers: {
        ...corsHeaders,
        'content-type':  'text/event-stream',
        'cache-control': 'no-cache',
        'connection':    'keep-alive',
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[claude]', message)
    return new Response(JSON.stringify({ error: message }), {
      status:  message.startsWith('auth:') ? 401 : 500,
      headers: { ...corsHeaders, 'content-type': 'application/json' },
    })
  }
})
