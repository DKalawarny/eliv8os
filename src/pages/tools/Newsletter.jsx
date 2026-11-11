import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { runToolCall, HAIKU } from '../../lib/anthropic'
import { isCapExceeded } from '../../lib/usage'
import { classifyAll, todayYmd } from '../../lib/milestoneProgress'
import CapExceededNotice from '../../components/tools/CapExceededNotice'
import ToolDisclaimer from '../../components/tools/ToolDisclaimer'
import ContextUsedLine from '../../components/tools/ContextUsedLine'
import { summarizeContext } from '../../lib/toolContextSummary'
import { useToolDraft, readToolDraft } from '../../hooks/useToolDraft'

/**
 * Team Newsletter — /tools/newsletter
 *
 * Generates a monthly team-facing update from roadmap progress and check-in
 * wins. No financial details — just what was built, what's in progress, what's
 * coming up, and a personal note from the owner.
 *
 * Flow:  form → loading → result (editable inline before copying / saving)
 */

const TONE_OPTIONS = [
  { value: 'warm',         label: 'Warm & personal',     hint: 'Like a note from a founder who cares.' },
  { value: 'energetic',    label: 'Energetic & bold',    hint: 'High energy, celebrating wins loudly.' },
  { value: 'professional', label: 'Clean & professional', hint: 'Polished, straight to the point.' },
]

const CURRENT_MONTH = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

export default function Newsletter() {
  const { profile, company } = useAuth()
  const navigate = useNavigate()

  const [stage,    setStage]    = useState('form')
  const [period,   setPeriod]   = useState(CURRENT_MONTH)
  const [tone,     setTone]     = useState('warm')
  const [note,     setNote]     = useState('')
  const [result,   setResult]   = useState(null)
  const [copied,   setCopied]   = useState(false)
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState(null)
  const [capError, setCapError] = useState(null)
  // Snapshot of inputs the newsletter saw at generation time. Persisted on
  // the saved document so reopening from the library still shows what fed it.
  const [contextSummary, setContextSummary] = useState(null)

  // ⭐ Keep the last newsletter (incl. your edits) on the page across navigation.
  // Show the latest saved result on open (like CFO), so a returning owner and
  // the demo see a filled example instead of a blank form. Local draft wins.
  useEffect(() => {
    if (!profile?.company_id) return
    if (readToolDraft('newsletter', profile.company_id)?.result) return
    let cancelled = false
    supabase
      .from('documents')
      .select('output_data')
      .eq('company_id', profile.company_id)
      .eq('tool_id', 'team-newsletter')
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
    toolId: 'newsletter',
    companyId: profile?.company_id,
    result,
    payload: { period, tone, note, contextSummary },
    onRestore: (d) => {
      setResult(d.result)
      if (d.period) setPeriod(d.period)
      if (d.tone) setTone(d.tone)
      if (d.note != null) setNote(d.note)
      if (d.contextSummary != null) setContextSummary(d.contextSummary)
      setStage('result')
    },
  })

  const [milestones, setMilestones] = useState([])
  const [checkins,   setCheckins]   = useState([])
  const [dataLoaded, setDataLoaded] = useState(false)

  useEffect(() => {
    if (!profile?.company_id) return
    let cancelled = false
    ;(async () => {
      const [msRes, ciRes] = await Promise.all([
        supabase
          .from('milestones')
          .select('id, title, completed, completed_date, progress_percent, end_date')
          .eq('company_id', profile.company_id)
          .order('sort_order', { ascending: true }),
        supabase
          .from('checkins')
          .select('win, created_at')
          .eq('company_id', profile.company_id)
          .not('win', 'is', null)
          .order('created_at', { ascending: false })
          .limit(10),
      ])
      if (cancelled) return
      setMilestones(msRes.data ?? [])
      setCheckins(ciRes.data ?? [])
      setDataLoaded(true)
    })()
    return () => { cancelled = true }
  }, [profile?.company_id])

  // Milestone buckets
  const statusById = classifyAll(milestones, todayYmd())

  const recentlyCompleted = milestones
    .filter(m => m.completed && m.completed_date)
    .sort((a, b) => new Date(b.completed_date) - new Date(a.completed_date))
    .slice(0, 5)

  const inProgress = milestones
    .filter(m => !m.completed && statusById.get(m.id) === 'in-progress')
    .slice(0, 4)

  const comingUp = milestones
    .filter(m => !m.completed && statusById.get(m.id) === 'ready')
    .slice(0, 3)

  const recentWins = checkins
    .filter(c => c.win?.trim())
    .slice(0, 6)
    .map(c => c.win.trim())

  // ── Inline edit helpers ──────────────────────────────────────────────────────
  function updateField(field, value) {
    setResult(prev => ({ ...prev, [field]: value }))
  }
  function updateSection(i, field, value) {
    setResult(prev => ({
      ...prev,
      sections: prev.sections.map((s, idx) => idx === i ? { ...s, [field]: value } : s),
    }))
  }

  // A section of your own (Daniel, 10 Oct: "there should be an area that you
  // can add another section of info that might be different"). Lives in the same
  // list as the drafted ones, so copying and saving carry it with no extra work.
  function addSection() {
    setResult(prev => ({ ...prev, sections: [...(prev.sections ?? []), { heading: '', body: '', custom: true }] }))
  }
  function removeSection(i) {
    setResult(prev => ({ ...prev, sections: prev.sections.filter((_, idx) => idx !== i) }))
  }

  // ── Generate ─────────────────────────────────────────────────────────────────
  async function handleGenerate(e) {
    e?.preventDefault()
    if (!profile?.company_id) return
    setStage('loading')
    setError(null)
    setCapError(null)
    setContextSummary(summarizeContext({
      business: company?.name ? { name: company.name } : null,
      roadmap:  { total: milestones.length },
    }))

    try {
      const toneDesc = tone === 'warm'
        ? 'warm and personal, like a note from a founder who genuinely cares about the team'
        : tone === 'energetic'
        ? 'high-energy and celebratory, making wins feel like a big deal'
        : 'clean and professional, direct and clear'

      const systemPrompt = `You are writing a monthly team newsletter for a small business. Write a genuinely engaging update that keeps field staff, admin, and contractors feeling informed and part of something.

RULES:
- Never include specific revenue numbers, profit margins, or financial figures
- You CAN say "business is growing" or "we're taking on more work" — nothing precise
- Focus on what was BUILT, what we're WORKING ON, and what's NEXT
- Tone: ${toneDesc}
- Length: 200–350 words for the full body. People read this on their phones
- Short paragraphs only. No bullet point walls
- Refer to the team as "the team" or "we/us" — never "staff" or "employees"
- This is from the business owner, NOT from Claude
- End with something that makes people feel good about showing up tomorrow

Return JSON only:
{
  "subject": "one punchy subject line",
  "sections": [
    { "heading": "section heading", "body": "paragraph text" }
  ],
  "sign_off": "closing line, e.g. See you out there, — Daniel"
}`

      const raw = await runToolCall({
        companyId:    profile.company_id,
        userId:       profile.id,
        toolId:       'team-newsletter',
        kind:         'generate',
        model:        HAIKU,
        systemPrompt,
        messages: [{
          role: 'user',
          content: JSON.stringify({
            company_name:       company?.name ?? 'the company',
            period:             period.trim(),
            recently_completed: recentlyCompleted.map(m => m.title),
            in_progress:        inProgress.map(m => ({ title: m.title, pct: m.progress_percent ?? 0 })),
            coming_up:          comingUp.map(m => m.title),
            recent_wins:        recentWins,
            personal_note:      note.trim() || null,
            owner_name:         profile?.name?.split(' ')[0] ?? null,
          }),
        }],
        maxTokens: 1500,
        json:      true,
      })

      setResult(JSON.parse(raw))
      setStage('result')
    } catch (err) {
      console.error('[newsletter]', err)
      isCapExceeded(err) ? setCapError(err) : setError(err.message || 'Something went wrong.')
      setStage('form')
    }
  }

  // ── Copy ──────────────────────────────────────────────────────────────────────
  function buildPlainText() {
    if (!result) return ''
    return [
      `Subject: ${result.subject ?? ''}`,
      '',
      ...(result.sections ?? []).flatMap(s => [s.heading ?? '', '', s.body ?? '', '']),
      result.sign_off ?? '',
    ].join('\n')
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(buildPlainText())
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch { /* ignore */ }
  }

  // ── Save ──────────────────────────────────────────────────────────────────────
  async function handleSave() {
    if (!result || !profile?.company_id) return
    setSaving(true)
    try {
      const { error: err } = await supabase.from('documents').insert({
        company_id:  profile.company_id,
        user_id:     profile.id,
        tool_id:     'team-newsletter',
        title:       `Team Newsletter, ${period}`,
        tags:        ['newsletter', 'team'],
        input_data:  { period, tone, note, context_summary: contextSummary },
        output_data: result,
      })
      if (err) throw err
      navigate('/documents?tool=team-newsletter')
    } catch (err) {
      setError(err.message || 'Could not save.')
      setSaving(false)
    }
  }

  // ── Loading ───────────────────────────────────────────────────────────────────
  if (stage === 'loading') {
    return <NewsletterLoadingView />
  }

  // ── Result ────────────────────────────────────────────────────────────────────
  if (stage === 'result' && result) {
    return (
      <div className="min-h-screen bg-ink-50">

        {/* Page header */}
        <div className="bg-white border-b border-ink-100">
          <div className="max-w-3xl mx-auto px-4 sm:px-8 py-5 flex items-center justify-between gap-4 flex-wrap">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-brand-700 mb-0.5">
                Team Newsletter
              </div>
              <h1 className="text-lg font-bold text-ink-900 leading-tight">{period}</h1>
              <p className="text-xs text-ink-500 mt-0.5">Click any text to edit before copying.</p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => setStage('form')}
                className="px-3.5 py-2 rounded-lg border border-ink-700 text-xs text-ink-300 hover:bg-ink-800 font-medium transition-colors"
              >
                ← Back
              </button>
              <button
                type="button"
                onClick={handleGenerate}
                className="px-3.5 py-2 rounded-lg border border-ink-700 text-xs text-ink-300 hover:bg-ink-800 font-medium transition-colors"
              >
                Regenerate
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="px-3.5 py-2 rounded-lg border border-ink-700 text-xs text-ink-300 hover:bg-ink-800 font-semibold disabled:opacity-40 transition-colors"
              >
                {saving ? 'Saving…' : 'Save to library'}
              </button>
              <button
                type="button"
                onClick={handleCopy}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
                  copied ? 'bg-green-500 text-white' : 'bg-brand-600 hover:bg-brand-700 text-white'
                }`}
              >
                {copied ? (
                  <>
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth="2.5">
                      <path d="M3 8l3 3 7-7" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    Copied!
                  </>
                ) : (
                  <>
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth="2">
                      <rect x="6" y="1" width="8" height="10" rx="1.5" />
                      <path d="M3 4H2a1 1 0 00-1 1v9a1 1 0 001 1h8a1 1 0 001-1v-1" strokeLinecap="round" />
                    </svg>
                    Copy to clipboard
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        <div className="max-w-3xl mx-auto px-4 sm:px-8 py-6 space-y-4">
          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
          )}

          <ContextUsedLine summary={contextSummary} />

          {/* Editable newsletter card */}
          <div className="bg-white border border-ink-100 rounded-2xl shadow-sm overflow-hidden">

            {/* Subject */}
            <div className="flex items-start gap-3 px-4 sm:px-6 py-3.5 bg-ink-50 border-b border-ink-100">
              <span className="text-[10px] font-bold uppercase tracking-widest text-ink-400 flex-shrink-0">
                Subject
              </span>
              <GrowingTextarea
                value={result.subject ?? ''}
                onChange={e => updateField('subject', e.target.value)}
                className="flex-1 min-w-0 resize-none overflow-hidden bg-transparent text-sm font-semibold text-ink-900 border-0 outline-none ring-0 focus:ring-0 p-0"
                placeholder="Subject line…"
              />
            </div>

            {/* Sections */}
            <div className="divide-y divide-ink-50">
              {(result.sections ?? []).map((s, i) => (
                <div key={i} className="px-4 sm:px-8 py-5 group/sec">
                  <div className="flex items-start gap-3">
                    <GrowingTextarea
                      value={s.heading ?? ''}
                      onChange={e => updateSection(i, 'heading', e.target.value)}
                      className="block flex-1 min-w-0 resize-none overflow-hidden text-[10.5px] font-bold uppercase tracking-widest text-ink-400 border-0 outline-none ring-0 focus:ring-0 bg-transparent p-0 mb-2.5"
                      placeholder={s.custom ? 'Give this section a heading, e.g. Safety reminder' : 'Section heading…'}
                    />
                    <button
                      type="button"
                      onClick={() => removeSection(i)}
                      className="flex-shrink-0 text-[11px] text-ink-300 hover:text-red-600 sm:opacity-0 sm:group-hover/sec:opacity-100 focus:opacity-100 transition-opacity"
                    >
                      Remove section
                    </button>
                  </div>
                  <GrowingTextarea
                    value={s.body ?? ''}
                    onChange={e => updateSection(i, 'body', e.target.value)}
                    className="block w-full overflow-hidden text-sm text-ink-800 leading-relaxed border border-transparent hover:border-ink-200 focus:border-brand-300 focus:ring-1 focus:ring-brand-200 rounded-lg bg-transparent p-2 -mx-2 resize-none transition-colors outline-none"
                    placeholder={s.custom ? 'Write what you want the team to know. A birthday, a new truck, a reminder, a thank you.' : 'Section body…'}
                  />
                </div>
              ))}

              <div className="px-4 sm:px-8 py-4">
                <button
                  type="button"
                  onClick={addSection}
                  className="text-sm font-semibold text-brand-700 hover:text-brand-800"
                >
                  + Add a section of your own
                </button>
                <p className="text-[12px] text-ink-400 mt-0.5">
                  For anything the draft does not cover. It goes out with the rest when you copy or save.
                </p>
              </div>

              {/* Sign off */}
              {result.sign_off !== undefined && (
                <div className="px-4 sm:px-8 py-5 bg-ink-50/50">
                  <textarea
                    value={result.sign_off ?? ''}
                    onChange={e => updateField('sign_off', e.target.value)}
                    rows={2}
                    className="block w-full text-sm text-ink-600 italic border border-transparent hover:border-ink-200 focus:border-brand-300 focus:ring-1 focus:ring-brand-200 rounded-lg bg-transparent p-2 -mx-2 resize-none transition-colors outline-none"
                    placeholder="Sign off…"
                  />
                </div>
              )}
            </div>
          </div>

          <p className="text-xs text-ink-400 text-center pb-4">
            Paste into Mailchimp, Gmail, Slack, wherever your team lives.
          </p>

          <ToolDisclaimer toolId="team-newsletter" />
        </div>
      </div>
    )
  }

  // ── Form ──────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-ink-50">

      {/* Page header */}
      <div className="bg-white border-b border-ink-100">
        <div className="max-w-2xl mx-auto px-8 py-5">
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-brand-700 mb-0.5">
            📰 Team Newsletter
          </div>
          <h1 className="text-xl font-bold text-ink-900 leading-tight">Monthly team update</h1>
          <p className="text-xs text-ink-500 mt-0.5">
            What we built, what we're working on, what's next. No financials.
          </p>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-8 py-6 space-y-5">

        {capError && <CapExceededNotice err={capError} toolLabel="Team Newsletter" />}
        {error    && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

        {/* What Claude will pull in */}
        {dataLoaded && (
          <div className="bg-white border border-ink-100 rounded-xl p-5 shadow-sm">
            <p className="text-[10.5px] font-bold uppercase tracking-widest text-ink-400 mb-3">
              What we'll pull in
            </p>
            <div className="space-y-2.5">
              <DataRow icon="✅" label="Recently completed" items={recentlyCompleted.map(m => m.title)}    empty="No completed milestones yet" />
              <DataRow icon="🔧" label="In progress"        items={inProgress.map(m => m.title)}           empty="No in-progress milestones" />
              <DataRow icon="🔜" label="Coming up"          items={comingUp.map(m => m.title)}             empty="No upcoming milestones" />
              <DataRow icon="🏆" label="Recent wins"        items={recentWins}                             empty="No check-in wins yet" />
            </div>
          </div>
        )}

        {/* Form */}
        <div className="bg-white border border-ink-100 rounded-xl shadow-sm overflow-hidden">
          <form onSubmit={handleGenerate} className="p-6 space-y-5">

            {/* Period */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-widest text-ink-500 mb-2">
                Period
              </label>
              <input
                type="text"
                value={period}
                onChange={e => setPeriod(e.target.value)}
                placeholder="e.g. April 2026"
                className="w-full"
              />
            </div>

            {/* Tone */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-widest text-ink-500 mb-2">
                Tone
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {TONE_OPTIONS.map(t => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => setTone(t.value)}
                    className={`text-left p-3.5 rounded-xl border transition-all ${
                      tone === t.value
                        ? 'border-brand-400 bg-brand-50 ring-1 ring-brand-300'
                        : 'border-ink-200 hover:border-ink-300 bg-white'
                    }`}
                  >
                    <p className={`text-sm font-semibold ${tone === t.value ? 'text-brand-800' : 'text-ink-800'}`}>
                      {t.label}
                    </p>
                    <p className="text-[11px] text-ink-400 mt-0.5 leading-snug">{t.hint}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Personal note */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-widest text-ink-500 mb-1">
                Personal note{' '}
                <span className="font-normal normal-case tracking-normal text-ink-400">(optional)</span>
              </label>
              <p className="text-[11px] text-ink-400 mb-2">
                A shoutout, heads-up, or thank-you. Solomon will weave it in naturally.
              </p>
              <textarea
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder="e.g. Big thanks to everyone who pushed on the Parker job last week. That's the kind of work that gets us referrals."
                rows={3}
                className="w-full resize-none"
              />
            </div>

            <div className="flex items-center gap-3 pt-1">
              <button
                type="submit"
                disabled={!period.trim() || !dataLoaded}
                className="px-6 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors"
              >
                Generate newsletter →
              </button>
              <Link to="/tools" className="text-sm text-ink-400 hover:text-ink-600 transition-colors">
                Cancel
              </Link>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

// ── Newsletter loading steps ──────────────────────────────────────────────────

const NEWSLETTER_STEPS = [
  { label: 'Pulling your recent wins',     sub: 'Check-ins, completed milestones, and team highlights', delay: 0 },
  { label: 'Mapping what\'s in progress',  sub: 'Current milestones and how far along they are', delay: 3000 },
  { label: 'Previewing what\'s coming',    sub: 'What the team will be working on next', delay: 7000 },
  { label: 'Matching the tone',            sub: 'Warm, energetic, or professional. You chose the feel', delay: 11000 },
  { label: 'Writing your update',          sub: 'Short, readable, no financials, just progress and momentum', delay: 15000 },
  { label: 'Polishing the sign-off',       sub: 'A closing line that makes people glad they showed up', delay: 19000 },
]

function NewsletterLoadingView() {
  const [activeStep, setActiveStep] = useState(0)
  useEffect(() => {
    const timers = NEWSLETTER_STEPS.slice(1).map((s, i) => setTimeout(() => setActiveStep(i + 1), s.delay))
    return () => timers.forEach(clearTimeout)
  }, [])

  return (
    <div className="min-h-screen bg-ink-900 flex flex-col items-center justify-center px-6">
      <div className="mb-10 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-brand-500/10 border border-brand-500/20 text-brand-400 text-[11px] font-semibold tracking-widest uppercase mb-5">
          <span className="w-1.5 h-1.5 rounded-full bg-brand-400 animate-pulse" />
          Team Newsletter
        </div>
        <h2 className="text-2xl font-bold text-white tracking-tight">{CURRENT_MONTH}</h2>
        <p className="text-sm text-ink-500 mt-1.5">Usually a few seconds</p>
      </div>
      <div className="w-full max-w-xs space-y-1">
        {NEWSLETTER_STEPS.map((step, i) => {
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
        No financials. Just what was built, what's in progress, and what's next.
      </p>
    </div>
  )
}

// ── DataRow ───────────────────────────────────────────────────────────────────

function DataRow({ icon, label, items, empty }) {
  const hasItems = items.length > 0
  const display  = hasItems
    ? items.slice(0, 3).join(', ') + (items.length > 3 ? ` +${items.length - 3} more` : '')
    : null

  return (
    <div className="flex items-start gap-2.5">
      <span className="text-sm flex-shrink-0 mt-px">{icon}</span>
      <div className="min-w-0 flex-1">
        <span className="text-[11px] font-semibold text-ink-500">{label}: </span>
        {display
          ? <span className="text-[11px] text-ink-700">{display}</span>
          : <span className="text-[11px] text-ink-300 italic">{empty}</span>
        }
      </div>
    </div>
  )
}

// A textarea that is always as tall as its text. The row count used to be
// guessed at 90 characters a line, which on a phone (about 35) cut every
// section off mid-sentence behind a box with no scrollbar.
function GrowingTextarea({ value, ...rest }) {
  const ref = useRef(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])
  return <textarea ref={ref} value={value} rows={1} {...rest} />
}
