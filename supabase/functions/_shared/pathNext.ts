/**
 * Where somebody is on their path, for the check-in email (31 Oct 2026).
 *
 * ⚠️ THE SAME RULES AS src/lib/wayout/path.js (currentStep), kept here because
 * an edge function cannot import from src/. pathNext.test.js runs both on the
 * same paths and fails if they ever disagree, so this copy cannot drift.
 * Pure: no Deno, no network.
 */
export interface Step {
  id: string
  title: string
  why?: string
  minutes?: number
  needs?: string[]
  wait?: { days: number; label: string } | null
}
export interface PathShape { parts?: Array<{ move: number; steps: Step[] }> }
export type PathState = Record<string, { s?: string; until?: string; saved?: number } | undefined>

const FINISHED = new Set(['done', 'tried'])

export function pathNext(path: PathShape | null, state: PathState = {}, now: Date = new Date()) {
  const steps = (path?.parts ?? []).flatMap(p => p.steps ?? [])
  const isDone = (id: string) => FINISHED.has(state[id]?.s ?? '')
  const ready = (s: Step) => (s.needs ?? []).every(isDone)
  const parked = (s: Step) => state[s.id]?.s === 'parked'
  const waiting = (s: Step) => parked(s) && !!state[s.id]?.until && new Date(state[s.id]!.until!) > now

  // ⭐ A parked step whose date has come is the most useful thing to say: they
  // asked to be reminded, and this is the reminder.
  const due = steps.find(s => parked(s) && !isDone(s.id) && !waiting(s)) ?? null
  const open = steps.filter(s => !isDone(s.id) && ready(s) && !waiting(s))
  const next = open.find(s => state[s.id]?.s !== 'later') ?? open[0] ?? null
  return { due, next, done: steps.filter(s => isDone(s.id)).length, total: steps.length }
}
