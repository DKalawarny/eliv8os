/**
 * ⭐⭐ ops-check — tells Daniel when something is broken, before a user does.
 *
 * 3 Oct 2026 audit: nothing alerted anyone. The Netlify "usage_exceeded" outage
 * took both sites down and was found by Daniel looking at his own screen.
 *
 * Every 15 minutes (pg_cron → this function, with the shared secret in
 * internal_secrets 'ops_check'):
 *   1. Both sites answer 200 and serve their own page — and Netlify's
 *      "usage_exceeded" 503 is named as what it is.
 *   2. The AI is working: ops_events written by the claude function — any
 *      "credit balance" failure alerts at once; 3+ failures in an hour alert.
 * One email per problem per 6 hours (ops_alerts), to WAYOUT_ALERT_EMAIL.
 * ⚠️ Never includes anybody's words or answers — counts and statuses only.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sweepOrphanCompanyFolders } from '../_shared/storageCleanup.ts'

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })

type Problem = { key: string; title: string; detail: string }

async function checkSite(url: string, mustContain: string, name: string): Promise<Problem | null> {
  try {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15000) })
    const body = await res.text()
    if (res.status === 503 && /usage_exceeded/i.test(body)) {
      return { key: `site-credits:${name}`, title: `${name} is DOWN — Netlify credits used up`,
        detail: `${url} returns 503 usage_exceeded. Netlify has stopped serving the site. Fix: app.netlify.com → Billing → add credits or upgrade.` }
    }
    if (res.status !== 200) return { key: `site-status:${name}`, title: `${name} is not loading (HTTP ${res.status})`, detail: `${url} answered ${res.status}.` }
    if (!body.includes(mustContain)) return { key: `site-content:${name}`, title: `${name} is serving the wrong page`, detail: `${url} answered 200 but does not contain "${mustContain}".` }
    return null
  } catch (e) {
    return { key: `site-unreachable:${name}`, title: `${name} is unreachable`, detail: `${url}: ${String((e as Error).message).slice(0, 200)}` }
  }
}

async function checkAi(): Promise<Problem[]> {
  const out: Problem[] = []
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const { data } = await admin.from('ops_events').select('kind, detail').gte('created_at', since)
  const rows = (data ?? []) as Array<{ kind: string; detail: string | null }>
  const credit = rows.filter(r => /credit balance|billing|quota/i.test(r.detail ?? ''))
  if (credit.length) out.push({ key: 'ai-credits', title: 'The AI has run out of credits — every plan and reply is failing',
    detail: `${credit.length} call(s) in the last hour failed for billing. Fix: console.anthropic.com → Billing (turn on auto-reload).` })
  const fails = rows.filter(r => r.kind === 'ai_upstream_error')
  if (fails.length >= 3 && !credit.length) out.push({ key: 'ai-failing', title: `The AI failed ${fails.length} times in the last hour`,
    detail: `Most recent: ${(fails[fails.length - 1].detail ?? '').slice(0, 200)}. Often a provider outage that clears by itself — check status.anthropic.com.` })
  return out
}

async function alert(problems: Problem[]) {
  const key = Deno.env.get('RESEND_API_KEY'), from = Deno.env.get('RESEND_FROM')
  const to = Deno.env.get('WAYOUT_ALERT_EMAIL') ?? 'dkalawarny@hotmail.com'
  const due: Problem[] = []
  for (const p of problems) {
    const { data } = await admin.from('ops_alerts').select('last_sent').eq('key', p.key).maybeSingle()
    const last = (data as { last_sent: string } | null)?.last_sent
    if (last && Date.now() - new Date(last).getTime() < 6 * 60 * 60 * 1000) continue
    due.push(p)
  }
  if (!due.length || !key || !from) return { sent: 0, due: due.length }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from, to,
      subject: due.length === 1 ? `⚠️ ${due[0].title}` : `⚠️ ${due.length} problems on your sites`,
      text: due.map(p => `${p.title}\n${p.detail}`).join('\n\n') + `\n\n— ops-check, ${new Date().toISOString()}`,
    }),
  })
  if (res.ok) {
    for (const p of due) await admin.from('ops_alerts').upsert({ key: p.key, last_sent: new Date().toISOString(), title: p.title })
  }
  return { sent: res.ok ? due.length : 0, status: res.status }
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const given = req.headers.get('x-ops-secret') ?? ''
  const { data: s } = await admin.from('internal_secrets').select('value').eq('key', 'ops_check').maybeSingle()
  const expected = (s as { value: string } | null)?.value ?? ''
  if (!expected || given !== expected) return json({ error: 'no' }, 401)

  const problems = (await Promise.all([
    checkSite('https://getunstuckmap.com/', 'Unstuck Map', 'getunstuckmap.com'),
    checkSite('https://eliv8os.com/', 'Eliv8', 'eliv8os.com'),
  ])).filter(Boolean) as Problem[]
  problems.push(...await checkAi())
  const result = await alert(problems)
  // Files of companies that no longer exist (demo copies are wiped by a SQL
  // job, which cannot reach storage). Never fails the check itself.
  const swept = await sweepOrphanCompanyFolders(admin).catch(() => -1)
  return json({ ok: problems.length === 0, problems: problems.map(p => p.title), swept, ...result })
})
