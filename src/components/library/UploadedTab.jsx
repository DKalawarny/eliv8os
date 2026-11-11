import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { supabase } from '../../lib/supabase'
import {
  listKnowledgeFiles,
  getKnowledgeFile,
  deleteKnowledgeFile,
  getSignedUrl,
  expandDroppedItems,
  KIND_OPTIONS,
} from '../../lib/knowledgeFiles'
import { runLibraryAnalysis, getLibraryAnalysis } from '../../lib/libraryAnalysis'
import { checkGoogleFreshness, describeFreshness } from '../../lib/cloudFreshness'
import UploadDialog from './UploadDialog'
import { MAX_MB } from '../../lib/knowledgeFiles'
import { indexMissingFiles } from '../../lib/rag/indexer'
import { isDemoCompany } from '../../lib/demo'
import CloudImportModal from './CloudImportModal'
import ManualFinancialsModal from './ManualFinancialsModal'

/**
 * UploadedTab — owner-uploaded knowledge files + Library Intelligence.
 *
 * Changes from previous version:
 * - LibraryIntelligencePanel collapses to a slim one-line strip by default
 *   once analysis exists; expands on click to show full results.
 * - Individual row cards → single container card with divider lines.
 * - Emits count via onCountChange prop so parent can show badge.
 */

const CATEGORY_TONES = {
  foundation: 'bg-amber-50 text-amber-700 border-amber-200',
  systems:    'bg-blue-50 text-blue-700 border-blue-200',
  team:       'bg-teal-50 text-teal-700 border-teal-200',
  revenue:    'bg-green-50 text-green-700 border-green-200',
  exit:       'bg-rose-50 text-rose-700 border-rose-200',
}

export default function UploadedTab({ onCountChange }) {
  const { profile, company }     = useAuth()
  // Same repair as the Solomon page: files with text but no search vectors.
  useEffect(() => {
    if (profile?.company_id && company && !isDemoCompany(company)) {
      indexMissingFiles(profile.company_id).catch(() => {})
    }
  }, [profile?.company_id, company])
  const [files, setFiles]        = useState(null)
  const [error, setError]        = useState(null)
  const [selected, setSelected]  = useState(null)
  const [kindFilter, setKind]    = useState('all')
  const [showUpload, setShowUpload]               = useState(false)
  // Files handed in by a drop on the empty-state card, so the dialog opens
  // already holding them instead of asking for them again.
  const [seedFiles, setSeedFiles]                 = useState([])
  const [showCloud,  setShowCloud]                = useState(false)
  // Drive freshness. `null` = never checked this session — deliberately not run
  // on mount: checking needs a Google authorisation, and popping a consent
  // prompt at somebody who just opened their Library is how you teach people to
  // dismiss consent prompts.
  const [freshness, setFreshness]                 = useState(null)
  const [checking,  setChecking]                  = useState(false)
  const [showManualFinancials, setShowManualFinancials] = useState(false)

  // Intelligence panel state
  const [analysis, setAnalysis]             = useState(undefined)
  const [analyzePhase, setAnalyzePhase]     = useState('idle')
  const [analyzeError, setAnalyzeError]     = useState(null)
  const [appliedTitles, setAppliedTitles]   = useState(new Set())

  // ---- data loading ----

  useEffect(() => {
    if (!profile?.company_id) return
    let cancelled = false

    ;(async () => {
      try {
        const [data, savedAnalysis] = await Promise.all([
          listKnowledgeFiles(profile.company_id),
          getLibraryAnalysis(profile.company_id).catch(() => null),
        ])
        if (cancelled) return
        setFiles(data)
        setAnalysis(savedAnalysis ?? null)
        setError(null)
      } catch (err) {
        if (cancelled) return
        setError(err.message)
        setFiles([])
        setAnalysis(null)
      }
    })()
    return () => { cancelled = true }
  }, [profile?.company_id])

  // Report count to parent header
  useEffect(() => {
    if (files !== null && onCountChange) onCountChange(files.length)
  }, [files, onCountChange])

  const visible = useMemo(() => {
    if (!files) return []
    return kindFilter === 'all' ? files : files.filter(f => f.kind === kindFilter)
  }, [files, kindFilter])

  const usedKinds = useMemo(() => {
    if (!files) return []
    return [...new Set(files.map(f => f.kind))]
  }, [files])

  const readyCount = useMemo(
    () => (files ?? []).filter(f => f.status === 'ready').length,
    [files],
  )

  // ---- intelligence ----

  async function handleAnalyze() {
    if (!profile?.company_id) return
    setAnalyzePhase('running')
    setAnalyzeError(null)
    try {
      const result = await runLibraryAnalysis(profile.company_id)
      setAnalysis(result)
      setAnalyzePhase('idle')
    } catch (err) {
      setAnalyzeError(err.message ?? 'Analysis failed. Try again.')
      setAnalyzePhase('error')
    }
  }

  async function handleApplyMilestone(milestone) {
    if (!profile?.company_id) return
    const { error: insertErr } = await supabase
      .from('milestones')
      .insert({
        company_id:  profile.company_id,
        title:       milestone.title,
        description: milestone.description ?? null,
        timeframe:   milestone.timeframe ?? null,
        category:    milestone.category ?? null,
        actions:     Array.isArray(milestone.actions) ? milestone.actions : [],
        books:       [],
        sort_order:  9999,
        weight:      sanitizeWeight(milestone.weight),
        source:      'library',
      })
    if (!insertErr) {
      setAppliedTitles(prev => new Set([...prev, milestone.title]))
    }
  }

  // ---- upload ----

  // ⚠️ `analyze` defaults to true so the cloud-import and manual-entry callers
  // keep their old behaviour. UploadDialog passes false for every file in a
  // batch except the last — seven uploads used to mean seven library analyses
  // of a library that was still changing under them.
  async function handleCheckDrive() {
    if (checking) return
    setChecking(true)
    try {
      const result = await checkGoogleFreshness(profile.company_id)
      setFreshness({ ...result, message: describeFreshness(result) })
    } catch (err) {
      setFreshness({ error: err.message || 'Could not check Google Drive.' })
    } finally {
      setChecking(false)
    }
  }

  const onUploaded = (newRow, { analyze = true } = {}) => {
    setFiles(prev => (prev ? [newRow, ...prev] : [newRow]))
    setSelected(newRow.id)
    if (analyze && newRow.status === 'ready') handleAnalyze()
  }

  const onDelete = async (file) => {
    if (!confirm(`Delete "${file.title}"? This removes it from the library and Solomon's context.`)) return
    try {
      await deleteKnowledgeFile(file.id, file.file_path)
      setFiles(prev => prev.filter(f => f.id !== file.id))
      if (selected === file.id) setSelected(null)
    } catch (err) {
      alert(`Delete failed: ${err.message}`)
    }
  }

  // ---- loading / error ----

  if (files === null) {
    return (
      <div className="space-y-3">
        <div className="h-12 bg-ink-50 rounded-xl animate-pulse" />
        <div className="bg-white border border-ink-100 rounded-xl overflow-hidden shadow-sm">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-14 border-b border-ink-100 last:border-0 px-4 flex items-center gap-3">
              <div className="w-6 h-6 bg-ink-100 rounded animate-pulse flex-shrink-0" />
              <div className="h-4 w-48 bg-ink-100 rounded animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-800 text-sm">
        Couldn't load your files: {error}
      </div>
    )
  }

  return (
    <>
      {/* ⚠️ BOTH OF THESE ARE GATED ON files.length > 0, AND THAT MATTERS.
          They used to render unconditionally, above an EmptyState that carries
          its own copy of each. On an empty library that produced FOUR upload
          affordances on one screen — Upload and Import in this toolbar, plus
          Upload from your computer and Import from Google Drive or OneDrive in
          the empty state — and the "what should I upload?" panel twice over,
          once collapsed here and once expanded below.

          An empty state exists to give someone exactly one obvious next move.
          Surrounding it with duplicates of itself is the opposite. */}
      {files.length > 0 && (
      <>
      {/* ⚠️ 10 Oct, Daniel: "it's a mess, nothing lines up, you need to
          streamline it." Both shelves now have the SAME three rows in the same
          places: one line saying what the shelf is, one row of controls with a
          Show filter on the left, then the list. Keep the two in step: if a row
          is added here, add its twin in GeneratedTab. */}
      <p className="text-sm text-ink-600 leading-snug mb-3 lg:h-10">
        Files you added. Solomon reads these before he answers.
      </p>
      <div className="flex items-center gap-2 mb-4 h-10">
        <label className="text-sm text-ink-600 font-medium flex-shrink-0">Show</label>
        <select
          value={kindFilter}
          onChange={e => setKind(e.target.value)}
          className="min-w-0 flex-1 h-10 text-sm border border-ink-200 rounded-lg px-2.5 bg-white text-ink-800 font-medium focus:outline-none focus:border-brand-400"
        >
          <option value="all">All ({files.length})</option>
          {usedKinds.map(k => (
            <option key={k} value={k}>
              {KIND_OPTIONS.find(o => o.value === k)?.label ?? k} ({files.filter(f => f.kind === k).length})
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setShowCloud(true)}
          className="flex-shrink-0 h-10 inline-flex items-center px-3 rounded-lg border border-ink-200 bg-white text-sm font-semibold text-ink-900"
          title="Bring files in from Google Drive or OneDrive"
        >
          From Drive
        </button>
        <button
          type="button"
          onClick={() => setShowUpload(true)}
          className="flex-shrink-0 h-10 inline-flex items-center gap-1.5 px-4 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold transition-colors"
        >
          <span aria-hidden>＋</span> Upload
        </button>
      </div>

      {/* Freshness result. Deliberately plain text rather than badges on rows:
          the honest answer is often "nothing changed", and a UI that only ever
          renders when something IS wrong trains people to read silence as
          confirmation — which it is not, because nothing checks on its own. */}
      {freshness && (
        <div
          className="mt-3 rounded-xl border px-4 py-3 text-[13px] leading-relaxed"
          style={{
            background:  freshness.error ? 'rgba(239,68,68,0.06)' : 'rgba(11,107,78,0.06)',
            borderColor: freshness.error ? 'rgba(239,68,68,0.25)' : 'rgba(11,107,78,0.25)',
            color:       freshness.error ? '#b91c1c' : '#0b6b4e',
          }}
        >
          <p>{freshness.error ?? freshness.message}</p>
          {freshness.stale?.length > 0 && (
            <ul className="mt-2 space-y-1">
              {freshness.stale.map(f => (
                <li key={f.id} className="text-ink-600">
                  <span className="font-semibold">{f.title}</span>
                  {'changed '}
                  {new Date(f.upstream_modified_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                </li>
              ))}
            </ul>
          )}
          {freshness.stale?.length > 0 && (
            <p className="mt-2 text-ink-500">
              Import them again to bring Solomon&rsquo;s copy up to date. The
              old one stays until you do.
            </p>
          )}
        </div>
      )}
      </>
      )}

      {/* File list — single card with dividers */}
      {files.length === 0 ? (
        <EmptyState
          onUpload={(dropped) => { setSeedFiles(Array.isArray(dropped) ? dropped : []); setShowUpload(true) }}
          onCloudImport={() => setShowCloud(true)}
          onManualEntry={() => setShowManualFinancials(true)}
        />
      ) : visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-ink-200 p-8 text-center text-sm text-ink-400">
          No files in this category yet.
        </div>
      ) : (
        <>
        {/* A heading and one line, the same shape as the group headings on the
            other shelf, so the two lists start on the same line. */}
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-ink-500">Files</h3>
        <p className="text-[12px] text-ink-400 mt-0.5 mb-2">Newest first. Click one to read what Solomon took from it.</p>
        <div className="bg-white border border-ink-100 rounded-xl shadow-sm overflow-hidden">
          {visible.map(f => (
            <Row
              key={f.id} file={f}
              expanded={selected === f.id}
              onToggle={() => setSelected(selected === f.id ? null : f.id)}
              onDelete={() => onDelete(f)}
            />
          ))}
        </div>
        </>
      )}

      {files.length > 0 && (
        <p className="mt-2 text-sm text-ink-600">
          Brought files in from Google Drive?{' '}
          <button type="button" onClick={handleCheckDrive} disabled={checking} className="font-semibold text-brand-700 hover:text-brand-800 disabled:opacity-50">
            {checking ? 'Checking…' : 'Check whether any have changed there'}
          </button>
        </p>
      )}

      {/* ⚠️ 10 Oct, Daniel: "this section is confusing to me." Two dark bars
          (read everything together, what should I upload) sat ABOVE the files,
          so the first thing on a page called Uploaded was two things that are
          not files. The files and the three ways to add one come first now;
          these two follow, as the optional extras they are. */}
      {files.length > 0 && (
        <div className="mt-6">
          <UploadSuggestionsPanel defaultOpen={false} onManualEntry={() => setShowManualFinancials(true)} />
        <LibraryIntelligencePanel
          readyCount={readyCount}
          analysis={analysis}
          analyzePhase={analyzePhase}
          analyzeError={analyzeError}
          appliedTitles={appliedTitles}
          onAnalyze={handleAnalyze}
          onApplyMilestone={handleApplyMilestone}
        />
        </div>
      )}

      {showUpload && (
        <UploadDialog
          initialFiles={seedFiles}
          onClose={() => { setShowUpload(false); setSeedFiles([]) }}
          onUploaded={onUploaded}
        />
      )}

      {showCloud && (
        <CloudImportModal
          companyId={profile?.company_id}
          userId={profile?.id}
          onClose={() => setShowCloud(false)}
          onUploaded={onUploaded}
        />
      )}

      {showManualFinancials && (
        <ManualFinancialsModal
          companyId={profile?.company_id}
          userId={profile?.id}
          onClose={() => setShowManualFinancials(false)}
          onUploaded={(row) => { onUploaded(row); setShowManualFinancials(false) }}
        />
      )}
    </>
  )
}

// ============================================================================
// Library Intelligence panel — collapses to slim strip when analysis exists
// ============================================================================

function LibraryIntelligencePanel({
  readyCount, analysis, analyzePhase, analyzeError,
  appliedTitles, onAnalyze, onApplyMilestone,
}) {
  const isRunning   = analyzePhase === 'running'
  const hasAnalysis = !!analysis && !isRunning
  const analyzedAt  = analysis?.analyzed_at ? formatRelative(analysis.analyzed_at) : null

  // Collapse by default when analysis already exists, open when it doesn't
  const [expanded, setExpanded] = useState(!hasAnalysis)

  // Summary counts for the collapsed strip
  const strengthCount    = (analysis?.strengths ?? []).length
  const gapCount         = (analysis?.gaps ?? []).length
  const opportunityCount = (analysis?.opportunities ?? []).length
  const suggestionCount  = (analysis?.suggested_milestones ?? []).length

  return (
    <div className="mb-4 bg-white border border-ink-100 rounded-xl shadow-sm overflow-hidden">

      {/* Always-visible strip (header) */}
      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center gap-2.5 px-5 py-3 bg-ink-50 hover:bg-ink-100 transition-colors text-left"
      >
        {/* Status dot */}
        {isRunning ? (
          <span className="w-2 h-2 rounded-full bg-brand-400 animate-pulse flex-shrink-0" />
        ) : hasAnalysis ? (
          <span className="w-2 h-2 rounded-full bg-green-400 flex-shrink-0" />
        ) : (
          <span className="w-2 h-2 rounded-full bg-ink-600 flex-shrink-0" />
        )}

        {/* ⚠️ 1 Sep — this said "LIBRARY INTELLIGENCE", which Daniel found
            confusing: "is it a summary of everything it sees?" It is exactly
            that — a synthesised read across ALL the uploaded files at once, not
            per-file — and the old name described the machinery rather than the
            thing. Named for what it does now. */}
        <span className="text-[10.5px] font-bold uppercase tracking-widest text-ink-700 flex-shrink-0">
          One read across all your files
        </span>

        {/* Collapsed summary */}
        {hasAnalysis && !expanded && (
          <span className="text-[10.5px] text-ink-500 truncate">
            · {strengthCount} strength{strengthCount !== 1 ? 's' : ''}
            {' · '}{gapCount} gap{gapCount !== 1 ? 's' : ''}
            {' · '}{opportunityCount} opportunit{opportunityCount !== 1 ? 'ies' : 'y'}
            {suggestionCount > 0 && ` · ${suggestionCount} roadmap suggestion${suggestionCount !== 1 ? 's' : ''}`}
          </span>
        )}

        {isRunning && (
          <span className="text-[10.5px] text-ink-500">· analyzing…</span>
        )}

        {analyzedAt && !isRunning && (
          <span className="text-[10.5px] text-ink-600 ml-auto mr-2 flex-shrink-0">
            {expanded ? `updated ${analyzedAt}` : ''}
          </span>
        )}

        {/* Re-analyze button (only when expanded) */}
        {expanded && readyCount > 0 && !isRunning && (
          <button
            type="button"
            onClick={e => { e.stopPropagation(); onAnalyze() }}
            className="text-[10.5px] text-ink-400 hover:text-brand-400 transition-colors font-medium flex-shrink-0 ml-auto mr-2"
          >
            {hasAnalysis ? 'Read them again →' : ''}
          </button>
        )}

        <span className="text-ink-500 text-[10px] flex-shrink-0 ml-auto">
          {expanded ? '▲' : '▼'}
        </span>
      </button>

      {/* Expandable body */}
      {expanded && (
        <div className="p-5">

          {/* Running */}
          {isRunning && (
            <div className="flex items-center gap-3 py-2">
              <span className="w-4 h-4 border-2 border-brand-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
              <p className="text-sm text-ink-500">
                Reading all {readyCount} document{readyCount !== 1 ? 's' : ''} and building your intelligence picture…
              </p>
            </div>
          )}

          {/* Error */}
          {analyzePhase === 'error' && analyzeError && (
            <div className="flex items-center gap-3 py-2">
              <p className="text-sm text-red-600">{analyzeError}</p>
              <button
                type="button"
                onClick={onAnalyze}
                className="text-xs text-brand-600 font-semibold hover:text-brand-700"
              >
                Try again
              </button>
            </div>
          )}

          {/* No analysis yet */}
          {!isRunning && !hasAnalysis && analyzePhase !== 'error' && (
            <div className="py-1">
              <p className="text-sm text-ink-500 leading-relaxed mb-4">
                Solomon reads all {readyCount} file{readyCount !== 1 ? 's' : ''} as one set, not one at a time, and tells you
                what is strong, what is missing, and what is worth adding to your roadmap.
              </p>
              <button
                type="button"
                onClick={onAnalyze}
                className="bg-gold-gradient text-white rounded-lg px-5 py-2.5 text-sm font-bold tracking-wide glow-gold-sm hover:glow-gold transition-all duration-200"
              >
                Read them together →
              </button>
            </div>
          )}

          {/* Analysis results */}
          {hasAnalysis && (
            <div className="space-y-5">
              <p className="text-sm text-ink-700 leading-relaxed">{analysis.summary}</p>

              <div className="grid sm:grid-cols-3 gap-3">
                <InsightColumn label="Strengths"     items={analysis.strengths ?? []}     tone="green" />
                <InsightColumn label="Gaps & Risks"  items={analysis.gaps ?? []}          tone="amber" />
                <InsightColumn label="Opportunities" items={analysis.opportunities ?? []}  tone="blue"  />
              </div>

              {(analysis.suggested_milestones ?? []).length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-[10.5px] font-semibold uppercase tracking-widest text-ink-400">
                      Roadmap suggestions from your documents
                    </span>
                    <span className="text-[10px] bg-brand-50 text-brand-700 border border-brand-200 px-2 py-0.5 rounded-full font-semibold">
                      {analysis.suggested_milestones.length} found
                    </span>
                  </div>
                  <div className="space-y-2">
                    {analysis.suggested_milestones.map((m, i) => (
                      <SuggestionRow
                        key={i}
                        milestone={m}
                        applied={appliedTitles.has(m.title)}
                        onApply={() => onApplyMilestone(m)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function InsightColumn({ label, items, tone }) {
  const styles = {
    green: { bg: 'bg-green-50 border-green-100', label: 'text-green-700', dot: 'bg-green-500' },
    amber: { bg: 'bg-amber-50 border-amber-100', label: 'text-amber-700', dot: 'bg-amber-500' },
    blue:  { bg: 'bg-blue-50  border-blue-100',  label: 'text-blue-700',  dot: 'bg-blue-500'  },
  }[tone] ?? { bg: 'bg-ink-50 border-ink-100', label: 'text-ink-500', dot: 'bg-ink-400' }

  return (
    <div className={`rounded-lg border p-3 ${styles.bg}`}>
      <p className={`text-[10px] font-bold uppercase tracking-widest mb-2 ${styles.label}`}>{label}</p>
      <ul className="space-y-1.5">
        {(items ?? []).slice(0, 3).map((item, i) => (
          <li key={i} className="flex items-start gap-1.5 text-xs text-ink-700">
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1 ${styles.dot}`} />
            <span className="leading-relaxed">{item}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function SuggestionRow({ milestone, applied, onApply }) {
  const tone = CATEGORY_TONES[milestone.category] ?? 'bg-gray-50 text-gray-700 border-gray-200'

  return (
    <div className="flex items-start gap-3 border border-ink-100 rounded-xl px-4 py-3 bg-white hover:border-brand-200 transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-0.5">
          <span className="text-sm font-semibold text-ink-900">{milestone.title}</span>
          {milestone.category && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium flex-shrink-0 ${tone}`}>
              {milestone.category}
            </span>
          )}
          {milestone.timeframe && (
            <span className="text-[10px] text-ink-400 flex-shrink-0">{milestone.timeframe}</span>
          )}
        </div>
        {milestone.reasoning && (
          <p className="text-xs text-ink-400 leading-relaxed">{milestone.reasoning}</p>
        )}
      </div>
      <div className="flex-shrink-0 mt-0.5">
        {applied ? (
          <span className="text-xs text-green-600 font-semibold flex items-center gap-1">
            <span>✓</span> Added
          </span>
        ) : (
          <button
            type="button"
            onClick={onApply}
            className="text-xs font-bold text-brand-600 hover:text-brand-700 transition-colors whitespace-nowrap bg-gold-gradient bg-clip-text"
            style={{ WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}
          >
            Add to roadmap →
          </button>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// Upload suggestions guide
// ============================================================================

const UPLOAD_CATEGORIES = [
  {
    icon:     '📊',
    label:    'Financials',
    why:      'Gives Solomon real numbers. Not just what you entered at onboarding.',
    examples: [
      'Profit & loss statement (last 12 months)',
      'Balance sheet',
      'Cash flow forecast or operating budget',
      'Pricing / rate sheet',
    ],
    comparison: {
      title: 'Three ways to get your financials in',
      options: [
        {
          label: 'Upload a report',
          icon:  '📄',
          pros: [
            'Works with any accounting software',
            "You control exactly what Solomon sees",
            'Nothing is connected, nothing auto-syncs',
          ],
          platforms: [
            { name: 'QuickBooks',  steps: 'Reports → Profit & Loss → Export as PDF' },
            { name: 'Xero',        steps: 'Accounting → Reports → Profit & Loss → Export PDF' },
            { name: 'Wave',        steps: 'Accounting → Reports → Income Statement → Download' },
            { name: 'FreshBooks',  steps: 'Reports → Profit & Loss → Export' },
            { name: 'Sage',        steps: 'Reporting → Profit & Loss → Export' },
            { name: 'Spreadsheet', steps: 'File → Export / Download as PDF' },
          ],
          best: 'Best for anyone who wants privacy-first, or has docs from multiple businesses.',
        },
        {
          label: 'Enter key numbers manually',
          icon:  '✏️',
          pros: [
            'No file, no software, just your numbers',
            'Takes about 2 minutes',
            'You can add context a spreadsheet never could',
          ],
          best: "Best if you don't use accounting software, or just don't want to share files.",
          action: 'manual_entry',
        },
        {
          label: 'Connect QuickBooks or Xero',
          icon:  '⚡',
          pros: [
            'Always current, syncs automatically, no re-uploading',
            'Live revenue and cash flow appear on your dashboard',
            'Set once, forget forever',
          ],
          best: 'Best if your books are clean and you want a hands-off connection.',
          note: 'Settings → Integrations',
        },
      ],
    },
  },
  {
    icon:     '⚙️',
    label:    'Operations',
    why:      'Shows how the business runs day-to-day, where time goes and where it leaks.',
    examples: [
      'Standard operating procedures (SOPs)',
      'Service delivery or job checklist',
      'Quoting or estimating process',
      'Quality control checklist',
    ],
  },
  {
    icon:     '👥',
    label:    'Team',
    why:      'Reveals your people structure, culture, and capacity gaps.',
    examples: [
      'Employee handbook',
      'Current job descriptions',
      'Org chart',
      'Onboarding or training guide',
    ],
  },
  {
    icon:     '📣',
    label:    'Sales & Marketing',
    why:      'Shows how you win work, and where deals are getting lost.',
    examples: [
      'Past proposals or quotes',
      'Customer testimonials or reviews',
      'Marketing materials or flyers',
      'Lead follow-up process',
    ],
  },
  {
    icon:     '🎯',
    label:    'Strategy',
    why:      'Gives Solomon the longer-term context behind your decisions.',
    examples: [
      'Business plan or growth plan',
      'Competitor research or notes',
      'Customer survey results',
      'Meeting notes or major strategic decisions',
    ],
  },
]

function ComparisonCallout({ comparison, onManualEntry }) {
  const [open,           setOpen]           = useState(false)
  const [expandPlatform, setExpandPlatform] = useState(false)

  return (
    <div className="mt-3 border-t border-ink-100 pt-3">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 text-[10.5px] font-semibold text-brand-600 hover:text-brand-700 transition-colors w-full text-left"
      >
        <span aria-hidden>⚖️</span>
        <span className="flex-1">{comparison.title}</span>
        <span className="text-ink-300 text-[10px]">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="mt-3 space-y-2">
          {(comparison.options ?? []).map(opt => (
            <div key={opt.label} className="rounded-lg border border-ink-100 bg-white p-3">
              <div className="flex items-center gap-1.5 mb-1.5">
                <span aria-hidden className="text-sm">{opt.icon}</span>
                <span className="text-xs font-bold text-ink-900 flex-1">{opt.label}</span>
                {opt.action === 'manual_entry' && onManualEntry && (
                  <button
                    type="button"
                    onClick={onManualEntry}
                    className="text-[10px] font-bold text-brand-600 hover:text-brand-700 transition-colors whitespace-nowrap"
                  >
                    Open form →
                  </button>
                )}
                {opt.note && <span className="text-[10px] text-ink-400">{opt.note}</span>}
              </div>

              <ul className="space-y-1 mb-2">
                {opt.pros.map(p => (
                  <li key={p} className="flex items-start gap-1.5 text-[11px] text-ink-600">
                    <span className="text-green-500 font-bold flex-shrink-0 mt-0.5">✓</span>
                    <span>{p}</span>
                  </li>
                ))}
              </ul>

              {opt.platforms && (
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={() => setExpandPlatform(e => !e)}
                    className="text-[10px] text-ink-400 hover:text-brand-600 transition-colors font-medium"
                  >
                    {expandPlatform ? '▲ Hide' : '▼ Show'} export steps by software
                  </button>
                  {expandPlatform && (
                    <ul className="mt-2 space-y-1.5">
                      {opt.platforms.map(p => (
                        <li key={p.name} className="flex items-start gap-2 text-[11px]">
                          <span className="font-semibold text-ink-700 w-24 flex-shrink-0">{p.name}</span>
                          <span className="text-ink-400">{p.steps}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              <p className="text-[10.5px] text-ink-500 italic leading-relaxed mt-2">{opt.best}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function UploadSuggestionsPanel({ defaultOpen = false, onManualEntry }) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="mb-4 bg-white border border-ink-100 rounded-xl shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-3 px-5 py-3 bg-ink-50 hover:bg-ink-100 transition-colors"
      >
        {/* In a half-width column the label broke onto two centred lines and
            squeezed the hint beside it; keep the label whole and let the hint
            wrap under it, left aligned. */}
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 min-w-0 text-left">
          <span className="text-[10.5px] font-bold uppercase tracking-widest text-ink-700 whitespace-nowrap">
            What to upload
          </span>
          <span className="text-[11px] text-ink-500">
            Ideas, by area. You do not need all of them.
          </span>
        </div>
        <span className="text-ink-400 text-xs flex-shrink-0">
          {open ? '▲ Hide' : '▼ Show'}
        </span>
      </button>

      {open && (
        <div className="p-5">
          <p className="text-sm text-ink-500 leading-relaxed mb-5">
            Solomon reads everything together as one picture of your business. Not file by file.
            Upload whatever you have; even partial docs help.
          </p>

          {/* ⚠️ 2 Sep — Daniel: "is there a guideline we can give clients so
              Solomon reads properly, pulling from different areas, invoice
              numbers or direction?"

              The need is real and his own library proves it: nine files, every
              one filed as "General", three of them named quote.png. Solomon can
              read all three and has no way to tell which job, which version, or
              which is current — so he either hedges or picks one.

              ⚠️ Four rules, not a manual. Anything longer does not get read,
              and every rule here has to earn its place by changing what Solomon
              can actually do with the file. */}
          <div className="mb-6 rounded-xl border border-brand-200 bg-brand-50/40 p-4">
            <p className="text-sm font-bold text-ink-900 mb-2">Four things that make him much better at this</p>
            <ol className="space-y-2 text-[13px] text-ink-700 leading-relaxed list-decimal pl-4">
              <li>
                <span className="font-semibold text-ink-900">Name the file so it says what and when.</span>{' '}
                &ldquo;Cascade quote. Mar 2026&rdquo; beats &ldquo;quote.png&rdquo;. Three files
                called quote.png are three files he cannot tell apart.
              </li>
              <li>
                <span className="font-semibold text-ink-900">Pick the category when you upload.</span>{' '}
                It is how he knows a P&amp;L from a handbook before he has read a word of either.
              </li>
              <li>
                <span className="font-semibold text-ink-900">Leave the reference numbers in.</span>{' '}
                An invoice or quote number, the job name, the customer, that is how he ties a
                document to the job it belongs to instead of guessing.
              </li>
              <li>
                <span className="font-semibold text-ink-900">Replace old versions, do not stack them.</span>{' '}
                If two versions of a quote are both here he will read both, and say they disagree
                rather than pick one.
              </li>
            </ol>
            <p className="text-[12px] text-ink-500 mt-3 leading-relaxed">
              None of it is required. He works with whatever he is given. This is just what
              turns &ldquo;a document exists&rdquo; into &ldquo;the Cascade quote says $47,200&rdquo;.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {UPLOAD_CATEGORIES.map(cat => (
              <div
                key={cat.label}
                className="rounded-xl border border-ink-100 bg-ink-50/50 p-4 hover:border-brand-200 hover:bg-brand-50/20 transition-colors"
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xl" aria-hidden>{cat.icon}</span>
                  <span className="text-sm font-bold text-ink-900">{cat.label}</span>
                </div>
                <p className="text-[11px] text-ink-400 leading-relaxed mb-3">{cat.why}</p>
                <ul className="space-y-1">
                  {cat.examples.map(ex => (
                    <li key={ex} className="flex items-start gap-1.5 text-xs text-ink-600">
                      <span className="text-brand-400 font-bold flex-shrink-0 mt-0.5">·</span>
                      <span>{ex}</span>
                    </li>
                  ))}
                </ul>
                {cat.comparison && (
                  <ComparisonCallout comparison={cat.comparison} onManualEntry={onManualEntry} />
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================================================
// File row (divider style — no individual card)
// ============================================================================

function Row({ file, expanded, onToggle, onDelete }) {
  return (
    <div className="border-b border-ink-100 last:border-0">
      <button
        type="button" onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-ink-50 transition-colors"
      >
        <span className="text-lg flex-shrink-0" aria-hidden>{iconFor(file)}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <div className="text-sm font-semibold text-ink-900 truncate">{file.title}</div>
            {file.status === 'failed' && (
              <span className="text-[10px] uppercase tracking-wide text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded flex-shrink-0">
                text unread
              </span>
            )}
          </div>
          <div className="text-xs text-ink-400 mt-0.5">
            {[labelForKind(file.kind), formatBytes(file.size_bytes), formatDate(file.created_at)].filter(Boolean).join(' · ')}
          </div>
        </div>
        <span className="text-ink-300 text-sm">{expanded ? '−' : '+'}</span>
      </button>

      {expanded && (
        <div className="px-4 pb-4 pt-1 bg-ink-50/40 space-y-3">
          {file.notes && (
            <div>
              <div className="text-[10.5px] font-semibold uppercase tracking-widest text-ink-400 mb-1">Notes</div>
              <p className="text-sm text-ink-700">{file.notes}</p>
            </div>
          )}
          <DetailBody file={file} />
          <div className="flex items-center gap-2 pt-1">
            <OpenButton file={file} />
            <button
              type="button"
              onClick={onDelete}
              className="px-3 py-1.5 rounded-lg border border-ink-200 hover:bg-red-50 hover:border-red-200 hover:text-red-700 text-xs text-ink-500 font-medium transition-colors"
            >
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function DetailBody({ file }) {
  const [full, setFull]   = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const data = await getKnowledgeFile(file.id)
        if (!cancelled) setFull(data)
      } catch (err) {
        if (!cancelled) setError(err.message)
      }
    })()
    return () => { cancelled = true }
  }, [file.id])

  if (error) return <p className="text-sm text-red-700">Couldn't load preview: {error}</p>
  if (!full)  return <div className="h-12 bg-ink-100 rounded animate-pulse" />

  if (full.status === 'failed' || !full.extracted_text) {
    return (
      <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800">
        We couldn't read the text from this file. Try re-uploading, or open the file directly.
      </div>
    )
  }

  return (
    <div>
      <div className="text-[10.5px] font-semibold uppercase tracking-widest text-ink-400 mb-1">Preview</div>
      <div className="bg-white border border-ink-100 rounded-lg p-3 max-h-64 overflow-y-auto whitespace-pre-wrap text-xs text-ink-700 font-mono leading-relaxed">
        {full.extracted_text.slice(0, 5000)}
        {full.extracted_text.length > 5000 && '\n\n[… truncated for preview]'}
      </div>
    </div>
  )
}

function OpenButton({ file }) {
  const [busy, setBusy] = useState(false)
  const onClick = async () => {
    setBusy(true)
    try {
      const url = await getSignedUrl(file.file_path, 60)
      window.open(url, '_blank', 'noopener')
    } catch (err) {
      alert(`Couldn't open the file: ${err.message}`)
    } finally {
      setBusy(false)
    }
  }
  return (
    <button
      type="button" onClick={onClick} disabled={busy}
      className="px-3 py-1.5 rounded-lg bg-white border border-ink-200 hover:bg-ink-50 text-xs text-ink-700 font-medium disabled:opacity-50 transition-colors"
    >
      {busy ? 'Opening…' : 'Open file ↗'}
    </button>
  )
}

function FilterChip({ label, count, active, onClick }) {
  return (
    <button
      type="button" onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
        active
          ? 'bg-ink-900 text-white border-ink-900'
          : 'bg-white text-ink-600 border-ink-200 hover:border-ink-300'
      }`}
    >
      <span>{label}</span>
      <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${active ? 'bg-white/20' : 'bg-ink-100 text-ink-500'}`}>
        {count}
      </span>
    </button>
  )
}

function EmptyState({ onUpload, onCloudImport, onManualEntry }) {
  return (
    <div className="space-y-5">
      {/* ⭐ ONE primary action, one quiet alternative.
          This card used to carry a dark "KNOWLEDGE LIBRARY" bar above it,
          which repeated the "UPLOADED · Your knowledge files" header already
          sitting directly above — two labels, one section, no new information.
          It is gone, and the card is now a drop target rather than a poster
          with buttons on it: dropping files is what people try first.

          ⚠️ onDrop used to call onUpload() and never read e.dataTransfer — so
          the card invited a drop, opened an EMPTY dialog, and made the owner
          pick the same files a second time. Discarding a correct drop is
          worse than not offering one. */}
      <div
        onDragOver={e => { e.preventDefault(); e.currentTarget.dataset.over = '1' }}
        onDragLeave={e => { delete e.currentTarget.dataset.over }}
        onDrop={async e => {
          e.preventDefault()
          delete e.currentTarget.dataset.over
          const dropped = await expandDroppedItems(e.dataTransfer)
          onUpload(dropped)
        }}
        className="bg-white border-2 border-dashed border-ink-200 rounded-2xl p-10 text-center transition-colors data-[over]:border-brand-400 data-[over]:bg-brand-50/30"
      >
        <div className="text-4xl mb-3" aria-hidden>📚</div>
        <h2 className="text-xl font-bold text-ink-900 mb-2 tracking-tight">
          Teach Solomon about your business
        </h2>
        <p className="text-sm text-ink-500 max-w-md mx-auto mb-6 leading-relaxed">
          Procedures, price lists, financials, contracts. He reads them together
          as one picture rather than file by file, so even partial documents help.
        </p>

        <button
          type="button" onClick={onUpload}
          className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-gold-gradient text-white text-sm font-bold tracking-wide glow-gold-sm hover:glow-gold transition-all duration-200"
        >
          <span aria-hidden>＋</span> Choose files
        </button>

        <p className="text-xs text-ink-400 mt-4">
          or drop them here · or{' '}
          <button
            type="button" onClick={onCloudImport}
            className="text-brand-700 font-semibold underline underline-offset-2 hover:text-brand-800"
          >
            import from Google Drive or OneDrive
          </button>
        </p>

        <p className="text-[11px] text-ink-300 mt-5">
          {/* ⚠️ 2 Sep — the photo capability was SIXTH in a list of file formats,
              which is not the same as telling anyone about it. Daniel: "having
              that explained to the user is important, it's a great feature it
              reading hand notes." It is genuinely the least expected thing the
              product does — an owner does not assume he can photograph the back
              of an envelope — and it was written as a footnote about MIME types. */}
          <span className="text-ink-600">Photograph a handwritten page and it gets read.</span>{' '}
          A whiteboard, a site note, the back of an envelope, Solomon reads the writing,
          not just the picture. Or upload PDF, Word, Excel, CSV, text, Markdown ·
          {' '}{MAX_MB} MB max · only you and your team can see these
        </p>
      </div>

      <UploadSuggestionsPanel defaultOpen={true} onManualEntry={onManualEntry} />
    </div>
  )
}

// ============================================================================
// Helpers
// ============================================================================

function sanitizeWeight(w) {
  const n = Number(w)
  if (!Number.isFinite(n)) return 5
  return Math.max(1, Math.min(10, Math.round(n)))
}

function iconFor(file) {
  const t = (file.mime_type || '').toLowerCase()
  if (t.includes('pdf'))    return '📕'
  if (t.startsWith('text/')) return '📝'
  return '📄'
}

function labelForKind(kind) {
  return KIND_OPTIONS.find(o => o.value === kind)?.label ?? kind
}

function formatBytes(b) {
  if (!b) return ''
  if (b < 1024)         return `${b} B`
  if (b < 1024 * 1024)  return `${(b / 1024).toFixed(0)} KB`
  return `${(b / 1024 / 1024).toFixed(1)} MB`
}

function formatDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

function formatRelative(iso) {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const mins  = Math.floor(diff / 60_000)
  if (mins < 1)   return 'just now'
  if (mins < 60)  return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7)   return `${days}d ago`
  return `${Math.floor(days / 7)}w ago`
}
