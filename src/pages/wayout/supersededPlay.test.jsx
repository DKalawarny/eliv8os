import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
import Playbook from './Playbook'

// 9 Oct, Daniel: "whys it like this when click back through walk through with
// the lines". 6 Nov: "messy and confusing". A walkthrough for a move the plan
// no longer has leads with the way forward; the old steps fold away.
const render = props => renderToStaticMarkup(
  <HelmetProvider><MemoryRouter>
    <Playbook play={{ title: 'The old move', thisWeek: { action: 'Do the old thing' } }} index={1} {...props}>
      <p id="child">ask box</p>
    </Playbook>
  </MemoryRouter></HelmetProvider>,
)

describe('a superseded walkthrough', () => {
  const html = render({
    superseded: true,
    notice: <div className="wayout__stale"><button className="wayout__btn">Write the steps for this move</button></div>,
  })
  const foldAt = html.indexOf('wayout__ovold')

  it('puts the way back and the button first, the old steps folded after', () => {
    expect(foldAt).toBeGreaterThan(-1)
    expect(html.indexOf('Back to your plan')).toBeLessThan(foldAt)
    expect(html.indexOf('Write the steps for this move')).toBeLessThan(foldAt)
    expect(html.indexOf('Do the old thing')).toBeGreaterThan(foldAt)
    expect(html).not.toMatch(/<details[^>]*wayout__ovold[^>]*open/)
  })

  it('offers no ask box or done button for steps the plan no longer has', () => {
    expect(html.includes('id="child"')).toBe(false)
  })

  it('shows a current walkthrough in full', () => {
    const now = render({})
    expect(now.includes('wayout__ovold')).toBe(false)
    expect(now.includes('id="child"')).toBe(true)
  })

  it('takes the dashes out of stored text', () => {
    const out = renderToStaticMarkup(
      <HelmetProvider><MemoryRouter>
        <Playbook play={{ title: 'Move', words: { script: 'Hey — I am selling the house' } }} index={1} />
      </MemoryRouter></HelmetProvider>,
    )
    expect(out).toContain('Hey. I am selling the house')
    expect(out).not.toContain('—')
  })
})
