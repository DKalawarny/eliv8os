import { Link } from 'react-router-dom'
import { Helmet } from 'react-helmet-async'
import PublicHeader from '../../components/layout/PublicHeader'
import DecisionView from '../../components/tools/DecisionView'
import { buildPageMeta, SITE_NAME } from '../../lib/seo'

/**
 * /demo — a walkthrough anyone can open without a login, so the product can
 * sell itself over time. Daniel, 8 Oct: keep it clean and universal, no jargon,
 * a thriving business so it reads as exciting rather than a warning.
 *
 * ⭐ TWO RULES THIS PAGE IS BUILT AROUND.
 *
 * 1. EVERY NUMBER HERE IS INVENTED, AND THE PAGE SAYS SO — twice, in plain
 *    sight. A demo full of realistic figures is only honest while the reader
 *    knows it is an example. Evergreen Grounds does not exist. There are no
 *    testimonials here and there will not be until real customers give real
 *    quotes with their real names.
 *
 * 2. IT RENDERS THE REAL COMPONENTS. The decision below is the actual
 *    DecisionView from the product fed seeded data, not a screenshot and not a
 *    mock that drifts the first time the real one changes. What a visitor sees
 *    here is what they get when they sign in.
 *
 * ⭐ The example is a thriving landscaping company on purpose: everyone
 *    understands it with no jargon, and the question is about GROWTH, so
 *    Solomon reads as the sharp advisor who makes a good business bigger
 *    without being reckless. He still names the real constraint and what he
 *    cannot see, because an advisor that only flatters is the whole thing this
 *    product refuses to be. The buyer is defined by conviction, not sector
 *    (see lib/seo.js); landscaping is just the clearest example to show.
 *
 * ⚠️ No em dashes in anything a visitor reads (Daniel, "looks AI").
 */

const DEMO_META = buildPageMeta({
  title:       `See it work — ${SITE_NAME}`,
  description: 'A worked example: what Solomon says when a growing owner asks whether to expand, using a fictional company’s real-shaped numbers.',
  // ⚠️ /tour, not /demo. /demo is the live demo's door (DemoEntry.jsx): it
  // signs a visitor into the sample company and its HTML points at the home
  // page, so this page saying it was /demo meant Google indexed neither (2 Nov).
  path:        '/tour',
})

// ── The example company ───────────────────────────────────────────────────────
// Invented. A healthy, growing landscaping and property-maintenance company.
// "a landscaping" reads correctly; if you change `trade` to a vowel-initial
// word, fix the article in Step 1, this is prose, not a template engine.
const CO = {
  name:     'Evergreen Grounds',
  trade:    'landscaping and property maintenance',
  where:    'Abbotsford, BC',
  people:   18,
  revenue:  '$2.8M',
  margin:   '16%',
}

const NUMBERS = [
  { label: 'Revenue, trailing 12',   value: '$2.8M',  note: 'up 22% on last year' },
  { label: 'Net margin',             value: '16%',    note: 'up from 12%' },
  { label: 'Recurring maintenance',  value: '64%',    note: 'of revenue, renews yearly' },
  { label: 'Cash on hand',           value: '$240k',  note: 'about 9 weeks of payroll' },
]

// The real Advisor conversation shape, abbreviated.
const CHAT = [
  { role: 'user', text: 'We’re growing fast and the commercial side is busy. I want to add a second crew and chase the big strata contracts. Can we pull it off?' },
  {
    role: 'assistant',
    text: 'The money says yes, and that is the easy part. Recurring maintenance is 64% of your revenue and it renews, your margin went from 12 to 16 as that book grew, and you have about nine weeks of payroll in the bank. A second crew is backed by income you can count on, not a hope.\n\nSo the question is not whether you can afford it. It is who runs the second crew to the standard that is winning you those renewals. Right now that standard is you.\n\nWho on the crew today could run a site the way you do, and have you asked them?',
  },
  { role: 'user', text: 'Marcus could. He basically runs our biggest site already. I haven’t asked him though.' },
  {
    role: 'assistant',
    text: 'Then that conversation is the first move, before any hiring. Promote Marcus, give him six weeks running the current crew while you step back, and you will know before the March bids whether the quality holds without you on site.\n\nIf it holds, a second crew is just a staffing exercise and the numbers already say go. If it does not, you have learned that for the cost of a conversation instead of a year of payroll.\n\nThe one thing I would not do is crew up and promote at the same time under bid pressure. That is how the standard slips on both crews at once.\n\nAnd whatever the numbers say, the crew earning those renewals is the business. Grow in a way that does not burn them to hit a deadline.',
  },
]

// Real shape, fed to the real component.
const DECISION = {
  decision: 'Whether to add a second maintenance crew now, or wait until spring',
  stakes:   'The commercial maintenance book has grown faster than one crew can service, and two large strata contracts go to bid in March. A second crew is roughly $190k all in for the year. The question is not whether the work is there. It is whether the business can run a second crew to the same standard without the owner on it.',
  angles: [
    {
      name:          'The cash case',
      leaning:       'for',
      argument:      'Recurring maintenance is 64% of revenue and it renews, so a second crew is backed by predictable income rather than a forecast. At 16% net and $240k in the bank you can carry the ramp without touching the line of credit. This is about as safe as an expansion gets.',
      weakest_point: 'It assumes the two strata bids land. If both go elsewhere, you have sized a crew for work that did not arrive, and the ramp cost shows up anyway.',
    },
    {
      name:          'The people case',
      leaning:       'mixed',
      argument:      'What actually gates a second crew is not money, it is a lead who runs a site the way you would. You have one strong candidate in Marcus, but promoting him pulls your best hand off the crew that is already earning the renewals, so the move has a cost on both sides.',
      weakest_point: 'You have not asked Marcus whether he wants to lead. This is read off how he already runs the big site, not off a conversation, and the conversation is free.',
    },
    {
      name:          'The margin case',
      leaning:       'for',
      argument:      'Margin rose from 12% to 16% as the recurring book grew, because routed maintenance is more profitable per hour than one-off installs. A second crew weighted to maintenance compounds the exact thing already working for you.',
      weakest_point: 'A new crew runs below the mature margin while its routes fill. Model year one at about 11%, not 16%, or the payback looks better on paper than it will in the first season.',
    },
  ],
  conflict: 'The cash and margin cases both say go now. The people case says the real constraint is a single promotion, and making it too fast could cost you the crew that is carrying the renewals. The money is ready before the organisation is.',
  landing: {
    recommendation: 'Add the crew, but promote and settle Marcus first, and time the hire to the March bids rather than ahead of them.',
    reasoning:      'You can plainly afford it, so money is not the deciding factor, the crew lead is. Promote Marcus now, give him six weeks running the existing crew with you stepping back, and you will know before March whether the standard holds without you. If it does, the second crew is a staffing exercise. If it does not, you found that out for the price of a conversation.',
    my_weakest_point: 'I am treating the March bids as the trigger. If a contract comes up sooner, the sequence compresses and you may have to promote and crew up at once, which is the one thing this plan is built to avoid.',
  },
  cannot_see: [
    'Whether Marcus actually wants to lead, or is happy on the tools',
    'How the two strata bids are really trending. Your estimator would have a feel for the win odds',
    'Whether the current crew keeps its renewal rate if its best hand moves up',
  ],
  next_asks: [
    { ask: 'Ask Marcus this week whether he wants to run a crew', why: 'The whole plan rests on it and the conversation costs nothing' },
    { ask: 'Put a realistic win probability on the two March bids', why: 'It decides whether you crew up ahead of them or after' },
    { ask: 'Model the second crew at 11% first-year margin, not 16%', why: 'A new route runs below mature margin until it fills' },
  ],
  drawn_from: ['Your QuickBooks figures', 'The maintenance contract renewals', 'Roadmap milestones', 'Two earlier talks about promoting from the crew'],
}

export default function Demo() {
  return (
    <div className="min-h-screen bg-white">
      <Helmet>
        <title>{DEMO_META.title}</title>
        <link rel="canonical" href={DEMO_META.canonical} />
        {DEMO_META.meta.map((m, i) =>
          m.property
            ? <meta key={i} property={m.property} content={m.content} />
            : <meta key={i} name={m.name} content={m.content} />
        )}
      </Helmet>

      <PublicHeader />

      <main className="max-w-3xl mx-auto px-6 py-14">

        <header className="mb-10">
          <p className="text-brand-600 text-xs font-bold uppercase tracking-widest mb-3">A worked example</p>
          <h1 className="text-4xl md:text-5xl font-black text-gray-900 tracking-tight leading-[1.1] mb-5">
            What it actually looks like<br />when you ask.
          </h1>
          <p className="text-lg text-gray-600 leading-relaxed">
            Below is a walkthrough of the product, the same screens and the same
            components a signed-in owner sees. The only difference is that the
            business is made up.
          </p>
        </header>

        {/* Said plainly, up top, where nobody can miss it. */}
        <div className="rounded-2xl border border-gray-300 bg-gray-50 p-5 mb-12">
          <p className="text-[15px] text-gray-800 leading-relaxed">
            <strong>{CO.name} is not a real company.</strong> Every figure on this
            page is invented to show the shape of a real answer. We would rather
            show you a fiction that is clearly labelled than a customer&rsquo;s
            books, or a testimonial we do not have yet.
          </p>
        </div>

        {/* ── The setup ───────────────────────────────────────────────────── */}
        <Step n="1" title="What Solomon already knows">
          <p className="text-gray-700 leading-relaxed mb-5">
            {CO.name} is a {CO.trade} company in {CO.where}, {CO.people} people,
            about {CO.revenue} a year at {CO.margin} net and growing. The owner
            connected QuickBooks and answered the setup questions once. Nothing
            here was re-typed for this conversation.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {NUMBERS.map(n => (
              <div key={n.label} className="rounded-xl border border-gray-200 bg-white p-4">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">{n.label}</p>
                <p className="text-xl font-black text-gray-900 tabular-nums leading-none mb-1.5">{n.value}</p>
                <p className="text-[11px] text-gray-500 leading-snug">{n.note}</p>
              </div>
            ))}
          </div>
        </Step>

        {/* ── The conversation ────────────────────────────────────────────── */}
        <Step
          n="2"
          title="He answers the question underneath the question"
          blurb="The owner asks about growing. Solomon starts from what is actually strong, names the one thing that gates it, and ends by asking the question that decides it."
        >
          <div className="rounded-2xl border border-gray-200 bg-ink-50 p-4 sm:p-5 flex flex-col gap-3">
            {CHAT.map((m, i) => (
              m.role === 'user' ? (
                <div key={i} className="flex justify-end">
                  <div className="max-w-[85%] rounded-[18px] rounded-br-[4px] bg-ink-900 text-white px-4 py-2.5 text-sm leading-relaxed">
                    {m.text}
                  </div>
                </div>
              ) : (
                <div key={i} className="flex justify-start">
                  <div
                    className="max-w-[92%] rounded-[18px] rounded-bl-[4px] px-5 py-4 font-serif text-[16px] leading-[1.62] whitespace-pre-line"
                    style={{ background: '#FFFFFF', border: '1px solid rgba(13,20,19,0.09)', color: '#1B2422' }}
                  >
                    {m.text}
                  </div>
                </div>
              )
            ))}
          </div>
          <p className="text-[12px] text-gray-400 mt-3 leading-relaxed">
            He starts from the money, which is strong, then moves straight to the
            thing that actually decides it. He is not talking you out of growing,
            he is making the growth hold.
          </p>
        </Step>

        {/* ── The decision tool — the REAL component ───────────────────────── */}
        <Step
          n="3"
          title="On the big calls, he argues it more than one way"
          blurb="This is the actual output, rendered by the same component the product uses. He gives every angle its own weakest point, says where he lands, and lists what he cannot see."
        >
          <div className="rounded-2xl border border-gray-200 bg-ink-50 p-4 sm:p-6">
            <DecisionView result={DECISION} />
          </div>
        </Step>

        {/* ── Memory ──────────────────────────────────────────────────────── */}
        <Step
          n="4"
          title="And he remembers it next month"
          blurb="Decisions, constraints, people and commitments carry forward. You do not re-explain your business every time you open it."
        >
          <div className="rounded-2xl border border-gray-200 bg-white divide-y divide-gray-100">
            {[
              ['Decision', 'Promote Marcus to crew lead before adding a second crew'],
              ['Constraint', 'Will not crew up and promote at the same time under bid pressure'],
              ['Person', 'Marcus runs the largest maintenance site, strong candidate to lead'],
              ['Commitment', 'Six weeks with the owner stepping back, to test the standard before March'],
            ].map(([kind, text]) => (
              <div key={text} className="flex gap-4 px-5 py-3.5">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-brand-700 pt-1 w-20 flex-shrink-0">{kind}</span>
                <span className="text-[14px] text-gray-700 leading-relaxed">{text}</span>
              </div>
            ))}
          </div>
          <p className="text-[12px] text-gray-400 mt-3 leading-relaxed">
            If the owner later says something that contradicts one of these,
            Solomon says so rather than quietly going along with it.
          </p>
        </Step>

        {/* ── Why it answers this way — integrity shown, pointed to, never asserted.
             Mirrors the landing ConvictionSection (approved copy). NO faith words:
             the conviction lives in behaviour; /about is where it is findable. */}
        <section className="mt-16 rounded-2xl border border-gray-200 bg-gray-50 p-7 sm:p-9">
          <h2 className="text-2xl font-black text-gray-900 tracking-tight mb-4 leading-tight">
            Why it cares about more than the money
          </h2>
          <div className="space-y-4 text-[16px] leading-[1.7] text-gray-700">
            <p>
              Most business tools treat your company like a machine for making a
              number, and treat your people, your reputation, your peace, as the
              cost of getting there.
            </p>
            <p>
              Solomon won&rsquo;t. The number matters, and it will be as hard-nosed
              about your margins as anyone you&rsquo;d pay. But it also watches the
              things that never fit in a column: the people who show up for you, the
              corners you wouldn&rsquo;t cut, whether this is still a good place to
              spend a life.
            </p>
            <p className="text-gray-900 font-medium">
              It won&rsquo;t tell you that running it this way makes you more money,
              nobody honestly can. It&rsquo;ll tell you what it costs, and help you
              build something you&rsquo;d be proud to hand on.
            </p>
          </div>
          <Link to="/about" className="inline-block mt-6 text-sm font-semibold text-brand-600 hover:text-brand-700 transition-colors">
            Why it is built this way &rarr;
          </Link>
        </section>

        {/* ── CTA ─────────────────────────────────────────────────────────── */}
        <div className="mt-14 pt-10 border-t border-gray-200 text-center">
          <h2 className="text-2xl font-black text-gray-900 mb-3">
            Your numbers, your business, same treatment.
          </h2>
          <p className="text-gray-600 mb-7 max-w-lg mx-auto leading-relaxed">
            Eliv8 OS is in private pilot and free while it is. No card, and
            nothing is charged.
          </p>
          <Link
            to="/signup"
            className="inline-block px-9 py-4 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-bold transition-colors"
          >
            Start free
          </Link>
          <p className="text-[12px] text-gray-400 mt-5">
            See the{' '}
            <Link to="/terms" className="underline hover:text-gray-600">pilot agreement</Link>
            {' '}&middot;{' '}
            <Link to="/pricing" className="underline hover:text-gray-600">what is included</Link>
          </p>
        </div>
      </main>
    </div>
  )
}

function Step({ n, title, blurb, children }) {
  return (
    <section className="mb-14">
      <div className="flex items-baseline gap-3 mb-2">
        <span className="text-[13px] font-black text-brand-600 tabular-nums">{n}</span>
        <h2 className="text-2xl font-black text-gray-900 tracking-tight leading-tight">{title}</h2>
      </div>
      {blurb && <p className="text-gray-500 leading-relaxed mb-5 pl-7">{blurb}</p>}
      <div className="pl-0 sm:pl-7">{children}</div>
    </section>
  )
}
