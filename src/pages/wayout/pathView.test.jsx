import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { PathView } from './Path'
import { enforcePathContract } from '../../lib/wayout/path'

/**
 * ⭐ The end of the path says what happens next (Daniel, 31 Oct 2026: "what
 * next here", on a finished path that just stopped at "9 of 9").
 */
const MAP = { headline: 'One job, home for supper', moves: [{ title: 'One' }] }
const PATH = enforcePathContract({ parts: [{ move: 1, steps: [{ title: 'A', money: true }, { title: 'B' }] }] }, MAP)
const html = (state, gap = 300) => renderToStaticMarkup(
  <MemoryRouter><PathView path={PATH} state={state} headline={MAP.headline} gap={gap} onState={() => {}} doneLink="/done" /></MemoryRouter>,
).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

describe('the end of the path', () => {
  it('says plainly what they are working toward while steps are left', () => {
    const t = html({ '1.1': { s: 'done' } })
    expect(t).toMatch(/What you are working toward One job, home for supper/)
    expect(t).not.toMatch(/You did every step/)
  })
  it('when every step is done but the gap is not closed, says how short and what to do', () => {
    const t = html({ '1.1': { s: 'done', saved: 60 }, '1.2': { s: 'tried' } })
    expect(t).toMatch(/You found \$60 a month\. You are still \$240 a month short\./)
    expect(t).toMatch(/Tell us how it went/)
  })
  it('when the gap is closed, says so', () => {
    const t = html({ '1.1': { s: 'done', saved: 300 }, '1.2': { s: 'done' } })
    expect(t).toMatch(/The \$300 gap is closed\./)
  })
})
