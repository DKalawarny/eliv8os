/**
 * The way out — the map's output contract.
 *
 * ⚠️ SPLIT OUT OF session.js SO IT CAN BE TESTED. This is the logic that
 * decides whether the seen card is allowed to render, which is the one thing in
 * this product that cannot be wrong — and it was sitting in a module that
 * imports the Supabase client, so it could not be loaded in a unit test at all.
 * Pure in, pure out, no I/O.
 */

// ⚠️ The .js extension is required, not stylistic. Vite resolves extensionless
// imports; plain Node does not — and scripts/wayout-audit.mjs runs this module
// under Node so the audit can use the very same guards the product uses,
// rather than a copy that can drift from them.
import { WAYOUT_READING } from '../../content/wayoutReading.js'
import { WAYOUT_SCREENS, WAYOUT_OPEN } from '../../content/wayoutIntake.js'
import { plainDashes } from '../plainDashes.js'
export { plainDashes }

/**
 * ⭐⭐ THE SEEN CARD IS THE ONE THING IN THIS PRODUCT THAT CANNOT BE WRONG.
 *
 * It quotes the person back to themselves and names what they missed, and it
 * only works because it is true. A fabricated quote — even a close paraphrase —
 * does not read as a small error. It reads as "this thing is making things up
 * about me", and it takes every other claim on the page down with it.
 *
 * The prompt says copy it verbatim or omit the field. This checks. A prompt
 * rule is a preference; this is the guarantee, and it is why SPEC §9 lists
 * "seen never renders without a verbatim quote" as an acceptance check rather
 * than a nice-to-have.
 *
 * ⚠️ Only free text counts. A chip the person tapped is our label, not their
 * words, and quoting it back as if they had said it is the same lie in a
 * smaller font.
 */
/**
 * ⭐⭐ WHICH ANSWERS ARE THEIR WORDS — DERIVED FROM THE INTAKE, NOT LISTED.
 * This was a hand-kept list, and its own comment named the weakness: a free-text
 * field left off it makes every quote from it unverifiable, so the seen card is
 * dropped for being honest. On 1 Oct it was missing enough, coming, debt, refuse
 * and alreadyTried — and two audit plans lost their most personal card ("enough
 * to stop nights", "far less than I think") that way.
 * Every `kind: 'text'` question counts, plus the open door, plus the few that
 * live outside WAYOUT_SCREENS.
 */
const THEIR_WORDS_KEYS = [...new Set([
  ...WAYOUT_SCREENS.flatMap(sc => sc.fields ?? []).filter(f => f.kind === 'text').map(f => f.key),
  WAYOUT_OPEN?.field?.key,
  'out', 'seasonNote', 'worstVersion', 'fromToward',
  // ⚠️ Merged away on 9 Oct but still in older sessions, so a quote from one of
  // them has to stay verifiable.
  'partnerWants', 'paidFor', 'fiveYearTest', 'coming',
].filter(Boolean))]

export function enforceMapContract(map, answers) {
  const out = { ...map }

  // Computed once — `allowedFigures` is O(n²) over their numbers and the trim
  // asks about every sentence.
  const allowed = allowedFigures(answers ?? {})

  const freeText = [
    ...THEIR_WORDS_KEYS.map(k => answers[k]),
    // ⚠️ ADDED AFTER THE PLAN, AND IT COUNTS AS THEIR WORDS LIKE ANY OTHER.
    ...(Array.isArray(answers.added) ? answers.added : []),
  ].filter(v => typeof v === 'string' && v).join('\n').toLowerCase()

  if (out.seen?.quote) {
    const quote = String(out.seen.quote).toLowerCase().trim()
      // Models normalise typography — a straight quote becomes curly, a dash
      // becomes an em dash. That is not fabrication, so normalise both sides
      // rather than dropping a card that is genuinely the person's words.
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[–—]/g, '-')
    const haystack = freeText
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[–—]/g, '-')

    /**
     * ⭐⭐ DROP THE QUOTE, KEEP THE INSIGHT. This used to delete the whole card,
     * which threw away the one warm sentence on the page along with the
     * unverifiable one.
     *
     * 🔴 AND IT FAILED WORST EXACTLY WHERE IT MATTERED MOST. Somebody who typed
     * almost nothing has nothing quotable, so the thin-answers plan rendered
     * with NO insight at all — the most guarded person got the least warmth,
     * which is backwards. Daniel, 26 Sep: "we need to have a motivating tone as
     * well." A card that vanishes cannot carry one.
     *
     * ⚠️ The asymmetry is the justification. A QUOTE is a claim about what they
     * said, so an unverifiable one is a fabrication and must go. An INSIGHT is
     * the model's own observation about their situation — it was never theirs to
     * misquote, it is scrubbed for invented figures just below, and it is the
     * sentence that does the lifting.
     */
    if (!quote || !haystack.includes(quote)) {
      console.warn('[wayout] seen quote dropped — not verbatim in the answers; insight kept')
      if (out.seen.insight) out.seen = { insight: out.seen.insight }
      else delete out.seen
    }
  }

  // ⚠️ THE INSIGHT BESIDE THE QUOTE WAS NEVER CHECKED. The quote is verified
  // word for word — it is the one thing that cannot be wrong — and the sentence
  // next to it, which is the most personal claim on the page, went unread.
  if (out.seen?.insight) {
    out.seen = { ...out.seen, insight: scrubFigures(out.seen.insight, answers) }
  }

  // The highlight is rendered as a <mark> inside the headline by string match.
  // If it is not actually in the headline the mark silently does nothing, which
  // looks like a design bug rather than a data one.
  if (out.highlight && out.headline && !out.headline.includes(out.highlight)) {
    console.warn('[wayout] highlight not found in headline — dropping the mark')
    delete out.highlight
  }

  // ⚠️ A HIGHLIGHT THAT COVERS MOST OF THE HEADLINE IS NOT A HIGHLIGHT. The
  // prompt asks for two to four words; it produced eight, which at headline
  // size overflowed its column and ran over the next one. The CSS now wraps
  // instead of overflowing, so this is no longer a layout failure — but a mark
  // under half a sentence emphasises nothing, which is its own failure.
  if (out.highlight && out.headline && out.highlight.length > out.headline.length * 0.5) {
    console.warn('[wayout] highlight covers most of the headline — dropping the mark')
    delete out.highlight
  }

  // Exactly three moves, in order. A map with four is not a worse map, it is a
  // different product — the ordering is the thing being sold.
  if (Array.isArray(out.moves)) {
    out.moves = out.moves
      .slice(0, 3)
      // 🔴 EVERY MOVE CARRIES A DETAIL AGAIN. Withholding them on two and
      // three was meant to protect the paid half and it gutted the plan
      // instead — Daniel: "super vague, not enough meat". A title and a gate
      // with nothing between them is not restraint, it is a blank. What keeps
      // the paid half safe is the WHAT/HOW line, which every detail is trimmed
      // against regardless of which move it belongs to.
      .map((m, i) => ({
        ...m,
        order: i + 1,
        detail: trimDetail(m?.detail, allowed, answers),
      }))
  }

  // ⭐⭐ OURS WHERE WE CAN DERIVE THEM. See deriveStats — the two biggest
  // numbers on the page are subtraction on figures they typed, and putting a
  // language model in that loop is what made them move.
  const derived = deriveStats(answers)

  // ⭐ A stat is the biggest type on the page, and its value is a clean number
  // rather than prose — so an unfounded one can be dropped the way the seen
  // card is, instead of failing the whole plan. If that leaves fewer than two,
  // `mapProblems` says so and the map is written again.
  // ⭐⭐ IN THIS ORDER, AND THE ORDER IS THE POINT.
  //   1. Our own pair, when both can be derived. Deterministic, and the answer
  //      to "why does the dollar amount always change".
  //   2. Otherwise the model's, minus any figure that is not theirs.
  //   3. Otherwise the one number we can stand behind.
  //
  // ⚠️ My first attempt collapsed this to "ours if we have any", which threw
  // away two perfectly good guarded stats to show one derived one. Preferring
  // certainty is right; preferring LESS certainty is not.
  const founded = (Array.isArray(out.stats) ? out.stats : []).filter(st => {
    const ok = statIsFounded(st, answers)
    if (!ok) console.warn('[wayout] stat dropped — figure is not theirs:', st?.label, st?.value)
    return ok
  })

  if (derived && derived.length >= 2) out.stats = derived
  else if (founded.length) out.stats = founded
  else if (derived) out.stats = derived
  else out.stats = []

  // ⭐ Three at the outside. A list of nine assumptions is not honesty, it is
  // a disclaimer — nobody reads it and nothing gets corrected.
  if (Array.isArray(out.assumptions)) {
    out.assumptions = out.assumptions
      .map(a => firstSentence(String(a ?? '').trim()))
      .filter(Boolean)
      .slice(0, 3)
  }

  // ⚠️ Questions only, and never their answers. `stuck` exists to make the gap
  // felt; a line without a question mark is almost always the model answering
  // itself, which hands over the one thing that is meant to be paid for.
  if (Array.isArray(out.stuck)) {
    out.stuck = out.stuck
      .map(q => String(q ?? '').trim())
      .filter(q => q.endsWith('?'))
      .slice(0, 3)
  }

  // ⚠️ A book we cannot vouch for is dropped silently. There is no version of
  // "we recommended something that may not exist" worth rendering.
  if (out.read && !readingIsReal(out.read, WAYOUT_READING)) {
    console.warn('[wayout] reading dropped — not on the shelf:', out.read?.title)
    delete out.read
  }

  if (Array.isArray(out.cut)) {
    out.cut = out.cut
      .slice(0, 4)
      .map(c => ({ ...c, why: trimDetail(c?.why, allowed, answers, true) }))
      // ⚠️ A reason that loses every sentence is no longer a reason. Naming
      // something crossed off without saying why is worse than not naming it.
      .filter(c => String(c?.why ?? '').trim())
  }

  out.disclaimer = out.disclaimer
    || 'This is a map of options, not financial or legal advice. Check the numbers before you act.'

  return deJargon(out)
}

/**
 * Does this person live somewhere with a real winter?
 *
 * ⚠️ A KEYWORD TEST ON FREE TEXT, AND IT IS DELIBERATELY BIASED TOWARDS "YES".
 * We ask where they are and what the season is like, and both are free text, so
 * there is no clean signal here. The two errors are not equal: a false positive
 * asks for an off-season plan somewhere mild, which is a slightly redundant
 * paragraph. A false negative leaves someone in Nanaimo with no income from
 * November, and they find out in November. So anything that reads cold counts,
 * and a blank answer counts too.
 */
export function looksColdClimate(answers) {
  const text = `${answers?.locationText ?? ''} ${answers?.seasonNote ?? ''}`.toLowerCase()
  if (!text.trim()) return true
  if (/\b(tropical|no winter|mild all year|year-round warm|never gets cold|desert)\b/.test(text)) return false
  return /\b(snow|winter|cold|freez|ice|frost|rain|wet|canada|alberta|saskatchewan|manitoba|ontario|quebec|bc|british columbia|yukon|maritime|minnesota|michigan|wisconsin|dakota|montana|maine|vermont|alaska|new york|chicago|boston|denver|toronto|calgary|edmonton|winnipeg|montreal|ottawa|vancouver|nanaimo|kelowna|prince george)\b/.test(text)
}

/**
 * Immovables that end the relocation conversation.
 *
 * ⭐ From the spec's first principle — constraints before dreams. A plan that
 * asks someone with shared custody to move away is not a worse plan, it is a
 * worthless one, and it tells them the thing did not listen to the first
 * question it asked.
 */
const BLOCKS_RELOCATION = new Set(['kids-home', 'custody', 'parent', 'partner-job', 'health', 'legal'])

export function relocationIsBlocked(answers) {
  const tags = Array.isArray(answers?.immovables) ? answers.immovables : []
  return tags.some(t => BLOCKS_RELOCATION.has(t.key))
}

/**
 * ⚠️ Keyword-matched, because the move is free text the model wrote. It will
 * not catch every phrasing, so it is a backstop for the prompt rule rather than
 * a replacement for it — but it catches the blunt ones, and the blunt ones are
 * what a model produces when it forgets a constraint.
 */
const RELOCATION_WORDS = /\b(relocat|move away|move to|moving to|leave town|leave the (city|province|state)|somewhere cheaper|a cheaper (city|town|province|state)|sell up and move)\b/i

function proposesRelocation(move) {
  return RELOCATION_WORDS.test(`${move?.title ?? ''} ${move?.detail ?? ''}`)
}

/**
 * Shape and safety problems worth surfacing rather than rendering a half-map.
 *
 * ⭐ These are the SPEC §9 acceptance checks, enforced rather than hoped for.
 * The prompt states every one of them; this is what makes them true. A caller
 * that gets a non-empty list must not render the map — see Plan.jsx, which
 * says the plan came back wrong rather than showing three-quarters of one to
 * someone who has paid.
 */
/**
 * ⭐ 18 Oct: somebody who tapped "a second job" as what eats their time asked
 * for one job. Live plans named the second job's end only half the time, with
 * the rule in the prompt. Exported so the audit uses this one, not its own.
 */
export const SECOND_JOB_ENDS = /second job|one job|side (?:work|job)|(?:extra|weekend|warehouse) shifts?|without the (?:second|side|weekend|warehouse|detail)/i

/**
 * `fresh` is true only for a plan just written. A rule added after a plan was
 * saved must not rewrite that plan (and its ticks) the next time it is opened.
 */
export function mapProblems(map, answers = {}, { fresh = false } = {}) {
  const problems = []
  if (!map?.headline) problems.push('no headline')

  if (!Array.isArray(map?.moves) || map.moves.length !== 3) {
    problems.push('not three moves')
  } else {
    // Every move needs a checkable next step, or the ordering means nothing.
    const gateless = map.moves.filter(m => !String(m?.gate ?? '').trim())
    if (gateless.length) problems.push(`move ${gateless.map(m => m.order).join(', ')} has no gate`)

    // No December hole.
    const first = map.moves[0]
    const outdoor = first?.outdoor === true || Boolean(first?.season)
    // 🔴 A DELIBERATE OFF-SEASON IS NOT A HOLE. This check used to flag any
    // outdoor first move in a cold climate with no winter work — which meant
    // that for the landscaper who earns his year in six months and spends the
    // winter somewhere warm, we looked at his correct plan and called it
    // broken. When someone has asked for a season on and a season off, the
    // empty half of the year is the thing they are buying.
    const wantsSeasonal = answers?.yearShape === 'seasonal'
    if (outdoor && !wantsSeasonal && looksColdClimate(answers)) {
      const hasPlan = Array.isArray(map.seasonPlan) && map.seasonPlan.length > 0
      if (!hasPlan) problems.push('outdoor first move in a cold climate with no off-season plan')
    }

    if (fresh && (answers?.timeEaters ?? []).some(t => t?.key === 'work-second')
      && !map.moves.some(m => SECOND_JOB_ENDS.test(`${m?.title ?? ''} ${m?.gate ?? ''}`))) {
      problems.push('they named a second job eating their time and asked for one job: one move must name the second job they stop, with a gate from their own numbers saying when')
    }

    // Constraints before dreams.
    if (relocationIsBlocked(answers)) {
      const bad = map.moves.filter(proposesRelocation)
      if (bad.length) problems.push(`move ${bad.map(m => m.order).join(', ')} asks them to move when they said they can't`)
    }
  }

  // ⚠️ AT LEAST ONE, NOT EXACTLY TWO. See deriveStats — somebody who answered
  // thinly can only honestly be shown one figure, and failing their whole plan
  // over the second is refusing to serve the person with least to give.
  if (!Array.isArray(map?.stats) || map.stats.length < 1) problems.push('missing stats')

  // 🔴 THE ONE THAT COST DANIEL'S FIRST REAL MAP ITS CREDIBILITY. Prose cannot
  // be edited down the way a stat can — a sentence with a made-up figure cut
  // out of it is not a sentence — so this fails the map and `generateMap`
  // writes it again, naming the offending figure in the retry.
  inventedFigures(map, answers).forEach(p => problems.push(p))

  // Anything deJargon could not translate. The map is rewritten rather than
  // shipped with our schema showing.
  fieldNamesLeaked(map).forEach(n => problems.push(`"${n}" is our field name, not a word — say it the way the question did`))
  if (!Array.isArray(map?.cut) || map.cut.length < 2) problems.push('nothing crossed off')
  return problems
}

// ── Numbers ─────────────────────────────────────────────────────────────────

/**
 * ⭐⭐ A FIGURE THE PLAN PRINTS MUST BE A FIGURE THE PERSON GAVE.
 *
 * 🔴 DANIEL'S FIRST REAL MAP INVENTED TWO. It printed "$5,000/mo — mortgage
 * gone when the house sells" and "$120,000 — cash in hand at sale". He had
 * never said what his mortgage is, never said his house was worth anything in
 * particular, and had written exactly six words: "hopefully sale of my house".
 * The $5,000 was his MUST-PAY TOTAL — rent, insurance, fuel, food, childcare,
 * the lot — relabelled as a mortgage payment. The $120,000 came from nowhere.
 *
 * ⚠️ THIS IS THE SEEN-CARD FAILURE IN A BIGGER FONT. A made-up quote reads as
 * "it is making things up about me"; a made-up number reads the same way AND
 * someone might act on it. The plan is being used to decide whether to sell a
 * house. The prompt asking nicely is a preference; this is the guarantee.
 *
 * The rule: a money-shaped figure is allowed if it is one of their own numbers,
 * a sum or difference of two of them, or one of those converted between monthly
 * and yearly. That is the arithmetic the plan is FOR — closing the gap is
 * subtraction — and it is the only arithmetic that cannot introduce a fact.
 */

/** Money-shaped figures only. "3 months" and "20 hours" are not claims about money. */
function figuresIn(text) {
  const out = []
  const re = /(\$)?\s?(\d[\d,]*(?:\.\d+)?)\s?(k\b|m\b)?(%)?/gi
  let m
  while ((m = re.exec(String(text ?? ''))) !== null) {
    const [, dollar, digits, scale, pct] = m
    if (pct) continue                       // 50% is not a dollar figure
    let value = parseFloat(digits.replace(/,/g, ''))
    if (!Number.isFinite(value)) continue
    if (/^k/i.test(scale ?? '')) value *= 1000
    if (/^m/i.test(scale ?? '')) value *= 1000000
    // A bare year is a date, not money. 2026 must not read as $2,026.
    if (!dollar && !scale && Number.isInteger(value) && value >= 1900 && value <= 2100) continue
    // Below $100 with no dollar sign is a count — hours, weeks, a score out of 10.
    if (!dollar && !scale && value < 100) continue
    out.push(value)
  }
  return out
}

/**
 * ⭐⭐ PEOPLE WRITE NUMBERS AS WORDS, AND THIS GUARD COULD NOT READ THEM.
 *
 * 🔴 THE DEADLOCK, FOUND BY GENERATING A REAL MAP AND RUNNING IT THROUGH THE
 * CONTRACT. Someone wrote "a guy paid me two hundred to clear his yard". The
 * model did exactly the right thing — used $200, their own figure, from their
 * own sentence — and the check rejected it as invented, because `figuresIn`
 * only ever looked for digits. Every attempt failed the same way, three times,
 * and the person got an error instead of the plan.
 *
 * ⚠️ This is the third time the same shape has bitten: a guard built to stop
 * fabrication rejecting something honest, because the rule was written against
 * how a MODEL writes rather than how a PERSON does. "Two hundred", "a couple
 * grand" and "600k" are all somebody telling you a number.
 */
const ONES = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
  fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
}
const TENS = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90,
}
const SCALES = { hundred: 100, thousand: 1000, grand: 1000, k: 1000, million: 1e6 }

/** "two hundred", "a couple grand", "forty five thousand". */
function wordNumbers(text) {
  const words = String(text ?? '').toLowerCase().match(/[a-z]+/g) ?? []
  const found = []
  let current = 0
  let running = 0
  let live = false

  const flush = () => {
    if (live && (running + current) > 0) found.push(running + current)
    current = 0; running = 0; live = false
  }

  for (const w of words) {
    if (w === 'a' || w === 'an') { current = current || 1; continue }
    if (w === 'couple' || w === 'few') { current = current || 2; live = true; continue }
    if (ONES[w] != null) { current += ONES[w]; live = true; continue }
    if (TENS[w] != null) { current += TENS[w]; live = true; continue }
    if (SCALES[w] != null) {
      const scale = SCALES[w]
      // "hundred" multiplies what is beside it; "thousand" closes the group.
      if (scale === 100) current = (current || 1) * 100
      else { running += (current || 1) * scale; current = 0 }
      live = true
      continue
    }
    if (w === 'and' && live) continue
    flush()
  }
  flush()
  return found
}

/** Every number this person put in front of us, however they put it. */
function theirNumbers(value, into = []) {
  if (value == null) return into
  if (typeof value === 'number') { if (Number.isFinite(value)) into.push(value); return into }
  if (typeof value === 'string') {
    figuresIn(value).forEach(n => into.push(n))
    // ⭐ And the ones they spelled out. See wordNumbers.
    wordNumbers(value).forEach(n => into.push(n))
    return into
  }
  if (Array.isArray(value)) { value.forEach(v => theirNumbers(v, into)); return into }
  if (typeof value === 'object') { Object.values(value).forEach(v => theirNumbers(v, into)); return into }
  return into
}

/**
 * Their numbers, plus the arithmetic that adds no new fact.
 *
 * ⚠️ Deliberately GENEROUS. A false positive here rejects a correct plan and
 * makes the person try again, which is a worse experience than the occasional
 * figure that slips through — so pairwise sums and differences are allowed, and
 * so is ×12 and ÷12, because "what it costs a year" is the same fact as "what
 * it costs a month". Anything beyond that is the model knowing something about
 * their life that it was never told.
 */
function allowedFigures(answers) {
  const base = [...new Set(theirNumbers(answers))]

  // ⚠️ DISTINCT PAIRS ONLY, AND THE `i < j` IS LOAD-BEARING. The first version
  // of this let every number pair with ITSELF, so a $5,000 must-pay doubled to
  // $10,000 and annualised to exactly $120,000 — which is the invented figure
  // this check exists to catch, reconstructed by the check itself. Adding a
  // number to itself is not reading their answer, it is inventing a second one.
  const combined = new Set(base)
  base.forEach((a, i) => base.forEach((b, j) => {
    if (i >= j) return
    combined.add(a + b)
    combined.add(Math.abs(a - b))
  }))

  const out = new Set(combined)
  // A month or a year. Same fact, different unit.
  //
  // 🔴 ×52 AND ÷52 USED TO BE IN HERE AND THEY MADE THIS GUARD POROUS. Weekly
  // money is not something this intake ever asks for, and multiplying every
  // pairwise sum by 52 lays down such a dense net of values that almost any
  // large figure lands within tolerance of one. A must-pay of 2,000 and a
  // discretionary of 340 made $121,680 "traceable" — which is 2% from
  // $120,000, the exact fabrication this whole check was built to catch.
  //
  // ⚠️ A generous closure is the right instinct; this one was generous enough
  // to be decorative. It is not a guard if a wide enough search finds a path to
  // any number.
  combined.forEach(v => { out.add(v * 12); out.add(v / 12) })
  // ⭐ "Three months of must-pay banked" is a real and honest gate, and it is
  // still only their number. Small whole multiples of a BASE figure only —
  // never of a converted one, or a year of must-pay triples into a mortgage.
  base.forEach(v => { out.add(v * 2); out.add(v * 3); out.add(v * 6); out.add(v / 2) })

  return [...out].filter(v => Number.isFinite(v) && v > 0)
}

/** Rounding is honest; a different number is not. 2% or a dollar, whichever is larger. */
function traceable(value, allowed) {
  return allowed.some(v => Math.abs(v - value) <= Math.max(1, value * 0.02))
}

/**
 * ⭐ THE SECOND HALF OF DANIEL'S CATCH, AND THE HARDER ONE: the $5,000 WAS his
 * number. What was invented was what it was CALLED.
 *
 * A figure hung on a sale, an inheritance, a payout or a pension is not
 * arithmetic — it is a claim about a thing only they can price. So when a stat
 * says "at sale", the figure has to come from the answer where THEY mentioned
 * the sale. Someone who wrote "hopefully sale of my house" and no number has
 * told us there may be a sale and nothing whatsoever about what it is worth.
 */
const SPECULATIVE = [
  /\bsale\b|\bsell(s|ing)?\b|\bsold\b/i,
  /\bequity\b/i,
  /\binherit(ance|ed|ing)?\b/i,
  /\bpension\b/i,
  /\bbonus(es)?\b/i,
  /\bseveran/i,
  /\bsettlement\b/i,
  /\bpay ?out\b/i,
  /\bwindfall\b/i,
  /\blump sum\b/i,
  /\brefund\b/i,
  /\bcommission\b/i,
]

/**
 * ⭐⭐ AN ASSUMPTION IS ONE SENTENCE AND IT STOPS.
 *
 * 🔴 Daniel read this in his own plan: "I have assumed the BnB will be run
 * under professional management from day one, because this plan only works if
 * you are not the operator — you have already learned what happens when you
 * are." Three faults in one sentence. It is a VERDICT ON HIM dressed as an
 * assumption. It diagnoses him from something he never said — he mentioned a
 * service business, and it concluded burnout and then generalised that to
 * managing a rental, which is a different job entirely. And it is negative
 * about him, which nothing in this plan is allowed to be.
 *
 * ⚠️ The cut is at the first sentence and it is deliberately blunt. Everything
 * after "I have assumed X." is the model explaining itself, and explaining
 * itself is where it starts telling the person about themselves. The rule
 * cannot be "be careful"; it has to be a full stop.
 */
function firstSentence(text) {
  // 🔴 This cut at the first full stop anywhere, so "I have assumed your St.
  // Joseph's placement…" reached the page as "I have assumed your St." — the
  // same bug the sentence splitter had with decimals. sentencesOf knows about
  // abbreviations, initialisms and decimals.
  let out = (sentencesOf(text)[0] ?? String(text ?? '')).trim()

  // A trailing clause joined by a dash is the same fault with different
  // punctuation — "I have assumed X — you have already learned..."
  out = out.split(/\s+[—–-]\s+/)[0]

  // ⚠️ AND THE JUSTIFICATION, WHICH IS WHERE IT ACTUALLY WENT WRONG. The
  // sentence Daniel objected to ran "...from day one, because this plan only
  // works if you are not the operator". Cutting at the full stop left the
  // whole verdict intact, because the verdict was a subordinate clause rather
  // than a second sentence. An assumption never needs a "because": naming the
  // thing is the entire job, and the reason is always where it starts
  // explaining the person to themselves.
  out = out.split(/\s+(?:because|since|so that|which means|as this|given that)\b/i)[0]

  return out.replace(/[,;:\s]+$/, '').trim()
}

/**
 * ⭐⭐ A FIGURE STATED AS A NAMED QUANTITY MUST BE THAT QUANTITY.
 *
 * 🔴 "You have roughly $120,000 in savings" — from a person who has nothing of
 * the sort. Daniel: "where the heck did it come up with 120k in savings?"
 *
 * ⚠️ AND THE FIGURES GUARD PASSED IT, CORRECTLY BY ITS OWN RULES. $120,000 is
 * reachable from his real savings — the allowed set includes small whole
 * multiples so that "six months of must-pay banked" can be said, and six times
 * twenty thousand is a hundred and twenty. The number was derivable. The CLAIM
 * was invented.
 *
 * This is the third time the same shape has appeared: "$5,000 — mortgage gone"
 * when $5,000 was the whole must-pay, "Freed by cutting $5,000" when nothing
 * was cut, and now savings that are not savings. A number being arithmetically
 * reachable says nothing about whether it is the thing it is being called.
 *
 * ⚠️ So when a figure is stated AS the value of something they told us — their
 * savings, their must-pay, what comes in, what housing costs — it has to equal
 * that. Not derive from it. Equal it.
 */
/**
 * ⭐⭐ A FIGURE THAT IS EXACTLY ONE OF THEIR NUMBERS IS NEVER AN INVENTION.
 *
 * 🔴 THE AUDIT CAUGHT BOTH OF MY GUARDS FLAGGING CORRECT SENTENCES, which is
 * the failure that matters most: a guard that cries wolf gets loosened, and a
 * loosened guard stops catching the real thing.
 *
 *   "At $9,000 a month your savings last…"  → flagged as savings being stated
 *   as $9,000. It is their MUST-PAY. The sentence is right.
 *
 *   "The $4,000 housing cost…" in a move about selling → flagged as a figure
 *   put on something they never priced. It is their HOUSING COST, which they
 *   typed, being discussed in a sentence that happens to mention a sale.
 *
 * ⚠️ Both checks work on proximity — a number near a word — because there is
 * no parser here and there should not be. The fix is not to parse; it is to
 * notice that a figure matching one of their own stated quantities EXACTLY is
 * by definition not made up, whatever word it is standing next to.
 */
function isOneOfTheirs(figure, answers) {
  // ⚠️ SAFE, AND THE DISTINCTION IS THE WHOLE POINT OF THE RULE: this is a
  // module constant read inside a FUNCTION BODY, so it is initialised long
  // before this line ever runs. The fatal version is the same-scope one that
  // took down /plan on 28 Sep — a const read earlier in the SAME function.
  // eslint-disable-next-line no-use-before-define
  return NAMED_QUANTITIES.some(({ key }) => {
    const v = Number(answers?.[key])
    return Number.isFinite(v) && String(answers?.[key] ?? '').trim() !== ''
      && Math.abs(v - figure) <= Math.max(1, v * 0.02)
  })
}

/**
 * ⭐⭐ A FIGURE THIS PRODUCT COMPUTES AND PRINTS ON THE PAGE ITSELF. Separate
 * from `isOneOfTheirs` ON PURPOSE, and the separation is the whole lesson.
 *
 * 🔴 The audit found a real generation where must-pay was $9,000 and housing
 * $4,000, and the move said owning outright "drops what has to go out from
 * $9,000 to $5,000". The speculative rule fired — the sentence is about selling
 * a house, $5,000 is not a number anyone typed — and called correct subtraction
 * an invented price.
 *
 * 🔴 My first fix folded this into `isOneOfTheirs`, and a test caught it within
 * the minute: it also stopped "your $400 must-pay" being flagged, because $400
 * was their SPARE. That is the original bug — a derived figure wearing the
 * wrong label — un-fixed by the fix for something else.
 *
 * ⚠️ So the two questions stay apart, because they are different questions:
 *     where did this number come from?  → derived is fine (this function)
 *     is it being called the right thing? → derived is the whole risk (not this)
 * Only the provenance check may use this. The naming check must never.
 */
function isShownOnTheirPage(figure, answers) {
  const near = v => Number.isFinite(v) && Math.abs(v - figure) <= Math.max(1, v * 0.02)
  if (isOneOfTheirs(figure, answers)) return true
  const floor = floorWithoutHousing(answers)
  if (floor && near(floor.without)) return true
  return deriveStats(answers).some(s => near(Number(s?.value)))
}

const NAMED_QUANTITIES = [
  { key: 'savings', re: /\bsavings?\b|\bput (?:by|away)\b|\bcushion\b/i },
  { key: 'mustPay', re: /\bmust[- ]pay\b|\bhas to go out\b|\bgoes out every month\b/i },
  { key: 'housingCost', re: /\bhousing costs?\b|\bhousing line\b|\bmortgage\b/i },
  { key: 'takeHome', re: /\byou (?:take|bring) home\b|\byour take[- ]home\b/i },
  { key: 'householdTakeHome', re: /\bhousehold (?:income|brings? in)\b/i },
]

/**
 * ⭐⭐ ONLY THE FORMS THAT GENUINELY ASSERT A VALUE. A WHITELIST, NOT A
 * BLACKLIST, AND THE DIRECTION IS THE WHOLE LESSON.
 *
 * 🔴 This started as "a figure near the word", then grew a list of words that
 * mean comparison rather than identity — after, against, left, more than. The
 * audit kept finding new ones: "$400 left after must-pay", "park it in
 * savings", "the monthly number". Every round of blacklisting made the guard
 * looser, and a guard that keeps being loosened to stop it crying wolf ends up
 * catching nothing.
 *
 * ⚠️ So it is inverted. English has a handful of ways to say "this number IS
 * that thing", and they are countable:
 *     you have $X in savings   ·   your $5,000 must-pay
 *     savings of $20,000       ·   savings is/are $20,000
 * Everything else — putting money INTO savings, having something LEFT AFTER
 * must-pay, a figure merely sharing a sentence — is not a claim about the
 * value and is none of this check's business.
 *
 * ⚠️ It will miss some real ones. That is the correct trade: an invented figure
 * that slips past here is still caught by traceability if it is not their
 * number at all, and the cost of a false positive is a guard nobody trusts.
 */
function statedAs(sentence, re) {
  const money = '\\$\\s?[\\d,]+(?:\\.\\d+)?k?'
  const q = re.source
  const forms = [
    `\\b(?:have|has|had|with|got)\\s+(?:roughly\\s+|about\\s+|around\\s+|some\\s+)?${money}\\s+(?:in|of)\\s+(?:${q})`,
    `\\byour\\s+${money}\\s+(?:a month\\s+)?(?:${q})`,
    // ⚠️ Not when the figure is a DISTANCE from the quantity: "your take-home
    // is $300 short of what has to go out" (18 Oct, a correct plan rejected).
    `(?:${q})\\s+(?:of|is|are|sits at|comes to|totals?)\\s+(?:roughly\\s+|about\\s+|around\\s+)?${money}(?![\\d,k])(?!\\s+(?:short|more|less|under|over|below|above|behind|shy)\\b)`,
    `(?:${q})\\s*[:—-]\\s*${money}`,
  ]
  return forms.some(f => new RegExp(f, 'i').test(sentence))
}

function misnamedQuantity(text, answers) {
  const found = []
  String(text ?? '').split(/(?<=[.!?])\s+/).forEach(sentence => {
    NAMED_QUANTITIES.forEach(({ key, re }) => {
      const actual = Number(answers?.[key])
      if (!Number.isFinite(actual) || String(answers?.[key] ?? '').trim() === '') return
      // ⚠️ "The gap between what comes in and what has to go out is $300"
      // states the GAP, not the must-pay. Caught by the audit on 17 Oct: a
      // person $300 short got a correct map rejected for saying so. The
      // between-clause is cut before asking whether a quantity was stated.
      if (!statedAs(sentence.replace(/\b(?:gap|difference|shortfall)\s+between\b[^$]*/i, ''), re)) return
      const figures = figuresIn(sentence)
      if (!figures.length) return
      // ⚠️ One of the figures in the sentence has to BE it. A sentence may
      // legitimately carry others — "your $5,000 must-pay against $4,000 in" —
      // so this asks whether the true value appears at all, not whether every
      // number matches.
      const matches = figures.some(f => Math.abs(f - actual) <= Math.max(1, actual * 0.02))
      // ⚠️ And not if every figure in the sentence is one of their OTHER
      // numbers — "at $9,000 a month your savings last four years" is their
      // must-pay beside the word savings, which is correct English and correct
      // arithmetic. See isOneOfTheirs.
      const allTheirs = figures.every(f => isOneOfTheirs(f, answers))
      if (!matches && !allTheirs) {
        // ⚠️ THE SENTENCE COMES WITH THE COMPLAINT. A guard that reports "x is
        // stated as y" without showing where cannot be told apart from a false
        // positive — and this one produced several, which cost a round trip to
        // discover. Evidence in the message is the difference between a
        // finding and an accusation.
        found.push(`${key} stated as ${figures.map(f => `$${f.toLocaleString()}`).join('/')}, they said $${actual.toLocaleString()} — "${sentence.trim().slice(0, 90)}"`)
      }
    })
  })
  return found
}

/** Everything they TYPED, as opposed to tapped or entered in a fixed field. */
function freeText(value, into = []) {
  if (typeof value === 'string') { into.push(value); return into }
  if (Array.isArray(value)) { value.forEach(v => freeText(v, into)); return into }
  if (value && typeof value === 'object') { Object.values(value).forEach(v => freeText(v, into)); return into }
  return into
}

/**
 * ⚠️ `theirNumbersAreFine` IS TRUE IN PROSE AND FALSE ON A STAT, and the test
 * that forced the distinction is the first bug Daniel ever reported.
 *
 * In a SENTENCE, one of their own figures can legitimately stand near a word
 * about selling: "sell and own outright — the $4,000 housing cost goes" is
 * their housing cost, correctly used, in a sentence about a sale.
 *
 * On a STAT it cannot. A stat is a bare label and a number asserting "this
 * figure IS this thing", with no sentence around it to carry the meaning —
 * which is exactly how "$5,000 — mortgage gone when the house sells" happened
 * when $5,000 was his whole must-pay. Exempting their own numbers there would
 * re-open the bug that started all of this.
 */
function speculativeProblem(text, figures, answers, theirNumbersAreFine = true) {
  if (!SPECULATIVE.some(re => re.test(String(text ?? '')))) return null
  if (!figures.length) return null

  // 🔴 THIS USED TO DEMAND THE FIGURE APPEAR IN THE SAME ANSWER AS THE WORD
  // "sale", AND IT DEADLOCKED DANIEL — three rewrites, no plan, just "that
  // didn't come through". People do not answer that tidily: the sale gets
  // mentioned on one screen and the number lands on another, or inside a
  // custom entry two levels down. A rule nobody can satisfy is not a strict
  // rule, it is a broken one.
  //
  // ⭐ What still holds, and is the whole point: it must be a number they
  // TYPED, in their own words, somewhere. A fixed field cannot price a house —
  // "what has to go out every month" means must-pay and nothing else, so
  // reaching for it to value a sale is exactly the $5,000 mortgage again. Free
  // text is the only place someone can tell us what their house might clear.
  const typed = []
  theirNumbers(freeText(answers ?? {}), typed)

  const unfounded = [...new Set(
    figures.filter(f => !typed.some(n => Math.abs(n - f) <= Math.max(1, f * 0.02)))
      // ⚠️ A figure they typed into a FIELD is theirs too. The speculative rule
      // exists to stop a sale being given a price out of nowhere; their own
      // housing cost appearing in a sentence about selling is not that.
      .filter(f => !(theirNumbersAreFine && isShownOnTheirPage(f, answers))),
  )]
  if (!unfounded.length) return null
  // ⚠️ Evidence, for the same reason as misnamedQuantity: a complaint without
  // the sentence cannot be told apart from a false positive.
  return `${unfounded.map(f => `$${f.toLocaleString()}`).join(', ')} put on something they never priced — "${String(text).trim().slice(0, 90)}"`
}

/**
 * Every figure in the map that this person did not give us.
 * Returns plain sentences, because they end up in front of a human.
 */
export function inventedFigures(map, answers = {}) {
  const allowed = allowedFigures(answers)
  const found = []

  const check = (text, where) => {
    const figures = figuresIn(text)
    const bad = [...new Set(figures.filter(f => !traceable(f, allowed)))]
    if (bad.length) found.push(`${bad.map(f => `$${f.toLocaleString()}`).join(', ')} in ${where} is not a number they gave`)

    // 🔴 SENTENCE BY SENTENCE, NOT MOVE BY MOVE. Checking the whole move meant
    // that "Your $5,000 must-pay does not change. Selling the house would." was
    // rejected — the $5,000 is correctly their must-pay and the word "selling"
    // is two sentences away. A figure only makes a claim about a sale when it
    // is IN the sentence about the sale.
    // ⚠️ A figure can be theirs and still be a lie about what it is. See
    // misnamedQuantity — this is the check the $120,000-in-savings got past.
    misnamedQuantity(text, answers).forEach(p => found.push(`${where}: ${p}`))

    String(text ?? '')
      .split(/(?<=[.!?])\s+/)
      .forEach(sentence => {
        // ⚠️ Only figures that ARE theirs. One already reported as invented
        // does not need reporting twice, and a retry message that says the same
        // number two different ways reads like two separate faults.
        const mine = figuresIn(sentence).filter(f => traceable(f, allowed))
        const spec = speculativeProblem(sentence, mine, answers)
        if (spec) found.push(`${where}: ${spec}`)
      })
  }

  check(map?.headline, 'the headline');
  (map?.moves ?? []).forEach((m, i) => {
    check([m?.title, m?.detail, m?.gate, m?.when].filter(Boolean).join(' '), `move ${i + 1}`)
  });
  (map?.cut ?? []).forEach(c => check([c?.label, c?.why].filter(Boolean).join(' '), 'what was crossed off'));
  (map?.seasonPlan ?? []).forEach(s => check(typeof s === 'string' ? s : Object.values(s ?? {}).join(' '), 'the off-season plan'))

  return found
}

/**
 * The same test for a stat, where the figure is a clean number rather than
 * prose — so a bad one can simply be dropped instead of failing the whole map.
 */
/**
 * ⭐⭐ A STAT WHOSE LABEL NAMES ONE QUANTITY AND WHOSE VALUE IS A DIFFERENT ONE
 * OF THEIRS. This is the exact signature of the bug Daniel saw: their $5,000
 * must-pay printed under "Freed when the mortgage is gone", when their mortgage
 * was $3,100.
 *
 * 🔴 I TOLD HIM THIS WAS FIXED AND IT WAS ONLY HALF FIXED. When must-pay and
 * income are both known the product computes the stats itself and throws the
 * model's away, so the bug cannot occur — that is why it stopped appearing. But
 * when income is missing the derived pair cannot be built, the code falls back
 * to the model's own stats, and nothing in that path was checking the LABEL
 * against the VALUE. He asked the right question.
 *
 * ⚠️ Why "a different one of THEIRS" and not "does not match": a stat's label is
 * not a sentence, so the prose check cannot read it, and a bare mismatch would
 * flag every honest derived stat — "how long your savings cover" is a count of
 * months, not a sum of money, and matches nothing. Landing exactly on another
 * named quantity is what makes it a relabelling rather than a calculation.
 */
function statMisnamed(stat, answers = {}) {
  const value = Number(stat?.value)
  if (!Number.isFinite(value) || value <= 0) return null
  const label = [stat?.label, stat?.caption].filter(Boolean).join(' ')

  const has = key => Number.isFinite(Number(answers?.[key])) && String(answers?.[key] ?? '').trim() !== ''
  const near = key => Math.abs(Number(answers[key]) - value) <= Math.max(1, Number(answers[key]) * 0.02)

  const named = NAMED_QUANTITIES.filter(({ re }) => re.test(label)).map(({ key }) => key).filter(has)
  if (named.length !== 1) return null
  if (named.some(near)) return null

  const isInstead = NAMED_QUANTITIES.map(({ key }) => key)
    .filter(k => k !== named[0] && has(k) && near(k))
  if (!isInstead.length) return null
  return `"${stat.label}" shows $${value.toLocaleString()}, which is their `
    + `${isInstead[0]} — their ${named[0]} is $${Number(answers[named[0]]).toLocaleString()}`
}

export function statIsFounded(stat, answers = {}) {
  const value = Number(stat?.value)
  if (!Number.isFinite(value) || value === 0) return true
  const label = [stat?.label, stat?.caption].filter(Boolean).join(' ')
  if (!traceable(value, allowedFigures(answers))) return false
  if (statMisnamed(stat, answers)) return false
  // ⚠️ `false` — see the note on speculativeProblem. A stat has no sentence to
  // give a number its meaning, so "one of their figures" is not a defence.
  return !speculativeProblem(label, [value], answers, false)
}

// ── Style ───────────────────────────────────────────────────────────────────

/**
 * ⭐⭐ STYLE IS A REWRITE REASON, NEVER A REASON TO SHIP NOTHING.
 *
 * Kept deliberately apart from `mapProblems`, which is about TRUTH and
 * structure and is allowed to refuse a map outright. This is about register,
 * and register is never worth withholding somebody's plan over. `generateMap`
 * feeds these back on the early attempts and drops them on the last one.
 *
 * 🔴 The failure that made this necessary: Daniel's move one detail ran five
 * sentences and ended "Talk to your real-estate agent and an accountant before
 * you list." Who to call is the play-by-play's job — `check_first` /
 * `who_knows` — and it is the paid half of the product, given away in a worse
 * form. ⭐ Length is the tell. "Is this a how?" cannot be checked by a machine;
 * "is this five sentences when the spec said two" can, and in practice detail
 * drifts into instructions by getting longer.
 */

/**
 * ⭐⭐ REASONS THAT ARE ABOUT A FEELING RATHER THAN A CONSTRAINT.
 *
 * 🔴 Daniel's deepest correction so far, and it is not about wording. He read
 * "the apps have more chance with a calm launcher" and said: people are
 * stressed or not calm USUALLY BECAUSE OF LACK OF ACTION. This is action.
 *
 * The instinct behind that sentence is the commonest failure in advice — it
 * sounds like care and works as a trap. Somebody arrives stuck, and the plan
 * tells them to wait until the pressure lifts; the pressure is coming FROM
 * being stuck, so waiting is the one thing that guarantees it stays. It
 * prescribes the disease as the cure, kindly.
 *
 * ⚠️ Only mechanical things defer a move: money that does not exist yet, hours
 * already committed, a real dependency. Those are facts about the world. A
 * mood is a fact about nobody — we have never met this person.
 */
/**
 * ⭐⭐ A NAMED SCARCE THING. The feeling rule below only fires when NONE of these
 * is present, and that gate is what makes it a rule about reasoning rather than
 * about vocabulary.
 *
 * 🔴 Both false positives the audit found were the same shape. "Use the
 * proceeds to start something" was cut because "you have under five hours a
 * week and you said it cannot fail" — a named constraint — and got flagged
 * because a later, unrelated clause used the word "pressure". "Pressure
 * washing" was flagged because of its own name.
 *
 * ⚠️ Matching a word is not reading an argument. If the paragraph names
 * something scarce, the mood word is colour and this rule has no business
 * firing; if it names nothing scarce, a mood word IS the argument.
 */
const NAMES_A_CONSTRAINT = [
  /\$\s?[\d,]+/,
  /\b(?:\d+|one|two|three|four|five|six|ten|fifteen|twenty)\s*(?:to\s*\w+\s*)?(?:hours?|days?|weeks?|months?|years?)\b/i,
  /\b(?:under|over|less than|fewer than|only)\s+(?:\d+|one|two|three|four|five|ten|fifteen)\b/i,
  /\b(?:equipment|tools?|a truck|a vehicle|a licen[cs]e|certifi|insurance|a deposit|capital|cash|savings|runway|premises|space|a trailer|a permit|someone else|a partner|a co-?signer|credit|qualif)/i,
  /\bdoes not (?:own|have)\b|\byou may not own\b|\byou do not have\b|\bwould need to (?:buy|rent|borrow|hire)\b/i,
]

const FEELING_AS_REASON = [
  /\bcalm(er|ly)?\b/i,
  /\bstress(ed|ful)?\b/i,
  /\bpressure\b(?!\s*(?:wash|clean))/i,
  /\boverwhelm(ed|ing)?\b/i,
  /\bburn(ed|t)? ?out\b/i,
  /\bready\b/i,
  /\bclear head|peace of mind|breathing room|headspace|bandwidth\b/i,
  /\bone thing at a time\b/i,
  /\btoo much (at once|on your plate)\b/i,
]

/** Phrasings that are the play-by-play leaking into the plan. */
const INSTRUCTION_SHAPED = [
  { re: /\b(talk to|call|speak to|contact|ask)\s+(your|a|an)\s/i, why: 'tells them who to call — that is the play-by-play' },
  { re: /\bknock on\b|\bdoor to door\b/i, why: 'tells them how to find customers' },
  { re: /\bcharge\b|\bquote\b|\bprice it\b/i, why: 'tells them what to charge' },
  { re: /\bpost (an?|it|the)\b|\blist it on\b|\bsign up (for|with)\b/i, why: 'tells them which service to use' },
  { re: /\bsay\b.{0,20}\b(to them|like this)\b|\bsend (them )?(a|this)\b/i, why: 'gives them the words to send' },
]

/** Roughly two plain sentences. Generous — this only has to catch a runaway. */
const DETAIL_MAX = 380

/**
 * ⭐⭐ A MOVE THAT LAYS OUT A CHOICE GETS MORE ROOM. Daniel's call, and it was a
 * liability one: "give more than one option and maybe have the person select
 * it... we dont want someone coming back and saying i lost evreything becasue i
 * went with what this app said."
 *
 * 🔴 The audit flagged a 420-character move for being over the cap. Reading it,
 * it was not padding — it was the question, two real options, whose call it is,
 * and who can price them. That is the shape we now ASK for. The cap was written
 * before that decision and had quietly turned into a rule against following it.
 *
 * ⚠️ The extra room is for the second option, not for prose. 480 fits a choice
 * stated plainly; anything past it is still the "how" creeping back in.
 */
const DETAIL_MAX_WITH_CHOICE = 480
const OFFERS_A_CHOICE = [
  /\bwhether that means\b/i,
  /\beither\b[^.]{0,80}\bor\b/i,
  /\b(?:two|three) (?:ways|routes|options|paths)\b/i,
  /\byours to (?:make|decide|choose)\b|\byour call\b|\bthe call is yours\b/i,
  /\bor,? instead,?\b/i,
]

/**
 * ⭐⭐ TAKE THE TWO SENTENCES. DO NOT ASK FOR THEM.
 *
 * 🔴 Style notes were advisory by design — they ride the early attempts and are
 * dropped on the last, so prose could never withhold somebody's plan. The cost
 * showed up immediately: a model that ignores them three times WINS. Daniel's
 * move three shipped with "Talk to an accountant who knows short-term rental
 * tax before you buy" — the exact sentence banned an hour earlier — and move
 * two ran six hundred characters.
 *
 * ⚠️ Whole sentences only, and only from the END. Cutting mid-sentence produces
 * garbage, and the first sentence is always the one that names the move — every
 * over-long detail seen so far says the move, then drifts. So the trim is safe
 * in a way a paraphrase never is: nothing is rewritten, only stopped.
 *
 * ⭐ It also swept up "Neither requires you to be in one place. all" — a stray
 * fragment the model left on the end. Anything after the second sentence goes,
 * whether it was instruction, repetition or debris.
 */
/**
 * ⭐⭐ DROP ANY SENTENCE THAT SAYS SOMETHING UNTRUE ABOUT A NUMBER.
 *
 * 🔴 THE AUDIT FINDING, AND IT IS WORSE THAN THE BUG THAT PROMPTED IT. The
 * figure guards ran on the MAP and almost nothing else. The play-by-play — the
 * paid half, the place where money is actually USED, where somebody is told
 * what to charge and what a thing costs to start — had them on exactly two of
 * its fields. The conversation had none at all: an answer went from the model
 * to the screen unread.
 *
 * ⚠️ The two newest surfaces were the two least guarded, which is how this goes
 * every time: the checks get written for the thing that broke, and the next
 * thing gets built beside them without inheriting anything.
 *
 * ⚠️ Whole sentences, never a rewrite. Same reasoning as trimDetail: nothing is
 * paraphrased, it is only stopped — and a sentence that made a false claim
 * about their money is better absent than repaired by a machine.
 */
/**
 * Split prose into sentences WITH their trailing whitespace, so joining the
 * pieces back gives the original text exactly.
 *
 * 🔴🔴 THE OLD SPLITTER ATE EVERYTHING BEFORE A DECIMAL POINT. It matched
 * /[^.!?]+[.!?]+/ — so "You would need 8.4 percent a year" became the sentence
 * "4 percent a year", and a plan told somebody 4% where it had written 8.4%:
 * a returns claim reversed by punctuation. It also dropped any closing text
 * without a full stop, and cut "U.S." down to "S.".
 * ⭐ A sentence ends at . ! or ? FOLLOWED BY WHITESPACE — a decimal point never
 * is — and not after an initialism ("U.S.") or a common abbreviation.
 */
export function sentencesOf(text) {
  const src = String(text ?? '')
  if (!src.trim()) return []
  const parts = src.split(/(?<=[.!?])(?<!\b[A-Z]\.[A-Z]\.)(?<!\b(?:[Ee]\.g|[Ii]\.e|vs|Mr|Mrs|Ms|Dr|St)\.)(\s+)/)
  const out = []
  for (let i = 0; i < parts.length; i += 2) {
    const piece = parts[i] + (parts[i + 1] ?? '')
    if (piece.trim()) out.push(piece)
  }
  return out
}

export function scrubFigures(text, answers = {}) {
  // ⭐ Every reply, comparison and answer passes through here, so the word
  // rules (no "Tuesday", no chip keys) ride along with the figure rules.
  const src = deJargon(String(text ?? '').trim())
  if (!src) return src
  const allowed = allowedFigures(answers ?? {})

  const kept = (sentencesOf(src).length ? sentencesOf(src) : [src]).filter(sentence => {
    const figures = figuresIn(sentence)
    if (figures.some(f => !traceable(f, allowed))) return false
    if (speculativeProblem(sentence, figures.filter(f => traceable(f, allowed)), answers)) return false
    if (misnamedQuantity(sentence, answers).length) return false
    return true
  })

  // ⚠️ Never return nothing from something. If every sentence made a false
  // claim the answer is broken, not empty, and the caller decides what to do
  // with a string it can see is unchanged.
  const out = kept.join('').trim()
  return out || src
}

function trimDetail(detail, allowed = null, answers = null, allowEmpty = false) {
  const text = String(detail ?? '').trim()
  if (!text) return text

  const split = sentencesOf(text)
  const sentences = split.length ? split : [text]
  const kept = []
  for (const sentence of sentences) {
    // An instruction is dropped wherever it sits, not just past the limit.
    if (INSTRUCTION_SHAPED.some(({ re }) => re.test(sentence))) continue

    // ⭐⭐ AND A SENTENCE CARRYING A NUMBER THAT IS NOT THEIRS GOES THE SAME WAY.
    //
    // 🔴 THIS IS WHY A PLAN TOOK FIFTY-ONE SECONDS. Measured by driving the real
    // page: one generation is ~27s, attempt one got rejected over a single
    // figure, and the whole 3,000-token map was written again. Rewriting
    // everything because one sentence has a bad number in it is a terrible
    // trade — the person waits twice as long for a plan that is mostly
    // identical, and pays for two calls.
    //
    // ⚠️ The same surgery as the instruction case and safe for the same reason:
    // whole sentences, nothing paraphrased, and the first sentence — the one
    // that names the move — is almost never the one carrying a stray figure.
    // A headline or a gate still forces a rewrite, because those cannot lose a
    // sentence and still be what they are.
    if (allowed && figuresIn(sentence).some(f => !traceable(f, allowed))) continue
    if (allowed && speculativeProblem(sentence, figuresIn(sentence).filter(f => traceable(f, allowed)), answers)) continue

    if (kept.length >= 2 && kept.join('').length >= 200) break
    kept.push(sentence)
    if (kept.length >= 3) break
  }

  // ⚠️ Never return nothing FOR A MOVE. If every sentence went, the first one
  // back is better than an empty move — mapProblems has no opinion on detail,
  // so an empty string would render as a blank move and ship.
  //
  // ⭐ A crossed-off reason is the opposite: `allowEmpty` lets it come back
  // empty so the caller can drop the whole entry. "Buying a second truck" with
  // no reason beside it is worse than not raising it — the reason IS the
  // product there, and a bare strikethrough reads as a judgement with nothing
  // behind it.
  const out = kept.join('').trim()
  if (out) return out
  return allowEmpty ? '' : sentences[0].trim()
}

export function mapStyleNotes(map) {
  const notes = []

  ;(map?.moves ?? []).forEach((m, i) => {
    const detail = String(m?.detail ?? '')
    const cap = OFFERS_A_CHOICE.some(re => re.test(detail)) ? DETAIL_MAX_WITH_CHOICE : DETAIL_MAX
    if (detail.length > cap) {
      notes.push(
        `move ${i + 1} detail is ${detail.length} characters — the spec is one or two plain `
        + 'sentences. Say what the move IS and stop; the extra sentences are always the how.',
      )
    }
    INSTRUCTION_SHAPED.forEach(({ re, why }) => {
      if (re.test(detail)) notes.push(`move ${i + 1} detail ${why}. Cut that sentence.`)
    })

    // ⚠️ A gate is ONE checkable thing. "A written estimate AND a clear sense of
    // how much goes where" is two, and the second half is not checkable at all
    // — which means the person can never know whether move 2 has started.
    const gate = String(m?.gate ?? '')
    if (gate.length > 140) {
      notes.push(`move ${i + 1} gate is too long to check. One thing that is true or not true.`)
    }

    // 🔴 A GATE IS A FACT THAT BECOMES TRUE, NOT AN ERRAND. Daniel's read "a
    // written net-proceeds figure from a lawyer or accountant, not an
    // estimate" — an instruction wearing a gate's clothes, and wrong about how
    // a house sale works: when one closes the lawyer hands you the figure.
    // Telling someone to fetch a thing they will automatically receive says
    // you do not know the situation.
    if (/^(get|ask|call|find|make sure|ensure|obtain|confirm with|speak)\b/i.test(gate.trim())) {
      notes.push(`move ${i + 1} gate is an instruction. Write the FACT that becomes true — "the sale has closed and you know what it cleared" — not the errand.`)
    }

    // ⚠️ And a gate that repeats the move teaches nothing. It is about what the
    // NEXT move needs, not what this one did.
    const title = String(m?.title ?? '').toLowerCase()
    // ⚠️ FOUR LETTERS, NOT FIVE. At five, "The credit card debt is cleared from
    // the proceeds" — a gate that parrots its title almost word for word —
    // keeps only three words and slips under the floor below. The short words
    // are most of the sentence; dropping them leaves nothing to measure.
    const words = gate.toLowerCase().match(/[a-z]{4,}/g) ?? []
    const echoed = words.filter(w => title.includes(w))
    // 🔴 A RATIO OVER ONE WORD IS NOT A RATIO. This fired on "The card debt is
    // gone and you know what is left of the proceeds" — a good gate naming two
    // facts — because the only word in it long enough to count was "proceeds",
    // which the title also used. 1/1 is 100% and means nothing.
    //
    // ⚠️ Four is the point where the proportion starts describing the sentence
    // rather than an accident of which words happen to be five letters long.
    if (words.length >= 4 && echoed.length / words.length > 0.6) {
      notes.push(`move ${i + 1} gate just restates the move. Say what move ${i + 2} needs to be true.`)
    }
  })

  // 🔴 A MOOD IS NOT A REASON. Checked on what was crossed off and on the
  // gates, because those are the two places the plan explains its own
  // sequencing — and sequencing is exactly where "wait until you feel better"
  // gets in and looks like wisdom.
  ;(map?.cut ?? []).forEach(c => {
    const why = String(c?.why ?? '')
    if (FEELING_AS_REASON.some(re => re.test(why)) && !NAMES_A_CONSTRAINT.some(re => re.test(why))) {
      notes.push(
        `"${c?.label}" is crossed off over a feeling, not a constraint. Name the scarce `
        + 'thing it would take — money, hours, a dependency — or do not cross it off. '
        + 'People are usually stressed BECAUSE nothing is moving.',
      )
    }
  })
  ;(map?.moves ?? []).forEach((m, i) => {
    if (FEELING_AS_REASON.some(re => re.test(String(m?.gate ?? '')))) {
      notes.push(`move ${i + 1} gate waits on a feeling. A gate is a fact that becomes true.`)
    }
  })

  return notes
}

/**
 * ⭐⭐ OUR FIELD NAMES ARE NOT WORDS. THEY MUST NEVER REACH A PERSON.
 *
 * 🔴 Daniel's stat card read "Your mustPay drops to zero once the mortgage is
 * gone". `mustPay` is the key on the intake field — our schema, printed in the
 * largest caption on the page. It is the tell that the model is describing the
 * JSON it was handed rather than the person who filled it in, and once you see
 * it you cannot unsee it: the plan stops sounding written and starts sounding
 * generated.
 *
 * ⚠️ A machine check, because it is exactly the kind of thing that reads fine
 * to whoever wrote the prompt and glaring to everybody else.
 */
const FIELD_NAMES = [
  'immovablesNote', 'faithNote', 'healthNote', 'workType', 'kidsAges',
  'partnerWants', 'peopleNote', 'askedFor', 'paidFor', 'takeHome', 'mustPay',
  'householdTakeHome', 'atStake', 'fiveYearTest', 'tradeRank', 'hoursPerWeek',
  'yearShape', 'locationText', 'alreadyTried', 'goalType', 'goalFirst',
  'seasonNote', 'worstVersion', 'fromToward', 'timeEaters',
  // 🔴 'discretionary' WAS IN THIS LIST AND IT IS AN ORDINARY ENGLISH WORD.
  // The model wrote the perfectly good "no discretionary spending named" and
  // the substitution turned it into "no what you spend on top spending named".
  // ⚠️ THE RULE IS NOW EXPLICIT: only camelCase compounds belong here, because
  // those cannot occur in a sentence by accident. A single lowercase word can,
  // and policing one means mangling prose that was never wrong.
]

/** In their own words, for the ones that have one. */
const FIELD_IN_WORDS = {
  mustPay: 'what has to go out every month',
  takeHome: 'what you take home',
  householdTakeHome: 'what the household takes home',
  hoursPerWeek: 'the hours you have',
  locationText: 'where you live',
  timeEaters: 'what takes your time',
}

/**
 * ⭐ CHIP VALUES ARE OUR LABELS TOO. An audit plan said "at 58 with a cannot-fail
 * constraint" and "which is what cannot-fail actually means" — the KEY of the
 * chip they picked ("It can't fail — there's no cushion"), printed as if it were
 * a word. FIELD_NAMES only knew field keys.
 * ⚠️ Same discipline as FIELD_NAMES: only HYPHENATED compounds of letters, which
 * cannot occur in a sentence by accident. "0-4" is an age range people write;
 * "money" is a word. Read from the intake, so a new chip is covered on arrival.
 */
const CHIP_IN_WORDS = {
  'cannot-fail': 'no room to fail',
  'kids-home': 'kids at home',
  'partner-job': 'your partner\u2019s job',
  'family-proximity': 'being near family',
}
const CHIP_KEYS = [...new Set(
  WAYOUT_SCREENS.flatMap(sc => sc.fields ?? []).flatMap(f => f.options ?? [])
    .map(o => o?.key).filter(k => typeof k === 'string' && /^[a-z]+(-[a-z]+)+$/.test(k)),
)]
const chipRe = k => new RegExp(`(?<![\\w-])${k}(?![\\w-])`, 'g')

/** Chip keys that reached prose. Reported by the audit harness; repaired by deJargon. */
export function chipKeysLeaked(map) {
  const text = JSON.stringify(map ?? {})
  return CHIP_KEYS.filter(k => chipRe(k).test(text))
}

export function fieldNamesLeaked(map) {
  const text = JSON.stringify(map ?? {})
  return FIELD_NAMES.filter(name => new RegExp(`\\b${name}\\b`).test(text))
}

/**
 * Swap a leaked key for the phrase the question actually used.
 *
 * ⚠️ Only where there is an honest phrase for it. A key with no plain-English
 * equivalent stays, gets reported by `mapProblems`, and the map is rewritten —
 * substituting a guess would replace a visible fault with an invisible one.
 */
/**
 * 🔴🔴 "TUESDAY" NEVER REACHES A READER. The weekday is OUR device for getting a
 * specific answer out of them; in output it is a private reference to a day
 * that does not exist. The prompt bans it as a word and it still came back —
 * "a step toward your Tuesday" in a walkthrough question on 1 Oct — so it is
 * enforced here, on everything a person reads.
 * ⚠️ Validated both ways in the tests: "your Tuesday" / "that Tuesday" become
 * the aim, "on Tuesday" becomes "this week", and a plain "Tuesday" goes too.
 */
export function noTuesday(text) {
  if (typeof text !== 'string' || !/tuesday/i.test(text)) return text
  return text
    .replace(/\b(?:your|their|that|the|a|my|this)\s+(?:ordinary\s+)?tuesdays?\b/gi, 'the life you are aiming for')
    .replace(/\b(?:on|by|next|this|every)\s+tuesdays?\b/gi, 'this week')
    .replace(/\btuesdays?\b/gi, 'the day')
}

/**
 * 🔴 NO DASHES IN ANYTHING A PERSON READS. Daniel, 5 Oct: "no one writes like
 * that, it looks AI — use a comma if needed." The model reaches for " — "
 * constantly, so the prompt asks it not to AND this removes any that get
 * through, including in plans written before the rule existed (the contract
 * runs on every stored map as it is read).
 * ⚠️ A dash between two digits is a RANGE ("0–4", "5–11") and is kept.
 * ⚠️ A dash standing alone as a value (a "—" meaning "none") is kept.
 */
/** Everything AI-written passes through this before a person reads it. */
export function forReaders(text) {
  return plainDashes(noTuesday(text))
}

/**
 * A walkthrough with forReaders run over every string in it, at render time.
 * 🔴 6 Nov: the contract above only ever ran at generation and never ran this,
 * so stored walkthroughs showed "Hey — I'm selling…" to the person reading.
 */
export function readableDeep(value) {
  if (typeof value === 'string') return forReaders(value)
  if (Array.isArray(value)) return value.map(readableDeep)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, readableDeep(v)]))
  return value
}

function deJargon(value) {
  if (typeof value === 'string') {
    value = forReaders(value)
    const fields = Object.entries(FIELD_IN_WORDS).reduce(
      (out, [key, words]) => out.replace(new RegExp(`\\b${key}\\b`, 'g'), words),
      value,
    )
    return CHIP_KEYS.reduce(
      (out, key) => out.replace(chipRe(key), CHIP_IN_WORDS[key] ?? key.replace(/-/g, ' ')),
      fields,
    )
  }
  if (Array.isArray(value)) return value.map(deJargon)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, deJargon(v)]))
  }
  return value
}

// ── The play-by-play ────────────────────────────────────────────────────────

/**
 * ⭐⭐ THE PAID HALF GETS THE SAME GUARDS AS THE FREE ONE, AND NEEDS THEM MORE.
 *
 * 🔴 The map has been checked since the day it invented "$120,000 cash in hand
 * at sale". The play-by-play was never checked at all — and it is the place
 * money is actually USED: what to charge, what it costs to start, what to
 * expect. A wrong figure in the plan sets a wrong expectation; a wrong figure
 * here gets quoted to a customer.
 *
 * ⚠️ Prose is repaired, never rewritten. Regenerating a 4,000-token playbook
 * over one sentence is the trade that made a plan take fifty-one seconds.
 */
export function enforcePlaybookContract(play, answers = {}) {
  if (!play || typeof play !== 'object' || play.crisis) return play
  const out = { ...play }

  // ⚠️ `money.what_to_charge` and `how_you_know` are deliberately NOT trimmed
  // for figures. Naming a rate is the job here, and the prompt's answer to not
  // knowing one is to teach the check that finds it — "two or three local ads
  // will list a price, that is your range" — which carries no figure at all.
  // Trimming this field would delete the one thing the person paid for.
  // 🔴 EVERY PROSE FIELD, NOT TWO OF THEM. See scrubFigures — this half of the
  // product had figure guards on `why_first` and `done_when` and nowhere else,
  // while being the half that tells somebody what to charge.
  const scrub = v => (typeof v === 'string' ? scrubFigures(v, answers) : v)

  out.done_when = scrub(out.done_when)
  if (out.thisWeek && typeof out.thisWeek === 'object') {
    out.thisWeek = {
      ...out.thisWeek,
      action: scrub(out.thisWeek.action),
      why_first: scrub(out.thisWeek.why_first),
    }
  }
  if (out.words && typeof out.words === 'object') {
    // ⚠️ The script is NOT scrubbed sentence-by-sentence. It is a message they
    // will send as one piece, and half a message is worse than a wrong one —
    // it is checked as a whole below instead, and dropped entire if it lies.
    out.words = { ...out.words, context: scrub(out.words.context) }
    if (typeof out.words.script === 'string' && scrubFigures(out.words.script, answers) !== out.words.script) {
      console.warn('[wayout] script dropped — a figure in it is not theirs')
      out.words = { ...out.words, script: '' }
    }
  }
  if (out.money && typeof out.money === 'object') {
    // ⚠️ `what_to_charge` is scrubbed like everything else now. Naming a rate is
    // the job, and the honest answer when the rate is unknown carries no figure
    // at all — so a figure here that is not theirs is exactly the thing that
    // gets quoted to a customer.
    out.money = {
      ...out.money,
      what_to_charge: scrub(out.money.what_to_charge),
      how_you_know: scrub(out.money.how_you_know),
      getting_paid: scrub(out.money.getting_paid),
    }
  }
  ;['need_first', 'dont_need_yet'].forEach(k => {
    if (Array.isArray(out[k])) out[k] = out[k].map(scrub)
  })
  if (Array.isArray(out.goes_wrong)) {
    out.goes_wrong = out.goes_wrong.map(g => ({ ...g, what: scrub(g?.what), do: scrub(g?.do) }))
  }
  if (Array.isArray(out.check_first)) {
    out.check_first = out.check_first.map(c => ({ ...c, thing: scrub(c?.thing), who_knows: scrub(c?.who_knows) }))
  }

  // The lists are short by design and a padded one is the tell that it ran out
  // of true things to say.
  if (Array.isArray(out.need_first))    out.need_first    = out.need_first.slice(0, 5)
  if (Array.isArray(out.dont_need_yet)) out.dont_need_yet = out.dont_need_yet.slice(0, 5)
  if (Array.isArray(out.goes_wrong))    out.goes_wrong    = out.goes_wrong.slice(0, 4)
  if (Array.isArray(out.check_first))   out.check_first   = out.check_first.slice(0, 3)

  out.disclaimer = out.disclaimer
    || 'This is a plan, not financial, legal or tax advice. Check the numbers before you act.'

  // ⭐ The same word rules as the map — the walkthrough is read just as closely.
  return deJargon(out)
}

/**
 * ⭐⭐ THE BOOK MUST BE ON THE SHELF. CHECKED, NOT ASKED FOR.
 *
 * 🔴 The same failure as inventing an organisation, and models are unusually
 * good at it: a plausible title, a real-sounding author, and nothing behind it.
 * Somebody goes looking, finds nothing, and correctly stops believing the rest
 * of the page — and a fabricated recommendation is worse than a fabricated
 * figure, because they will spend money on it before they find out.
 *
 * ⚠️ Title AND author both have to match. "The Psychology of Money by James
 * Clear" is two real things joined into a false one, and it is exactly the kind
 * of near-miss that a title-only check waves through.
 */
export function readingIsReal(read, shelf) {
  // 🔴 TYPOGRAPHY NEARLY THREW AWAY A CORRECT ANSWER. The shelf holds "So Good
  // They Can’t Ignore You" with a curly apostrophe; the model returned the
  // same title with a straight one and the check called it a fabrication.
  //
  // ⚠️ Exactly the failure the seen card already guards against, in a file that
  // already has the fix twenty lines away — and I wrote this one without it.
  // A guard that rejects the truth over punctuation is worse than no guard: it
  // trains you to loosen it, and then it stops catching the real thing.
  const norm = v => String(v ?? '')
    .trim()
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')

  // ⚠️ THE AUDIT CAUGHT THIS REJECTING A REAL BOOK. The model put the author
  // inside the title — "Scarcity by Sendhil Mullainathan and Eldar Shafir" —
  // and a strict match threw away a correct recommendation. A guard that drops
  // the truth over formatting teaches you to loosen it, which is how it stops
  // catching the thing it is for. Same lesson as the curly apostrophe.
  const title = norm(read?.title).replace(/\s+by\s+.+$/, '').trim()
  if (!title) return false
  return shelf.some(b => {
    if (norm(b.title) !== title) return false
    // The author is optional in the shape; when it is given it has to be right.
    const claimed = norm(read?.author)
    return !claimed || norm(b.author) === claimed
  })
}

/**
 * ⭐⭐ THE TWO HEADLINE FIGURES ARE OURS, NOT THE MODEL'S.
 *
 * 🔴 Daniel, three times: "why does the dollar amount always change?" Across
 * four regenerations the first stat stayed at his must-pay and the second was a
 * different number every time — the sale price, a gap, household income — and
 * on one run the gap was $1,500 when $5,000 minus $4,000 is $1,000.
 *
 * Two separate faults, and neither is fixable by asking nicely:
 *   - The prompt said "pick the two figures that decide this plan", so the
 *     CHOICE was re-made on every run. Nothing was drifting; it was choosing.
 *   - And a subtraction went through a language model, which is the one kind of
 *     work it has no business doing when both operands are sitting in a form.
 *
 * ⚠️ So they are computed here, from their own answers, every time. Same
 * answers, same numbers, forever — which is what "this is what your answers
 * produce" has to mean if it means anything.
 *
 * ⚠️ WE ONLY REPLACE WHAT WE CAN ACTUALLY DERIVE. A person who skipped the
 * income questions gets the model's stats, because a confident $0 would be
 * worse than a chosen one.
 */
export function deriveStats(answers = {}) {
  const num = v => (Number.isFinite(Number(v)) && String(v ?? '').trim() !== '' ? Number(v) : null)
  const mustPay = num(answers.mustPay)
  if (mustPay === null) return null

  const income = [answers.takeHome, answers.householdTakeHome]
    .map(num)
    .filter(v => v !== null)
    .reduce((a, b) => a + b, 0)

  const stats = [{
    label: 'What has to go out every month',
    value: mustPay,
    prefix: '$',
    suffix: '/mo',
    caption: 'The number everything has to beat',
    // ⭐ `tone` decides presentation, never wording (9 Oct, Daniel's brother:
    // "almost had a heart attack"). Only a `good` number counts up on screen;
    // a hard one sits still beside what the plan does about it.
    tone: 'plain',
  }]

  // ⚠️ Only when they actually told us what comes in. `reduce` on an empty
  // list gives 0, and "your income is $0" is a lie with a stat card round it.
  const gaveIncome = [answers.takeHome, answers.householdTakeHome].some(v => num(v) !== null)
  if (gaveIncome) {
    const gap = mustPay - income
    stats.push(gap > 0
      ? {
        label: 'The gap to close',
        value: gap,
        prefix: '$',
        suffix: '/mo',
        caption: `$${income.toLocaleString()} coming in against $${mustPay.toLocaleString()} going out`,
        tone: 'hard',
      }
      : {
        // ⭐ Not everybody is short. Somebody already clearing their floor is
        // being told something useful and surprising, and calling it a gap of
        // zero would hide it.
        label: 'Spare each month, right now',
        value: Math.abs(gap),
        prefix: '$',
        suffix: '/mo',
        caption: `$${income.toLocaleString()} coming in against $${mustPay.toLocaleString()} going out`,
        tone: 'good',
      })
  }

  // ⚠️ ONE TRUE STAT BEATS TWO WHERE ONE IS MADE UP. The audit found a person
  // who gave almost nothing ending up with NO stats at all: we could derive
  // only their must-pay, so we returned nothing, and the figures guard then
  // correctly dropped the model's two because neither traced to anything.
  // Requiring a pair was a design preference; having a number on the page that
  // is theirs is the product.
  return stats.length ? stats : null
}

/**
 * ⭐⭐ WHAT THE FLOOR BECOMES IF HOUSING GOES — ARITHMETIC, NOT A PROMISE.
 *
 * Daniel: "what do you think about adding what you'll need once these bills are
 * gone?" It is the number his own plan's first gate is about, and until now the
 * honest answer was "we cannot know, go and work it out" — true, and worse than
 * knowing.
 *
 * ⚠️ IT IS NOT PAYWALLED, AND THAT IS NOT GENEROSITY. We could not sell it if
 * we wanted to: without the housing figure there is nothing to sell, and with
 * it there is nothing left to do but subtract. Charging for a subtraction on
 * two numbers somebody typed is the bait-and-switch this product ruled out on
 * its first screen. What the paid half is for is what to DO once the number
 * exists — which is the whole of move one.
 */
export function floorWithoutHousing(answers = {}) {
  const num = v => (Number.isFinite(Number(v)) && String(v ?? '').trim() !== '' ? Number(v) : null)
  const mustPay = num(answers.mustPay)
  const housing = num(answers.housingCost)
  if (mustPay === null || housing === null || housing <= 0) return null
  // ⚠️ A housing cost larger than must-pay is somebody misreading the question,
  // not somebody with a negative floor. Say nothing rather than something silly.
  if (housing >= mustPay) return null
  return { without: mustPay - housing, housing, mustPay }
}
