/**
 * ⭐⭐ THE PATH: each move of the plan, broken into small steps somebody can
 * actually do in one sitting, tapped through like a game (Daniel, 31 Oct 2026,
 * from doing Duolingo: "it's interactive like a game, some of this could be
 * really beneficial for unstuck").
 *
 * Everything here is pure, so it is tested without a browser or a model:
 *   · enforcePathContract — what the model wrote, made safe to show
 *   · stepStatus / currentStep — where somebody is, from their taps
 *   · cheer — the words when a step is done
 *
 * 🔴🔴 NOTHING BLOCKS UNLESS IT HAS TO (Daniel, 31 Oct 2026): "I don't think we
 * should ever block someone unless it has to be done before they can go on."
 * Every step is open from the start. A step is closed only when it `needs`
 * another one done first (you cannot ask for the pay meeting before you have
 * your three examples). "Not yet" never stops anybody; it moves the suggestion
 * on. A step that has to wait for a date ("check the card in two months") is
 * parked and comes back on that date. This replaces the one-move-at-a-time
 * order from migration 056, on his call.
 *
 * ⚠️ THE WORDS STAY ABOUT WHAT THEY DID. He asked for energy (confetti, a chime,
 * a different line each time) and chose it over the old "no confetti" rule. Every
 * line still names a real thing: the step, the part, the money back. Never
 * "you're amazing", never a score, never a streak.
 */
import { scrubFigures, forReaders } from './mapContract'

export const PATH_RULES = 1
export const MAX_STEPS = 5

const DONE = new Set(['done', 'tried'])

/** The plan the path was written for. A rebuilt plan needs a new path. */
export function pathKey(map) {
  return (map?.moves ?? []).map(m => String(m?.title ?? '').trim()).join(' | ')
}

export function pathIsStale(path, map) {
  if (!path?.parts?.length) return true
  if ((path.rules ?? 0) < PATH_RULES) return true
  return path.key !== pathKey(map)
}

const text = (v, answers) => {
  if (typeof v !== 'string') return ''
  return forReaders(scrubFigures(v.trim(), answers)).trim()
}
const minutesOf = v => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) ? Math.min(120, Math.max(1, n)) : 15
}

/**
 * Make what the model wrote safe to show.
 *
 * ⚠️ Every step gets a fresh id ("2.3" = move 2, step 3) and `needs` is
 * rewritten to match. A step may only need a step that comes BEFORE it, so a
 * loop (A needs B needs A) cannot exist and nobody can ever be stuck behind one.
 * ⚠️ Figures go through the same guard as the map: a number that is not theirs
 * is cut, and a step left with no words is dropped.
 */
export function enforcePathContract(raw, map, answers = {}) {
  const moves = map?.moves ?? []
  const given = Array.isArray(raw?.parts) ? raw.parts : []
  const seen = new Map()          // model id → our id, in order of appearance
  const parts = moves.map((move, mi) => {
    const order = mi + 1
    const src = given.find(p => Number(p?.move) === order) ?? given[mi] ?? {}
    const steps = []
    for (const s of Array.isArray(src.steps) ? src.steps : []) {
      if (steps.length >= MAX_STEPS) break
      const title = text(s?.title, answers)
      if (!title) continue
      const id = `${order}.${steps.length + 1}`
      const needs = (Array.isArray(s?.needs) ? s.needs : [])
        .map(n => seen.get(String(n)))
        .filter(Boolean)
      if (s?.id != null) seen.set(String(s.id), id)
      const days = Math.round(Number(s?.wait?.days))
      const altTitle = text(s?.alt?.title, answers)
      steps.push({
        id,
        title,
        why: text(s?.why, answers),
        minutes: minutesOf(s?.minutes),
        needs: [...new Set(needs)],
        wait: days >= 1 && days <= 365 ? { days, label: text(s.wait.label, answers) || `in ${days} days` } : null,
        money: s?.money === true,
        alt: altTitle ? { title: altTitle, why: text(s.alt.why, answers), minutes: minutesOf(s.alt.minutes) } : null,
      })
    }
    // A move the model gave no usable steps for still appears: as one step,
    // the move itself, so the path never has a hole in it.
    if (!steps.length) {
      steps.push({ id: `${order}.1`, title: text(move?.title, answers) || `Move ${order}`, why: text(move?.detail, answers),
        minutes: 30, needs: [], wait: null, money: false, alt: null })
    }
    return { move: order, title: text(move?.title, answers), steps }
  })
  return { rules: PATH_RULES, key: pathKey(map), parts }
}

// ── Where somebody is ───────────────────────────────────────────────────────

export const allSteps = path => (path?.parts ?? []).flatMap(p => p.steps)
const byId = (path, id) => allSteps(path).find(s => s.id === id)
const isDone = (state, id) => DONE.has(state?.[id]?.s)

export function isReady(path, state, step) {
  return (step.needs ?? []).every(id => isDone(state, id))
}

/** Parked and its date has not come yet. */
function waiting(state, step, now) {
  const st = state?.[step.id]
  return st?.s === 'parked' && st.until && new Date(st.until) > now
}

/**
 * The suggested next step ("Today"). Only a suggestion: every open step can be
 * done. Steps put off with "Not yet" go to the back of the line, not off it.
 */
export function currentStep(path, state = {}, now = new Date()) {
  const open = allSteps(path).filter(s => !isDone(state, s.id) && isReady(path, state, s) && !waiting(state, s, now))
  return open.find(s => state[s.id]?.s !== 'later') ?? open[0] ?? null
}

/** done · tried · now · parked · open · blocked */
export function stepStatus(path, state = {}, step, now = new Date()) {
  const st = state[step.id]?.s
  if (st === 'done' || st === 'tried') return st
  if (!isReady(path, state, step)) return 'blocked'
  if (waiting(state, step, now)) return 'parked'
  return currentStep(path, state, now)?.id === step.id ? 'now' : 'open'
}

/** The first unfinished step a blocked step is waiting on. */
export function blockedBy(path, state, step) {
  return (step.needs ?? []).map(id => byId(path, id)).find(s => s && !isDone(state, s.id)) ?? null
}

export function savedPerMonth(state = {}) {
  return Object.values(state).reduce((t, st) => t + (Number(st?.saved) > 0 ? Number(st.saved) : 0), 0)
}

export const partIsFinished = (part, state) => part.steps.every(s => isDone(state, s.id))

export function untilFor(step, now = new Date()) {
  return new Date(now.getTime() + (step.wait?.days ?? 0) * 86400000).toISOString()
}

/**
 * The monthly gap their plan named, if it named one in their own numbers
 * ("The gap to close: $300/mo"). Null otherwise; the path then counts money
 * back without a target.
 */
export function monthlyGap(map) {
  const st = (map?.stats ?? []).find(s => s?.tone === 'hard' && /mo/.test(String(s?.suffix ?? '')) && Number(s?.value) > 0)
  return st ? Number(st.value) : null
}

/** A typed amount, as whole dollars, or null if it is not a sensible one. */
export function parseAmount(v) {
  const n = Math.round(Number(String(v ?? '').replace(/[$,\s]/g, '')))
  return Number.isFinite(n) && n > 0 && n <= 100000 ? n : null
}

// ── The words when a step is done ───────────────────────────────────────────

export const MONEY_HEADS = ['Nice work', 'That one paid off', 'Look at that', 'Real money back', 'That counts', 'Well done']
export const DONE_HEADS = ['Done', 'Checked off', 'That one is behind you', 'Good, that is done', 'Another one down', 'Nice']
export const DONE_LINES = ['One more step behind you.', 'The next one is ready when you are.', 'Small steps add up. This one did.', 'That makes the next step easier.']

/** A line from `list`, never the one used last time from that same list. */
export function pickFresh(list, last, rand = Math.random) {
  const options = list.filter(l => l !== last)
  return options[Math.floor(rand() * options.length)] ?? list[0]
}

/**
 * The headline after a step is done. `state` already includes this step.
 * Big moments get their own words; otherwise a fresh line from the pool.
 */
export function cheer({ path, state, step, saved = 0, gap = null, now = new Date(), last = {}, rand = Math.random }) {
  const part = (path?.parts ?? []).find(p => p.steps.some(s => s.id === step.id))
  const total = savedPerMonth(state)
  if (!currentStep(path, state, now) && allSteps(path).every(s => isDone(state, s.id))) return { head: 'You reached the end of the path!' }
  if (saved && gap && total >= gap && total - saved < gap) return { head: 'You closed the gap!' }
  if (part && partIsFinished(part, state)) return { head: `Part ${part.move} is done!` }
  if (saved && total === saved) return { head: 'Your first money back!' }
  const list = saved ? MONEY_HEADS : DONE_HEADS
  return { head: pickFresh(list, last[saved ? 'money' : 'done'], rand), from: saved ? 'money' : 'done' }
}
