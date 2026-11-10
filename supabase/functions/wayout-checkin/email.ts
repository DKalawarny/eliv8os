/**
 * ⭐⭐ THE CHECK-IN EMAIL, ON BRAND (Daniel, 10 Nov 2026: "this email isn't
 * really on brand, it should be something like how kinwove emails are").
 *
 * Same build as kinwove's emailWrap: a brand bar, a small label, one big line,
 * a card for the thing they are on, one button, a soft footer. In Unstuck's
 * colours: cream paper, deep ink, the green and the sun dot from the site.
 *
 * ⚠️ Pure, no Deno APIs, so it can be rendered and checked on a Mac.
 * ⚠️ Inline styles and tables only: Gmail strips <style>, fonts and position.
 * ⚠️ No "I", no sign-off, no name at the bottom: nobody is on the other end
 *    and the email must never imply a person (project rule).
 * ⚠️ No dashes in anything a person reads (titles come from their plan and can
 *    carry them, so they are cleaned here).
 */
import type { Step } from '../_shared/pathNext.ts'

export const SITE = 'https://getunstuckmap.com'

const C = {
  page: '#F3EEE1', paper: '#FFFDF8', ink: '#23301F', soft: '#5F6956',
  green: '#2F7D4F', sun: '#FFB43A', sunInk: '#8A5A06', line: '#E4DECB', card: '#FFF6E3',
}
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif"

export function esc(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Their plan's words, readable: no dashes, one full stop at the end. */
export function plain(s: string, stop = false): string {
  let t = String(s ?? '').replace(/\s*[—–]\s*/g, ', ').replace(/\s+-\s+/g, ', ').replace(/\s+/g, ' ').trim()
  if (stop && t && !/[.!?]$/.test(t)) t += '.'
  return t
}

export interface Parts {
  subject: string
  eyebrow: string
  heading: string
  intro?: string
  card?: { label: string; title: string; sub?: string; pill?: string }
  body: string
  cta: string
  link: string
}

export function emailHtml(p: Parts, first: string, stopLink: string): string {
  const card = p.card ? `
    <tr><td style="padding:0 32px 22px">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${C.card};border-radius:16px;border-bottom:4px solid #F3D9A6">
        <tr><td style="padding:18px 20px">
          <div style="font-size:11px;letter-spacing:1.6px;text-transform:uppercase;font-weight:800;color:${C.sunInk};margin:0 0 6px">${esc(p.card.label)}</div>
          <div style="font-size:19px;line-height:1.35;font-weight:800;color:${C.ink}">${esc(p.card.title)}</div>
          ${p.card.sub ? `<div style="font-size:15px;line-height:1.6;color:${C.soft};margin-top:8px">${esc(p.card.sub)}</div>` : ''}
          ${p.card.pill ? `<div style="margin-top:12px"><span style="display:inline-block;background:#E3F1FD;color:#1C74BA;font-size:13px;font-weight:700;border-radius:999px;padding:4px 12px">${esc(p.card.pill)}</span></div>` : ''}
        </td></tr>
      </table>
    </td></tr>` : ''
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>${esc(p.subject)}</title></head>
<body style="margin:0;padding:0;background:${C.page}">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${C.page}">
<tr><td align="center" style="padding:28px 12px">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:${C.paper};border-radius:22px;font-family:${FONT};color:${C.ink}">
    <tr><td style="padding:26px 32px 22px;border-bottom:1px solid ${C.line}">
      <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${C.sun};vertical-align:middle;margin-right:8px"></span><span style="font-size:16px;font-weight:800;color:${C.green};vertical-align:middle">Unstuck Map</span>
    </td></tr>
    <tr><td style="padding:28px 32px 0">
      <div style="font-size:11px;letter-spacing:1.6px;text-transform:uppercase;font-weight:800;color:${C.sunInk};margin:0 0 10px">${esc(p.eyebrow)}</div>
      <h1 style="font-size:26px;line-height:1.2;font-weight:800;letter-spacing:-0.3px;margin:0 0 14px;color:${C.ink}">${esc(p.heading)}</h1>
      <p style="font-size:16px;line-height:1.65;color:${C.soft};margin:0 0 20px">Hi ${esc(first)}.${p.intro ? ` ${esc(p.intro)}` : ''}</p>
    </td></tr>
    ${card}
    <tr><td style="padding:0 32px">
      <p style="font-size:16px;line-height:1.65;color:${C.ink};margin:0 0 22px">${esc(p.body)}</p>
      <a href="${p.link}" style="display:inline-block;background:${C.green};color:#ffffff;text-decoration:none;font-size:16px;font-weight:800;border-radius:999px;padding:14px 28px;border-bottom:4px solid #1F5A37">${esc(p.cta)}</a>
    </td></tr>
    <tr><td style="padding:30px 32px 28px">
      <div style="border-top:1px solid ${C.line};padding-top:16px;font-size:12px;line-height:1.7;color:${C.soft}">
        You get these because you have a plan on Unstuck Map. Unstuck Map is a planning tool, not legal, financial or tax advice. Every choice is yours.<br>
        <a href="${SITE}" style="color:${C.green};text-decoration:none">getunstuckmap.com</a> &middot; <a href="${stopLink}" style="color:${C.soft};text-decoration:underline">Stop these check-ins</a>
      </div>
    </td></tr>
  </table>
</td></tr>
</table>
</body></html>`
}

export function emailText(p: Parts, first: string, stopLink: string): string {
  const card = p.card ? `${p.card.label}: ${p.card.title}\n${p.card.sub ? `${p.card.sub}\n` : ''}${p.card.pill ? `${p.card.pill}\n` : ''}\n` : ''
  return `Hi ${first}.${p.intro ? ` ${p.intro}` : ''}\n\n${card}${p.body}\n\n${p.cta}: ${p.link}\n\nStop these check-ins: ${stopLink}\n`
}

/** The page someone sees after the one-click stop. Same look as the email. */
export function stoppedPage(): string {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Check-ins stopped</title>
<body style="margin:0;background:${C.page};font-family:${FONT};color:${C.ink}">
<div style="max-width:460px;margin:12vh auto;padding:0 16px">
  <div style="background:${C.paper};border-radius:22px;padding:28px 28px 30px">
    <div><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${C.sun};margin-right:8px"></span><b style="color:${C.green}">Unstuck Map</b></div>
    <h1 style="font-size:24px;margin:22px 0 10px">That's stopped.</h1>
    <p style="font-size:16px;line-height:1.6;color:${C.soft};margin:0 0 22px">No more check-ins. Your plan is untouched and still there whenever you want it.</p>
    <a href="${SITE}/plan" style="display:inline-block;background:${C.green};color:#fff;text-decoration:none;font-weight:800;border-radius:999px;padding:13px 24px">Open your plan</a>
  </div>
</div></body>`
}

/**
 * ⭐ WHAT THEY HAVE ALREADY DONE, IN ONE LINE. Evidence, not encouragement:
 * a count and a date they cannot argue with. Nothing when nothing is done.
 */
export function alreadyDone(doneDates: string[]): string | null {
  if (!doneDates.length) return null
  const last = doneDates.map(d => Date.parse(d)).sort((a, b) => b - a)[0]
  const when = new Date(last).toLocaleDateString('en-CA', { day: 'numeric', month: 'long' })
  return doneDates.length === 1
    ? `You finished a move on ${when}.`
    : `You have finished ${doneDates.length} moves so far, the last on ${when}.`
}

/**
 * A check-in about a MOVE, for someone not on the path. Escalates toward
 * offering to stop, never toward asking harder.
 */
export function composeMove(title: string, gate: string, count: number, record: string | null): Omit<Parts, 'link'> {
  const t = plain(title)
  const card = { label: 'You are on', title: t, sub: gate ? `It is done when: ${plain(gate, true)}` : undefined }
  if (count >= 4) {
    return {
      subject: 'Should these check-ins stop?', eyebrow: 'A check-in', heading: 'Should these check-ins stop?',
      intro: 'Nothing has changed on your plan for a while.', card,
      body: 'If this move stalled, open your plan and write what got in the way under it. The move gets reworked around it. If you would rather not get these, the link at the bottom stops them for good.',
      cta: 'Open your plan',
    }
  }
  if (count >= 2) {
    return {
      subject: `Still on: ${t}`, eyebrow: 'Your check-in', heading: 'Still on this move? That is normal.',
      intro: 'Some moves take longer than others.', card,
      body: 'If something changed, write it under the move and it gets rewritten around what is true now.',
      cta: 'Open your plan',
    }
  }
  return {
    subject: `How's "${t}" going?`, eyebrow: 'Your check-in', heading: 'How is your move going?',
    intro: record ?? undefined, card,
    body: 'When you get there, tick it off on your plan. Stuck on one part? Ask in the box under the move.',
    cta: 'Open your plan',
  }
}

/** A check-in for someone on the PATH: the one step, linked straight to it. */
export function composePath(p: { due: Step | null; next: Step | null; done: number; total: number }, count: number): Omit<Parts, 'link'> & { step: Step | null } {
  const record = p.done ? `You have done ${p.done} of ${p.total} steps.` : undefined
  const mins = (s: Step) => (s.minutes ? `About ${s.minutes} minutes` : undefined)
  if (count >= 4) {
    const s = p.due ?? p.next
    return {
      subject: 'Should these check-ins stop?', eyebrow: 'A check-in', heading: 'Should these check-ins stop?',
      intro: `${record ? `${record} ` : ''}Nothing has moved on your path for a while.`,
      card: s ? { label: 'Next step', title: plain(s.title) } : undefined,
      body: 'If a step cannot happen, open it and tap "It didn\'t work". The path moves on without it. If you would rather not get these, the link at the bottom stops them for good.',
      cta: 'Open your path', step: s,
    }
  }
  if (p.due) {
    return {
      subject: `It's time: ${plain(p.due.title)}`, eyebrow: 'You asked to be reminded', heading: 'The day has come for this step',
      intro: record,
      card: { label: 'Your step', title: plain(p.due.title), sub: p.due.why ? plain(p.due.why, true) : undefined, pill: mins(p.due) },
      body: 'Open your path and tap it once it is done.',
      cta: 'Open this step', step: p.due,
    }
  }
  const s = p.next!
  if (count >= 2) {
    return {
      subject: `Still waiting: ${plain(s.title)}`, eyebrow: 'Your check-in', heading: 'Your next step is still here',
      intro: record,
      card: { label: 'Next step', title: plain(s.title), pill: mins(s) },
      body: 'If it cannot happen, open it and tap "It didn\'t work". The path moves on, and nothing is lost.',
      cta: 'Open this step', step: s,
    }
  }
  return {
    subject: `Your next step: ${plain(s.title)}`, eyebrow: 'Your check-in', heading: 'Your next step is ready',
    intro: record,
    card: { label: 'Next step', title: plain(s.title), sub: s.why ? plain(s.why, true) : undefined, pill: mins(s) },
    body: 'Tap it on your path when it is done.',
    cta: 'Open this step', step: s,
  }
}
