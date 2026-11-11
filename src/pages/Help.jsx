import { useState } from 'react'
import { Link } from 'react-router-dom'
import HelpAsk from '../components/help/HelpAsk'

/**
 * /help — in-app FAQ + per-tool guides.
 *
 * This is the first version. Copy lives inline as data (FAQ + TOOL_GUIDES
 * arrays below) — easy to edit, no CMS. When the content gets bigger or
 * starts needing screenshots, we move it to MDX. For now flat text is fine.
 *
 * DRAFT NOTE for Daniel: every guide and FAQ answer below is a starting
 * draft. Read them through and rewrite in your voice — you know what
 * actually confuses owners better than I do. Mark each item ✓ when
 * you've reviewed it.
 *
 * Linked from:
 *   - Sidebar "Help" link (desktop + mobile drawer)
 *   - Settings → top-right of header (future)
 *   - Each tool's "?" / "How does this work?" link (future)
 */

// ----------------------------------------------------------------------------
// Content
// ----------------------------------------------------------------------------

const FAQ = [
  {
    q: 'How does Solomon know about my business?',
    a: 'Solomon reads three things every day: the answers you gave during onboarding (industry, revenue, goals), anything you tell it in conversation, and, if you\'ve connected QuickBooks, your live financials. The more specific you are when you check in, the better its advice gets.',
  },
  {
    q: 'Why is there a 10-runs-per-month cap on tools?',
    a: `Tools (Cash Flow, Hiring Scorecards, SOPs, etc.) each make an AI call that costs real money to run. The cap is what stops those costs running away. It is not there to slow you down, and it resets every month. A plan with more room for heavier use is coming later. If you are hitting the cap, tell us with Report a problem on this page, so we know who needs it.`,
  },
  {
    q: 'Do I need QuickBooks to use Eliv8 OS?',
    a: 'No. Connecting QuickBooks unlocks the live CFO Dashboard and makes cash flow forecasting automatic, but every other tool works without it. You can connect later from Settings → Integrations, or enter numbers manually.',
  },
  {
    q: 'Is my data private? Can you see it?',
    a: 'Each business gets an isolated workspace. Your data is never used to train AI models and is never shared. I can see aggregate usage (which tools are popular, error rates) but I do not read individual workspaces unless you explicitly send me something for support.',
  },
  {
    q: 'How do I invite my accountant or coach?',
    a: 'Go to Settings → Team & access. Under "Advisor access" generate an invite link and share it. They\'ll create a free account, get read-only access to your workspace, and can see your roadmap and check-ins but cannot edit anything.',
  },
  {
    q: 'How do I add my employees / techs?',
    a: 'Daily logs → Crew and reminders, at the bottom of the page. Add their name, and an email or phone if you want them reminded. They show up on Tasks so you can assign work to them. Adding crew does not create logins for them; they write their daily log from their own link.',
  },
  {
    q: 'What\'s the difference between a milestone and a task?',
    a: 'Milestones live on your Growth Roadmap. They\'re the big chunks (e.g. "Hire a foreman", "Launch service area in Airdrie"). Tasks live on the Jobs. They\'re the day-to-day work that gets you there ("Post job ad", "Call three references"). Milestones tell you where you\'re going. Tasks tell you what to do today.',
  },
  {
    q: 'Can I cancel anytime?',
    a: 'Yes. Settings → Billing → Manage billing opens the Stripe portal where you can cancel. Monthly plans stop at the end of the period. Annual plans can cancel renewal any time and keep access until renewal would have happened.',
  },
  {
    q: 'How do I export my data?',
    a: 'Ask for it in the box at the top of this page and send it to a person. You get a CSV of your milestones, tasks and check-ins back, usually within a day.',
  },
  {
    q: 'I think I found a bug / something broke',
    a: 'Use Report a problem in the sidebar, or the box at the top of this page, and send it to a person. Say what you were doing and what happened. "The cash flow chart would not load after I connected QuickBooks" beats "it is not working".',
  },
]

const TOOL_GUIDES = [
  {
    name:   'Solomon (AI advisor)',
    href:   '/advisor',
    short:  'Your always-on business advisor, chat anytime, opens with a brief each morning.',
    steps: [
      'Open Solomon from the sidebar. It remembers every prior conversation in this workspace.',
      'Each morning it pre-reads your latest financials, roadmap, and check-ins, then opens with what needs attention.',
      'Ask it anything: "Should I hire?", "What\'s my biggest risk this quarter?", "Help me write a job ad for a foreman".',
      'It can write documents, scope jobs, run numbers, and pull from your CFO Dashboard if QuickBooks is connected.',
    ],
  },
  {
    name:   'CFO Dashboard',
    href:   '/tools/cfo',
    short:  'Live KPIs from QuickBooks with plain-English commentary each month.',
    steps: [
      'Go to Settings → Integrations and connect QuickBooks (one-time OAuth).',
      'Once connected, the CFO Dashboard auto-pulls revenue, expenses, AR, and cash on hand.',
      'On the first of each month, you\'ll see a plain-English narrative explaining what changed and why.',
      'No QuickBooks? Skip this tool. Cash Flow Forecast works manually.',
    ],
  },
  {
    name:   'Cash Flow Forecast',
    href:   '/tools/cash-flow',
    short:  'Rolling 13-week forecast: see runway, gaps, and bad weeks before they hit.',
    steps: [
      'Enter the basics: starting cash, expected weekly inflows (jobs closing), and weekly outflows (payroll, rent, materials).',
      'Eliv8 OS extends 13 weeks out and highlights any week where you go negative.',
      'If QuickBooks is connected, the inflow/outflow defaults come from your real data, just adjust forward-looking weeks.',
      'Re-run it any time your pipeline changes. It\'s designed to be cheap to run weekly.',
    ],
  },
  {
    name:   'Hiring Planner',
    href:   '/tools/hiring',
    short:  'Generates scorecards, interview questions, red flags, and onboarding plans.',
    steps: [
      'Tell it the role you\'re hiring (foreman, estimator, office admin, etc.) and your business context.',
      'Get a scorecard (what "great" looks like in 30/60/90 days), a screening interview script, and red flags to watch for.',
      'Also produces a 30-day onboarding plan you can hand to the new hire on day one.',
      'Best paired with Pipeline to Hire (sourcing) and Estimator/Foreman Scorecards (specific role evals).',
    ],
  },
  {
    name:   'Org Chart Planner',
    href:   '/tools/org-chart',
    short:  'Maps the team you need in 12 months. Not the one you\'re stuck with today.',
    steps: [
      'Describe your current team and your 12-month revenue goal.',
      'Eliv8 OS sketches the org structure that supports that goal, what roles you\'ll need, in what order.',
      'Tells you which hire to make first and what hiring will cost vs. what it unlocks.',
      'Run it once a quarter. The picture changes as your roadmap moves.',
    ],
  },
  {
    name:   'Safety & Compliance',
    href:   '/tools/safety',
    short:  'Tracks every licence, WCB registration, insurance, and compliance document.',
    steps: [
      'Upload (or list) every licence, certificate, WCB registration, insurance policy, and contract you\'re responsible for.',
      'Eliv8 OS reminds you 60 / 30 / 7 days before each expires.',
      'Generates a safety meeting cadence and talk topics specific to your work.',
      'If you operate in multiple provinces/states, it tracks per-jurisdiction.',
    ],
  },
  {
    name:   'Growth Roadmap',
    href:   '/roadmap',
    short:  'Milestone-by-milestone plan with progress tracking, your 12-month operating plan.',
    steps: [
      'Generated automatically from your onboarding answers. Each milestone has actions, dependencies, and a target date.',
      'Mark milestones complete as you finish them, Solomon tracks your pace and adjusts advice.',
      'If your situation changes meaningfully (big new contract, key team change), update your answers in Business and regenerate from Settings → Danger zone.',
      'Regenerating wipes existing milestones including completed ones. Only do it when the old roadmap really doesn\'t fit any more.',
    ],
  },
  {
    name:   'Tasks',
    href:   '/board',
    short:  'A board for the day-to-day work: assign tasks, email staff, see what is in progress.',
    steps: [
      'Add your crew under Daily logs → Crew and reminders first so you can assign tasks to specific people.',
      'Create tasks under the relevant milestone or as standalone work.',
      'Drag between columns: Todo → In progress → Done.',
      'Assignees get an email when work is assigned to them or status changes (if they have an email on file).',
    ],
  },
  {
    name:   'Check-ins',
    href:   '/checkins',
    short:  'Weekly or daily logs that Solomon reads, your operating heartbeat.',
    steps: [
      'Quick prompts: what went well, what didn\'t, what you\'re worried about.',
      'Solomon reads these overnight and factors them into the morning brief.',
      'Owners who check in 2–3 times a week get noticeably better advice, patterns emerge that a one-shot conversation can\'t see.',
    ],
  },
  {
    name:   'Document Library',
    href:   '/documents',
    short:  'Everything Solomon and the tools can reference: contracts, SOPs, financials.',
    steps: [
      'Upload PDFs, Word docs, spreadsheets, anything you want Solomon to know about.',
      'Eliv8 OS reads them once and stores the extracted text so future conversations and tools can reference them.',
      'Good things to upload: master service agreement, employee handbook, last year\'s P&L, vendor list, safety manual.',
    ],
  },
  {
    name:   'Team Newsletter',
    href:   '/tools/newsletter',
    short:  'Generates a monthly newsletter from your check-ins and milestones. Keep the team in the loop.',
    steps: [
      'Click Generate; Eliv8 OS reads your last 30 days of activity and drafts a newsletter.',
      'Covers wins, what\'s coming up, hiring, and any compliance reminders.',
      'Review, edit, send. Owners use this with their crews, board, or co-owners.',
    ],
  },
]

// ----------------------------------------------------------------------------
// Page
// ----------------------------------------------------------------------------

export default function Help() {
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <header className="mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-ink-900 tracking-tight">Help &amp; support</h1>
        <p className="text-sm text-ink-400 mt-1">
          Ask Solomon how something works. If he cannot answer, your question goes to a person.
        </p>
      </header>

      <HelpAsk faq={FAQ} guides={TOOL_GUIDES} />

      {/* How to read the Roadmap — visual guide with the same color
          legend that lives inline on /roadmap. Owners forward this link
          to advisors / co-owners who haven't used the app before. */}
      <section className="mb-12">
        <h2 className="text-lg font-bold text-ink-900 mb-1">How to read your Roadmap</h2>
        <p className="text-sm text-ink-400 mb-4">
          What the colors, dots, and name pills mean on the milestone list.
        </p>
        <RoadmapGuide />
      </section>

      {/* FAQ */}
      <section className="mb-12">
        <h2 className="text-lg font-bold text-ink-900 mb-1">Frequently asked questions</h2>
        <p className="text-sm text-ink-400 mb-4">
          The ten questions I get most often.
        </p>
        <div className="bg-white border border-ink-100 rounded-xl divide-y divide-ink-50 shadow-sm overflow-hidden">
          {FAQ.map((item, i) => (
            <Expandable key={i} question={item.q}>
              <p className="text-sm text-ink-600 leading-relaxed">{item.a}</p>
            </Expandable>
          ))}
        </div>
      </section>

      {/* Tool guides */}
      <section className="mb-12">
        <h2 className="text-lg font-bold text-ink-900 mb-1">How to use each tool</h2>
        <p className="text-sm text-ink-400 mb-4">
          Short guide per tool. Click any to expand.
        </p>
        <div className="bg-white border border-ink-100 rounded-xl divide-y divide-ink-50 shadow-sm overflow-hidden">
          {TOOL_GUIDES.map((guide, i) => (
            <Expandable
              key={i}
              question={guide.name}
              subtitle={guide.short}
            >
              <ol className="space-y-2 text-sm text-ink-600 leading-relaxed list-decimal pl-5">
                {guide.steps.map((step, j) => (
                  <li key={j}>{step}</li>
                ))}
              </ol>
              {guide.href && (
                <Link
                  to={guide.href}
                  className="inline-flex items-center gap-1.5 mt-4 text-sm font-semibold text-brand-600 hover:text-brand-700"
                >
                  Open this tool
                  <svg viewBox="0 0 16 16" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="3" y1="8" x2="13" y2="8" />
                    <polyline points="9 4 13 8 9 12" />
                  </svg>
                </Link>
              )}
            </Expandable>
          ))}
        </div>
      </section>

      {/* Footer */}
      <section className="bg-ink-50 border border-ink-100 rounded-xl p-6 text-center">
        <p className="text-sm text-ink-600 mb-1">
          Still stuck? I read every message.
        </p>
<a href="#ask" className="text-sm font-semibold text-brand-600 hover:text-brand-700">
          Ask at the top of this page, then send it to a person
        </a>
      </section>
    </div>
  )
}

// ----------------------------------------------------------------------------
// Roadmap visual guide — same legend the Roadmap page exposes inline,
// fleshed out with the surrounding "how does this work" context an
// outside reader (advisor, co-owner) would need to understand the page.
// Colors hardcoded here to match Roadmap.jsx STATUS_BAR_COLORS /
// CATEGORY_BAR / CATEGORY_LABELS. If those change there, update here.
// ----------------------------------------------------------------------------

const ROADMAP_STATUS = [
  { color: '#f87171', label: 'Bottleneck',     desc: 'Blocking other milestones from starting' },
  { color: '#2f8f6d', label: 'Done',           desc: 'Completed' },
  { color: '#6366f1', label: 'In progress',    desc: 'Started, not yet finished' },
  { color: '#fbbf24', label: 'Behind',         desc: 'Past target date' },
  { color: '#d1d5db', label: 'Waiting',        desc: 'Waiting on a dependency to finish first' },
  { color: '#e2e8f0', label: 'Ready to start', desc: 'Available to work on' },
]

const ROADMAP_CATEGORIES = [
  { color: '#D97706', label: 'Foundation', desc: 'Legal, structure, basics' },
  { color: '#2563EB', label: 'Systems',    desc: 'Tools, processes, software' },
  { color: '#7C3AED', label: 'Team',       desc: 'Hiring, org chart, people' },
  { color: '#0b6b4e', label: 'Revenue',    desc: 'Sales, marketing, growth' },
  { color: '#E11D48', label: 'Exit',       desc: 'Long-term salability moves' },
  { color: '#EA580C', label: 'Trajectory', desc: 'Strategic direction' },
]

function RoadmapGuide() {
  return (
    <div className="bg-white border border-ink-100 rounded-xl p-5 sm:p-6 shadow-sm space-y-6">

      {/* Mock milestone row — visual anchor so readers can see exactly
          which element each legend entry refers to. */}
      <div>
        <p className="text-xs font-semibold text-ink-500 mb-2">What a milestone row looks like</p>
        <div
          className="bg-white rounded-xl border border-ink-150 shadow-sm overflow-hidden max-w-md"
          style={{ borderLeft: '3px solid #6366f1' }}
        >
          <div className="flex items-center gap-3 px-4 py-3.5">
            <span className="w-5 h-5 rounded-full border-2 border-ink-300 flex-shrink-0" />
            <p className="flex-1 text-sm font-semibold text-ink-900 leading-snug truncate">
              Hire a foreman
            </p>
            <span className="text-[11px] text-ink-400 whitespace-nowrap flex-shrink-0 hidden sm:block">
              Jun 30
            </span>
            <span className="text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full whitespace-nowrap">
              Danny
            </span>
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: '#7C3AED' }} />
            <span className="text-ink-300 text-xs select-none w-4 text-center">▼</span>
          </div>
        </div>
        <p className="text-xs text-ink-500 mt-2 leading-relaxed">
          Reading left-to-right: the <strong>indigo bar</strong> means in progress · checkbox to complete · title (click to expand) ·
          due date · <strong>green name pill</strong> is a staff member · <strong>teal dot</strong> is the Team category · expand arrow.
        </p>
      </div>

      {/* Left-edge bar — status */}
      <div>
        <p className="text-xs font-semibold text-ink-500 mb-2">Left-edge bar · status</p>
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {ROADMAP_STATUS.map(s => (
            <li key={s.label} className="flex items-start gap-2.5 text-sm text-ink-700">
              <span
                className="mt-1 w-3.5 h-3.5 rounded-sm flex-shrink-0"
                style={{ backgroundColor: s.color }}
              />
              <span>
                <span className="font-semibold">{s.label}</span>
                <span className="block text-xs text-ink-500">{s.desc}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* Right-side dot — category */}
      <div>
        <p className="text-xs font-semibold text-ink-500 mb-2">Right-side dot · category</p>
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {ROADMAP_CATEGORIES.map(c => (
            <li key={c.label} className="flex items-start gap-2.5 text-sm text-ink-700">
              <span
                className="mt-1.5 w-3 h-3 rounded-full flex-shrink-0"
                style={{ backgroundColor: c.color }}
              />
              <span>
                <span className="font-semibold">{c.label}</span>
                <span className="block text-xs text-ink-500">{c.desc}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-ink-500 mt-3 leading-relaxed">
          The dot lets you scan the list and group milestones by area of the business at a glance, without having
          to read each title.
        </p>
      </div>

      {/* Assignee chips */}
      <div>
        <p className="text-xs font-semibold text-ink-500 mb-2">Name pills · who's on it</p>
        <ul className="space-y-2.5 text-sm text-ink-700">
          <li className="flex items-center gap-3">
            <span className="text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full">
              Name
            </span>
            <span className="text-ink-600">
              <strong>Team staff.</strong> Field crew added in Settings → Team. They get an emailed magic-link when assigned, tap the link and they see only their tasks, no login needed.
            </span>
          </li>
          <li className="flex items-center gap-3">
            <span className="text-[10px] font-semibold bg-ink-100 text-ink-700 border border-ink-200 px-2 py-0.5 rounded-full">
              Name
            </span>
            <span className="text-ink-600">
              <strong>App user.</strong> Someone with their own login. They see assignments inside the Eliv8 OS dashboard.
              No magic-link email. They're already in the app.
            </span>
          </li>
          <li className="flex items-center gap-3">
            <span className="text-[10px] font-semibold bg-ink-50 text-ink-600 border border-ink-200 px-1.5 py-0.5 rounded-full">
              +N
            </span>
            <span className="text-ink-600">
              <strong>More people on this milestone.</strong> Hover the pill on the page to see the full list.
            </span>
          </li>
        </ul>
      </div>

      {/* Assigning work */}
      <div className="border-t border-ink-100 pt-5">
        <p className="text-xs font-semibold text-ink-500 mb-2">How to assign work</p>
        <ol className="text-sm text-ink-600 leading-relaxed list-decimal pl-5 space-y-1.5">
          <li>Click a milestone row to expand it.</li>
          <li>Each action step under "How to tackle this" has a "+ Job" button on hover.</li>
          <li>Click it → pick the person → set a due date if you want → "Add to board".</li>
          <li>
            If you pick a Team staff member, they get an email with a link to a mobile page showing just their
            tasks. If you pick an App user, they'll see the task in their dashboard.
          </li>
          <li>To change who's on it, hover the same action again, the button now reads "Reassign".</li>
        </ol>
      </div>

      <p className="text-xs text-ink-400 leading-relaxed border-t border-ink-100 pt-4">
        Tip: every dot or pill on the Roadmap has a hover tooltip. If you forget what something means, hover it for
        a one-line reminder.
      </p>
    </div>
  )
}

// ----------------------------------------------------------------------------
// Expandable row
// ----------------------------------------------------------------------------

function Expandable({ question, subtitle, children }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full px-5 py-4 flex items-start gap-4 text-left hover:bg-ink-50/40 transition-colors"
        aria-expanded={open}
      >
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-semibold text-ink-900">{question}</span>
          {subtitle && (
            <span className="block text-xs text-ink-400 mt-0.5">{subtitle}</span>
          )}
        </span>
        <span className={`mt-1 flex-shrink-0 text-ink-400 transition-transform ${open ? 'rotate-180' : ''}`}>
          <svg viewBox="0 0 16 16" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="4 6 8 10 12 6" />
          </svg>
        </span>
      </button>
      {open && (
        <div className="px-5 pb-5 pt-1">
          {children}
        </div>
      )}
    </div>
  )
}
