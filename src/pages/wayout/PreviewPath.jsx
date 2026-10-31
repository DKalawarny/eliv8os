import { useState } from 'react'
import WayoutShell from './WayoutShell'
import { PathView } from './Path'
import { enforcePathContract } from '../../lib/wayout/path'

/**
 * Dev only (/wayout/preview/path). The path with Luis's sample plan, the same
 * person as the landing video and the mock-up Daniel tapped through. No
 * session, no model, nothing saved: taps live in memory, reload starts over.
 */
const MAP = {
  headline: 'One job, cards going down, home for supper, 14 months',
  moves: [
    { title: 'Find the $300 inside what already goes out' },
    { title: 'Point every car detail at the card' },
    { title: 'Ask for the raise that ends the second job' },
  ],
  stats: [{ label: 'The gap to close', value: 300, prefix: '$', suffix: '/mo', tone: 'hard' }],
}
const ANSWERS = { short: 'I am $300 short every month', detail: 'People pay me to detail their cars. I charge 120 a car.', card: '22 percent' }
const RAW = { parts: [
  { move: 1, steps: [
    { id: 'a', title: 'Write down every bill that leaves your account', why: 'You cannot cut what you cannot see. Your last two bank statements are enough.', minutes: 15 },
    { id: 'b', title: 'Call your phone company and ask for their cheapest plan that still works for you', why: 'Phone plans are the bill most people overpay on without noticing.', minutes: 20, money: true,
      alt: { title: 'Look up two prepaid plans and compare them to what you pay', why: 'If they would not move, switching often does the same job.', minutes: 15 } },
    { id: 'c', title: 'Get one other quote for your car insurance', why: 'Insurance renews quietly. One quote shows whether you are paying too much.', minutes: 30, money: true,
      alt: { title: 'Ask your insurer what discounts you are not getting', why: 'A higher deductible or a safe driver discount can do it without switching.', minutes: 15 } },
    { id: 'd', title: 'Cancel subscriptions you pay for but do not use', why: 'Streaming, apps, the gym. Look at your list from step 1 and cancel the ones you forgot about.', minutes: 10, money: true, needs: ['a'] },
  ] },
  { move: 2, steps: [
    { id: 'e', title: 'Open a free savings account just for car detail money', why: 'If detail money goes into your everyday account, it gets spent on gas and groceries without you noticing. A separate account keeps it for the card.', minutes: 15 },
    { id: 'f', title: 'After your next car detail, pay the $120 onto your credit card', why: 'Your card charges 22 percent interest. Paying it down saves you more than anything else you could do with that money.', minutes: 5 },
    { id: 'g', title: 'Check your card balance', why: 'It should be lower than it is today. That is how you know the plan is working.', minutes: 5, needs: ['f'], wait: { days: 60, label: 'in two months' } },
  ] },
  { move: 3, steps: [
    { id: 'h', title: 'Write down three things you do at work that save your boss time or money', why: 'Asking for a raise is much easier when you have real examples written down.', minutes: 20 },
    { id: 'i', title: 'Ask your manager for a 20 minute meeting about your pay', why: 'A planned meeting goes better than asking in passing, and it shows you are serious.', minutes: 5, needs: ['h'], money: true },
  ] },
] }
const PATH = enforcePathContract(RAW, MAP, ANSWERS)

export default function PreviewPath() {
  const [state, setState] = useState({ '1.1': { s: 'done' } })
  // ?nogap shows a plan with no monthly gap (the money box should not appear).
  const gap = new URLSearchParams(window.location.search).has('nogap') ? null : 300
  return (
    <WayoutShell title="Your path (preview)" wide>
      <PathView path={PATH} state={state} headline={MAP.headline} gap={gap} onState={next => setState(next)} moveLink={null} />
    </WayoutShell>
  )
}
