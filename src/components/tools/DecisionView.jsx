/**
 * Renders one decision argued several ways.
 *
 * The visual job here is to stop the angles reading as a ranked list. They are
 * peers that disagree — so they get the same weight, the same size, and their
 * own weakest point printed underneath in the same grey. Only "where I land"
 * is allowed to look like a conclusion.
 */

import ToolDisclaimer from './ToolDisclaimer'

const LEAN = {
  for:     { label: 'Argues for',     bar: 'bg-brand-600',  text: 'text-brand-800' },
  against: { label: 'Argues against', bar: 'bg-red-500',    text: 'text-red-700'   },
  mixed:   { label: 'Cuts both ways', bar: 'bg-amber-500',  text: 'text-amber-700' },
}

export default function DecisionView({ result }) {
  if (!result) return null
  const { decision, stakes, angles = [], conflict, landing, cannot_see = [], drawn_from = [], next_asks = [] } = result

  return (
    <div className="flex flex-col gap-8">

      <header className="flex flex-col gap-2.5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-300">
          Working through a decision
        </p>
        <h2 className="font-serif text-[30px] leading-[1.2] text-ink-900">{decision}</h2>
        {stakes && <p className="text-[14.5px] leading-[1.6] text-ink-500">{stakes}</p>}
      </header>

      {angles.length > 0 && (
        <section className="flex flex-col gap-3">
          {angles.map((a, i) => {
            const lean = LEAN[a.leaning] ?? LEAN.mixed
            return (
              <article key={i} className="bg-white border border-ink-100 rounded-2xl p-5 sm:p-6 flex gap-4">
                <div className={`w-[3px] rounded-sm shrink-0 ${lean.bar}`} />
                <div className="flex flex-col gap-2.5 min-w-0">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <h3 className={`text-[13px] font-bold tracking-[0.03em] uppercase ${lean.text}`}>
                      {a.name}
                    </h3>
                    <span className="text-[11.5px] text-ink-300">{lean.label}</span>
                  </div>
                  <p className="text-[14.5px] leading-[1.65] text-ink-700">{a.argument}</p>
                  {a.weakest_point && (
                    <p className="text-[13.5px] leading-[1.6] text-ink-400">
                      <span className="font-semibold">Weakest point:</span> {a.weakest_point}
                    </p>
                  )}
                </div>
              </article>
            )
          })}
        </section>
      )}

      {conflict && (
        <section className="flex flex-col gap-2.5 px-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-300">
            Where they conflict
          </p>
          <p className="font-serif text-[19px] leading-[1.55] text-ink-900">{conflict}</p>
        </section>
      )}

      {landing && (
        <section className="bg-white border border-ink-100 rounded-2xl p-6 flex flex-col gap-3">
          <div className="flex items-center gap-2.5">
            <svg viewBox="0 0 24 24" className="w-[17px] h-[17px] text-brand-600" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 15a3 3 0 0 1-3 3H8l-4 3V7a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3z" />
            </svg>
            <p className="text-[11px] font-semibold uppercase tracking-[0.09em] text-brand-700">
              Where I land, for what it's worth
            </p>
          </div>
          <p className="font-serif text-[20px] leading-[1.55] text-ink-900">{landing.recommendation}</p>
          {landing.reasoning && (
            <p className="text-[14.5px] leading-[1.65] text-ink-700">{landing.reasoning}</p>
          )}
          {landing.my_weakest_point && (
            <p className="text-[13.5px] leading-[1.6] text-ink-400 pt-1 border-t border-ink-100 mt-1">
              <span className="font-semibold">The weakest point in my reasoning:</span> {landing.my_weakest_point}
            </p>
          )}
        </section>
      )}

      {cannot_see.length > 0 && (
        <section className="rounded-2xl border border-amber-200 bg-amber-50/60 p-5 sm:p-6 flex flex-col gap-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.09em] text-amber-800">
            What I can't see from here
          </p>
          <ul className="flex flex-col gap-2.5">
            {cannot_see.map((c, i) => (
              <li key={i} className="text-[14px] leading-[1.6] text-ink-700">
                {c.gap}
                {c.who_would_know && (
                  <span className="text-ink-400"> Who would know: {c.who_would_know}.</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {next_asks.length > 0 && (
        <section className="flex flex-col gap-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-300">
            Cheap things to find out first
          </p>
          <ul className="flex flex-col gap-2">
            {next_asks.map((n, i) => (
              <li key={i} className="bg-white border border-ink-100 rounded-xl px-4 py-3">
                <p className="text-[14.5px] text-ink-900">{n.ask}</p>
                {n.why && <p className="text-[13px] text-ink-400 mt-0.5">{n.why}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {drawn_from.length > 0 && (
        <section className="flex flex-wrap items-center gap-2 pt-1">
          <span className="text-[12.5px] font-semibold text-ink-300">Drawn from</span>
          {drawn_from.map((d, i) => (
            <span key={i} className="px-2.5 py-1 rounded-full bg-ink-100 text-ink-500 text-[12px]">
              {d}
            </span>
          ))}
        </section>
      )}

      <ToolDisclaimer toolId="decision" />

    </div>
  )
}
