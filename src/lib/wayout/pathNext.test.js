import { describe, it, expect } from 'vitest'
import { pathNext } from '../../../supabase/functions/_shared/pathNext.ts'
import { enforcePathContract, currentStep, untilFor } from './path'

/**
 * ⚠️ The check-in email works out the next step with its own copy of the rules
 * (an edge function cannot import from src/). This runs both on the same paths
 * and fails if they disagree, so the email can never name a different step
 * from the one the app is glowing.
 */
const MAP = { moves: [{ title: 'One' }, { title: 'Two' }] }
const PATH = enforcePathContract({ parts: [
  { move: 1, steps: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }, { id: 'c', title: 'C', needs: ['b'] }] },
  { move: 2, steps: [{ id: 'd', title: 'D' }, { id: 'e', title: 'E', needs: ['d'], wait: { days: 60, label: 'in two months' } }] },
] }, MAP)
const NOW = new Date('2026-11-01T12:00:00Z')
const LATER = new Date(NOW.getTime() + 61 * 86400000)
const e = PATH.parts[1].steps[1]

const CASES = [
  {},
  { '1.1': { s: 'done' } },
  { '1.1': { s: 'later' } },
  { '1.1': { s: 'done' }, '1.2': { s: 'tried' } },
  { '2.1': { s: 'done' }, '2.2': { s: 'parked', until: untilFor(e, NOW) } },
  Object.fromEntries(['1.1', '1.2', '1.3', '2.1'].map(id => [id, { s: 'later' }])),
]

describe('the email and the app agree on the next step', () => {
  for (const [i, state] of CASES.entries()) {
    for (const when of [NOW, LATER]) {
      it(`case ${i} at ${when === NOW ? 'now' : '61 days on'}`, () => {
        expect(pathNext(PATH, state, when).next?.id ?? null).toBe(currentStep(PATH, state, when)?.id ?? null)
      })
    }
  }
})

describe('a parked step', () => {
  const state = { '2.1': { s: 'done' }, '2.2': { s: 'parked', until: untilFor(e, NOW) } }
  it('is not due before its date', () => {
    expect(pathNext(PATH, state, NOW).due).toBe(null)
  })
  it('is due once its date has come', () => {
    expect(pathNext(PATH, state, LATER).due?.id).toBe('2.2')
  })
  it('counts what is done', () => {
    expect(pathNext(PATH, state, NOW)).toMatchObject({ done: 1, total: 5 })
  })
})
