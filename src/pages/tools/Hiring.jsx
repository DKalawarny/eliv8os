import { useState, useEffect } from 'react'
import { useToolDraft, clearToolDraft, readToolDraft } from '../../hooks/useToolDraft'
import { useNavigate, Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { runToolCall, HAIKU } from '../../lib/anthropic'
import { isCapExceeded } from '../../lib/usage'
import { buildAdvisorContext } from '../../lib/advisorContext'
import { summarizeContext } from '../../lib/toolContextSummary'
import HiringScorecard from '../../components/tools/HiringScorecard'
import CapExceededNotice from '../../components/tools/CapExceededNotice'
import RefineChat from '../../components/tools/RefineChat'
import ContextUsedLine from '../../components/tools/ContextUsedLine'

/**
 * Hiring Planner — /tools/hiring
 *
 * Flow:
 *   1. 'form'     owner fills a short brief about the role they want to hire
 *   2. 'loading'  we call Claude with the brief + their business context
 *   3. 'result'   scorecard rendered; owner can "Save to library" or "Start over"
 *   4. 'saving'   insert into `documents` table
 *                 → redirect to /documents?tool=hiring-scorecard
 *
 * Why a scorecard (not a JD): forces the owner to define outcomes BEFORE
 * qualifications. Cuts the "warm body with the right certifications" hiring
 * mistake that burns small businesses for 6+ months before anyone notices.
 *
 * Why we send BUSINESS_CONTEXT: so Claude can anchor the scorecard in the
 * specific business — "$900k revenue / 6 team / Alberta HVAC / owner-on-tools"
 * produces different outcomes than a $5M shop. Without context it's a
 * template.
 */

const INITIAL_FORM = {
  role_title:         '',
  why_now:            '',
  success_picture:    '',
  team_context:       '',
  budget:             '',
  target_start:       '',
}

export default function Hiring() {

  const { profile }        = useAuth()
  const navigate           = useNavigate()
  const [stage, setStage]  = useState('form')    // form | loading | result | saving
  const [form, setForm]    = useState(INITIAL_FORM)
  const [result, setResult] = useState(null)
  const [messages, setMessages] = useState([])   // chat turns for the refine panel
  const [refining, setRefining] = useState(false)
  const [error, setError]  = useState(null)
  // Separate state for cap-exceeded errors so we can render a richer notice
  // (reset date, contact link) instead of a generic red strip.
  const [capError, setCapError] = useState(null)
  // Snapshot of which inputs Solomon read at generation time. Persisted on
  // the saved document so re-opening the scorecard still shows what fed it.
  const [contextSummary, setContextSummary] = useState(null)

  // ⭐ Keep the last read on the page across navigation (useToolDraft).
  // Show the latest saved result on open (like the CFO page), so a returning
  // owner, and the demo, sees what this tool produced rather than a blank form.
  // A local draft (unsaved in-progress work) still takes precedence.
  useEffect(() => {
    if (!profile?.company_id) return
    if (readToolDraft('hiring-scorecard', profile.company_id)?.result) return
    let cancelled = false
    supabase
      .from('documents')
      .select('output_data')
      .eq('company_id', profile.company_id)
      .eq('tool_id', 'hiring-scorecard')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled && data?.output_data) { setResult(data.output_data); setStage('result') }
      })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.company_id])

  useToolDraft({
    toolId: 'hiring',
    companyId: profile?.company_id,
    result,
    payload: { form, contextSummary },
    onRestore: (d) => {
      setResult(d.result)
      if (d.form) setForm(d.form)
      if (d.contextSummary != null) setContextSummary(d.contextSummary)
      setStage('result')
    },
  })

  const canSubmit = form.role_title.trim() && form.why_now.trim()

  const updateField = (key) => (e) => setForm({ ...form, [key]: e.target.value })

  // -------- submit --------
  const handleGenerate = async (e) => {
    e.preventDefault()
    if (!canSubmit || !profile?.company_id) return

    setStage('loading')
    setError(null)
    setCapError(null)
    try {
      // Pull the same BUSINESS_CONTEXT the advisor sees — so the scorecard is
      // specific to this business, not a generic template.
      const context = await buildAdvisorContext(profile.company_id)
      setContextSummary(summarizeContext(context))
      const promptKey     = 'HIRING_SCORECARD_PROMPT'
      const stableContext = `\n\nBUSINESS_CONTEXT:\n${JSON.stringify(context, null, 2)}`

      // User message is the owner's brief. Keep it as structured JSON so the
      // model doesn't have to guess which string is which field.
      const userMessage = JSON.stringify({
        role_title:      form.role_title.trim(),
        why_now:         form.why_now.trim(),
        success_picture: form.success_picture.trim() || null,
        team_context:    form.team_context.trim() || null,
        budget:          form.budget.trim() || null,
        target_start:    form.target_start || null,
      })

      const raw = await runToolCall({
        companyId: profile.company_id,
        userId:    profile.id,
        toolId:    'hiring-scorecard',
        kind:      'generate',
        model:     HAIKU,
        promptKey,
        stableContext,
        messages:   [{ role: 'user', content: userMessage }],
        maxTokens:  2000,
        json:       true,
      })

      const parsed = JSON.parse(raw)
      setResult(parsed)
      // Seed the chat with an opener so the panel doesn't look empty. The
      // owner can either hit save or start a conversation to tweak the card.
      setMessages([{
        role: 'assistant',
        content: "Here's the first pass. Want to tweak anything? Just tell me what to change: outcomes, questions, tone, anything.",
      }])
      setStage('result')
    } catch (err) {
      console.error('[hiring] generate failed', err)
      if (isCapExceeded(err)) {
        setCapError(err)
      } else {
        setError(err.message || 'Something went wrong generating the scorecard.')
      }
      setStage('form')
    }
  }

  // -------- refine (chat) --------
  /**
   * User typed a change request in the chat panel. We send Claude:
   *   - the same business context
   *   - the current scorecard (so it can diff, not rewrite)
   *   - the chat history (so multi-turn context works: "make them shorter"
   *     after a prior "add numbers" keeps both concerns in mind)
   *   - the owner's new request
   *
   * Response shape is { scorecard, change_note }. The scorecard replaces
   * `result`, the change_note is shown as the assistant's reply.
   */
  const handleRefine = async (userText) => {
    const text = userText.trim()
    if (!text || refining || !result) return

    // Optimistically add the user's message and a typing placeholder so the
    // UI feels responsive. We'll replace the placeholder with the real reply.
    const userTurn = { role: 'user', content: text }
    setMessages(prev => [...prev, userTurn])
    setRefining(true)
    setError(null)

    try {
      const context = await buildAdvisorContext(profile.company_id)
      const promptKey     = 'HIRING_REFINE_PROMPT'
      const stableContext = `\n\nBUSINESS_CONTEXT:\n${JSON.stringify(context, null, 2)}`

      const userPayload = JSON.stringify({
        original_brief:     form,
        current_scorecard:  result,
        conversation:       [...messages, userTurn].map(m => ({
          role:    m.role,
          content: m.content,
        })),
        request:            text,
      })

      const raw = await runToolCall({
        companyId: profile.company_id,
        userId:    profile.id,
        toolId:    'hiring-scorecard',
        kind:      'refine',
        model:     HAIKU,
        promptKey,
        stableContext,
        messages:   [{ role: 'user', content: userPayload }],
        maxTokens:  2000,
        json:       true,
      })

      const parsed = JSON.parse(raw)
      if (parsed?.scorecard) setResult(parsed.scorecard)

      setMessages(prev => [
        ...prev,
        {
          role:    'assistant',
          content: parsed?.change_note || 'Updated.',
        },
      ])
    } catch (err) {
      console.error('[hiring] refine failed', err)
      // Cap-exceeded gets a specific message so the owner knows *why* refine
      // suddenly stopped working mid-session. Generic errors keep the existing
      // "rephrase or start over" copy.
      const content = isCapExceeded(err)
        ? `You've hit your monthly cap for this tool (${err.used}/${err.cap} runs). Resets on the 1st of next month.`
        : "Hmm, I couldn't apply that. Try rephrasing, or hit Start over to rebuild from scratch."
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content, error: true },
      ])
    } finally {
      setRefining(false)
    }
  }

  // -------- save --------
  const handleSave = async () => {
    if (!result || !profile?.company_id) return
    setStage('saving')
    try {
      const title = buildTitle(form.role_title)
      const { error: insertErr } = await supabase.from('documents').insert({
        company_id:  profile.company_id,
        user_id:     profile.id,
        tool_id:     'hiring-scorecard',
        title,
        tags:        [],
        // Persist context_summary alongside the form so reopening from the
        // library still shows what fed the result.
        input_data:  { ...form, context_summary: contextSummary },
        output_data: result,
      })
      if (insertErr) throw insertErr
      navigate('/documents?tool=hiring-scorecard')
    } catch (err) {
      console.error('[hiring] save failed', err)
      setError(err.message || 'Could not save to your library.')
      setStage('result')
    }
  }

  // -------- reset --------
  const handleStartOver = () => {
    setForm(INITIAL_FORM)
    setResult(null)
    clearToolDraft('hiring', profile?.company_id)
    setMessages([])
    setError(null)
    setStage('form')
  }

  // ============================================================== views

  if (stage === 'loading') {
    return <LoadingView role={form.role_title} />
  }

  if (stage === 'result' || stage === 'saving') {
    return (
      <ResultView
        form={form}
        result={result}
        saving={stage === 'saving'}
        error={error}
        capError={capError}
        messages={messages}
        refining={refining}
        contextSummary={contextSummary}
        onSave={handleSave}
        onStartOver={handleStartOver}
        onRefine={handleRefine}
      />
    )
  }

  return (
    <FormView
      form={form}
      canSubmit={canSubmit}
      error={error}
      capError={capError}
      onChange={updateField}
      onSubmit={handleGenerate}
    />
  )
}

// ============================================================== subviews

function FormView({ form, canSubmit, error, capError, onChange, onSubmit }) {
  return (
    <div className="min-h-screen bg-ink-50">
      <div className="bg-white border-b border-ink-100">
        <div className="max-w-5xl mx-auto px-8 py-5">
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] mb-0.5 text-brand-700">
            🎯 Hiring Planner
          </div>
          <h1 className="text-xl font-bold text-ink-900 leading-tight">
            Hire the right person
          </h1>
          <p className="text-xs text-ink-500 mt-0.5">
            Whether to hire at all, what the role really is, and what to look for in the person.
          </p>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-8 py-6 space-y-5">
        {capError && <CapExceededNotice err={capError} toolLabel="Hiring Planner" />}
        {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}

        <form onSubmit={onSubmit} className="bg-white border border-ink-100 rounded-xl shadow-sm p-6 space-y-5">

          <Field required label="What role are you hiring for?" hint={`e.g. "Lead Plumber", "HVAC Technician", "Dispatcher", "Service Manager", "Estimator"`}>
            <input type="text" value={form.role_title} onChange={onChange('role_title')} placeholder="Lead Plumber" autoFocus />
          </Field>

          <Field required label="Why are you hiring this role now?" hint="What gap or bottleneck does this hire solve? 1–2 sentences.">
            <textarea value={form.why_now} onChange={onChange('why_now')}
              placeholder="I'm running every service call myself. I can't grow past $800k until I have a qualified tech who can run a van solo without me on the phone."
              rows={3} className="w-full" />
          </Field>

          <Field label="What does success look like 12 months in?" hint="Optional but recommended, specific outcomes sharpen the scorecard.">
            <textarea value={form.success_picture} onChange={onChange('success_picture')}
              placeholder="Two vans running independently. Revenue per tech above $300k. Call-back rate under 5%. I'm off the tools."
              rows={3} className="w-full" />
          </Field>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <Field label="Team context" hint="Who do they work alongside? Who reports to them (if anyone)?">
              <input type="text" value={form.team_context} onChange={onChange('team_context')}
                placeholder="Reports to me. Works alongside 1 licensed plumber and 1 apprentice. Will eventually lead the apprentice." />
            </Field>
            <Field label="Budget or pay range" hint="Optional. Used for a sanity-check against market rates.">
              <input type="text" value={form.budget} onChange={onChange('budget')} placeholder="$35/hr + truck + tools, or $90k salary + bonus" />
            </Field>
          </div>

          <Field label="Target start date" hint="When would you ideally have them in the seat?">
            <input type="date" max="9999-12-31" value={form.target_start} onChange={onChange('target_start')} className="max-w-xs" />
          </Field>

          <div className="flex items-center gap-3 pt-1">
            <button type="submit" disabled={!canSubmit}
              className="px-5 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors">
              Build the scorecard →
            </button>
            <Link to="/tools" className="text-sm text-ink-400 hover:text-ink-600">Cancel</Link>
          </div>
        </form>

        <p className="text-xs text-ink-400 text-center pb-4">
          We send your answers + your business profile to Solomon. The scorecard isn't saved until you hit "Save to library".
        </p>
      </div>
    </div>
  )
}

function Field({ label, hint, required, children }) {
  return (
    <label className="block">
      <div className="mb-1">
        <span className="text-sm font-medium text-ink-800">
          {label}{required && <span className="text-red-500 ml-0.5">*</span>}
        </span>
      </div>
      {children}
      {hint && <p className="text-xs text-ink-400 mt-1">{hint}</p>}
    </label>
  )
}

const HIRING_STEPS = [
  {
    label: 'Reading your business context',
    sub:   'Pulling your team size, revenue stage, and roadmap',
    delay: 0,
  },
  {
    label: 'Scoping the role',
    sub:   'Field tech, office, or leadership, tailoring accordingly',
    delay: 4000,
  },
  {
    label: 'Setting the 12-month outcomes',
    sub:   'Specific, measurable results anchored to your numbers',
    delay: 10000,
  },
  {
    label: 'Writing the interview questions',
    sub:   'Behavioural questions that surface the real candidate',
    delay: 16000,
  },
  {
    label: 'Flagging the red flags',
    sub:   'Deal-breakers specific to trades and service businesses',
    delay: 22000,
  },
  {
    label: 'Building your 30/60/90 ramp',
    sub:   'What good looks like at each milestone',
    delay: 28000,
  },
]

function LoadingView({ role }) {
  const [activeStep, setActiveStep] = useState(0)

  useEffect(() => {
    const timers = HIRING_STEPS.slice(1).map((step, i) =>
      setTimeout(() => setActiveStep(i + 1), step.delay)
    )
    return () => timers.forEach(clearTimeout)
  }, [])

  return (
    <div className="min-h-screen bg-ink-900 flex flex-col items-center justify-center px-6">

      {/* Header */}
      <div className="mb-10 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-brand-500/10 border border-brand-500/20 text-brand-400 text-[11px] font-semibold tracking-widest uppercase mb-5">
          <span className="w-1.5 h-1.5 rounded-full bg-brand-400 animate-pulse" />
          Hiring Planner
        </div>
        <h2 className="text-2xl font-bold text-white tracking-tight">
          {role || 'Your next hire'}
        </h2>
        <p className="text-sm text-ink-500 mt-1.5">Usually 15 to 25 seconds</p>
      </div>

      {/* Step list */}
      <div className="w-full max-w-xs space-y-1">
        {HIRING_STEPS.map((step, i) => {
          const isDone   = i < activeStep
          const isActive = i === activeStep

          return (
            <div
              key={i}
              className={`flex items-start gap-3 px-4 py-3 rounded-xl transition-all duration-700 ${
                isActive  ? 'bg-brand-500/10 border border-brand-500/25 shadow-[0_0_20px_rgba(245,158,11,0.08)]' :
                isDone    ? 'bg-white/[0.03]' :
                            'opacity-25'
              }`}
            >
              <div className="flex-shrink-0 w-5 h-5 mt-0.5 flex items-center justify-center">
                {isDone ? (
                  <span className="text-[13px] font-bold text-green-400">✓</span>
                ) : isActive ? (
                  <span className="inline-block w-2 h-2 rounded-full bg-brand-400 animate-pulse" />
                ) : (
                  <span className="inline-block w-2 h-2 rounded-full bg-ink-700" />
                )}
              </div>

              <div className="min-w-0">
                <p className={`text-sm font-semibold leading-snug transition-colors duration-500 ${
                  isDone   ? 'text-ink-500' :
                  isActive ? 'text-white'   :
                             'text-ink-600'
                }`}>
                  {step.label}
                </p>
                {isActive && (
                  <p className="text-xs text-ink-500 mt-0.5 leading-snug">
                    {step.sub}
                  </p>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <p className="mt-10 text-xs text-ink-700 text-center max-w-xs leading-relaxed">
        Built for trades and home-service businesses: outcomes, questions, and red flags that actually apply to your team.
      </p>
    </div>
  )
}

function ResultView({ form, result, saving, error, capError, messages, refining, contextSummary, onSave, onStartOver, onRefine }) {
  return (
    <div className="min-h-screen bg-ink-50">
      <div className="bg-white border-b border-ink-100">
        <div className="max-w-5xl mx-auto px-8 py-5 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] mb-0.5 text-brand-700">🎯 Hiring Planner · Scorecard</div>
            <h1 className="text-xl font-bold text-ink-900 leading-tight">{form.role_title}</h1>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-8 py-6 space-y-5">
        {capError && <CapExceededNotice err={capError} toolLabel="Hiring Planner" />}
        {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}

        <ContextUsedLine summary={contextSummary} />

        <div className="bg-white border border-ink-100 rounded-xl shadow-sm p-5 md:p-6 relative">
          {refining && (
            <div className="absolute top-3 right-4 inline-flex items-center gap-1.5 text-xs text-brand-700 bg-brand-50 border border-brand-200 px-2 py-1 rounded-full z-10">
              <span className="w-1.5 h-1.5 rounded-full bg-brand-600 animate-pulse" />Updating…
            </div>
          )}
          <HiringScorecard data={result} />
        </div>

        <RefineChat messages={messages} refining={refining} onSend={onRefine}
          suggestions={HIRING_SUGGESTIONS}
          placeholder="Make the outcomes more specific to my trade. / This is a field role, remove anything office-related." />

        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={onSave} disabled={saving || refining}
            className="px-5 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white text-sm font-semibold transition-colors">
            {saving ? 'Saving…' : 'Save to library'}
          </button>
          <button type="button" onClick={onStartOver} disabled={saving || refining}
            className="px-4 py-2.5 rounded-xl border border-ink-200 hover:bg-ink-50 text-sm text-ink-700 font-medium transition-colors">
            Start over
          </button>
          <span className="text-xs text-ink-400 ml-auto">
            Saved scorecards appear in <Link to="/documents" className="underline hover:text-ink-700">Documents</Link>.
          </span>
        </div>
      </div>
    </div>
  )
}

const HIRING_SUGGESTIONS = [
  'Make the outcomes more specific to my trade',
  'This is a field role, remove anything office-related',
  'Punch up the interview questions',
  'The pay range is off for my market, rework it',
  'Add a note about the truck and tool package',
  'Tie the 90-day ramp to my roadmap milestone',
]

// ============================================================== helpers

/**
 * "Service Manager · Apr 2026" — friendly row label in the Documents library.
 * Keeping the date in the title means the library reads chronologically even
 * when the owner reruns the tool for the same role.
 */
function buildTitle(roleTitle) {
  const when = new Date().toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
  const role = (roleTitle || 'Role').trim()
  return `${role} · ${when}`
}
