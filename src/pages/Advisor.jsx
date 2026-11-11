import { forwardRef, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { isDemoCompany } from '../lib/demo'
import { callClaude, streamClaudeTurn, SONNET, HAIKU } from '../lib/anthropic'
import { SOLOMON_TOOLS, runSolomonTool, describeToolUse } from '../lib/solomonTools'
import { prepareChatImage, chatImageUrl, saveChatImageToLibrary, isImageFile, ACCEPTED_IMAGE_TYPES } from '../lib/chatImages'
import { speak, stopSpeaking, listen, dictationSupported } from '../lib/voice'
import { pickAdvisorModel, explainModelChoice } from '../lib/advisorCascade'
import { assertWithinSpendCap, isSpendCapExceeded, getMonthlyUsageSummary, DEFAULT_SPEND_CAP_USD } from '../lib/usage'
import SpendCapBanner from '../components/tools/SpendCapBanner'
import ToolDisclaimer from '../components/tools/ToolDisclaimer'
import { buildAdvisorContext, STALE_FINANCIALS_DAYS } from '../lib/advisorContext'
import { fetchLatestSnapshots, syncQuickBooks, fetchIntegration } from '../lib/quickbooks'
import { indexChatExchange } from '../lib/rag/chatIndexer'
import SolomonLauncher from '../components/advisor/SolomonLauncher'
import { rememberFromExchange, claimDueCommitment } from '../lib/memory'
import { plainDashes } from '../lib/plainDashes'

/**
 * Advisor — the owner's daily AI coaching chat.
 *
 * This is a unified experience: the Advisor IS the daily check-in.
 * On the first open of each day, Claude reads the owner's full business
 * context — overdue milestones, last check-in challenge, roadmap status,
 * day of week — and sends a personalised morning opener. The owner replies
 * naturally and the conversation continues from there.
 *
 * Why this works:
 *   - No generic "how are you doing?" — Claude opens with something specific
 *   - Every reply is grounded in the owner's actual situation right now
 *   - The daily habit (open Advisor first thing) is built organically
 *   - Historical context accumulates: Claude can reference what you said last Monday
 *
 * Morning opener logic:
 *   - Checks localStorage key `gos_morning_<userId>_<date>` on load
 *   - If not sent today: generates a short opener from Claude (200 tokens)
 *     saved to chat_messages so it persists in history
 *   - If already sent today: loads normally (opener already in DB history)
 */

const HISTORY_TURNS_SENT = 20

// ⭐ How many times Solomon may run tools before he has to answer in words.
//
// After this many rounds the next call goes out with no tools attached at all,
// which forces a written answer rather than another tool call. A ceiling that
// merely stops the loop would leave the owner staring at a bubble that never
// resolves; this one guarantees the turn ends with something to read.
//
// Three is not a cost decision — the spend cap is — it is a shape decision.
// A conversational answer that needed four rounds of tools was the wrong shape
// for a conversation.
const MAX_TOOL_ROUNDS = 3

// ── localStorage helper for morning opener tracking ──────────────────────────

function todayDate() {
  const d = new Date()
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-')
}

// Detect touch-only devices (phones / tablets). On these, Enter must produce
// a newline — sending happens only via the Send button. On desktop, Enter
// sends and Shift+Enter is a newline (the long-standing chat convention).
function isTouchDevice() {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(pointer: coarse)').matches
}

const OPENER_VERSION = 'v2'
function morningKey(userId)    { return `gos_morning_${userId}_${todayDate()}`                   }
function openerTextKey(userId) { return `gos_opener_text_${OPENER_VERSION}_${userId}_${todayDate()}` }

function hasOpenedToday(userId) {
  try { return !!localStorage.getItem(morningKey(userId)) }
  catch { return false }
}

// Check if the Dashboard already generated and cached the opener text.
// If so, Advisor should skip re-generating to avoid a duplicate DB entry.
function dashboardAlreadyGeneratedOpener(userId) {
  try { return !!localStorage.getItem(openerTextKey(userId)) }
  catch { return false }
}

function markOpenedToday(userId) {
  try { localStorage.setItem(morningKey(userId), '1') }
  catch { /* storage blocked */ }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function Advisor() {
  const { profile, company } = useAuth()
  const [messages,        setMessages]        = useState([])
  /**
   * ⭐⭐ OFF THE RECORD. Daniel, 4 Oct: "an incognito mode for personal
   * questions the owner doesn't want people to see — no memory stored."
   * While it is on, nothing about the conversation is written anywhere:
   * no chat_messages rows, no notes (solomon_memory), no long-term index
   * (chat_chunks), no photos (they upload to storage), no tool runs (they save
   * to the Library), no "save to documents". It lives in this page's state and
   * is gone when switched off or when the page closes. Solomon can still READ
   * the business to answer. What is still recorded: the COST of each reply in
   * usage_events — never its content.
   */
  const [offRecord,       setOffRecord]       = useState(false)
  const onRecordRef = useRef([])
  function toggleOffRecord() {
    if (sending) return
    if (!offRecord) {
      onRecordRef.current = messages
      setMessages([])
      setAttachment(null)
      setOffRecord(true)
    } else {
      setMessages(onRecordRef.current)
      setOffRecord(false)
    }
    setError(null)
  }
  // A question handed over from another page (the price check does this) lands
  // in the box, unsent, so the owner reads it and decides whether to ask.
  const [input,           setInput]           = useState(() => {
    try { return new URLSearchParams(window.location.search).get('ask') ?? '' } catch { return '' }
  })
  const [loading,         setLoading]         = useState(true)
  const [sending,         setSending]         = useState(false)
  const [generatingOpen,  setGeneratingOpen]  = useState(false) // morning opener in flight
  const [toolActivity,    setToolActivity]    = useState(null)  // "Building the 13-week cash flow"
  const [attachment,      setAttachment]      = useState(null)  // File pending on the next send
  const [error,           setError]           = useState(null)
  const [spendInfo,       setSpendInfo]       = useState(null)  // { used, cap }
  // Age of the accounting sync. Null until checked; { daysOld } only when it is
  // actually stale — a strip that renders on fresh data is noise, and noise is
  // how a real warning gets ignored.
  const [staleBooks,      setStaleBooks]      = useState(null)
  const [syncing,         setSyncing]         = useState(false)

  const bottomRef = useRef(null)
  const inputRef  = useRef(null)

  // ── Fetch monthly spend for the header budget indicator ──────────────────

  useEffect(() => {
    if (!profile?.company_id) return
    getMonthlyUsageSummary(profile.company_id).then(summary => {
      setSpendInfo({ used: summary.totalCost, cap: summary.cap ?? DEFAULT_SPEND_CAP_USD })
    }).catch(() => {})
  }, [profile?.company_id])

  // ── How old are the books? ─────────────────────────────────────────────────
  //
  // QuickBooks syncs only when somebody clicks it — there is no cron, by
  // design. So the one place the owner is actually reading numbers is the one
  // place that never told him how old they were.

  useEffect(() => {
    if (!profile?.company_id) return
    let cancelled = false
    ;(async () => {
      try {
        const integration = await fetchIntegration(profile.company_id)
        if (cancelled || integration?.status !== 'connected') return
        const snaps = await fetchLatestSnapshots(profile.company_id, { limit: 1 })
        if (cancelled) return
        const syncedAt = Date.parse(snaps?.[0]?.synced_at ?? '')
        if (!Number.isFinite(syncedAt)) return
        const daysOld = Math.floor((Date.now() - syncedAt) / 86_400_000)
        setStaleBooks(daysOld > STALE_FINANCIALS_DAYS ? { daysOld } : null)
      } catch { /* non-fatal — the strip is a courtesy, not a gate */ }
    })()
    return () => { cancelled = true }
  }, [profile?.company_id])

  async function handleSyncBooks() {
    if (syncing) return
    setSyncing(true)
    try {
      await syncQuickBooks()
      setStaleBooks(null)
    } catch (err) {
      setError(err.message || 'Could not refresh from QuickBooks.')
    } finally {
      setSyncing(false)
    }
  }

  // ── Generate and save the morning opener ──────────────────────────────────

  const generateMorningOpener = useCallback(async () => {
    if (!profile?.company_id || !profile?.id) return
    // The demo is refused at the edge, so asking only puts a 403 in the
    // console on every visit to this page (found in the 11 Nov audit).
    if (isDemoCompany(company)) return
    setGeneratingOpen(true)
    try {
      const context = await buildAdvisorContext(profile.company_id, { userId: profile.id })

      // ⭐ The one thing he said he would do that has come due and has never
      // been asked about. This is the whole reason the opener is allowed to
      // speak at all on most days — everything else it might raise (a
      // milestone, a job closing) he can already see on a screen. Nobody else
      // in his life asks him this.
      //
      // Claiming it MARKS it asked, whether or not the model ends up using it.
      // See claimDueCommitment — one ask per commitment, ever, deliberately.
      const owed = await claimDueCommitment(profile.company_id, profile.id).catch(() => null)

      // Lightweight prompt — 200 tokens max. Reads context, asks one specific question.
      const openerContext = context
        ? `\n\nBUSINESS_CONTEXT:\n${JSON.stringify(context, null, 2)}`
        : ''

      const h = new Date().getHours()
      const tod = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
      const dayStr = new Date().toLocaleDateString('en-US', { weekday: 'long', hour: 'numeric', hour12: true })
      const ownerFirst = profile?.name?.split(' ')[0] ?? 'there'
      const opener = await callClaude({
        model: HAIKU,
        promptKey:     'MORNING_OPENER_PROMPT',
        stableContext: openerContext,
        messages: [{ role: 'user', content: [
          `Open the check-in. The owner's name is ${ownerFirst}, use ONLY this name in your greeting, no other names.`,
          `Time context: ${tod}, ${dayStr}.`,
          owed
            ? `\n\nHE SAID HE WOULD DO THIS AND YOU HAVE NEVER ASKED:\n"${owed.statement}"${owed.due_on ? ` (by ${owed.due_on})` : ''}${owed.detail ? `\nContext: ${owed.detail}` : ''}\nAsk him about it, once, plainly. See FOLLOWING UP ON WHAT HE SAID HE WOULD DO.`
            : '',
        ].filter(Boolean).join(' ') }],
        maxTokens: 120,
      })

      // ⚠️ 3 Sep — SKIP means say nothing. Daniel, on the daily opener: "is the
      // daily response always going to be like this, I feel like it could get
      // annoying." He was right, and the cause was structural: the prompt
      // required a question EVERY day, with a generic fallback when there was
      // nothing real to ask. A message that arrives whether or not there is
      // something to say is a notification, and notifications get ignored —
      // which then costs us the mornings when there IS something.
      //
      // Most days should now be silent. That is the correct outcome, not a
      // failure, and there is deliberately no fallback message here.
      const trimmed = (opener ?? '').trim()
      if (!trimmed || /^SKIP\b/i.test(trimmed)) return

      // Save to DB so it's part of permanent conversation history.
      const { data: row, error: err } = await supabase
        .from('chat_messages')
        .insert({
          company_id: profile.company_id,
          user_id:    profile.id,
          chat_type:  'advisor',
          role:       'assistant',
          content:    trimmed,
        })
        .select()
        .single()

      if (!err && row) {
        setMessages(prev => [...prev, row])
      }
    } catch {
      // Non-fatal — opener failed, user can still chat normally
    } finally {
      setGeneratingOpen(false)
    }
  }, [profile?.company_id, profile?.id, company])

  // ── Load history + trigger morning opener ────────────────────────────────

  useEffect(() => {
    if (!profile?.company_id || !profile?.id) return
    let cancelled = false

    ;(async () => {
      const { data } = await supabase
        .from('chat_messages')
        .select('id, role, content, source_documents, created_at')
        .eq('company_id', profile.company_id)
        .eq('user_id', profile.id)
        .eq('chat_type', 'advisor')
        .order('created_at', { ascending: true })

      if (cancelled) return

      const history = data ?? []
      setMessages(history)
      setLoading(false)

      // Don't stack greetings. The only gate used to be "first open today", so
      // an owner who didn't reply collected one unanswered hello per day — the
      // live thread had four in a row, which reads as an app talking to itself.
      //
      // An unanswered opener is the last message, from the assistant, and
      // short. A real answer runs much longer, so the length test separates
      // "he greeted me and I ignored it" from "he answered me properly".
      // Imperfect, but it fails in the safe direction: worst case one greeting
      // is skipped, which costs nothing.
      const last = history[history.length - 1]
      const greetingLeftHanging =
        last && last.role === 'assistant' && (last.content ?? '').length < 400

      if (!hasOpenedToday(profile.id) && !dashboardAlreadyGeneratedOpener(profile.id) && !greetingLeftHanging) {
        markOpenedToday(profile.id)
        generateMorningOpener()
      } else {
        // Dashboard already handled it — just mark as opened so the sidebar
        // pulse dot clears correctly.
        markOpenedToday(profile.id)
      }
    })()

    return () => { cancelled = true }
  }, [profile?.company_id, profile?.id, generateMorningOpener])

  // ── Auto-scroll ───────────────────────────────────────────────────────────

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, sending, generatingOpen, toolActivity])

  // ── Send message ──────────────────────────────────────────────────────────

  async function handleSend(e) {
    e?.preventDefault()
    const text = input.trim()
    // ⭐ An attached image is a complete message on its own. Requiring text
    // alongside it would mean an owner holding up a quote has to caption his
    // own photograph before Solomon will look at it.
    if ((!text && !attachment) || sending || !profile?.company_id) return

    // Demo shows a seeded conversation; live chat is for a real account
    // (also refused at the edge, so it never costs anything here).
    if (isDemoCompany(company)) {
      setError('This is a read-only demo. Start your own free account to ask Solomon about your business.')
      return
    }

    setError(null)
    setSending(true)

    // 0. Spend cap check — block before any DB write or Claude call.
    try {
      await assertWithinSpendCap(profile.company_id)
    } catch (err) {
      // Store the full error object for spend cap — Composer renders SpendCapBanner.
      setError(isSpendCapExceeded(err) ? err : 'Could not verify usage limits. Please try again.')
      setSending(false)
      return
    }

    // 0b. Prepare the attachment, if there is one. Done BEFORE the user turn is
    // written so a failure (HEIC a browser can't decode, oversized file) leaves
    // no half-message in the thread — the composer keeps the image and says why.
    let image = null
    if (attachment) {
      try {
        image = await prepareChatImage(attachment, { companyId: profile.company_id })
      } catch (err) {
        setError(err.message ?? 'Could not read that image.')
        setSending(false)
        return
      }
    }

    // 1. Persist user turn.
    //
    // The stored content keeps a plain marker for the image. `content` is text
    // and the replayed history is text-only, so without this an image-only turn
    // would persist as an empty string — a blank bubble on reload, and a gap in
    // the history Solomon reads back.
    const storedContent = image
      ? [text, `[image: ${image.name}]`].filter(Boolean).join('\n\n')
      : text

    const { data: userRow, error: userErr } = offRecord
      ? { data: { id: `off-${Date.now()}`, role: 'user', content: storedContent, created_at: new Date().toISOString() }, error: null }
      : await supabase
      .from('chat_messages')
      .insert({
        company_id: profile.company_id,
        user_id:    profile.id,
        chat_type:  'advisor',
        role:       'user',
        content:    storedContent,
        // Reuses the column the artifact chips ride in. Shape is discriminated
        // by `type`, so a turn can carry an image, an artifact, or both.
        source_documents: image?.storagePath
          ? [{ type: 'image', path: image.storagePath, name: image.name }]
          : [],
      })
      .select()
      .single()

    if (userErr) {
      setError(`Could not save your message: ${userErr.message}`)
      setSending(false)
      return
    }

    const nextMessages = [...messages, userRow]
    setMessages(nextMessages)
    setInput('')
    setAttachment(null)

    // Streaming placeholder — shown while Claude streams the reply.
    // We render it as a special 'streaming' message so the bubble updates live.
    const STREAM_ID = '__streaming__'
    setMessages(prev => [...prev, { id: STREAM_ID, role: 'assistant', content: '' }])

    try {
      // 2. Fresh context — RAG mode when query provided.
      const context = await buildAdvisorContext(profile.company_id, { userId: profile.id, query: text })

      // 3. Build system prompt with context + long-term memory.
      const historySlice = nextMessages.slice(-HISTORY_TURNS_SENT).map(m => ({
        role:    m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      }))

      // ⭐ The image rides on THIS turn only, as real content blocks — Solomon
      // looks at the photograph rather than reading a description of it.
      //
      // ⚠️ Deliberately not replayed on later turns. History is text-only, and
      // re-attaching every past image would make an owner who shared four
      // photos pay for all four on every message after. What carries forward is
      // Solomon's own reply plus the [image: …] marker. See lib/chatImages.js.
      if (image && historySlice.length) {
        const last = historySlice[historySlice.length - 1]
        historySlice[historySlice.length - 1] = {
          role: 'user',
          content: [
            image.block,
            // An image with no caption still needs a text block — a bare image
            // gives the model nothing to answer.
            { type: 'text', text: text || 'Take a look at this and tell me what you make of it.' },
          ],
        }
        void last
      }
      const ownerFirst  = profile?.name?.split(' ')[0] ?? 'there'

      // Split the system payload so prompt caching can actually hit.
      //
      // Everything up to and including the cache marker has to be
      // byte-identical between turns or the entry is missed. Semantic search
      // hits, the safety brief and recalled conversations all change with the
      // QUESTION, so folding them in with the instructions — which is what
      // this did — meant a guaranteed miss on every message while the code
      // claimed a 90% saving. Stable material first, per-question material
      // strictly after.
      const {
        knowledge_files: volKnowledge,
        safety_context:  volSafety,
        past_conversations: volPast,
        today_pulse:     volPulse,
        today:           volToday,
        ...stableContext
      } = context ?? {}

      const stableBlock = context
        ? `\n\nOWNER: You are speaking with ${ownerFirst}. Always use this name when addressing them — never use any other person's name from the business context.\n\nBUSINESS_CONTEXT:\n${JSON.stringify(stableContext, null, 2)}`
        : `\n\nOWNER: You are speaking with ${ownerFirst}. Always use this name when addressing them.`

      const volatileParts = []
      // `today` goes here, not in the stable block. It changes daily, and the
      // cache key is the exact stable text — parking it there would throw away
      // the cached prefix every midnight for a value that costs nothing to
      // resend. It leads the volatile section because a date is useless if the
      // model has stopped reading by the time it arrives.
      if (volToday)     volatileParts.push(`TODAY: ${volToday.weekday}, ${volToday.date}`)
      if (volPast)      volatileParts.push(String(volPast))
      if (volPulse)     volatileParts.push(`TODAY_PULSE:\n${JSON.stringify(volPulse, null, 2)}`)
      if (volKnowledge) volatileParts.push(`RELEVANT_FROM_YOUR_LIBRARY:\n${JSON.stringify(volKnowledge, null, 2)}`)
      if (volSafety)    volatileParts.push(`SAFETY_CONTEXT:\n${JSON.stringify(volSafety, null, 2)}`)
      if (offRecord)    volatileParts.push('OFF_THE_RECORD: The owner has switched this conversation off the record. Nothing from it is saved or remembered once it ends. Never say you will remember, note down, follow up on, or bring back anything from it. Answer fully all the same.')

      // ⭐ The prompt is no longer sent — only its KEY. ADVISOR_SYSTEM_PROMPT is
      // 21k characters of Solomon and it used to ship to the browser, where
      // anyone could fetch it unauthenticated. The edge function resolves the
      // key and prepends the text to stableContext, so the cached block is the
      // same string it always was and the ~90% caching saving is unchanged.
      const systemVolatile = volatileParts.length ? `\n\n${volatileParts.join('\n\n')}` : undefined

      // 4. Stream the reply — update the placeholder bubble on every chunk.
      //
      // Model choice: cascade router picks Haiku for retrieval-grounded
      // factual lookups (safety_context populated + lookup-style question),
      // Sonnet for everything else. Default bias is Sonnet — strategy
      // questions never get downgraded. See lib/advisorCascade.js.
      const choice = explainModelChoice(text, context)
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.log(`[advisor] model=${choice.model.split('-')[1]} reason=${choice.reason}`)
      }
      // ⭐ THE TOOL LOOP. Solomon can now run the tools himself rather than
      // only talking about them — see lib/solomonTools.js for what he can run
      // and why the loop lives here in the browser instead of in the Edge
      // Function.
      //
      // Each pass streams into the same bubble. `parts` holds the text from
      // completed passes so a sentence he wrote before reaching for a tool
      // ("Let me pull the actual numbers") is still on screen while the tool
      // runs, and survives into what gets saved.
      const convo     = [...historySlice]
      const parts     = []
      const artifacts = []

      for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
        // The last pass can no longer call anything — tool_choice 'none'. The
        // tools stay DECLARED: a conversation whose history already contains
        // tool_use blocks must still define the tools they refer to, and
        // keeping the list identical also keeps the cached prefix intact.
        const lastRound = round === MAX_TOOL_ROUNDS
        const prefix    = parts.length ? `${parts.join('\n\n')}\n\n` : ''

        const leg = await streamClaudeTurn({
          model:     choice.model,
          promptKey:     'ADVISOR_SYSTEM_PROMPT',
          stableContext: stableBlock,
          systemVolatile,
          messages:  convo,
          // Off the record: no tools — running one saves its result to the Library.
          tools:      offRecord ? undefined : SOLOMON_TOOLS,
          toolChoice: offRecord ? undefined : lastRound ? { type: 'none' } : undefined,
          maxTokens: 2000,
          onChunk: (_chunk, fullText) => {
            setMessages(prev => prev.map(m =>
              m.id === STREAM_ID ? { ...m, content: prefix + fullText } : m
            ))
          },
        })

        if (leg.text.trim()) parts.push(leg.text.trim())

        // The presence of tool_use blocks is the signal, not stop_reason. They
        // agree in practice, but if the `done` event ever arrives without a
        // stop reason, trusting it would drop a tool call on the floor and
        // leave the owner an answer that quietly skipped the work.
        if (leg.toolUses.length === 0) break

        // Replay the assistant turn exactly as it was issued — the tool_use
        // blocks have to come back with their ids or the tool_results below
        // have nothing to attach to. An empty text block is rejected by the
        // API, so it is included only when he actually said something.
        convo.push({
          role: 'assistant',
          content: [
            ...(leg.text.trim() ? [{ type: 'text', text: leg.text }] : []),
            ...leg.toolUses.map(t => ({ type: 'tool_use', id: t.id, name: t.name, input: t.input })),
          ],
        })

        // Run them in order. Sequential rather than parallel on purpose: a
        // tool run is a Claude call of its own, and firing several at once
        // races them against the same spend cap with no way to say which one
        // tripped it.
        const results = []
        for (const toolUse of leg.toolUses) {
          setToolActivity(describeToolUse(toolUse))
          const outcome = await runSolomonTool({
            toolUse,
            companyId: profile.company_id,
            userId:    profile.id,
            context,
          })
          results.push(outcome.block)
          if (outcome.artifact) artifacts.push(outcome.artifact)
        }
        setToolActivity(null)

        // Every tool_result for a turn goes back in ONE user message. Splitting
        // them teaches the model to stop asking for more than one at a time.
        convo.push({ role: 'user', content: results })
      }

      setToolActivity(null)
      const reply = parts.join('\n\n')

      if (!reply) throw new Error('Empty response from Claude.')

      // 4b. Write down anything durable from this exchange.
      //
      // Deliberately NOT awaited: memory is a background concern and must
      // never sit between the owner and their reply. A failure in here is
      // logged and swallowed — a missed fact is a small loss, a blocked
      // conversation is not.
      if (!offRecord) rememberFromExchange({
        companyId:        profile.company_id,
        userId:           profile.id,
        userMessage:      text,
        assistantMessage: reply,
      })

      // 5. Persist the completed reply, swap placeholder with the real DB row.
      const { data: assistantRow, error: asstErr } = offRecord
        ? { data: { id: `off-${Date.now()}-a`, role: 'assistant', content: reply, source_documents: [], created_at: new Date().toISOString() }, error: null }
        : await supabase
        .from('chat_messages')
        .insert({
          company_id: profile.company_id,
          user_id:    profile.id,
          chat_type:  'advisor',
          role:       'assistant',
          content:    reply,
          // Anything Solomon built this turn. The column already existed and
          // was always '[]' — it is exactly the right shape for this, so the
          // artifact chips survive a reload without a migration.
          source_documents: artifacts,
        })
        .select()
        .single()

      if (asstErr) throw new Error(asstErr.message)
      setMessages(prev => prev.map(m => m.id === STREAM_ID ? assistantRow : m))

      // Index for long-term memory (background, non-blocking).
      if (!offRecord) indexChatExchange({
        companyId:      profile.company_id,
        userId:         profile.id,
        userMessage:    text,
        assistantReply: reply,
        occurredAt:     new Date(),
      })?.catch?.(() => {})
    } catch (err) {
      // Remove the streaming placeholder on error.
      setMessages(prev => prev.filter(m => m.id !== STREAM_ID))
      setError(isSpendCapExceeded(err) ? err : (err.message ?? 'Something went wrong.'))
    } finally {
      setToolActivity(null)
      setSending(false)
      inputRef.current?.focus()
    }
  }

  async function handleSaveMessage(content) {
    if (!profile?.company_id) return
    const title = content.replace(/\s+/g, ' ').trim().slice(0, 80) + (content.length > 80 ? '…' : '')
    await supabase.from('documents').insert({
      company_id:  profile.company_id,
      user_id:     profile.id,
      tool_id:     'solomon',
      title,
      output_data: { content },
    })
  }

  function handleKeyDown(e) {
    // On touch devices, never send via Enter — Enter must always add a newline.
    // Mobile keyboards have no Shift+Enter shortcut, so the desktop pattern
    // would make typing multi-line replies impossible.
    if (e.key === 'Enter' && !e.shiftKey && !isTouchDevice()) {
      e.preventDefault()
      handleSend()
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--color-ink-50)' }}>
      <Header companyName={company?.name} spendInfo={spendInfo} offRecord={offRecord} onToggleOffRecord={toggleOffRecord} />
      {offRecord && (
        <div className="px-4 sm:px-6 py-2.5 flex-shrink-0 text-center text-[12.5px] leading-relaxed" style={{ background: '#1F2A28', color: '#E8EEEC' }}>
          <b>Off the record.</b> Nothing here is saved or remembered, and nobody else on your account can see it. It disappears when you switch this off or leave the page.
        </div>
      )}

      {/* The refresh sits HERE — in the room where the numbers get used —
          rather than only in Settings and on the CFO page, which is where it
          lived and where nobody is standing when Solomon quotes a figure.
          Appears only when the sync is genuinely stale, so it means something
          when it does. */}
      {staleBooks && (
        <div
          className="px-4 sm:px-6 py-2 flex-shrink-0 flex items-center justify-center gap-3 text-[12.5px]"
          style={{ background: 'rgba(245,158,11,0.10)', borderBottom: '1px solid rgba(245,158,11,0.25)' }}
        >
          <span style={{ color: '#8a5a00' }}>
            Your books were last synced {staleBooks.daysOld} days ago.
          </span>
          <button
            type="button"
            onClick={handleSyncBooks}
            disabled={syncing}
            className="font-semibold underline underline-offset-2 disabled:opacity-50"
            style={{ color: '#8a5a00' }}
          >
            {syncing ? 'Refreshing…' : 'Refresh from QuickBooks'}
          </button>
        </div>
      )}

      <div className="flex-1 min-h-0 flex">
       <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-6">
          {loading ? (
            <LoadingHistory />
          ) : messages.length === 0 && !generatingOpen ? (
            <WelcomeBlock profile={profile} onPick={q => { setInput(q); inputRef.current?.focus() }} />
          ) : (
            <div className="space-y-1.5">
              {messages.map(m => (
                <Bubble
                  key={m.id}
                  role={m.role}
                  content={m.content}
                  artifacts={m.source_documents}
                  streaming={m.id === '__streaming__'}
                  onSave={offRecord ? undefined : handleSaveMessage}
                  companyId={profile?.company_id}
                  userId={profile?.id}
                />
              ))}
              {generatingOpen && <MorningThinkingBubble />}
              {/* What he's off doing. Sits under the bubble so the sentence he
                  wrote before reaching for the tool stays readable. */}
              {toolActivity && <ToolActivity label={toolActivity} />}
              {/* ThinkingBubble only shows before first chunk arrives */}
              {sending && !toolActivity && !messages.some(m => m.id === '__streaming__' && m.content) && <ThinkingBubble />}
            </div>
          )}
          <div ref={bottomRef} />
        </div>
       </div>

       {/* Everything Solomon can do stays visible; clicking seeds the
           conversation rather than opening another form page. */}
       <SolomonLauncher
         onPick={seed => { setInput(seed); inputRef.current?.focus() }}
       />
      </div>

      <Composer
        ref={inputRef}
        value={input}
        onChange={setInput}
        onKeyDown={handleKeyDown}
        onSend={handleSend}
        disabled={sending || generatingOpen}
        error={error}
        attachment={attachment}
        onAttach={f => {
          // Photos upload to storage, so they cannot be off the record.
          if (f && offRecord) { setError('Photos are saved when sent, so they cannot go off the record.'); return }
          setError(null); setAttachment(f)
        }}
      />
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Header({ companyName, spendInfo, offRecord = false, onToggleOffRecord }) {
  const dayLabel = new Date().toLocaleDateString('en-US', { weekday: 'long' })

  // Budget pill — only show once data is loaded and there's meaningful spend
  const budgetPill = spendInfo ? (() => {
    const pct     = Math.min(spendInfo.used / spendInfo.cap, 1)
    const remaining = Math.max(spendInfo.cap - spendInfo.used, 0)
    const isNearCap = pct >= 0.8
    const color = isNearCap ? 'rgba(251,191,36,0.7)' : 'rgba(13,20,19,0.25)'
    return (
      <div
        className="hidden sm:flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium"
        style={{ background: 'rgba(13,20,19,0.04)', border: '1px solid rgba(13,20,19,0.09)', color }}
        title={`$${spendInfo.used.toFixed(2)} of $${spendInfo.cap.toFixed(0)} monthly budget used`}
      >
        <span style={{ color }}>
          ${remaining.toFixed(2)} left
        </span>
      </div>
    )
  })() : null

  return (
    <header className="px-4 sm:px-6 py-3 sm:py-3.5 flex-shrink-0" style={{ background: '#FFFFFF', borderBottom: '1px solid rgba(13,20,19,0.08)' }}>
      <div className="max-w-3xl mx-auto flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.3)' }}>
            <span className="text-sm" aria-hidden>💡</span>
          </div>
          <div className="min-w-0">
            <h1 className="text-sm font-bold text-ink-900 leading-tight">Solomon</h1>
            <p className="text-[11px] text-ink-300 truncate">
              {dayLabel}{companyName ? ` · ${companyName}` : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
          {budgetPill}
          {onToggleOffRecord && (
            <button
              type="button"
              onClick={onToggleOffRecord}
              aria-pressed={offRecord}
              title={offRecord ? 'Back on the record. This conversation will be cleared' : 'Ask something personal: nothing saved, nothing remembered'}
              className="flex items-center gap-1.5 text-xs font-semibold px-2.5 sm:px-3 py-1.5 rounded-lg transition-colors"
              style={offRecord
                ? { color: '#FFFFFF', background: '#1F2A28', border: '1px solid #1F2A28' }
                : { color: 'rgba(13,20,19,0.55)', background: 'rgba(13,20,19,0.05)', border: '1px solid rgba(13,20,19,0.10)' }}
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5" aria-hidden>
                <rect x="3.5" y="7" width="9" height="6.5" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 015 0v2"/>
              </svg>
              <span>{offRecord ? 'Off the record, end' : 'Off the record'}</span>
            </button>
          )}
          <Link
            to="/checkins"
            aria-label="Log check-in"
            className="flex items-center gap-1.5 text-xs font-medium transition-colors px-2.5 sm:px-3 py-1.5 rounded-lg"
            style={{ color: 'rgba(13,20,19,0.45)', background: 'rgba(13,20,19,0.05)', border: '1px solid rgba(13,20,19,0.10)' }}
            onMouseEnter={e => { e.currentTarget.style.color = '#0D1413'; e.currentTarget.style.background = 'rgba(13,20,19,0.10)' }}
            onMouseLeave={e => { e.currentTarget.style.color = 'rgba(13,20,19,0.45)'; e.currentTarget.style.background = 'rgba(13,20,19,0.05)' }}
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
              <path d="M8 2v4l2.5 2.5"/>
              <circle cx="8" cy="8" r="6"/>
            </svg>
            <span className="hidden sm:inline">Log check-in</span>
          </Link>
          {/* Online indicator hidden on mobile to keep header tight */}
          <div className="hidden sm:flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-green-600" aria-hidden />
            <span className="text-xs text-green-700 font-medium">Online</span>
          </div>
        </div>
      </div>
    </header>
  )
}

function LoadingHistory() {
  return (
    <div className="space-y-2 pt-4">
      {[1, 2, 3].map(i => (
        <div key={i} className={`flex ${i % 2 === 0 ? 'justify-end' : 'justify-start'}`}>
          <div
            className="h-12 rounded-2xl animate-pulse"
            style={{
              width: i % 2 === 0 ? '48%' : '62%',
              background: i % 2 === 0 ? 'rgba(180,83,9,0.3)' : 'rgba(13,20,19,0.05)',
            }}
          />
        </div>
      ))}
    </div>
  )
}

function WelcomeBlock({ profile, onPick }) {
  const firstName = profile?.name?.split(' ')[0] ?? 'there'
  const allStarters = [
    "What's the single biggest lever I can pull this quarter?",
    "Walk me through my most important milestone in detail.",
    "Is my pricing leaving money on the table?",
    "What's a risk in my plan I'm probably not seeing?",
    "How do I know if I'm ready to hire another tech?",
    "Where is my cash flow most exposed right now?",
    "What would you cut first if I needed to drop overhead by 15%?",
    "Am I growing fast enough, or just staying busy?",
    "How should I be thinking about my slow season?",
    "What does a $2M version of my business look like?",
  ]
  // Pick 4 fresh starters per session using the day as a seed for variety
  const dayIndex = new Date().getDate() % allStarters.length
  const starters = [...allStarters.slice(dayIndex), ...allStarters.slice(0, dayIndex)].slice(0, 4)
  return (
    <div className="pt-10">
      <div className="text-center mb-8">
        <div className="w-14 h-14 rounded-full mx-auto mb-4 flex items-center justify-center"
          style={{ background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.3)' }}>
          <span className="text-2xl" aria-hidden>💡</span>
        </div>
        <h2 className="text-xl font-bold text-ink-900">Hey {firstName}.</h2>
        <p className="text-sm mt-1 max-w-md mx-auto leading-relaxed" style={{ color: 'rgba(13,20,19,0.45)' }}>
          I know your business, your roadmap, and your goals.
          Ask me anything, or I'll kick things off when you come back tomorrow.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {starters.map((s, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onPick(s)}
            className="text-left text-sm transition-colors rounded-xl px-4 py-3"
            style={{ background: 'rgba(13,20,19,0.04)', border: '1px solid rgba(13,20,19,0.09)', color: 'rgba(13,20,19,0.50)' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(13,20,19,0.09)'; e.currentTarget.style.color = '#0D1413' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(13,20,19,0.04)'; e.currentTarget.style.color = 'rgba(13,20,19,0.50)' }}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * What Solomon is doing while he isn't writing.
 *
 * Deliberately a plain line rather than a spinner with a percentage: a tool run
 * takes as long as it takes, and a fake progress bar is a small lie in a
 * product whose whole argument is that it doesn't tell them any.
 */
function ToolActivity({ label }) {
  return (
    <div className="flex justify-start pl-1 pt-1">
      <div className="flex items-center gap-2 text-[12px]" style={{ color: 'rgba(13,20,19,0.40)' }}>
        <span className="flex gap-1" aria-hidden>
          {[0, 150, 300].map(d => (
            <span key={d} className="w-1 h-1 rounded-full animate-bounce" style={{ background: 'rgba(11,107,78,0.65)', animationDelay: `${d}ms` }} />
          ))}
        </span>
        <span>{label}…</span>
      </div>
    </div>
  )
}

/**
 * Artifacts Solomon produced on this turn. The document is already saved and
 * formatted in the Library — this is the way back to it, so a thing he built
 * doesn't disappear the moment the conversation scrolls.
 */
/**
 * An image the owner shared, rendered back in their own bubble.
 *
 * The file lives in Storage under the company prefix, so the URL has to be
 * signed — a bare public URL would make one owner's photographs readable by
 * anyone who guessed the path.
 */
function SharedImage({ path, name, companyId, userId }) {
  const [url, setUrl] = useState(null)
  const [failed, setFailed] = useState(false)
  const [saveState, setSaveState] = useState('idle')  // idle | saving | saved | error

  useEffect(() => {
    let cancelled = false
    chatImageUrl(path)
      .then(u => { if (!cancelled) { u ? setUrl(u) : setFailed(true) } })
      .catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
  }, [path])

  async function handleKeep() {
    if (saveState !== 'idle') return
    setSaveState('saving')
    try {
      await saveChatImageToLibrary({ path, name, companyId, userId })
      setSaveState('saved')
    } catch {
      setSaveState('error')
    }
  }

  if (failed) {
    return <p className="text-[11px] mt-1.5 text-white/50">{name}: image unavailable</p>
  }
  if (!url) {
    return <div className="mt-1.5 h-32 w-44 rounded-xl bg-white/10 animate-pulse" />
  }
  return (
    <div className="mt-1.5">
      <a href={url} target="_blank" rel="noreferrer" className="block">
        <img
          src={url}
          alt={name || 'Shared image'}
          className="rounded-xl max-h-64 w-auto border border-white/15"
        />
      </a>
      {/* Keeping it moves the image into the Library, where it gets described,
          indexed and findable later — the difference between Solomon glancing
          at something once and being able to look it up in October. */}
      <button
        type="button"
        onClick={handleKeep}
        disabled={saveState !== 'idle'}
        className="mt-1.5 text-[11px] font-medium text-white/50 hover:text-white/90 transition-colors disabled:cursor-default"
      >
        {saveState === 'saving' ? 'Saving…'
       : saveState === 'saved'  ? '✓ Kept in your documents'
       : saveState === 'error'  ? 'Could not save. Try again'
       :                          'Keep this in my documents'}
      </button>
    </div>
  )
}

/**
 * Reads one reply aloud. Reports honestly which voice actually spoke — if the
 * ElevenLabs plan is out of credits the device voice takes over, and saying so
 * quietly is better than letting the owner think that robot is Solomon.
 */
function ListenButton({ text }) {
  const [state, setState] = useState('idle')   // idle | loading | playing | device
  useEffect(() => () => stopSpeaking(), [])

  async function toggle() {
    if (state === 'playing' || state === 'device') { stopSpeaking(); setState('idle'); return }
    setState('loading')
    const used = await speak(text, { onEnd: () => setState('idle') })
    if (used === 'none')      setState('idle')
    else if (used === 'device') setState('device')
    else                      setState('playing')
  }

  return (
    <button
      type="button"
      onClick={toggle}
      title={state === 'device' ? 'Using your device voice. Solomon\u2019s own voice is unavailable' : 'Listen'}
      className="absolute -bottom-5 right-14 flex items-center gap-1 text-[10px] font-medium transition-opacity px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 pointer-coarse:opacity-100 focus:opacity-100"
      style={{ color: state === 'idle' ? 'rgba(13,20,19,0.35)' : '#0b6b4e' }}
    >
      {state === 'loading' ? 'Loading…'
     : state === 'playing' ? 'Stop'
     : state === 'device'  ? 'Stop (device voice)'
     : 'Listen'}
    </button>
  )
}

function ArtifactChips({ artifacts }) {
  // source_documents carries two shapes now — artifacts Solomon produced and
  // images the owner shared. Filter, don't assume: an image entry has no
  // tool_id, and rendering it as a chip would link nowhere.
  const docs = Array.isArray(artifacts) ? artifacts.filter(a => a?.tool_id) : []
  if (docs.length === 0) return null
  // ⚠️ Every tool PAGE renders its disclaimer under the result, and so does the
  // Library, because the note lives inside each result component. Running the
  // tool from the conversation went around both: Solomon narrated a hiring
  // scorecard in prose with nothing saying "this is hiring strategy, not
  // employment law". The chat became the one door onto these tools with no
  // limit attached to it, which is precisely the door an owner is most likely
  // to act straight out of.
  const toolIds = [...new Set(docs.map(d => d.tool_id))]
  return (
    <>
    <div className="flex flex-wrap gap-1.5 mt-2">
      {docs.map(a => (
        <Link
          key={a.id ?? a.title}
          to={`/documents?tool=${encodeURIComponent(a.tool_id)}`}
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition-colors"
          style={{ background: 'rgba(11,107,78,0.10)', border: '1px solid rgba(11,107,78,0.28)', color: '#0b6b4e' }}
        >
          <svg viewBox="0 0 16 16" className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 2h8l4 4v8a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1z" /><path d="M11 2v4H5V2" />
          </svg>
          <span className="truncate max-w-[220px]">{a.title}</span>
          <span aria-hidden>→</span>
        </Link>
      ))}
    </div>
    {toolIds.map(id => (
      <ToolDisclaimer key={id} toolId={id} className="!mt-2 !pt-2 max-w-[520px]" />
    ))}
    </>
  )
}

/**
 * The stored text of an image turn carries a `[image: name]` marker so the
 * replayed history — which is text-only — does not lose the fact that a
 * picture was shared. That marker is for the model, not the owner: he can see
 * his own photograph rendered directly underneath. Showing him a filename in
 * brackets on top of it is just leaking our plumbing into his conversation.
 */
function stripImageMarker(text) {
  if (typeof text !== 'string') return text
  return text.replace(/\n*\[image:[^\]]*\]\s*$/i, '').trim()
}

function Bubble({ role, content, artifacts, streaming = false, onSave, companyId, userId }) {
  const isUser = role === 'user'
  const [saved, setSaved] = useState(false)
  const [hovered, setHovered] = useState(false)

  const handleSave = () => {
    if (saved) return
    setSaved(true)
    onSave?.(content)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div
      className={`flex ${isUser ? 'justify-end' : 'justify-start'} group`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="relative max-w-[78%]">
        {/* Solomon answers in a serif, the owner types in the sans. Counsel
            should look considered rather than look like chat — it is the one
            typographic decision carrying the whole positioning, and a reply
            set in the same face as the input reads as a chatbot.

            ⚠️ 1 Sep — the FACE changed, the decision did not. This was
            `font-serif`, i.e. Instrument Serif, which is a DISPLAY face and
            was never meant to carry paragraphs. Daniel: "hard to read, almost
            like a boring text book." Now --font-reading (Charter/Georgia),
            drawn for reading long text on a screen. Leading opened a little
            further with it. */}
        <div
          className={`px-4 py-2.5 rounded-[18px] ${
            isUser
              ? 'text-sm leading-relaxed'
              : 'text-[16.5px] leading-[1.68]'
          }`}
          style={isUser
            ? { background: '#0d1413', color: '#fff', borderBottomRightRadius: '4px' }
            : { background: '#FFFFFF', border: '1px solid rgba(13,20,19,0.09)', color: '#1B2422', borderBottomLeftRadius: '4px', fontFamily: 'var(--font-reading)' }
          }
        >
          {isUser
            ? <span className="whitespace-pre-wrap">{stripImageMarker(content)}</span>
            : <MarkdownContent text={content} streaming={streaming} />
          }
          {isUser && (Array.isArray(artifacts) ? artifacts : [])
            .filter(a => a?.type === 'image')
            .map(a => (
              <SharedImage
                key={a.path}
                path={a.path}
                name={a.name}
                companyId={companyId}
                userId={userId}
              />
            ))}
        </div>
        {!isUser && !streaming && <ArtifactChips artifacts={artifacts} />}
        {/* Listen — beside Save, and only on his finished replies. Never
            automatic: ElevenLabs bills per character, and a plan's whole
            monthly allowance is about fifty spoken replies. This has to be a
            thing the owner chooses, not a thing that happens to him. */}
        {!isUser && !streaming && content && (
          <ListenButton text={content} />
        )}
        {/* Save button — only on assistant messages, not while streaming */}
        {!isUser && !streaming && content && (
          <button
            type="button"
            onClick={handleSave}
            title="Save to Documents"
            className="absolute -bottom-5 right-1 flex items-center gap-1 text-[10px] font-medium transition-opacity px-1.5 py-0.5 rounded"
            style={{
              opacity: (hovered || saved) ? 1 : 0,
              color: saved ? '#2f8f6d' : 'rgba(13,20,19,0.35)',
              pointerEvents: hovered || saved ? 'auto' : 'none',
            }}
          >
            {saved ? (
              <>
                <svg viewBox="0 0 16 16" className="w-3 h-3" fill="currentColor"><path d="M13.28 4.22a.75.75 0 010 1.06l-6.5 6.5a.75.75 0 01-1.06 0l-3-3a.75.75 0 011.06-1.06l2.47 2.47 5.97-5.97a.75.75 0 011.06 0z"/></svg>
                Saved
              </>
            ) : (
              <>
                <svg viewBox="0 0 16 16" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2 2h8l4 4v8a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1z"/><path d="M11 2v4H5V2"/><path d="M5 10h6"/></svg>
                Save
              </>
            )}
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * Lightweight markdown renderer for assistant messages.
 * Handles the patterns Claude actually uses: bold, bullets, numbered lists,
 * headers, inline code, code blocks, and paragraph breaks.
 * No external dependency — keeps the bundle lean.
 */
function cleanLine(line) {
  if (/^\s*([-*_]\s*){3,}$/.test(line) || /^\s*\|/.test(line)) return line
  line = line.replace(/(\*\*[^*]+\*\*)\s*[—–]\s*/g, '$1: ')   // **Label** — text → **Label**: text
  const m = line.match(/^(\s*(?:[-*+]|\d+\.)\s+)([\s\S]*)$/)
  return m ? m[1] + plainDashes(m[2]) : plainDashes(line)
}

function MarkdownContent({ text, streaming }) {
  if (!text) {
    return streaming
      ? <span className="inline-block w-2 h-4 bg-white/40 rounded-sm animate-pulse" />
      : null
  }

  // ⭐ No dashes in what he says (Daniel, 5 Oct: "it looks AI"). The prompt asks;
  // this catches the ones that get through, and his older replies. ⚠️ Markdown
  // structure is left alone: a bullet's leading "- ", table rows, and "---".
  const lines   = text.split('\n').map(cleanLine)
  const nodes   = []
  let i         = 0
  let paraLines = []

  function flushPara() {
    if (!paraLines.length) return
    const joined = paraLines.join(' ')
    nodes.push(<p key={nodes.length} className="mb-2 last:mb-0">{inlineRender(joined)}</p>)
    paraLines = []
  }

  while (i < lines.length) {
    const line = lines[i]

    // Fenced code block
    if (line.trim().startsWith('```')) {
      flushPara()
      const codeLines = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i])
        i++
      }
      nodes.push(
        <pre key={nodes.length} className="my-2 px-3 py-2 rounded-lg text-xs font-mono overflow-x-auto"
          style={{ background: 'rgba(13,20,19,0.05)', color: '#1B2422' }}>
          {codeLines.join('\n')}
        </pre>
      )
      i++
      continue
    }

    // H1 / H2 / H3
    const hMatch = line.match(/^(#{1,3})\s+(.+)/)
    if (hMatch) {
      flushPara()
      const level = hMatch[1].length
      const Tag   = level === 1 ? 'h2' : level === 2 ? 'h3' : 'h4'
      const cls   = level === 1 ? 'text-base font-bold mt-3 mb-1' : 'text-sm font-bold mt-2 mb-1'
      nodes.push(<Tag key={nodes.length} className={cls} style={{ color: '#0D1413' }}>{inlineRender(hMatch[2])}</Tag>)
      i++
      continue
    }

    // Bullet list item
    const bulletMatch = line.match(/^(\s*[-*+])\s+(.+)/)
    if (bulletMatch) {
      flushPara()
      const items = []
      while (i < lines.length && lines[i].match(/^(\s*[-*+])\s+(.+)/)) {
        const m = lines[i].match(/^(\s*[-*+])\s+(.+)/)
        items.push(<li key={i} className="mb-0.5">{inlineRender(m[2])}</li>)
        i++
      }
      nodes.push(<ul key={nodes.length} className="list-disc list-inside my-1.5 space-y-0.5 text-sm" style={{ color: '#1B2422' }}>{items}</ul>)
      continue
    }

    // Numbered list item
    //
    // ⚠️ RENDERED AS "1. 1. 1." — visible in the product for who knows how long.
    // Items separated by a blank line ended the run, so each one became its own
    // <ol> and restarted the counter. Solomon writes exactly that way, so every
    // numbered answer he gave was numbered wrong.
    //
    // Two fixes: carry on across a blank line when the next non-empty line is
    // also numbered, and honour the number the author actually wrote via `start`
    // — so even a genuinely separate list continues from where it should.
    const numMatch = line.match(/^(\d+)\.\s+(.+)/)
    if (numMatch) {
      flushPara()
      const startNum = parseInt(numMatch[1], 10) || 1
      const items = []
      while (i < lines.length) {
        const m = lines[i].match(/^\d+\.\s+(.+)/)
        if (m) {
          items.push(<li key={i} className="mb-0.5">{inlineRender(m[1])}</li>)
          i++
          continue
        }
        // A single blank line inside a numbered run is a paragraph break
        // between items, not the end of the list.
        if (lines[i].trim() === '' && lines[i + 1]?.match(/^\d+\.\s+(.+)/)) {
          i++
          continue
        }
        break
      }
      nodes.push(
        <ol key={nodes.length} start={startNum} className="list-decimal list-inside my-1.5 space-y-0.5 text-sm" style={{ color: '#1B2422' }}>
          {items}
        </ol>
      )
      continue
    }

    // Blank line — flush paragraph
    if (line.trim() === '') {
      flushPara()
      i++
      continue
    }

    // Normal text — accumulate into paragraph
    paraLines.push(line)
    i++
  }

  flushPara()

  return (
    <div className="prose-invert">
      {nodes}
      {streaming && <span className="inline-block w-1.5 h-3.5 bg-white/50 rounded-sm animate-pulse ml-0.5 align-middle" />}
    </div>
  )
}

/** Render inline markdown: **bold**, *italic*, `code` */
function inlineRender(text) {
  const parts = []
  const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+)`)/g
  let last = 0
  let m
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    if (m[2])      parts.push(<strong key={m.index} className="font-bold" style={{ color: '#0D1413' }}>{m[2]}</strong>)
    else if (m[3]) parts.push(<em key={m.index} className="italic">{m[3]}</em>)
    else if (m[4]) parts.push(<code key={m.index} className="px-1 py-0.5 rounded text-[11px] font-mono" style={{ background: 'rgba(13,20,19,0.06)', color: '#0b6b4e' }}>{m[4]}</code>)
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts.length === 1 && typeof parts[0] === 'string' ? parts[0] : parts
}

function MorningThinkingBubble() {
  return (
    <div className="flex justify-start">
      <div
        className="rounded-[18px] px-4 py-3 flex items-center gap-2"
        style={{ background: 'rgba(13,20,19,0.05)', border: '1px solid rgba(13,20,19,0.09)', borderBottomLeftRadius: '4px' }}
      >
        <div className="flex gap-1">
          {[0, 150, 300].map(d => (
            <span key={d} className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: 'rgba(13,20,19,0.30)', animationDelay: `${d}ms` }} />
          ))}
        </div>
        <span className="text-xs" style={{ color: 'rgba(13,20,19,0.30)' }}>Reading your context…</span>
      </div>
    </div>
  )
}

function ThinkingBubble() {
  return (
    <div className="flex justify-start">
      <div
        className="rounded-[18px] px-4 py-3"
        style={{ background: 'rgba(13,20,19,0.05)', border: '1px solid rgba(13,20,19,0.09)', borderBottomLeftRadius: '4px' }}
      >
        <div className="flex gap-1">
          {[0, 150, 300].map(d => (
            <span key={d} className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: 'rgba(13,20,19,0.30)', animationDelay: `${d}ms` }} />
          ))}
        </div>
      </div>
    </div>
  )
}

const Composer = forwardRef(function Composer(
  { value, onChange, onKeyDown, onSend, disabled, error, attachment, onAttach },
  ref,
) {
  const fileRef = useRef(null)
  const stopRef = useRef(null)
  const [dictating, setDictating] = useState(false)
  const [micError,  setMicError]  = useState(null)
  const canDictate = dictationSupported()

  // The box grows with what is in it and shrinks back when it empties. This
  // used to run on keystrokes only, so a sent message or a dictated one left
  // the box at whatever height it last was.
  const boxRef = useRef(null)
  const setBox = useCallback(el => {
    boxRef.current = el
    if (typeof ref === 'function') ref(el)
    else if (ref) ref.current = el
  }, [ref])
  useLayoutEffect(() => {
    const el = boxRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [value])

  // Stop the microphone if the composer unmounts mid-sentence — otherwise the
  // browser keeps listening after the owner has navigated away, which is both
  // a bug and a bad look for an app asking to be trusted with the books.
  useEffect(() => () => { try { stopRef.current?.() } catch { /* ignore */ } }, [])

  function toggleDictation() {
    if (dictating) { stopRef.current?.(); setDictating(false); return }
    setMicError(null)
    setDictating(true)
    stopRef.current = listen(
      (text, isFinal) => {
        onChange(text)
        if (isFinal) setDictating(false)
      },
      (err) => { setMicError(err); setDictating(false) },
    )
  }
  const previewUrl = useMemo(
    () => (attachment ? URL.createObjectURL(attachment) : null),
    [attachment],
  )
  // Object URLs are a leak if you never revoke them, and a chat is exactly the
  // surface where someone attaches and clears twenty times in a sitting.
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl) }, [previewUrl])

  return (
    <div className="px-4 sm:px-6 py-3 sm:py-4 flex-shrink-0" style={{ background: '#FFFFFF', borderTop: '1px solid rgba(13,20,19,0.08)' }}>
      <div className="max-w-3xl mx-auto">
        {attachment && (
          <div className="mb-2 flex items-center gap-3 rounded-xl border border-ink-100 bg-ink-50 px-3 py-2">
            {previewUrl && (
              <img src={previewUrl} alt="" className="h-12 w-12 rounded-lg object-cover flex-shrink-0" />
            )}
            <span className="text-xs text-ink-600 truncate flex-1">{attachment.name}</span>
            <button
              type="button"
              onClick={() => onAttach(null)}
              className="text-xs font-semibold text-ink-400 hover:text-ink-700 transition-colors flex-shrink-0"
            >
              Remove
            </button>
          </div>
        )}
        {micError && (
          <div className="mb-2 rounded-lg px-3 py-2 text-xs" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: '#b91c1c' }}>
            {micError}
          </div>
        )}
        {error && (
          typeof error === 'object' && error.code === 'spend_cap_exceeded'
            ? <div className="mb-2"><SpendCapBanner err={error} /></div>
            : (
              <div className="mb-2 rounded-lg px-3 py-2 text-xs" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: '#b91c1c' }}>
                {typeof error === 'string' ? error : error.message}
              </div>
            )
        )}
        <form onSubmit={onSend} className="flex items-end gap-2">
          {/* Attach. Deliberately a plain paperclip rather than a labelled
              button — the composer is the one place in this product where
              chrome should get out of the way. */}
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPTED_IMAGE_TYPES}
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) onAttach(f); e.target.value = '' }}
          />
          {canDictate && (
            <button
              type="button"
              onClick={toggleDictation}
              disabled={disabled}
              aria-label={dictating ? 'Stop dictating' : 'Speak to Solomon'}
              title={dictating ? 'Stop dictating' : 'Speak to Solomon'}
              className="rounded-xl p-2.5 min-h-[44px] flex items-center justify-center transition-colors disabled:opacity-30 flex-shrink-0"
              style={{
                color:      dictating ? '#fff' : 'rgba(13,20,19,0.45)',
                background: dictating ? '#0b6b4e' : 'rgba(13,20,19,0.04)',
                border:     '1px solid rgba(13,20,19,0.10)',
              }}
            >
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" />
              </svg>
            </button>
          )}
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={disabled}
            aria-label="Attach an image"
            title="Attach an image"
            className="rounded-xl p-2.5 min-h-[44px] flex items-center justify-center transition-colors disabled:opacity-30 flex-shrink-0"
            style={{ color: 'rgba(13,20,19,0.45)', background: 'rgba(13,20,19,0.04)', border: '1px solid rgba(13,20,19,0.10)' }}
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
          </button>
          <textarea
            ref={setBox}
            rows={1}
            value={value}
            onChange={e => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={disabled}
            // Paste a screenshot straight in. This is how most people will
            // actually use it — cmd-shift-4, cmd-v — and making them save to
            // disk first would be the difference between using it and not.
            onPaste={e => {
              const file = Array.from(e.clipboardData?.files || []).find(isImageFile)
              if (file) { e.preventDefault(); onAttach(file) }
            }}
            placeholder="Message Solomon"
            autoCapitalize="sentences"
            autoCorrect="on"
            spellCheck
            enterKeyHint="enter"
            className="flex-1 rounded-xl px-4 py-2.5 text-base sm:text-sm resize-none focus:outline-none transition-colors disabled:opacity-50"
            style={{
              minHeight: '44px',
              maxHeight: '160px',
              background: 'rgba(13,20,19,0.04)',
              border: '1px solid rgba(13,20,19,0.10)',
              color: '#0D1413',
            }}
          />
          <button
            type="submit"
            disabled={disabled || (!value.trim() && !attachment)}
            aria-label="Send"
            className="rounded-xl px-4 py-2.5 text-sm font-bold text-ink-900 disabled:opacity-30 transition-opacity flex-shrink-0 min-h-[44px]"
            style={{ background: '#0b6b4e' }}
          >
            Send
          </button>
        </form>
        {/* Hint: only show desktop shortcut hint on devices with a real keyboard */}
        {/* ⭐ The persistent line — the "Claude can make mistakes" equivalent.
            The per-tool disclaimers in lib/toolDisclaimers.js only ride on tool
            OUTPUTS. Solomon in conversation had nothing, and conversation is
            where someone asks about a termination or a price. Deliberately
            always-on and deliberately dull: it is the constant backdrop, while
            prompts.js handles the sharp, contextual warning on the answers that
            actually carry money. */}
        <p className="kb-hide text-[10px] mt-2 text-center leading-relaxed" style={{ color: 'rgba(13,20,19,0.32)' }}>
          Solomon works from what you give him. Not professional advice, confirm anything costly.
          <span className="hidden sm:inline"> · Enter to send, Shift+Enter for a new line</span>
        </p>
      </div>
    </div>
  )
})
