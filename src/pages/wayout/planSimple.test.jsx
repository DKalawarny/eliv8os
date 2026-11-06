import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { VersionSwitch } from './PlanThread'

// 6 Nov 2026, Daniel: the plan page was "messy", "it needs to feel simple not
// daunting". The versions are one quiet line until opened.
const said = c => ({ role: 'user', content: c })
const reply = c => ({ role: 'assistant', content: c })
const map = (...t) => ({ moves: t.map(title => ({ title })) })
const V1 = map('Kissimmee'), V2 = map('Three markets'), V3 = map('Merida land question')
const thread = [
  said('flip instead'), reply('That changes move one.'),
  { role: 'assistant', rebuilt: true, base: V1, map: V2 },
  said('we have changed the plan we still wil travel around in the trailer but will end up in around Merida'), reply('ok'),
  { role: 'assistant', rebuilt: true, map: V3 },
]

describe('the version switch, compact', () => {
  it('is one line naming the version showing, with nothing of their old messages', () => {
    const html = renderToStaticMarkup(<VersionSwitch thread={thread} liveMap={V3} onSwitch={() => {}} compact />)
    expect(html).toContain('Version 3 of your plan')
    expect(html).not.toMatch(/Rewritten around|trailer|Help me choose/)
  })
  it('says original when the original is showing', () => {
    const html = renderToStaticMarkup(<VersionSwitch thread={thread} liveMap={V1} onSwitch={() => {}} compact />)
    expect(html).toContain('Your original plan')
  })
  it('is still the full switch when not compact', () => {
    const html = renderToStaticMarkup(<VersionSwitch thread={thread} liveMap={V3} onSwitch={() => {}} />)
    expect(html).toContain('The version you are looking at')
  })
})
