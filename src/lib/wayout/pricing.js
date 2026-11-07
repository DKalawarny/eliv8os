/**
 * The way out — price, in exactly one place.
 *
 * ⭐ SAME RULE AS src/lib/pricing.js, FOR THE SAME REASON. Eliv8 OS had $147
 * hardcoded into JSON-LD schemas built to be quoted by AI assistants, and they
 * went on advertising it long after the price changed. A price literal written
 * anywhere else is a price that will be wrong somewhere nobody is looking.
 *
 * ⚠️ NOTHING IS CHARGEABLE YET. `PAYMENTS_LIVE` is false and there is no Stripe
 * price object behind this figure. Stripe on this account is still in TEST mode
 * ("Leados sandbox"), and creating a live one-time price is Daniel's call, not
 * a side effect of building the screens.
 *
 * Flipping this to true requires BOTH:
 *   1. A real Stripe price at this exact figure, in live mode, with its id in
 *      `STRIPE_PRICE_ID_WAYOUT` as an edge-function secret. Stripe prices are
 *      immutable — a changed figure means a NEW price object, never an edit.
 *   2. The `wayout` branch of stripe-webhook writing `status = 'paid'`, which
 *      is the only thing the database will accept as proof of payment
 *      (migration 046 locks the column against the client).
 *
 * Until then the paywall screen says plainly that it cannot take money yet,
 * rather than rendering a button that goes nowhere.
 */

/**
 * ⭐⭐ THE MODEL, SETTLED 21 SEP: THE MAP IS FREE, THE WALKTHROUGH IS MONTHLY.
 *
 * ⭐ $19, NOT $29, DANIEL 17 OCT: "29 might be too much for what this is". The
 * people this is for are short every month, and their own plan tells them to
 * cut a $29 bill. One flat monthly price, asked once at the moment they want
 * the next step, never a free taste followed by a second ask ("people buy in
 * the moment"). Not $9 either: paying something real is part of seeing it
 * through, and it has to carry the referral cut. See REFERRAL below.
 *
 * It was $39 once for the map, and two files each claimed to be the paid half —
 * Plan.jsx said "$39, once. Not a subscription." while Play.jsx said "THIS IS
 * THE PAID HALF". Both cannot be true.
 *
 * ⭐ Why the map is free: their problem is money, so the hardest $39 in
 * consumer software is the one asked of somebody who is stuck. The map is also
 * the only thing anyone would ever show a friend — putting it behind a paywall
 * costs the distribution as well as the conversion. Daniel: "getting someone to
 * try it out for free for feedback and REVIEW IS MORE IMPORTANT."
 *
 * ⚠️ WHY NOT CHEAPER STILL, WHICH IS THE COUNTER-INTUITIVE PART. This product
 * FINISHES — three moves, two gates, out. Software priced cheap makes it back
 * on duration; a thing people complete cannot. Lifetime is four to six months,
 * so the monthly figure does all the work. "A small amount per week" optimises
 * for signup, and signup is not where this loses people.
 *
 * ⚠️ MONTHLY ONLY. NO ANNUAL PLAN. On something finished in six months, annual
 * is taking money for months they will not use — a refund magnet, and a direct
 * contradiction of a product whose whole posture is that you cannot be
 * ambushed. The short lifetime costs less than it looks, because it is short
 * either way.
 */
export const WAYOUT_PRICE_CENTS = 1900
export const WAYOUT_CURRENCY    = 'CAD'
export const WAYOUT_PRICE_PERIOD = 'month'

/**
 * ⭐ ONE PRICE PER COUNTRY (Daniel, 7 Nov 2026: "ok us 19"). Canadians pay
 * C$19, everyone else US$19, each in their own currency, so nobody is charged
 * in a currency they did not see. Stripe holds both prices on one product.
 * ⚠️ The invite share is worked out in the currency the friend paid (REFERRAL).
 */
export const WAYOUT_PRICES = {
  CAD: { cents: 1900, label: 'C$19', full: 'C$19 a month' },
  USD: { cents: 1900, label: 'US$19', full: 'US$19 a month' },
}
/** The price for someone, from the country they gave (answers.region). */
export function priceFor(region) {
  return String(region ?? '').toLowerCase() === 'ca'
    ? { currency: 'CAD', ...WAYOUT_PRICES.CAD }
    : { currency: 'USD', ...WAYOUT_PRICES.USD }
}

/** The human-readable figure. The only string anyone should print. */
export const WAYOUT_PRICE_LABEL = '$19'

/** With the period attached — for anywhere a bare figure would read as one-off. */
export const WAYOUT_PRICE_FULL = '$19 a month'

/**
 * ⚠️ Gate, not a preference. While this is false no checkout is started and no
 * price is presented as payable.
 */
export const WAYOUT_PAYMENTS_LIVE = false

/**
 * ⭐⭐ REFERRAL, DANIEL 17 OCT. NOT BUILT: it waits for the company and for
 * payments to be live. The rules are written here so the build cannot drift.
 *
 *   - ONE LEVEL. You earn from people you bring, never from people they bring.
 *   - A share of every payment that actually goes through, for as long as the
 *     friend keeps paying. No time limit and no limit on friends ("maybe we
 *     get a salesman that just kills it"). No payment, no share: it stops the
 *     moment they cancel. A refund or chargeback takes it back, so payouts
 *     wait 30 days.
 *   - Nothing to buy to earn. Making people pay in order to earn is a mark of a
 *     pyramid scheme.
 *   - 🔴 7 NOV: NO SHARE ON YOUR OWN PAYMENTS. With an ongoing share, inviting a
 *     second account of your own would be 20% off forever. A friend who pays
 *     with the same card (Stripe's card fingerprint) as the inviter earns them
 *     nothing; the friend's discount still applies.
 *   - ⭐ 7 NOV, DANIEL: THE FRIEND GETS SOMETHING TOO, so it reads as a gift and
 *     not a scheme ("it gives me a bit of a pyramid feel"): half off their first
 *     month (WAYOUT_FRIEND_DISCOUNT). They still pay from day one ("you have to
 *     get them to pay right away or we won't get them committed").
 *   - ⭐ 7 NOV: THE SHARE STARTS AT THE FRIEND'S SECOND PAID MONTH, so the worst
 *     first month (half price, AI at the $5 cap) still clears about $3.90, and
 *     the thank you is for a friend who stayed.
 *   - On screen the number is shown: "20% of what they pay" (Daniel, 7 Nov: "ya
 *     show the 20%", reversing "a share" the same day). Only once
 *     WAYOUT_REFERRAL_LIVE is on. Draft terms: docs/legal/invite-terms-draft.html.
 *   - The share is worked out in the currency the friend PAID, and says which.
 *     It is converted once, at payout, with the rate shown.
 *   - Never sold as a way to make money, and never in anything the AI writes.
 *     It is mentioned once they have seen progress, as a thank you for sharing.
 *   - Paid through Stripe Connect, minimum payout $25. A lawyer reads the
 *     final terms before launch.
 */
export const WAYOUT_REFERRAL_SHARE = 0.2
/** The share as people read it. Derived, so the number lives in one place. */
export const WAYOUT_REFERRAL_SHARE_LABEL = `${Math.round(WAYOUT_REFERRAL_SHARE * 100)}%`
/** The invited friend's discount: half off their first paid month. */
export const WAYOUT_FRIEND_DISCOUNT = 0.5
/** Said TO the friend ("your"), and ABOUT the friend to the inviter ("their"). */
export const WAYOUT_FRIEND_DISCOUNT_LABEL = 'half off your first month'
export const WAYOUT_FRIEND_DISCOUNT_THEIR = 'half off their first month'
/** The share starts with the friend's second paid month. */
export const WAYOUT_REFERRAL_FROM_MONTH = 2
/** A typed code counts only for an account this young (migration 103). */
export const WAYOUT_CODE_DAYS = 30
/** Payouts wait this long after a payment, for refunds. */
export const WAYOUT_PAYOUT_HOLD_DAYS = 30
/** Smallest payout, in the payout currency. */
export const WAYOUT_PAYOUT_MIN = 25
/**
 * ⚠️ One switch for every line that names money in the invite feature (the
 * friend's discount, the share). Until payments are live there is nothing to
 * discount and nothing to share, so the pages talk about inviting only.
 */
export const WAYOUT_REFERRAL_LIVE = WAYOUT_PAYMENTS_LIVE

/**
 * ⭐⭐ SAY THE PRICE EARLY, EVERY TIME. THE FEAR IS THE AMBUSH, NOT THE MONEY.
 *
 * 🔴 Four screens used to read "Nothing to buy until you've seen your plan",
 * and the actual flow is finish the questions → paywall → pay → THEN it
 * generates. We were promising people they would see it first. Someone who
 * suspects a bait-and-switch and then meets one has been proved right about us,
 * and there is no copy that recovers from that.
 *
 * ⚠️ The way to remove the fear is not to promise it away. It is to make it
 * impossible to be surprised: the number, in plain words, before a single
 * question, and again while they answer. Somebody who knew at minute zero
 * cannot be ambushed at minute fifteen.
 */
export function priceLine() {
  // ⭐ The assessment is free and always will be. What is paid for is the
  // play-by-play — how to actually do the move you are standing on.
  return WAYOUT_PAYMENTS_LIVE
    ? `Your plan is free. ${WAYOUT_PRICE_FULL} later, only if you want the step-by-step for actually doing it, and only for as long as you are doing it.`
    // ⚠️ True while payments are off: nothing is charged anywhere. It must not
    // promise "anywhere else" — the step-by-step is meant to be paid later.
    : 'Your plan is free. There is nothing to pay.'
}

/** The short version, for a corner of the screen while they answer. */
export function priceShort() {
  return WAYOUT_PAYMENTS_LIVE ? 'Your plan is free. No catch at the end.' : 'Your plan is free.'
}

/**
 * ⚠️ A real promise, not a marketing line. At this volume a refund costs almost
 * nothing, and it moves the risk off the person who has the least ability to
 * carry it — which is the whole posture of the product.
 */
export function guaranteeLine() {
  // ⚠️ Nothing about money back while nothing is being taken — "refund" copy on
  // a free product reads as a script somebody forgot to switch off.
  return WAYOUT_PAYMENTS_LIVE
    ? 'Cancel in one click, any month. If it doesn’t fit your life, say so and you get that month back. No form to fill in.'
    : ''
}

/**
 * ⭐⭐ WHAT THE SUBSCRIPTION IS, IN ONE SENTENCE — and the wording is load-bearing.
 *
 * 🔴 IT MUST NEVER IMPLY A HUMAN IS ON THE OTHER END. This product's whole
 * reason for working without one is capability, not accountability. Somebody
 * who expects a coach and meets software has been misled, and that is the one
 * thing this product cannot survive. Daniel settled the phrasing: "it walks the
 * move with you", NOT "a coach walks you through".
 */
export function walksWithYouLine() {
  /**
   * 🔴🔴 IT IS A GUIDE. A DOCUMENT. NOT A RELATIONSHIP — and that is a legal
   * distinction before it is a copy one.
   *
   * Daniel, 27 Sep, rejecting "knowing what to actually say on Tuesday": "i'm
   * really not a fan of this kind of talk. i mean like a step by step guide that
   * we build, something along those lines, that also takes away liability."
   *
   * ⭐⭐ HE IS RIGHT ON BOTH HALVES AND THE SECOND ONE MATTERS MORE. "It walks
   * the move with you", "having it walked with you", "your questions answered as
   * they come up" all describe an ONGOING ADVISORY SERVICE. A step-by-step guide
   * built from the answers somebody gave is a PRODUCT. For a consumer money tool
   * that is a materially better thing to be selling, and it is what this
   * actually is.
   *
   * ⚠️ WHAT COPY CANNOT DO. Naming it accurately narrows exposure; it does not
   * remove it. The protection is the terms and the corporation — and per
   * docs/wayout-before-launch.md the terms are still unwritten and Eliv8 Inc.
   * does not exist, so today Sarlia is the only entity between Daniel and a user.
   * Do not let this comment read as though the question is settled.
   *
   * ⚠️ AND STILL NOTHING IMPLYING A HUMAN. The old line failed that test by a
   * different route — "walks with you" is a companion. This has no companion and
   * no adviser in it, only a document and its contents.
   */
  return 'A step-by-step guide for the move you are on: what to do, in what '
    + 'order, what it should cost, and what to do if it does not go to plan.'
}
