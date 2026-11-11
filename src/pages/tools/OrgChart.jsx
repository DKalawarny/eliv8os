import { useState, useEffect } from 'react'
import { useToolDraft, clearToolDraft, readToolDraft } from '../../hooks/useToolDraft'
import { useNavigate, Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { runToolCall, SONNET } from '../../lib/anthropic'
import { isCapExceeded } from '../../lib/usage'
import { buildAdvisorContext } from '../../lib/advisorContext'
import { summarizeContext } from '../../lib/toolContextSummary'
import OrgChartView from '../../components/tools/OrgChartView'
import CapExceededNotice from '../../components/tools/CapExceededNotice'
import RefineChat from '../../components/tools/RefineChat'
import ContextUsedLine from '../../components/tools/ContextUsedLine'

/**
 * Org Chart — /tools/org-chart
 *
 * Flow (same shape as Hiring / Exit / Offer):
 *   1. 'form'     owner describes today's team + horizon + goal
 *   2. 'loading'  Claude generates target org + hiring sequence + owner shift
 *   3. 'result'   rendered; owner can refine via chat
 *   4. 'saving'   insert into `documents` with tool_id = 'org-chart'
 *
 * Why this tool matters:
 *   Hiring Planner answers "what should I look for in this one person?" —
 *   Org Chart answers "what seats need filling, in what order, and what
 *   does MY job become?". Most owners can't draw their own target org
 *   without falling into the trap of "today's team + 1". This pushes them
 *   toward the team they'll actually need.
 *
 * Form design:
 *   Required: horizon + today's team description.
 *   Optional: goal alignment, constraints (budget / remote), pain points.
 *   Goal is often implicit in BUSINESS_CONTEXT (their primary roadmap
 *   goal) so we don't force them to retype it.
 */

const INITIAL_FORM = {
  horizon:          '24 months',
  current_team:     '',   // prose: who's on the team today + rough comp / responsibilities
  goal:             '',   // optional — what do you want to be true at the horizon?
  constraints:      '',   // optional — budget ceilings, remote-friendly, geography, etc.
  pain_points:      '',   // optional — "what breaks first when we grow"
  role_in_horizon:  '',   // optional — what the OWNER wants to be doing at horizon
}

export default function OrgChart() {
  const { profile }          = useAuth()
  const navigate             = useNavigate()
  const [stage, setStage]    = useState('form')
  const [form, setForm]      = useState(INITIAL_FORM)
  const [result, setResult]  = useState(null)
  const [messages, setMsgs]  = useState([])
  const [refining, setRefining] = useState(false)
  const [error, setError]    = useState(null)
  const [capError, setCapError] = useState(null)
  const [contextSummary, setContextSummary] = useState(null)

  // ⭐ Keep the last read on the page across navigation (useToolDraft).
  // Show the latest saved result on open (like the CFO page), so a returning
  // owner, and the demo, sees what this tool produced rather than a blank form.
  // A local draft (unsaved in-progress work) still takes precedence.
  useEffect(() => {
    if (!profile?.company_id) return
    if (readToolDraft('org-chart', profile.company_id)?.result) return
    let cancelled = false
    supabase
      .from('documents')
      .select('output_data')
      .eq('company_id', profile.company_id)
      .eq('tool_id', 'org-chart')
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
    toolId: 'org-chart',
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

  const canSubmit = form.horizon.trim() && form.current_team.trim()
  const updateField = (key) => (e) => setForm({ ...form, [key]: e.target.value })

  // -------- submit --------
  const handleGenerate = async (e) => {
    e.preventDefault()
    if (!canSubmit || !profile?.company_id) return

    setStage('loading')
    setError(null)
    setCapError(null)
    try {
      const context = await buildAdvisorContext(profile.company_id)
      setContextSummary(summarizeContext(context))
      const promptKey     = 'ORG_CHART_PROMPT'
      const stableContext = `\n\nBUSINESS_CONTEXT:\n${JSON.stringify(context, null, 2)}`

      const userMessage = JSON.stringify({
        horizon:         form.horizon.trim(),
        current_team:    form.current_team.trim(),
        goal:            form.goal.trim() || null,
        constraints:     form.constraints.trim() || null,
        pain_points:     form.pain_points.trim() || null,
        role_in_horizon: form.role_in_horizon.trim() || null,
      })

      // 4–10 roles × deep structure + hiring sequence + owner transition +
      // risks adds up. 3500 tokens is the comfortable ceiling here.
      const raw = await runToolCall({
        model:     SONNET,
        companyId: profile.company_id,
        userId:    profile.id,
        toolId:    'org-chart',
        kind:      'generate',
        promptKey,
        stableContext,
        messages:  [{ role: 'user', content: userMessage }],
        maxTokens: 3500,
        json:      true,
      })

      const parsed = JSON.parse(raw)
      setResult(parsed)
      setMsgs([{
        role:    'assistant',
        content: "Here is the team this plan builds. Move hires around, drop roles you cannot afford, or tell me your own job is wrong. This is a first draft.",
      }])
      setStage('result')
    } catch (err) {
      console.error('[org-chart] generate failed', err)
      if (isCapExceeded(err)) {
        setCapError(err)
      } else {
        setError(err.message || 'Something went wrong building the chart.')
      }
      setStage('form')
    }
  }

  // -------- refine --------
  const handleRefine = async (userText) => {
    const text = userText.trim()
    if (!text || refining || !result) return

    const userTurn = { role: 'user', content: text }
    setMsgs(prev => [...prev, userTurn])
    setRefining(true)
    setError(null)

    try {
      const context = await buildAdvisorContext(profile.company_id)
      const promptKey     = 'ORG_CHART_REFINE_PROMPT'
      const stableContext = `\n\nBUSINESS_CONTEXT:\n${JSON.stringify(context, null, 2)}`

      const userPayload = JSON.stringify({
        original_brief: form,
        current_chart:  result,
        conversation:   [...messages, userTurn].map(m => ({
          role: m.role, content: m.content,
        })),
        request: text,
      })

      const raw = await runToolCall({
        model:     SONNET,
        companyId: profile.company_id,
        userId:    profile.id,
        toolId:    'org-chart',
        kind:      'refine',
        promptKey,
        stableContext,
        messages:  [{ role: 'user', content: userPayload }],
        maxTokens: 3500,
        json:      true,
      })

      const parsed = JSON.parse(raw)
      if (parsed?.chart) setResult(parsed.chart)

      setMsgs(prev => [
        ...prev,
        { role: 'assistant', content: parsed?.change_note || 'Updated.' },
      ])
    } catch (err) {
      console.error('[org-chart] refine failed', err)
      const content = isCapExceeded(err)
        ? `You've hit your monthly cap for this tool (${err.used}/${err.cap} runs). Resets on the 1st of next month.`
        : "Hmm, I couldn't apply that. Try rephrasing, or hit Start over to rebuild from scratch."
      setMsgs(prev => [
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
      const title = buildTitle(result)
      const { error: insertErr } = await supabase.from('documents').insert({
        company_id:  profile.company_id,
        user_id:     profile.id,
        tool_id:     'org-chart',
        title,
        tags:        [],
        input_data:  { ...form, context_summary: contextSummary },
        output_data: result,
      })
      if (insertErr) throw insertErr
      navigate('/documents?tool=org-chart')
    } catch (err) {
      console.error('[org-chart] save failed', err)
      setError(err.message || 'Could not save to your library.')
      setStage('result')
    }
  }

  const handleStartOver = () => {
    setForm(INITIAL_FORM)
    setResult(null)
    clearToolDraft('org-chart', profile?.company_id)
    setMsgs([])
    setError(null)
    setStage('form')
  }

  // ============================================================== views

  if (stage === 'loading') return <LoadingView horizon={form.horizon} />

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
            🧩 Org Chart
          </div>
          <h1 className="text-xl font-bold text-ink-900 leading-tight">
            Design the team you need next year, not the team you have today
          </h1>
          <p className="text-xs text-ink-500 mt-0.5">
            Hiring sequence, owner transition, and the seats that matter most.
          </p>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-8 py-6 space-y-5">
        {capError && <CapExceededNotice err={capError} toolLabel="Org Chart" />}
        {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}

        <form onSubmit={onSubmit} className="bg-white border border-ink-100 rounded-xl shadow-sm p-6 space-y-5">

          <Field required label="Planning horizon" hint="How far out are we designing for?">
            <input type="text" value={form.horizon} onChange={onChange('horizon')} placeholder="24 months" />
          </Field>

          <Field required label="Who's on the team today?" hint="Describe everyone: roles, rough comp, what they actually do. The more detail, the better the plan.">
            <textarea value={form.current_team} onChange={onChange('current_team')}
              placeholder="Me (owner/operator, HVAC tech + all sales + admin). 2 licensed techs at $35/hr. 1 part-time bookkeeper 10hrs/week."
              rows={4} className="w-full" />
          </Field>

          <Field label="What should be true at your horizon?" hint="Optional, what do you want to have built by then? Solomon will read your roadmap too.">
            <textarea value={form.goal} onChange={onChange('goal')}
              placeholder="Off the tools. Operations running without me. Enough of a team to handle a 30% revenue increase."
              rows={2} className="w-full" />
          </Field>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <Field label="Constraints" hint="Budget ceilings, remote, geography, anything that limits your options.">
              <textarea value={form.constraints} onChange={onChange('constraints')}
                placeholder="Can't spend more than $20k/mo on new payroll this year. Needs to be local, field work." rows={3} className="w-full" />
            </Field>
            <Field label="What breaks first when you grow?" hint="The bottleneck that will snap before anything else.">
              <textarea value={form.pain_points} onChange={onChange('pain_points')}
                placeholder="Dispatch and scheduling. I'm the only one who knows which tech goes where." rows={3} className="w-full" />
            </Field>
          </div>

          <Field label="What do YOU want to be doing at the horizon?" hint="Optional, shapes the owner transition plan.">
            <input type="text" value={form.role_in_horizon} onChange={onChange('role_in_horizon')}
              placeholder="Sales, key accounts, and strategy. Not service calls." />
          </Field>

          <div className="flex items-center gap-3 pt-1">
            <button type="submit" disabled={!canSubmit}
              className="px-5 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors">
              Build the org chart →
            </button>
            <Link to="/tools" className="text-sm text-ink-400 hover:text-ink-600">Cancel</Link>
          </div>
        </form>

        <p className="text-xs text-ink-400 text-center pb-4">
          We send your team description + business profile to Solomon. The chart isn't saved until you hit "Save to library".
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

const ORG_STEPS = [
  { label: 'Reading your current team',     sub: 'Mapping who does what and where the gaps are', delay: 0 },
  { label: 'Analysing your horizon',        sub: 'What this business needs to look like in your timeframe', delay: 4000 },
  { label: 'Designing the target structure',sub: 'Roles, reporting lines, and responsibilities', delay: 10000 },
  { label: 'Sequencing the hires',          sub: 'Who to bring on first, second, and why', delay: 17000 },
  { label: 'Planning the owner transition', sub: 'How your role changes as the team grows', delay: 23000 },
  { label: 'Building your hiring roadmap',  sub: 'The path from the team you have to the team you need', delay: 29000 },
]

function LoadingView({ horizon }) {
  const [activeStep, setActiveStep] = useState(0)
  useEffect(() => {
    const timers = ORG_STEPS.slice(1).map((s, i) => setTimeout(() => setActiveStep(i + 1), s.delay))
    return () => timers.forEach(clearTimeout)
  }, [])

  return (
    <div className="min-h-screen bg-ink-900 flex flex-col items-center justify-center px-6">
      <div className="mb-10 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-brand-500/10 border border-brand-500/20 text-brand-400 text-[11px] font-semibold tracking-widest uppercase mb-5">
          <span className="w-1.5 h-1.5 rounded-full bg-brand-400 animate-pulse" />
          Org Chart
        </div>
        <h2 className="text-2xl font-bold text-white tracking-tight">{horizon ? `Your team in ${horizon}` : 'The team you need next'}</h2>
        <p className="text-sm text-ink-500 mt-1.5">Usually 45 to 90 seconds</p>
      </div>
      <div className="w-full max-w-xs space-y-1">
        {ORG_STEPS.map((step, i) => {
          const isDone = i < activeStep, isActive = i === activeStep
          return (
            <div key={i} className={`flex items-start gap-3 px-4 py-3 rounded-xl transition-all duration-700 ${isActive ? 'bg-brand-500/10 border border-brand-500/25 shadow-[0_0_20px_rgba(245,158,11,0.08)]' : isDone ? 'bg-white/[0.03]' : 'opacity-25'}`}>
              <div className="flex-shrink-0 w-5 h-5 mt-0.5 flex items-center justify-center">
                {isDone ? <span className="text-[13px] font-bold text-green-400">✓</span>
                  : isActive ? <span className="inline-block w-2 h-2 rounded-full bg-brand-400 animate-pulse" />
                  : <span className="inline-block w-2 h-2 rounded-full bg-ink-700" />}
              </div>
              <div className="min-w-0">
                <p className={`text-sm font-semibold leading-snug transition-colors duration-500 ${isDone ? 'text-ink-500' : isActive ? 'text-white' : 'text-ink-600'}`}>{step.label}</p>
                {isActive && <p className="text-xs text-ink-500 mt-0.5 leading-snug">{step.sub}</p>}
              </div>
            </div>
          )
        })}
      </div>
      <p className="mt-10 text-xs text-ink-700 text-center max-w-xs leading-relaxed">
        Roles, sequence, and owner transition, built for where you're going, not where you are.
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
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] mb-0.5 text-brand-700">🧩 Org Chart</div>
            <h1 className="text-xl font-bold text-ink-900 leading-tight">The team you are building{result?.horizon_label ? ` · ${String(result.horizon_label).toLowerCase()}` : ''}</h1>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-8 py-6 space-y-5">
        {capError && <CapExceededNotice err={capError} toolLabel="Org Chart" />}
        {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}

        <ContextUsedLine summary={contextSummary} />

        <div className="bg-white border border-ink-100 rounded-xl shadow-sm p-5 md:p-6 relative">
          {refining && (
            <div className="absolute top-3 right-4 inline-flex items-center gap-1.5 text-xs text-brand-700 bg-brand-50 border border-brand-200 px-2 py-1 rounded-full z-10">
              <span className="w-1.5 h-1.5 rounded-full bg-brand-600 animate-pulse" />Updating…
            </div>
          )}
          <OrgChartView data={result} />
        </div>

        <RefineChat messages={messages} refining={refining} onSend={onRefine}
          suggestions={ORG_SUGGESTIONS}
          placeholder="Push the Service Manager hire to month 3. / I can't afford a full-time dispatcher. Use part-time. / Change the owner role to pure sales." />

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
            Saved charts appear in <Link to="/documents" className="underline hover:text-ink-700">Documents</Link>.
          </span>
        </div>
      </div>
    </div>
  )
}

const ORG_SUGGESTIONS = [
  'Push the GM hire to year 2',
  'Make the CFO role fractional',
  'I\'m not stepping off sales, rework around that',
  'We can\'t afford a full exec team, simplify',
  'Add an apprentice under the field supervisor',
]

// ============================================================== helpers

/**
 * "Org Chart · 24 months · Apr 2026" — date keeps the library chronological
 * when the owner iterates. Horizon in the title lets them scan at a glance.
 */
function buildTitle(result) {
  const when    = new Date().toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
  const horizon = result?.horizon_label ? ` · ${result.horizon_label}` : ''
  return `Org Chart${horizon} · ${when}`
}
