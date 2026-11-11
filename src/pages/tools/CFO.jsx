import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { runToolCall, SONNET } from '../../lib/anthropic'
import { isCapExceeded } from '../../lib/usage'
import { buildAdvisorContext } from '../../lib/advisorContext'
import { summarizeContext } from '../../lib/toolContextSummary'
import CFODashboardView from '../../components/tools/CFODashboardView'
import CapExceededNotice from '../../components/tools/CapExceededNotice'
import RefineChat from '../../components/tools/RefineChat'
import ContextUsedLine from '../../components/tools/ContextUsedLine'
import {
  fetchIntegration,
  fetchLatestSnapshots,
  syncQuickBooks,
  formatRelative,
} from '../../lib/quickbooks'

/**
 * CFO Dashboard — /tools/cfo
 *
 * Layout: latest saved analysis always visible at the top on load.
 * Scroll down for the form to generate a new read.
 *
 * On first visit (no saved docs) the top section shows an empty state
 * and the form is the focus. After the first generate + save the page
 * always opens on the most recent read.
 */

const INITIAL_FORM = {
  period_label:       '',
  focus_area:         'all',
  notes:              '',
  specific_questions: '',
}

const FOCUS_OPTIONS = [
  { value: 'all',           label: 'Overall health'   },
  { value: 'profitability', label: 'Profitability'    },
  { value: 'cash',          label: 'Cash position'    },
  { value: 'labour',        label: 'Labour & payroll' },
  { value: 'sales',         label: 'Sales momentum'   },
]

// Three, short, and true of any read. The old five named a month and metrics
// that were not on the page they sat under.
const CFO_SUGGESTIONS = [
  'One of these numbers is wrong',
  'Add average job size',
  'What should I ask my accountant?',
]

// ⭐ 7 Oct — a generated read that was never saved used to vanish on navigation
// (Daniel: "when i come back its gone, shouldn't it stay up"). Keep the last
// unsaved read in localStorage per company so returning restores it, Unsaved
// badge and all. Cleared on save, or when a newer saved read supersedes it.
const draftKey = (cid) => `eliv8:cfo-draft:${cid}`
function readDraft(cid) {
  try { const r = localStorage.getItem(draftKey(cid)); return r ? JSON.parse(r) : null } catch { return null }
}
function writeDraft(cid, data) {
  try { localStorage.setItem(draftKey(cid), JSON.stringify(data)) } catch { /* private mode / quota — ignore */ }
}
function clearDraft(cid) {
  try { localStorage.removeItem(draftKey(cid)) } catch { /* ignore */ }
}

export default function CFO() {
  const { profile } = useAuth()
  const navigate    = useNavigate()

  // ── Latest saved doc (fetched on mount) ───────────────────────────────────
  const [latestDoc,    setLatestDoc]    = useState(undefined) // undefined = loading
  const [allDocs,      setAllDocs]      = useState([])

  // ── Active result (latest doc OR freshly generated) ───────────────────────
  const [result,       setResult]       = useState(null)
  const [resultForm,   setResultForm]   = useState(null)  // form inputs used to produce result
  const [resultDocId,  setResultDocId]  = useState(null)  // set after save

  // ── Generate state ────────────────────────────────────────────────────────
  const [form,         setForm]         = useState(INITIAL_FORM)
  const [generating,   setGenerating]   = useState(false)
  const [saving,       setSaving]       = useState(false)
  const [unsaved,      setUnsaved]      = useState(false) // true when result not yet saved

  // ── Refine state ──────────────────────────────────────────────────────────
  const [messages,     setMessages]     = useState([])
  const [refining,     setRefining]     = useState(false)

  // ── Errors ────────────────────────────────────────────────────────────────
  const [error,        setError]        = useState(null)
  const [capError,     setCapError]     = useState(null)

  // ── Context summary (for "Based on" line + persistence) ──────────────────
  const [contextSummary, setContextSummary] = useState(null)

  // ── QBO ───────────────────────────────────────────────────────────────────
  const [qboIntegration, setQboIntegration] = useState(null)
  const [qboSnapshots,   setQboSnapshots]   = useState([])
  const [qboSyncing,     setQboSyncing]     = useState(false)

  // ── Period-over-period delta computation ──────────────────────────────────
  // When we have ≥2 saved reads, diff the KPIs so arrows show real numbers
  // rather than Claude's estimate. The "previous" doc is whichever saved read
  // comes immediately before the one currently on screen.
  const prevDoc = useMemo(() => {
    if (!result || allDocs.length === 0) return null
    // Unsaved fresh result → compare against the most recently saved doc
    if (!resultDocId) return allDocs[0] ?? null
    // Viewing a saved doc → compare against the next one in the list (older)
    const idx = allDocs.findIndex(d => d.id === resultDocId)
    if (idx < 0 || idx >= allDocs.length - 1) return null
    return allDocs[idx + 1]
  }, [result, resultDocId, allDocs])

  const computedDeltas = useMemo(() => {
    const currKpis = result?.kpis
    const prevKpis = prevDoc?.output_data?.kpis
    if (!currKpis?.length || !prevKpis?.length) return {}
    const out = {}
    for (const kpi of currKpis) {
      const key  = normKpiLabel(kpi.label)
      const prev = prevKpis.find(p => normKpiLabel(p.label) === key)
      if (!prev) continue
      const currVal = parseKpiValue(kpi.value)
      const prevVal = parseKpiValue(prev.value)
      if (currVal == null || prevVal == null || prevVal === 0) continue
      const rawPct   = ((currVal - prevVal) / Math.abs(prevVal)) * 100
      const pct      = Math.round(Math.abs(rawPct) * 10) / 10
      const direction = rawPct >  0.5 ? 'up' : rawPct < -0.5 ? 'down' : 'flat'
      const lowerIsBetter = LOWER_IS_BETTER.some(w => key.includes(w))
      out[key] = {
        pct,
        direction,
        isGood: direction === 'flat' ? null : lowerIsBetter ? direction === 'down' : direction === 'up',
        prevValue: prev.value,
      }
    }
    return out
  }, [result, prevDoc])

  const prevPeriodLabel = prevDoc?.input_data?.period_label ?? null

  // ── Refs ──────────────────────────────────────────────────────────────────
  const formRef   = useRef()  // scroll-to-form button target
  // The new-period form stays closed while a read is on screen. It used to sit
  // open under every read, with three separate buttons that only scrolled to it.
  const [showForm, setShowForm] = useState(false)
  const openForm = () => {
    setShowForm(true)
    setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60)
  }
  const resultRef = useRef()  // scroll-to-result after generate

  // ── On mount: load latest doc + QBO state ────────────────────────────────
  useEffect(() => {
    if (!profile?.company_id) return
    let cancelled = false

    ;(async () => {
      try {
        // Documents fetch is always done first and in isolation — QBO errors
        // must never prevent the saved analysis from loading.
        const docRes = await supabase
          .from('documents')
          .select('id, title, created_at, input_data, output_data')
          .eq('company_id', profile.company_id)
          .eq('tool_id', 'cfo-dashboard')
          .order('created_at', { ascending: false })
          .limit(6)

        if (cancelled) return

        const docs = docRes.data ?? []
        setAllDocs(docs)
        setLatestDoc(docs[0] ?? null)

        // Restore whichever read is newest: an unsaved draft (kept in
        // localStorage) or the latest saved doc. A draft only wins when it is
        // more recent than the newest saved read, so saving still takes over.
        const draft = readDraft(profile.company_id)
        const docTime = docs[0] ? Date.parse(docs[0].created_at) : 0
        if (draft && Number(draft.savedAt) > docTime) {
          setResult(draft.result)
          setResultForm(draft.resultForm)
          setResultDocId(null)
          setUnsaved(true)
          setContextSummary(draft.contextSummary ?? null)
          setMessages([{
            role:    'assistant',
            content: "Here's the read you were last looking at. It isn't saved yet, so hit Save to library to keep it, or run a new one below.",
          }])
        } else if (docs[0]) {
          const outputData = docs[0].output_data
          // Defensive: handle the edge case where output_data is a JSON string
          const parsed = typeof outputData === 'string'
            ? (() => { try { return JSON.parse(outputData) } catch { return outputData } })()
            : outputData
          setResult(parsed)
          setResultForm(docs[0].input_data)
          setResultDocId(docs[0].id)
          setContextSummary(docs[0].input_data?.context_summary ?? null)
          setMessages([{
            role:    'assistant',
            content: "Here's your most recent financial read. Ask me to adjust any number, swap a KPI, or run a fresh analysis below.",
          }])
        }

        // QBO state — load in parallel but failures are non-fatal
        const [iRes, sRes] = await Promise.all([
          fetchIntegration(profile.company_id, 'quickbooks').catch(() => null),
          fetchLatestSnapshots(profile.company_id, { limit: 4 }).catch(() => []),
        ])
        if (cancelled) return

        setQboIntegration(iRes)
        setQboSnapshots(sRes)
      } catch (err) {
        console.warn('[cfo] load error', err)
        setLatestDoc(null)
      }
    })()

    return () => { cancelled = true }
  }, [profile?.company_id])

  // ── QBO sync ──────────────────────────────────────────────────────────────
  const handleQboSync = async () => {
    setQboSyncing(true)
    try {
      await syncQuickBooks()
      const [i, s] = await Promise.all([
        fetchIntegration(profile.company_id, 'quickbooks'),
        fetchLatestSnapshots(profile.company_id, { limit: 4 }),
      ])
      setQboIntegration(i)
      setQboSnapshots(s)
    } catch (err) {
      setError(`QuickBooks sync failed: ${err.message}`)
    } finally {
      setQboSyncing(false)
    }
  }

  // ── Generate ──────────────────────────────────────────────────────────────
  const handleGenerate = async (e) => {
    e.preventDefault()
    if (!form.period_label.trim() || !profile?.company_id) return

    setGenerating(true)
    setError(null)
    setCapError(null)

    try {
      const context      = await buildAdvisorContext(profile.company_id)
      setContextSummary(summarizeContext(context))
      const promptKey     = 'CFO_DASHBOARD_PROMPT'
      const stableContext = `\n\nBUSINESS_CONTEXT:\n${JSON.stringify(context, null, 2)}`
      const userMessage  = JSON.stringify({
        period_label:       form.period_label.trim(),
        focus_area:         form.focus_area,
        notes:              form.notes.trim() || null,
        specific_questions: form.specific_questions.trim() || null,
      })

      const raw = await runToolCall({
        model:        SONNET,
        companyId:    profile.company_id,
        userId:       profile.id,
        toolId:       'cfo-dashboard',
        kind:         'generate',
        promptKey,
        stableContext,
        messages:     [{ role: 'user', content: userMessage }],
        maxTokens:    3500,
        json:         true,
      })

      const parsed = JSON.parse(raw)
      setResult(parsed)
      setResultForm({ ...form })
      setResultDocId(null)
      setUnsaved(true)
      // Remember it so it survives leaving the page before saving.
      writeDraft(profile.company_id, { result: parsed, resultForm: { ...form }, contextSummary, savedAt: Date.now() })
      setMessages([{
        role:    'assistant',
        content: "Here's the read on your books. If a KPI feels off, tell me the real number and I'll re-derive. You can also swap the KPI set, change the tone, or ask me to explain any line.",
      }])

      // Scroll up to show the new result
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100)
    } catch (err) {
      console.error('[cfo] generate failed', err)
      isCapExceeded(err) ? setCapError(err) : setError(err.message || 'Something went wrong.')
    } finally {
      setGenerating(false)
    }
  }

  // ── Refine ────────────────────────────────────────────────────────────────
  const handleRefine = async (userText) => {
    const text = userText.trim()
    if (!text || refining || !result) return

    const userTurn = { role: 'user', content: text }
    setMessages(prev => [...prev, userTurn])
    setRefining(true)
    setError(null)

    try {
      const context      = await buildAdvisorContext(profile.company_id)
      const promptKey     = 'CFO_DASHBOARD_REFINE_PROMPT'
      const stableContext = `\n\nBUSINESS_CONTEXT:\n${JSON.stringify(context, null, 2)}`
      const userPayload  = JSON.stringify({
        original_brief:    resultForm || form,
        current_dashboard: result,
        conversation:      [...messages, userTurn].map(m => ({ role: m.role, content: m.content })),
        request:           text,
      })

      const raw = await runToolCall({
        model:        SONNET,
        companyId:    profile.company_id,
        userId:       profile.id,
        toolId:       'cfo-dashboard',
        kind:         'refine',
        promptKey,
        stableContext,
        messages:     [{ role: 'user', content: userPayload }],
        maxTokens:    3500,
        json:         true,
      })

      const parsed = JSON.parse(raw)
      if (parsed?.dashboard) {
        setResult(parsed.dashboard)
        setUnsaved(true)
        setResultDocId(null)
        writeDraft(profile.company_id, { result: parsed.dashboard, resultForm, contextSummary, savedAt: Date.now() })
      }
      setMessages(prev => [...prev, { role: 'assistant', content: parsed?.change_note || 'Updated.' }])
    } catch (err) {
      const content = isCapExceeded(err)
        ? `You've hit your monthly cap (${err.used}/${err.cap} runs). Resets on the 1st.`
        : "Couldn't apply that. Try rephrasing."
      setMessages(prev => [...prev, { role: 'assistant', content, error: true }])
    } finally {
      setRefining(false)
    }
  }

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!result || !profile?.company_id) return
    setSaving(true)
    try {
      const title = buildTitle(result.period_label || resultForm?.period_label, result.health_grade)
      const { data, error: insertErr } = await supabase.from('documents').insert({
        company_id:  profile.company_id,
        user_id:     profile.id,
        tool_id:     'cfo-dashboard',
        title,
        tags:        [],
        input_data:  { ...(resultForm || form), context_summary: contextSummary },
        output_data: result,
      }).select('id').single()
      if (insertErr) throw insertErr
      setResultDocId(data.id)
      setUnsaved(false)
      clearDraft(profile.company_id)  // it's in the library now; no draft to restore
      // Refresh doc list
      const { data: docs } = await supabase
        .from('documents')
        .select('id, title, created_at, input_data, output_data')
        .eq('company_id', profile.company_id)
        .eq('tool_id', 'cfo-dashboard')
        .order('created_at', { ascending: false })
        .limit(6)
      setAllDocs(docs ?? [])
    } catch (err) {
      setError(err.message || 'Could not save.')
    } finally {
      setSaving(false)
    }
  }

  // ── Switch to a previously saved doc ─────────────────────────────────────
  const handleLoadDoc = (doc) => {
    setResult(doc.output_data)
    setResultForm(doc.input_data)
    setResultDocId(doc.id)
    setContextSummary(doc.input_data?.context_summary ?? null)
    setUnsaved(false)
    setMessages([{
      role:    'assistant',
      content: `Showing your ${doc.input_data?.period_label || 'saved'} read. Ask me anything or run a new analysis below.`,
    }])
    resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const loading = latestDoc === undefined

  if (generating) {
    return <CFOLoadingView periodLabel={form.period_label} />
  }

  return (
    <div className="min-h-screen bg-ink-50">

      {/* ── Dark page header ──────────────────────────────────────────────── */}
      <div className="bg-white border-b border-ink-100">
        <div className="max-w-5xl mx-auto px-8 py-5 flex items-center justify-between gap-6 flex-wrap">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] mb-0.5 text-brand-700">
              CFO Dashboard
            </div>
            <h1 className="text-xl font-bold text-ink-900 leading-tight">
              Your financial read
            </h1>
          </div>
          <div className="flex items-center gap-3">
            {allDocs.length > 1 && (
              <select
                className="text-xs font-medium rounded-lg px-3 py-2 border border-ink-200 bg-white text-ink-700 focus:outline-none focus:ring-1 focus:ring-brand-500"
                value={resultDocId ?? ''}
                onChange={e => {
                  const doc = allDocs.find(d => d.id === e.target.value)
                  if (doc) handleLoadDoc(doc)
                }}
              >
                <option value="" disabled>Previous reads</option>
                {allDocs.map(d => (
                  <option key={d.id} value={d.id}>
                    {d.input_data?.period_label || d.title} · {new Date(d.created_at).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}
                  </option>
                ))}
              </select>
            )}
            <button
              type="button"
              onClick={openForm}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold bg-brand-600 hover:bg-brand-700 text-white transition-colors"
            >
              Run a new period
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-8 py-6 space-y-6">

        {/* ── Errors ────────────────────────────────────────────────────────── */}
        {capError && <CapExceededNotice err={capError} toolLabel="CFO Dashboard" />}
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>
        )}

        {/* ── Current result (top, always shown if available) ────────────────── */}
        <div ref={resultRef}>
          {loading ? (
            <div className="bg-white border border-ink-100 rounded-xl shadow-sm p-8">
              <div className="space-y-3 max-w-lg">
                {[1,2,3,4].map(i => (
                  <div key={i} className={`h-3 bg-ink-100 rounded animate-pulse`} style={{ width: `${90 - i * 10}%` }} />
                ))}
              </div>
            </div>
          ) : result ? (
            <div className="bg-white border border-ink-100 rounded-xl shadow-sm overflow-hidden">
              {/* Result header */}
              <div className="bg-ink-900 px-5 py-3.5 flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-3">
                  <span className="text-[10.5px] font-semibold uppercase tracking-widest text-brand-400">
                    {resultForm?.period_label || result?.period_label || 'Current read'}
                  </span>
                  {unsaved && (
                    <span className="text-[10px] font-semibold text-amber-400 bg-amber-400/10 border border-amber-400/20 px-2 py-0.5 rounded-full">
                      Unsaved
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {unsaved && (
                    <button
                      type="button"
                      onClick={handleSave}
                      disabled={saving || refining}
                      className="px-3.5 py-1.5 rounded-lg text-xs font-bold bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white transition-colors"
                    >
                      {saving ? 'Saving…' : 'Save to library'}
                    </button>
                  )}
                  {!unsaved && resultDocId && (
                    <Link
                      to="/documents?tool=cfo-dashboard"
                      className="text-[10.5px] text-ink-400 hover:text-brand-400 transition-colors"
                    >
                      View in library →
                    </Link>
                  )}
                </div>
              </div>

              {/* Dashboard output */}
              <div className="p-5 md:p-6 relative space-y-4">
                {refining && (
                  <div className="absolute top-3 right-4 inline-flex items-center gap-1.5 text-xs text-brand-700 bg-brand-50 border border-brand-200 px-2 py-1 rounded-full z-10">
                    <span className="w-1.5 h-1.5 rounded-full bg-brand-600 animate-pulse" />
                    Updating…
                  </div>
                )}
                <ContextUsedLine summary={contextSummary} />
                <CFODashboardView
                  data={result}
                  computedDeltas={computedDeltas}
                  prevPeriodLabel={prevPeriodLabel}
                  hidePeriod
                />
              </div>

              {/* Refine chat */}
              <div className="border-t border-ink-100 px-5 pb-5 pt-4">
                <RefineChat
                  bare
                  messages={messages}
                  refining={refining}
                  onSend={handleRefine}
                  suggestions={CFO_SUGGESTIONS}
                  placeholder="e.g. Cash on hand is $265k, not $240k. Update the read."
                />
              </div>
            </div>
          ) : (
            /* No saved docs yet */
            <div className="bg-white border border-dashed border-ink-200 rounded-xl p-10 text-center">
              <div className="text-4xl mb-3 opacity-30">📊</div>
              <h2 className="text-base font-bold text-ink-800 mb-1">No financial reads yet</h2>
              <p className="text-sm text-ink-400 mb-4 max-w-sm mx-auto">
                Your month in plain English. Pick a period, add anything on your mind, and get your read of the numbers.
              </p>
              <button
                type="button"
                onClick={openForm}
                className="px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold transition-colors"
              >
                Build your first read →
              </button>
            </div>
          )}
        </div>

        {/* ── New analysis form (below, scroll to) ──────────────────────────── */}
        {(showForm || (!result && !loading)) && (
        <div ref={formRef} className="bg-white border border-ink-100 rounded-xl shadow-sm overflow-hidden">
          <div className="bg-ink-900 px-5 py-3.5">
            <span className="text-[10.5px] font-semibold uppercase tracking-widest text-brand-400">
              {result ? 'Analyse a new period' : 'Get your first read'}
            </span>
          </div>

          <div className="p-5 md:p-6 space-y-5">

            <QBOBadge
              integration={qboIntegration}
              snapshots={qboSnapshots}
              syncing={qboSyncing}
              onSync={handleQboSync}
            />

            {qboIntegration?.status !== 'connected' && (
              <Link
                to="/documents?view=uploaded"
                className="group flex items-start gap-4 rounded-xl border-2 border-brand-200 bg-brand-50 hover:bg-brand-100 hover:border-brand-300 p-4 transition-colors"
              >
                <div className="text-3xl flex-shrink-0">📂</div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-brand-900">Upload your P&amp;L or bank statement first</div>
                  <p className="text-xs text-brand-800 mt-0.5">Without your numbers, every figure here is a guess. Add your financials and they turn real.</p>
                </div>
                <div className="text-brand-600 text-xl flex-shrink-0 self-center group-hover:translate-x-0.5 transition-transform">→</div>
              </Link>
            )}

            <form onSubmit={handleGenerate} className="space-y-4">
              <Field required label="Which period are we looking at?" hint='"Last month", "July 2026" or "Q2 2026" all work.'>
                <input
                  type="text"
                  value={form.period_label}
                  onChange={e => setForm({ ...form, period_label: e.target.value })}
                  placeholder="Last month"
                  className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm text-ink-800 focus:outline-none focus:ring-2 focus:ring-brand-300"
                />
              </Field>

              <Field label="Focus area" hint="What's top of mind? Leave as 'Overall' for a broad read.">
                <select
                  value={form.focus_area}
                  onChange={e => setForm({ ...form, focus_area: e.target.value })}
                  className="w-full max-w-sm rounded-lg border border-ink-200 px-3 py-2 text-sm text-ink-800 focus:outline-none focus:ring-2 focus:ring-brand-300"
                >
                  {FOCUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </Field>

              {/* ⚠️ 1 Sep — all four examples on this form used to be disasters:
                  a lost account, margin lower than February, AR getting worse,
                  "why did my margin drop". Daniel: "the examples seem negative".

                  ⚠️ The fix is NOT cheerfulness — this product does not do false
                  optimism, and an example that only ever shows good news would
                  be its own kind of dishonest. It is that examples MODEL what to
                  type: four problems in a row teaches the owner this form is
                  where bad news goes, and leaves someone having a good month
                  with nothing to pattern-match. These now show the range — a win,
                  a neutral one-off, and a question that is genuinely open rather
                  than pre-loaded with a bad answer. Keep the mix. */}
              <Field label="Notes or context" hint="Anything Solomon can't see: a big job landing, a one-off expense, a quiet month.">
                <textarea
                  value={form.notes}
                  onChange={e => setForm({ ...form, notes: e.target.value })}
                  placeholder="Won the Parker contract mid-month, and the new van came out of this period."
                  rows={3}
                  className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm text-ink-800 focus:outline-none focus:ring-2 focus:ring-brand-300"
                />
              </Field>

              <Field label="Specific questions" hint='Anything you want answered directly. "Is this month as good as it looks?"'>
                <textarea
                  value={form.specific_questions}
                  onChange={e => setForm({ ...form, specific_questions: e.target.value })}
                  placeholder="Is the margin holding where I think it is? Which jobs actually made money?"
                  rows={2}
                  className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm text-ink-800 focus:outline-none focus:ring-2 focus:ring-brand-300"
                />
              </Field>

              <div className="flex items-center gap-3 pt-1">
                <button
                  type="submit"
                  disabled={generating || !form.period_label.trim()}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-bold transition-colors"
                >
                  Build the dashboard →
                </button>
                {result
                  ? <button type="button" onClick={() => setShowForm(false)} className="text-sm text-ink-400 hover:text-ink-600">Cancel</button>
                  : <Link to="/tools" className="text-sm text-ink-400 hover:text-ink-600">Cancel</Link>}
              </div>
            </form>

            <p className="text-[11px] text-ink-300 leading-relaxed">
              We send your period, business profile, and uploaded financial docs to Solomon.
              The dashboard isn't saved until you hit "Save to library".
            </p>
          </div>
        </div>
        )}

        <div className="h-4" />
      </div>
    </div>
  )
}

// ── CFO Loading screen ────────────────────────────────────────────────────────

const CFO_STEPS = [
  {
    label: 'Reading your financial snapshot',
    sub:   'Pulling your P&L, balance sheet, and uploaded docs',
    delay: 0,
  },
  {
    label: 'Crunching your KPIs',
    sub:   'Calculating gross margin, labour %, and cash ratios',
    delay: 4000,
  },
  {
    label: 'Benchmarking your numbers',
    sub:   'Comparing against healthy benchmarks for a business your size',
    delay: 10000,
  },
  {
    label: 'Spotting the gaps',
    sub:   'Identifying what\'s dragging your profitability',
    delay: 17000,
  },
  {
    label: 'Writing your financial read',
    sub:   'Plain-English commentary on what the numbers mean',
    delay: 23000,
  },
  {
    label: 'Building your action plan',
    sub:   'Turning insights into moves you can make this week',
    delay: 30000,
  },
]

function CFOLoadingView({ periodLabel }) {
  const [activeStep, setActiveStep] = useState(0)

  useEffect(() => {
    const timers = CFO_STEPS.slice(1).map((step, i) =>
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
          CFO Dashboard
        </div>
        <h2 className="text-2xl font-bold text-white tracking-tight">
          {periodLabel || 'Your financial read'}
        </h2>
        <p className="text-sm text-ink-500 mt-1.5">Usually 30 to 60 seconds</p>
      </div>

      {/* Step list */}
      <div className="w-full max-w-xs space-y-1">
        {CFO_STEPS.map((step, i) => {
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
              {/* State icon */}
              <div className="flex-shrink-0 w-5 h-5 mt-0.5 flex items-center justify-center">
                {isDone ? (
                  <span className="text-[13px] font-bold text-green-400">✓</span>
                ) : isActive ? (
                  <span className="inline-block w-2 h-2 rounded-full bg-brand-400 animate-pulse" />
                ) : (
                  <span className="inline-block w-2 h-2 rounded-full bg-ink-700" />
                )}
              </div>

              {/* Label + subtitle */}
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

      {/* Footer note */}
      <p className="mt-10 text-xs text-ink-700 text-center max-w-xs leading-relaxed">
        Every number is benchmarked against what a healthy business your size actually looks like.
      </p>
    </div>
  )
}

// ── QBO badge ─────────────────────────────────────────────────────────────────

function QBOBadge({ integration, snapshots, syncing, onSync }) {
  const status = integration?.status ?? 'disconnected'

  if (status !== 'connected') {
    return (
      <Link
        to="/settings/integrations"
        className="group flex items-start gap-4 rounded-xl border border-ink-100 bg-ink-50 hover:bg-ink-100 p-4 transition-colors"
      >
        <div className="w-9 h-9 rounded-lg bg-[#2CA01C] flex items-center justify-center text-white font-bold text-xs flex-shrink-0">qb</div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-ink-800">Connect QuickBooks for live numbers</div>
          <p className="text-xs text-ink-500 mt-0.5">Connect in one click. Your P&amp;L and balance sheet flow in automatically.</p>
        </div>
        <div className="text-ink-400 text-lg flex-shrink-0 self-center group-hover:translate-x-0.5 transition-transform">→</div>
      </Link>
    )
  }

  const newest = snapshots[0]
  return (
    <div className="flex items-start gap-4 rounded-xl border-2 border-green-200 bg-green-50 p-4">
      <div className="w-9 h-9 rounded-lg bg-[#2CA01C] flex items-center justify-center text-white font-bold text-xs flex-shrink-0">qb</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-green-900">QuickBooks connected</span>
          <span className="text-[10px] font-medium text-green-800 bg-white/70 border border-green-200 px-1.5 py-0.5 rounded-full">live data</span>
        </div>
        {newest ? (
          <p className="text-xs text-green-800 mt-0.5">
            Using {newest.period_label} · {snapshots.length} report{snapshots.length !== 1 ? 's' : ''} · synced {formatRelative(newest.synced_at)}
          </p>
        ) : (
          <p className="text-xs text-green-800 mt-0.5">Nothing here yet. Connect your books and your latest P&amp;L shows up.</p>
        )}
      </div>
      <button
        type="button"
        onClick={onSync}
        disabled={syncing}
        className="flex-shrink-0 self-center px-3 py-1.5 rounded-lg bg-[#2CA01C] hover:bg-[#228B19] disabled:bg-gray-300 text-white text-xs font-semibold transition-colors"
      >
        {syncing ? 'Syncing…' : 'Sync now'}
      </button>
    </div>
  )
}

// ── Field wrapper ─────────────────────────────────────────────────────────────

function Field({ label, hint, required, children }) {
  return (
    <label className="block">
      <div className="mb-1">
        <span className="text-xs font-semibold text-ink-700">
          {label}{required && <span className="text-red-500 ml-0.5">*</span>}
        </span>
      </div>
      {children}
      {hint && <p className="text-[11px] text-ink-400 mt-1">{hint}</p>}
    </label>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// ── KPI delta helpers ─────────────────────────────────────────────────────────

/**
 * Labels where a decrease is a good thing (costs, overhead, slow-pay metrics).
 * Matched as substrings of the normalised label, so "labour cost" and "labour
 * costs" both match "labour".
 */
const LOWER_IS_BETTER = [
  'cost', 'expense', 'overhead', 'payroll', 'labour', 'labor',
  'cogs', 'ar day', 'days outstanding', 'payable', 'debt', 'late',
]

/** Lowercase + strip non-alpha for fuzzy label matching across periods. */
function normKpiLabel(label) {
  return (label || '').toLowerCase().trim().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ')
}

/**
 * Parse a KPI value string like "$52,400", "$1.2M", "42%", "18 days" into a
 * plain number so we can compute percentage change.  Returns null when the
 * string contains no parseable number (e.g. "N/A", "—").
 */
function parseKpiValue(str) {
  if (!str) return null
  const s = String(str).replace(/,/g, '').trim()
  const mMatch = s.match(/\$?([\d.]+)\s*[Mm](?:illion)?/)
  if (mMatch) return parseFloat(mMatch[1]) * 1_000_000
  const kMatch = s.match(/\$?([\d.]+)\s*[Kk](?:illion)?/)
  if (kMatch) return parseFloat(kMatch[1]) * 1_000
  const pMatch = s.match(/([\d.]+)\s*%/)
  if (pMatch) return parseFloat(pMatch[1])
  const nMatch = s.match(/\$?([\d.]+)/)
  if (nMatch) return parseFloat(nMatch[1])
  return null
}

function buildTitle(periodLabel, grade) {
  const period   = (periodLabel || 'Period').trim()
  const gradeBit = grade ? ` · ${grade}` : ''
  return `CFO · ${period}${gradeBit}`
}
