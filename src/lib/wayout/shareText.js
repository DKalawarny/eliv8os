import { WAYOUT_NAME, WAYOUT_SITE_URL, WAYOUT_TOTAL_TIME } from './brand'
import { WAYOUT_REFERRAL_LIVE, WAYOUT_FRIEND_DISCOUNT_LABEL, WAYOUT_REFERRAL_SHARE_LABEL } from './pricing'
import { forReaders } from './mapContract'

/**
 * ⭐⭐ WHAT SOMEONE SENDS A FRIEND ABOUT THEIR PLAN (17 Oct 2026).
 *
 * The free plan is the only thing anyone would show a friend, so it is how
 * strangers arrive without ad money. Daniel: "how do we get it to snowball".
 *
 * 🔴 It is THEIR plan, so it is a draft in a box they edit, never a public page.
 * A plan holds their debt, their custody, what they are running from. Only the
 * move titles go in, and every money figure comes out before they even see it:
 * "$300 short" in a text to a brother-in-law is not ours to send.
 */

/** The link carries utm tags so source.js counts a shared plan as its own source. */
export const SHARE_URL = `${WAYOUT_SITE_URL}/?utm_source=share`

const MONEY = /\$\s?\d[\d,]*(?:\.\d+)?(?:k\b)?(?:\s*(?:a|per|\/)\s*(?:month|mo|week|year|yr))?/gi

/** Every money figure out. "the $300" reads as "the money", anything else as "money". */
export function withoutFigures(text) {
  return String(text ?? '')
    .replace(new RegExp(`\\bthe\\s+${MONEY.source}`, 'gi'), 'the money')
    .replace(MONEY, 'money')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/** Their three move titles, figures out, as lines to add to the message. */
export function movesBlock(map) {
  const moves = (Array.isArray(map?.moves) ? map.moves : [])
    .map(m => withoutFigures(forReaders(m?.title)).replace(/[.\s]+$/, ''))
    .filter(Boolean)
    .slice(0, 3)
  if (!moves.length) return ''
  return ['My next three moves:', ...moves.map((t, i) => `${i + 1}. ${t}`)].join('\n')
}

/**
 * ⭐ ABOUT THE PRODUCT, NOT THEIR PLAN (Daniel, 6 Nov 2026: "why would you send
 * someone you know your plan?"). Their moves are their life and mean nothing to
 * the friend, so they are out unless the person adds them (`withMoves`).
 * `url` is their own invite link when they have one (invites.js), so the friend counts.
 */
export function shareDraft(map, url = SHARE_URL, { withMoves = false, code = '', live = WAYOUT_REFERRAL_LIVE } = {}) {
  const lines = [`I have been using ${WAYOUT_NAME} to work out what to do first. Getting your plan is free, and the questions take ${WAYOUT_TOTAL_TIME}.`]
  const moves = withMoves ? movesBlock(map) : ''
  if (moves) lines.push('', moves)
  // ⭐ Tells them to use THIS link (Daniel, 7 Nov: "so the person knows to use
  // that specific one, not just sign in normally"), and, once there is money
  // in it, says the sender gets something: the honest way to recommend.
  if (live) lines.push('', `My link gives you ${WAYOUT_FRIEND_DISCOUNT_LABEL} of the step by step help${code ? `, or enter my code ${code}` : ''}. (If you stay, I get ${WAYOUT_REFERRAL_SHARE_LABEL} of what you pay.)`)
  else if (url !== SHARE_URL) lines.push('', `Sign up through my link so I can see you joined${code ? `, or enter my code ${code}` : ''}.`)
  lines.push('', `Yours: ${url}`)
  return lines.join('\n')
}
