import { describe, it, expect } from 'vitest'
import {
  enforcePathContract, pathKey, pathIsStale, currentStep, stepStatus, blockedBy,
  savedPerMonth, monthlyGap, parseAmount, cheer, pickFresh, untilFor, MAX_STEPS,
} from './path'

const MAP = {
  moves: [{ title: 'Find the $300' }, { title: 'Detail money to the card' }, { title: 'Ask for the raise' }],
  stats: [{ label: 'Gap', value: 300, prefix: '$', suffix: '/mo', tone: 'hard' }],
}
const ANSWERS = { short: 'I am $300 short every month', detail: 'I charge 120 a car' }

const RAW = {
  parts: [
    { move: 1, steps: [
      { id: 'a', title: 'Write down every bill', why: 'You cannot cut what you cannot see.', minutes: 15 },
      { id: 'b', title: 'Call the phone company', why: 'Most people overpay.', minutes: 20, money: true,
        alt: { title: 'Compare two prepaid plans', why: 'Switching does the same job.', minutes: 15 } },
    ] },
    { move: 2, steps: [
      { id: 'c', title: 'Pay the $120 onto the card', why: 'It charges 22 percent.', minutes: 5 },
      { id: 'd', title: 'Check the card balance', why: 'It should be lower.', minutes: 5, needs: ['c'], wait: { days: 60, label: 'in two months' } },
    ] },
    { move: 3, steps: [
      { id: 'e', title: 'Write three examples', why: 'Easier with them written down.', minutes: 20 },
      { id: 'f', title: 'Ask for a pay meeting', why: 'Planned beats passing.', minutes: 5, needs: ['e'] },
    ] },
  ],
}
const path = enforcePathContract(RAW, MAP, ANSWERS)
const NOW = new Date('2026-11-01T12:00:00Z')

describe('enforcePathContract', () => {
  it('gives every step a stable id and rewrites needs to match', () => {
    expect(path.parts.map(p => p.steps.map(s => s.id))).toEqual([['1.1', '1.2'], ['2.1', '2.2'], ['3.1', '3.2']])
    expect(path.parts[1].steps[1].needs).toEqual(['2.1'])
    expect(path.parts[2].steps[1].needs).toEqual(['3.1'])
  })

  it('drops a need on a LATER step, so a loop can never block anybody', () => {
    const p = enforcePathContract({ parts: [{ move: 1, steps: [
      { id: 'x', title: 'First', needs: ['y'] }, { id: 'y', title: 'Second', needs: ['x'] },
    ] }] }, { moves: [{ title: 'M' }] })
    expect(p.parts[0].steps[0].needs).toEqual([])
    expect(p.parts[0].steps[1].needs).toEqual(['1.1'])
  })

  it('lets a step wait on one other step at most, the nearest', () => {
    const p = enforcePathContract({ parts: [{ move: 1, steps: [
      { id: 'a', title: 'A' }, { id: 'b', title: 'B' }, { id: 'c', title: 'C', needs: ['a', 'b'] },
    ] }] }, { moves: [{ title: 'M' }] })
    expect(p.parts[0].steps[2].needs).toEqual(['1.2'])
  })

  it('cuts a figure that is not theirs and keeps one that is', () => {
    const p = enforcePathContract({ parts: [{ move: 1, steps: [
      { title: 'Ask for the rate', why: 'That would save you $4,750 a year. Phone plans are often too high.' },
      { title: 'Send the $120 to the card', why: 'Your $300 gap closes from both sides.' },
    ] }] }, { moves: [{ title: 'M' }] }, ANSWERS)
    expect(p.parts[0].steps[0].why).not.toMatch(/4,750/)
    expect(p.parts[0].steps[1].title).toMatch(/\$120/)
  })

  it('caps a part at MAX_STEPS and never leaves a part empty', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ title: `Step ${i}` }))
    const p = enforcePathContract({ parts: [{ move: 1, steps: many }] }, { moves: [{ title: 'One' }, { title: 'Two' }] })
    expect(p.parts[0].steps).toHaveLength(MAX_STEPS)
    expect(p.parts[1].steps).toHaveLength(1)
    expect(p.parts[1].steps[0].title).toBe('Two')
  })

  it('keeps only sensible waits and minutes', () => {
    const p = enforcePathContract({ parts: [{ move: 1, steps: [
      { title: 'A', minutes: 900, wait: { days: 0 } }, { title: 'B', minutes: 'soon', wait: { days: 14 } },
    ] }] }, { moves: [{ title: 'M' }] })
    expect(p.parts[0].steps[0]).toMatchObject({ minutes: 120, wait: null })
    expect(p.parts[0].steps[1]).toMatchObject({ minutes: 15, wait: { days: 14, label: 'in 14 days' } })
  })

  it('takes out dashes and "Tuesday" like every other AI text a person reads', () => {
    const p = enforcePathContract({ parts: [{ move: 1, steps: [{ title: 'Call them on Tuesday — early' }] }] }, { moves: [{ title: 'M' }] })
    expect(p.parts[0].steps[0].title).not.toMatch(/Tuesday|—/)
  })
})

describe('staleness', () => {
  it('is fresh for the plan it was written for and stale for a rebuilt one', () => {
    expect(pathIsStale(path, MAP)).toBe(false)
    expect(pathIsStale(path, { moves: [{ title: 'Something else' }] })).toBe(true)
    expect(pathIsStale(null, MAP)).toBe(true)
    expect(path.key).toBe(pathKey(MAP))
  })
})

describe('nothing blocks unless it has to', () => {
  it('opens every step without a need, from the start, in every part', () => {
    const st = path.parts.flatMap(p => p.steps).map(s => stepStatus(path, {}, s, NOW))
    expect(st).toEqual(['now', 'open', 'open', 'blocked', 'open', 'blocked'])
  })

  it('"Not yet" moves the suggestion on without closing the step', () => {
    const state = { '1.1': { s: 'later' } }
    expect(currentStep(path, state, NOW).id).toBe('1.2')
    expect(stepStatus(path, state, path.parts[0].steps[0], NOW)).toBe('open')
  })

  it('a step can be done out of order, and that opens what needed it', () => {
    const state = { '3.1': { s: 'done' } }
    expect(stepStatus(path, state, path.parts[2].steps[1], NOW)).toBe('open')
  })

  it('a blocked step names the step it is waiting on', () => {
    expect(blockedBy(path, {}, path.parts[1].steps[1]).id).toBe('2.1')
  })

  it('"It didn\'t work, move on" counts as finished for whatever needed it', () => {
    const state = { '2.1': { s: 'tried' } }
    expect(stepStatus(path, state, path.parts[1].steps[1], NOW)).not.toBe('blocked')
  })

  it('a parked step stays out of the way until its date, then comes back', () => {
    const step = path.parts[1].steps[1]
    const state = { '2.1': { s: 'done' }, '2.2': { s: 'parked', until: untilFor(step, NOW) } }
    expect(stepStatus(path, state, step, NOW)).toBe('parked')
    const later = new Date(NOW.getTime() + 61 * 86400000)
    expect(stepStatus(path, state, step, later)).not.toBe('parked')
  })

  it('when everything left was put off, the suggestion falls back rather than vanishing', () => {
    const state = Object.fromEntries(path.parts.flatMap(p => p.steps).map(s => [s.id, { s: 'later' }]))
    expect(currentStep(path, state, NOW)?.id).toBe('1.1')
  })
})

describe('money', () => {
  it('adds up what they typed, per month', () => {
    expect(savedPerMonth({ a: { s: 'done', saved: 25 }, b: { s: 'done', saved: 40 }, c: { s: 'tried' } })).toBe(65)
  })
  it('reads the gap only from the plan\'s own monthly hard number', () => {
    expect(monthlyGap(MAP)).toBe(300)
    expect(monthlyGap({ stats: [{ value: 4400, suffix: '/mo', tone: 'plain' }] })).toBe(null)
  })
  it('accepts a typed amount in the ways people type it', () => {
    expect(parseAmount('$47')).toBe(47)
    expect(parseAmount('1,200')).toBe(1200)
    expect(parseAmount('abc')).toBe(null)
    expect(parseAmount('0')).toBe(null)
  })
})

describe('the words when a step is done', () => {
  const s11 = path.parts[0].steps[0], s12 = path.parts[0].steps[1]
  it('names the first money back', () => {
    const state = { '1.2': { s: 'done', saved: 25 } }
    expect(cheer({ path, state, step: s12, saved: 25, gap: 300, now: NOW }).head).toBe('Your first money back!')
  })
  it('names a finished part', () => {
    const state = { '1.1': { s: 'done' }, '1.2': { s: 'done' } }
    expect(cheer({ path, state, step: s12, now: NOW }).head).toBe('Part 1 is done!')
  })
  it('names the closed gap', () => {
    const state = { '1.1': { s: 'done', saved: 280 }, '1.2': { s: 'done', saved: 40 } }
    expect(cheer({ path, state, step: s12, saved: 40, gap: 300, now: NOW }).head).toBe('You closed the gap!')
  })
  it('names the end of the path', () => {
    const state = Object.fromEntries(path.parts.flatMap(p => p.steps).map(s => [s.id, { s: 'done' }]))
    expect(cheer({ path, state, step: s11, now: NOW }).head).toBe('You reached the end of the path!')
  })
  it('never repeats the line it used last time', () => {
    for (let i = 0; i < 30; i++) {
      const line = pickFresh(['a', 'b', 'c'], 'b')
      expect(line).not.toBe('b')
    }
  })
  it('never praises the person, only what was done', () => {
    const state = { '2.1': { s: 'done' } }
    const all = new Set()
    for (let i = 0; i < 40; i++) all.add(cheer({ path, state, step: path.parts[1].steps[0], now: NOW }).head)
    for (const h of all) expect(h).not.toMatch(/amazing|proud|incredible|genius|you are|you're/i)
  })
})
