import { describe, it, expect } from 'vitest'
import { shareDraft, withoutFigures, SHARE_URL } from './shareText'

describe('a shared plan carries no money figures', () => {
  it('takes out every figure, in every shape the plans write them', () => {
    expect(withoutFigures('Find the $300 inside what already goes out')).toBe('Find the money inside what already goes out')
    expect(withoutFigures('Pay $14,000 down at $250 a month')).toBe('Pay money down at money')
    expect(withoutFigures('Bank $5k before spring')).toBe('Bank money before spring')
    expect(withoutFigures('Clear $1,250.50/month')).not.toMatch(/\d/)
  })

  it('leaves alone a title with no money in it', () => {
    expect(withoutFigures('Ask for the raise that ends the second job')).toBe('Ask for the raise that ends the second job')
    expect(withoutFigures('Home by 5, four nights a week')).toBe('Home by 5, four nights a week')
  })

  it('a real plan comes out as three titles and the link, with no figure anywhere', () => {
    const map = { headline: 'One job, $300 short', moves: [
      { title: 'Find the $300 inside what already goes out', detail: 'You are $300 short.' },
      { title: 'Point every car detail at the card.', detail: '$14,000 at 22 percent' },
      { title: 'Ask for the raise that ends the second job — soon' },
    ] }
    const text = shareDraft(map, SHARE_URL, { withMoves: true })
    expect(text).not.toMatch(/\$/)
    expect(text).not.toMatch(/14,000|300|22 percent|—/)
    expect(text).toContain('2. Point every car detail at the card\n')
    expect(text).toContain(SHARE_URL)
    expect(text.split('\n').filter(l => /^\d\. /.test(l))).toHaveLength(3)
  })

  it('never includes the headline or a detail, only titles', () => {
    const text = shareDraft({ headline: 'Leave before the custody hearing', moves: [{ title: 'x', detail: 'secret detail' }] }, SHARE_URL, { withMoves: true })
    expect(text).not.toMatch(/custody|secret/)
  })

  it('leaves their moves out unless they add them', () => {
    const map = { moves: [{ title: 'Get the Merida land question answered' }] }
    const text = shareDraft(map)
    expect(text).not.toMatch(/Merida|three moves/)
    expect(text).toContain(SHARE_URL)
    expect(text).not.toMatch(/—/)
  })
})

describe('the invite message, by whether money is in it yet', () => {
  it('before payments: tells them to use the link or code, names no money', () => {
    const t = shareDraft(null, 'https://getunstuckmap.com/?i=abc', { code: 'DANNY-4F2', live: false })
    expect(t).toContain('Sign up through my link so I can see you joined, or enter my code DANNY-4F2.')
    expect(t).not.toMatch(/half|share|thank you|\$/i)
  })
  it('once live: the friend’s discount first, and the sender says they get something', () => {
    const t = shareDraft(null, 'https://getunstuckmap.com/?i=abc', { code: 'DANNY-4F2', live: true })
    expect(t).toContain('My link gives you half off your first month')
    expect(t).toContain('(I get a small thank you if you stay.)')
    expect(t).not.toMatch(/20|percent|%/)
  })
})
