/**
 * wayout-checkin — the thing that makes "it walks the move with you" true.
 *
 * ⭐⭐ BEFORE THIS, NOTHING IN THE WAY OUT EVER CONTACTED ANYBODY. The plan was
 * written once and sat there; the person had to remember the product existed.
 * That is a product you consult, not one that walks with you, and the phrase we
 * sell it on was a promise it did not keep.
 *
 * ⭐⭐ IT IS ALSO THE ANSWER TO A PRICING PROBLEM. The gates are long on purpose
 * — "the sale has closed", "three people have paid you", "two full months on
 * days only" — weeks to months apart. If the subscription's job were unlocking
 * the next move, the subscriber would pay and have nothing to open for eight
 * weeks. Keeping up with them between gates turns those gaps from dead weeks
 * into the product.
 *
 * ⚠️ WHAT IT DOES NOT DO. It does not generate, decide, or change the plan. It
 * sends a link and asks one question. If it fails silently for a week, nobody
 * was nudged and every plan is exactly where its owner left it. That is the
 * right blast radius for something running unattended — same rule as
 * log-reminders, which this is modelled on.
 *
 * Two entry points:
 *   POST  with x-checkin-secret  → send the due check-ins (pg_cron calls this)
 *   GET   ?stop=<session uuid>   → opt out, one click, no login
 */

import { json, preflight } from '../_shared/cors.ts'
import { serviceClient } from '../_shared/supabase.ts'
import { pathNext, type PathShape, type PathState } from '../_shared/pathNext.ts'
import { SITE, alreadyDone, composeMove, composePath, emailHtml, emailText, stoppedPage, type Parts } from './email.ts'

interface Due {
  session_id: string
  user_id: string
  email: string
  name: string | null
  checkin_count: number
}

/**
 * ⭐ ONE REAL QUESTION, ABOUT THE THING THEY ARE ACTUALLY WAITING ON.
 *
 * ⚠️ A generic "how's it going?" is what every dead SaaS nudge says, and people
 * filter it within two sends. What makes this worth opening is that it names
 * the gate out of their own plan — the sentence they are standing in front of.
 *
 * ⚠️ It escalates toward asking whether to stop, rather than toward asking
 * harder. Someone who has ignored four of these is telling us something, and
 * the honest response is to offer the door.
 */
// The words and the look of every check-in live in ./email.ts.

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return preflight()

  const admin = serviceClient()

  // ── One-click opt-out ─────────────────────────────────────────────────────
  //
  // ⚠️ THE SESSION UUID IS THE KEY, AND THAT IS A DELIBERATE TRADE, NOT AN
  // OVERSIGHT. A v4 UUID is 122 bits of entropy and only ever reaches the
  // person whose inbox it was sent to. Building a signed-token system for this
  // would be the right call if the button did something costly — this one stops
  // email, is reversible in the app, and refusing to unsubscribe somebody
  // without a login is far worse than the theoretical risk.
  if (req.method === 'GET') {
    const stop = new URL(req.url).searchParams.get('stop') ?? ''
    if (!/^[0-9a-f-]{36}$/i.test(stop)) return json({ error: 'no' }, 400)
    await admin.from('wayout_sessions')
      .update({ checkin_opted_out: true }).eq('id', stop)
    return new Response(stoppedPage(), { headers: { 'content-type': 'text/html; charset=utf-8' } })
  }

  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  // ── Auth: the shared secret, and nothing else ─────────────────────────────
  const given = req.headers.get('x-checkin-secret') ?? ''
  const { data: secretRow } = await admin
    .from('internal_secrets').select('value').eq('key', 'wayout_checkin').maybeSingle()
  const expected = (secretRow as { value: string } | null)?.value ?? ''
  if (!expected || given !== expected) return json({ error: 'no' }, 401)

  const { data: due, error } = await admin
    .from('wayout_checkin_due').select('*').limit(200)
  if (error) return json({ error: error.message }, 500)

  // ⚠️ Checked ONCE, before the loop — a missing sender is a configuration
  // fault, not a per-person failure, and reporting it fifty times would bury it.
  const wayoutFrom = Deno.env.get('WAYOUT_EMAIL_FROM') ?? ''
  if (!wayoutFrom) {
    return json({
      due: (due ?? []).length,
      sent: 0,
      failures: ['WAYOUT_EMAIL_FROM is not set, refusing to send as Eliv8 OS. '
        + 'supabase secrets set WAYOUT_EMAIL_FROM="the way out <hello@yourdomain>"'],
    })
  }

  let sent = 0
  const failures: string[] = []

  for (const row of (due ?? []) as Due[]) {
    try {
      // The move they are actually standing on: the lowest-numbered one with no
      // done_at. No playbook rows yet means they have not opened move one.
      const { data: pbs } = await admin
        .from('wayout_playbooks')
        .select('move_order, done_at')
        .eq('session_id', row.session_id)
        .order('move_order')

      const doneOrders = new Set((pbs ?? []).filter(p => p.done_at).map(p => p.move_order))
      const current = [1, 2, 3].find(n => !doneOrders.has(n)) ?? 3

      // ⚠️ Titles and gates come out of THEIR map, never written here. A nudge
      // that paraphrases somebody's plan back at them slightly wrong is worse
      // than one that says nothing.
      const { data: sess } = await admin
        .from('wayout_sessions').select('map, path, path_state').eq('id', row.session_id).maybeSingle()
      const moves = (sess?.map as { moves?: Array<{ title?: string; gate?: string }> })?.moves ?? []
      const move = moves[current - 1]
      if (!move?.title) { failures.push(`${row.session_id}: no move ${current}`); continue }

      // ⭐ On the path, the email is about the step, and links to the path.
      const onPath = pathNext(sess?.path as PathShape | null, (sess?.path_state ?? {}) as PathState)
      const usePath = !!(onPath.due || onPath.next)

      const first = (row.name ?? '').split(' ')[0] || 'there'
      /**
       * ⚠️ The record (what they finished) is NOT on the fourth one: that
       * email offers to stop, and opening it with a tally reads as making a point.
       */
      const record = row.checkin_count >= 4 || usePath
        ? null
        : alreadyDone((pbs ?? []).filter(p => p.done_at).map(p => p.done_at as string))
      // ⭐ Links go to getunstuckmap.com itself, and a path step opens on that step.
      let parts: Parts
      if (usePath) {
        const { step, ...rest } = composePath(onPath, row.checkin_count)
        parts = { ...rest, link: `${SITE}/path${step?.id ? `?step=${encodeURIComponent(step.id)}` : ''}` }
      } else {
        parts = { ...composeMove(move.title, move.gate ?? '', row.checkin_count, record), link: `${SITE}/plan` }
      }
      const subject = parts.subject
      const stopLink = `${Deno.env.get('SUPABASE_URL')}/functions/v1/wayout-checkin?stop=${row.session_id}`

      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${Deno.env.get('RESEND_API_KEY') ?? ''}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          // 🔴 ITS OWN SENDER, AND IT REFUSES TO FALL BACK TO ELIV8'S. This
          // product is deliberately separate from Eliv8 OS, and mail arriving
          // from "Eliv8 OS" about somebody's personal money plan is both
          // confusing and a leak of a connection they never agreed to. So
          // WAYOUT_EMAIL_FROM is required; without it the send is skipped and
          // reported, rather than quietly going out under the wrong name.
          from: wayoutFrom,
          to: [row.email],
          subject,
          // ⚠️ List-Unsubscribe as a real header, not only a footer link. It is
          // what inbox providers read, and it is the difference between an
          // unsubscribe and a spam complaint.
          headers: {
            'List-Unsubscribe': `<${stopLink}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          },
          text: emailText(parts, first, stopLink),
          html: emailHtml(parts, first, stopLink),
        }),
      })

      // ⚠️ Report what the provider SAID, not just the status — a bare 401 once
      // had me chasing a missing API key that was set the whole time.
      if (!res.ok) {
        failures.push(`${row.session_id}: ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`)
        continue
      }

      // ⚠️ Counted only after a send that actually succeeded. Bumping first
      // would quietly burn somebody's six allowed check-ins on failed sends.
      await admin.from('wayout_sessions')
        .update({ checkin_at: new Date().toISOString(), checkin_count: row.checkin_count + 1 })
        .eq('id', row.session_id)
      sent++
    } catch (e) {
      failures.push(`${row.session_id}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return json({ due: (due ?? []).length, sent, failures })
})
