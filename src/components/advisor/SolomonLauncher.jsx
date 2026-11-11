import { Link } from 'react-router-dom'

/**
 * What Solomon can do — the launcher that replaces the tools grid.
 *
 * The grid was a destination: you navigated to /tools, read ten cards, picked
 * one, landed on a form page and filled eight fields. Ten products in a
 * trench coat. But deleting it outright would have hidden every capability,
 * which is the real objection to chat-only interfaces — people don't know
 * what to ask for, so they ask for nothing.
 *
 * So: everything stays visible, but clicking seeds the CONVERSATION instead
 * of opening a page. Discoverability without the sprawl.
 *
 * ⭐ These now genuinely run. Clicking a row still only seeds the conversation
 * — Solomon decides whether the question wants a tool or an answer — but when
 * it does want one he runs the real tool and the artifact lands in the Library.
 * See lib/solomonTools.js.
 *
 * Two rows are still conversation-only, and deliberately so: "Draft an update
 * for the team" (the newsletter prompt is still built inline in Newsletter.jsx,
 * so there is no promptKey to run) and "Write down a repeating job" (Playbooks
 * is a page, not a generate). Each row keeps its "open the full tool" link
 * regardless, so nothing that worked before stops working.
 */

const GROUPS = [
  {
    title: 'Money',
    items: [
      { label: 'Forecast cash further out',      seed: 'Walk me through my cash position over the next 13 weeks. Where does it get tight, and what are my options before it does?', to: '/tools/cash-flow' },
      { label: 'Read this month’s numbers to me', seed: 'Read me this month’s numbers in plain English. What actually changed, and what should I do about it?',                     to: '/tools/cfo' },
      { label: 'Price something honestly',        seed: 'I want to price a service properly. Not gouging, not underselling. Help me think through what it’s actually worth.',        to: '/tools/offer-builder' },
    ],
  },
  {
    title: 'People',
    items: [
      { label: 'Think through a hire',        seed: 'I’m thinking about hiring. Help me work out whether I should, what the role really is, and what I’d be looking for in the person.', to: '/tools/hiring' },
      { label: 'Plan the team I’ll need',     seed: 'What should my team look like in twelve months, and what’s the order I should build it in?',                                        to: '/tools/org-chart' },
      { label: 'Draft an update for the team', seed: 'Help me write an honest update for my team about where the business is heading.',                                                  to: '/tools/newsletter' },
    ],
  },
  {
    title: 'The business',
    items: [
      { label: 'Work through a decision',       seed: 'I have a decision to make and I keep going round in circles on it. Argue it more than one way for me.', to: '/tools/decision' },
      { label: 'Set this quarter’s priorities', seed: 'Help me pick the two or three things that actually matter this quarter, and be honest if I’m taking on too many.', to: '/tools/rocks' },
      { label: 'Write down a repeating job',    seed: 'I want to write down a job we do over and over so it stops living in my head. Walk me through it.',                to: '/playbooks' },
      { label: 'Check an obligation',           seed: 'I have a question about a rule or an obligation. Answer it from my documents and show me the actual source.',      to: '/tools/safety' },
      { label: 'Think about who runs this next', seed: 'If I stepped back in five years, what would need to be true? Be honest about how far off that is today.',         to: '/tools/exit-readiness' },
    ],
  },
]

// Shown first, in the accent colour. Kept deliberately short — a list of
// "suggested" items as long as the real list suggests nothing at all.
function suggest({ hasCashConcern, hasOpenHire }) {
  const out = []
  if (hasCashConcern) out.push(GROUPS[0].items[0])
  if (hasOpenHire)    out.push(GROUPS[1].items[0])
  if (!out.length)    out.push(GROUPS[2].items[0])
  return out.slice(0, 2)
}

export default function SolomonLauncher({ onPick, hasCashConcern = false, hasOpenHire = false }) {
  const suggested = suggest({ hasCashConcern, hasOpenHire })
  const suggestedLabels = new Set(suggested.map(s => s.label))

  return (
    <aside className="hidden xl:flex w-[300px] shrink-0 flex-col gap-5 overflow-y-auto scrollbar-hide border-l border-ink-100 bg-white px-5 py-6">

      <div className="flex flex-col gap-1.5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-400">
          What Solomon can do
        </p>
        <p className="text-[12.5px] leading-[1.5] text-ink-400">
          Everything the tools page held. It just happens in the conversation now.
        </p>
      </div>

      {suggested.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="px-3 text-[10.5px] font-bold tracking-[0.05em] text-brand-400">
            SUGGESTED NOW
          </p>
          {suggested.map(item => (
            <Row key={item.label} item={item} onPick={onPick} highlight />
          ))}
        </div>
      )}

      {GROUPS.map(group => {
        const items = group.items.filter(i => !suggestedLabels.has(i.label))
        if (!items.length) return null
        return (
          <div key={group.title} className="flex flex-col gap-1">
            <p className="px-3 text-[10.5px] font-bold tracking-[0.05em] text-ink-300 uppercase">
              {group.title}
            </p>
            {items.map(item => (
              <Row key={item.label} item={item} onPick={onPick} />
            ))}
          </div>
        )
      })}

      <div className="mt-auto pt-4 border-t border-ink-100 flex flex-col gap-1.5">
        <p className="text-[12.5px] leading-[1.5] text-ink-400">
          Everything he makes is saved to your documents.
        </p>
        <Link to="/documents" className="text-[12.5px] font-semibold text-brand-700 hover:text-brand-800 transition-colors">
          See what’s there →
        </Link>
        <Link to="/context" className="text-[12.5px] font-semibold text-ink-400 hover:text-ink-700 transition-colors">
          What he’s working from →
        </Link>
      </div>
    </aside>
  )
}

function Row({ item, onPick, highlight = false }) {
  return (
    <div className="group relative">
      <button
        type="button"
        onClick={() => onPick(item.seed)}
        className={[
          'w-full text-left px-3 py-2.5 rounded-[10px] text-[13.5px] transition-colors',
          highlight
            ? 'bg-brand-50 text-brand-800 font-semibold hover:bg-brand-100'
            : 'text-ink-600 hover:bg-white hover:text-ink-900',
        ].join(' ')}
      >
        {item.label}
      </button>
      {item.to && (
        <Link
          to={item.to}
          title="Open the full tool"
          className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 pointer-coarse:opacity-100 focus:opacity-100 transition-opacity text-ink-300 hover:text-ink-700 p-1"
        >
          <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 17 17 7" /><path d="M8 7h9v9" />
          </svg>
        </Link>
      )}
    </div>
  )
}
