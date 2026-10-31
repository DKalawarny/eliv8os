import { describe, it, expect } from 'vitest'
import { crisisFrom, moveIsOpen } from './session'

/**
 * 🔴🔴 THE MOST VULNERABLE PERSON THIS PRODUCT WILL EVER MEET GOT A PARSER
 * ERROR. Found by running a real intake describing violence at home through
 * the live function: the model correctly abandoned the three-move JSON and
 * wrote prose — 211 for a transition house, 911 for immediate danger, 988 to
 * talk. Better than any JSON could have been. The client threw "The plan came
 * back unreadable."
 */
describe('a crisis answer is allowed to break the format', () => {
  const realAnswer = 'This is a safety situation, not a planning moment.\n\n'
    + 'Taking the car keys to prevent you from leaving with your kids is a form of control. '
    + 'You do not need to have a plan before you can go. You need one number and one search.\n\n'
    + 'Call or text 211. Tell them you need a transition house. If you are in immediate '
    + 'danger right now, call 911.'

  it('recognises it as prose that was meant to be prose', () => {
    expect(crisisFrom(realAnswer)).toEqual({ crisis: true, message: realAnswer })
  })

  it('does NOT swallow a truncated map — that is a real error and must stay one', () => {
    expect(crisisFrom('{"headline": "Out of the warehouse", "moves": [{"title": "Pressure')).toBeNull()
    expect(crisisFrom('"headline": "Out of the warehouse in twelve months and home on Fridays"')).toBeNull()
  })

  it('does not treat a stray fragment as a safety message', () => {
    expect(crisisFrom('Sorry, I cannot.')).toBeNull()
    expect(crisisFrom('')).toBeNull()
    expect(crisisFrom(null)).toBeNull()
  })
})

describe('no move is ever locked (Daniel, 31 Oct 2026)', () => {
  // ⭐ He chose this over 056's "the gate is the product": never block somebody
  // unless a thing truly has to come first. Single steps can still need one
  // another; that lives in path.js and is tested there.
  it('every move is open, whatever is done', () => {
    expect(moveIsOpen(1, new Set())).toBe(true)
    expect(moveIsOpen(2, new Set())).toBe(true)
    expect(moveIsOpen(3, new Set([1]))).toBe(true)
  })
})
