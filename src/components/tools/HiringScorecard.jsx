import PushToBoardButton from './PushToBoardButton'
import ToolDisclaimer from './ToolDisclaimer'

/**
 * HiringScorecard — pure presentation component for the JSON produced by
 * HIRING_SCORECARD_PROMPT.
 *
 * Used in two places:
 *   - /tools/hiring (right after Claude returns)
 *   - /documents    (when opening a saved scorecard)
 *
 * Field names here MUST match the JSON shape the prompt returns. If the
 * prompt changes, update this file in the same commit.
 *
 * Sections render only when data is present, so a scorecard with no
 * `compensation_note` (the optional field) doesn't show an empty heading.
 */
export default function HiringScorecard({ data }) {
  if (!data || typeof data !== 'object') {
    return <p className="text-sm text-gray-500">No content saved.</p>
  }
  return (
    <div className="space-y-5">
      {data.mission && (
        <Section title="Mission">
          <p className="text-sm text-gray-800 leading-relaxed">{data.mission}</p>
        </Section>
      )}

      {Array.isArray(data.outcomes) && data.outcomes.length > 0 && (
        <Section title="Outcomes (what success looks like at 12 months)">
          <ol className="space-y-1.5 text-sm text-gray-800">
            {data.outcomes.map((o, i) => (
              <li key={i} className="flex items-start gap-2 group">
                <span className="flex-shrink-0 font-semibold text-brand-600 w-5">{i + 1}.</span>
                <span className="flex-1">{o}</span>
                <span className="opacity-0 group-hover:opacity-100 pointer-coarse:opacity-100 transition-opacity mt-0.5">
                  <PushToBoardButton title={typeof o === 'string' ? o : ''} />
                </span>
              </li>
            ))}
          </ol>
        </Section>
      )}

      {Array.isArray(data.certifications_required) && data.certifications_required.length > 0 && (
        <Section title="Certifications & licences required">
          <ul className="space-y-1 text-sm text-gray-800">
            {data.certifications_required.map((c, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-brand-600 flex-shrink-0">✓</span>
                <span>{c}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {Array.isArray(data.competencies) && data.competencies.length > 0 && (
        <Section title="Competencies">
          <ul className="space-y-1 text-sm text-gray-800">
            {data.competencies.map((c, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-brand-600 flex-shrink-0">→</span>
                <span>{typeof c === 'string' ? c : `${c.name}${c.definition ? `: ${c.definition}` : ''}`}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {Array.isArray(data.interview_questions) && data.interview_questions.length > 0 && (
        <Section title="Interview questions">
          <ol className="space-y-1.5 pl-5 list-decimal text-sm text-gray-800">
            {data.interview_questions.map((q, i) => <li key={i}>{q}</li>)}
          </ol>
        </Section>
      )}

      {Array.isArray(data.red_flags) && data.red_flags.length > 0 && (
        <Section title="Red flags">
          <ul className="space-y-1 text-sm text-gray-800">
            {data.red_flags.map((r, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-red-600 flex-shrink-0">⚠</span>
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {data.ramp_plan && (
        <Section title="30 / 60 / 90 day ramp">
          <div className="space-y-2">
            {[
              { label: 'Day 30', key: 'day_30' },
              { label: 'Day 60', key: 'day_60' },
              { label: 'Day 90', key: 'day_90' },
            ].map(({ label, key }) =>
              data.ramp_plan[key] ? (
                <div key={key} className="flex gap-3 text-sm text-gray-800 group items-start">
                  <span className="font-semibold text-brand-600 w-12 flex-shrink-0">{label}</span>
                  <span className="flex-1">{data.ramp_plan[key]}</span>
                  <span className="opacity-0 group-hover:opacity-100 pointer-coarse:opacity-100 transition-opacity mt-0.5 flex-shrink-0">
                    <PushToBoardButton title={`${label}: ${data.ramp_plan[key]}`} />
                  </span>
                </div>
              ) : null
            )}
          </div>
        </Section>
      )}

      {data.compensation_note && (
        <Section title="Compensation note">
          <p className="text-sm text-gray-800 leading-relaxed">{data.compensation_note}</p>
        </Section>
      )}

      <ToolDisclaimer toolId="hiring-scorecard" />
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5">
        {title}
      </div>
      {children}
    </div>
  )
}
