import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { runToolCall, HAIKU } from '../../lib/anthropic'
import ToolDisclaimer from '../../components/tools/ToolDisclaimer'
import ContextUsedLine from '../../components/tools/ContextUsedLine'
import { summarizeContext } from '../../lib/toolContextSummary'
import BackToTools from '../../components/tools/BackToTools'
import {
  uploadKnowledgeFile,
  listKnowledgeFiles,
  deleteKnowledgeFile,
  getSignedUrl,
  validateFile,
} from '../../lib/knowledgeFiles'

/**
 * Safety & Compliance — /tools/safety
 *
 * Layout (redesigned):
 *   1. Dark page header
 *   2. Two-column card: Location context (left) + Ask question (right)
 *   3. Answer panel — surfaces doc matches first, then AI + regulatory sources
 *   4. Collapsible: Document vault
 *   5. Collapsible: Full regulation scan (AI research by jurisdiction)
 */

// ── Cache keys ────────────────────────────────────────────────────────────────

function contextCacheKey(companyId) { return `growthos:compliance-context:${companyId}` }
function renewalKey(companyId, docId) { return `growthos:safety-renewal:${companyId}:${docId}` }

// ── Renewal date helpers ──────────────────────────────────────────────────────

function getRenewalDate(companyId, docId) {
  try { return localStorage.getItem(renewalKey(companyId, docId)) || null }
  catch { return null }
}

function setRenewalDate(companyId, docId, iso) {
  try {
    if (iso) localStorage.setItem(renewalKey(companyId, docId), iso)
    else     localStorage.removeItem(renewalKey(companyId, docId))
  } catch { /* storage blocked */ }
}

/** Returns days until expiry. Negative = overdue. Null if no date set. */
function daysUntil(iso) {
  if (!iso) return null
  const target = new Date(`${iso}T23:59:59`).getTime()
  if (!Number.isFinite(target)) return null
  return Math.floor((target - Date.now()) / (1000 * 60 * 60 * 24))
}

// ── System prompt for the ask flow ────────────────────────────────────────────
// ⚠️ 18 Oct 2026: this prompt used to demand "the exact regulatory body and
// regulation name (e.g. ...Part 6...)" from a model with no search and no
// regulation text. Asked about fall protection in BC it answered "OHS
// Regulation Part 3.1" (it is Part 11) and gave an unverified phone number.
// Numbers now only come from the owner's own documents.

function buildAskSystemPrompt({ industry, country, province, city, docTexts }) {
  const location = [city, province, country].filter(Boolean).join(', ')

  return `You are a compliance research assistant helping a small business owner find safety and regulatory information. You are knowledgeable, direct, and practical.

Business context:
- Industry: ${industry || 'Not specified'}
- Location: ${location || 'Not specified'}

${docTexts ? `The owner has uploaded these compliance documents. SEARCH THESE FIRST before answering:\n\n${docTexts}\n\n` : ''}

When answering a compliance question:
1. If the answer is found in the owner's uploaded documents, START by quoting or summarising the relevant section and say which document it came from. Section numbers, phone numbers and figures may be repeated from those documents exactly as written.
2. Then give the general regulatory picture: which authority is responsible (e.g. WorkSafeBC, CCOHS, OSHA, the provincial labour ministry), which body of rules covers it, and the topic within those rules (e.g. "WorkSafeBC's fall protection requirements in the BC OHS Regulation").
3. NEVER state a part, section, clause or CFR number, a phone number, or a dollar fine that did not come from the owner's documents. You are answering from memory with nothing to check it against, and a wrong section number sent to a regulator is worse than none. Name the topic and tell them where to look it up on the authority's official website instead.
4. Say plainly when something depends on details you do not have (height, the type of work, the number of workers), and what to check.
5. Be specific to the location and industry provided.
6. End with a one-line reminder that this is general information, not legal advice, and they should verify with the relevant authority.

Format your response clearly with headings if covering multiple points. Be thorough but concise.`
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' })
}
function fmtSize(bytes) {
  if (!bytes) return ''
  if (bytes < 1024)        return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Safety() {
  const { profile } = useAuth()
  const companyId = profile?.company_id
  const userId    = profile?.id

  // Business context
  const [country,  setCountry]  = useState('Canada')
  const [province, setProvince] = useState('')
  const [city,     setCity]     = useState('')
  const [industry, setIndustry] = useState('')

  // Ask flow
  const [question,   setQuestion]   = useState('')
  const [answers,    setAnswers]     = useState([])   // [{ question, answer, docsSearched }]
  const [asking,     setAsking]      = useState(false)
  const [askError,   setAskError]    = useState('')
  const answerRef = useRef()

  // Document vault
  const [vaultOpen,  setVaultOpen]  = useState(true)
  const [docs,       setDocs]       = useState([])
  const [uploading,  setUploading]  = useState(false)
  const [uploadErr,  setUploadErr]  = useState('')
  const [uploadPct,  setUploadPct]  = useState(0)
  const [dragging,   setDragging]   = useState(false)
  const fileRef = useRef()

  // Renewal-date overlay — keyed by doc.id, hydrated from localStorage.
  // Bumped on every save so the alerts banner re-derives.
  const [renewalsBump, setRenewalsBump] = useState(0)
  function recordRenewal(docId, iso) {
    if (!companyId) return
    setRenewalDate(companyId, docId, iso)
    setRenewalsBump(n => n + 1)
  }
  // What fed the answer: the location/industry context the owner set, plus
  // any uploaded compliance docs the prompt searches first.
  const contextSummary = useMemo(() => summarizeContext({
    business: industry ? { industry } : null,
    knowledge_files: docs.length > 0
      ? { included: docs.map(d => ({ title: d.title, kind: 'legal' })) }
      : null,
  }), [industry, docs])

  // Derived alerts list (overdue + within 30 days), oldest-due first.
  const alerts = useMemo(() => {
    if (!companyId) return []
    return docs
      .map(d => {
        const iso = getRenewalDate(companyId, d.id)
        const days = daysUntil(iso)
        if (days === null || days > 30) return null
        return { doc: d, iso, days }
      })
      .filter(Boolean)
      .sort((a, b) => a.days - b.days)
  }, [companyId, docs, renewalsBump])

  // ── Load context + cached scan ─────────────────────────────────────────────
  useEffect(() => {
    if (!companyId) return
    supabase.from('business_profiles').select('industry, location').eq('company_id', companyId).maybeSingle()
      .then(({ data }) => {
        try {
          const saved = JSON.parse(localStorage.getItem(contextCacheKey(companyId)) || '{}')
          setCountry(saved.country   || 'Canada')
          setProvince(saved.province || '')
          setCity(saved.city         || data?.location || '')
          setIndustry(saved.industry || data?.industry || '')
        } catch {
          setCity(data?.location || '')
          setIndustry(data?.industry || '')
        }
      }).catch(() => {})
  }, [companyId])

  useEffect(() => {
    if (!companyId) return
    listKnowledgeFiles(companyId).then(all => setDocs(all.filter(d => d.kind === 'legal'))).catch(() => {})
  }, [companyId])

  function saveContext(patch) {
    if (!companyId) return
    const next = { country, province, city, industry, ...patch }
    try { localStorage.setItem(contextCacheKey(companyId), JSON.stringify(next)) } catch {}
    if ('country'  in patch) setCountry(patch.country)
    if ('province' in patch) setProvince(patch.province)
    if ('city'     in patch) setCity(patch.city)
    if ('industry' in patch) setIndustry(patch.industry)
  }

  // ── Ask a question ─────────────────────────────────────────────────────────
  async function handleAsk(overrideQ) {
    const q = (overrideQ ?? question).trim()
    if (!q || asking) return
    setQuestion('')
    setAsking(true)
    setAskError('')

    try {
      // 1. Fetch uploaded legal docs
      const { data: legalDocs } = await supabase
        .from('knowledge_files')
        .select('title, extracted_text')
        .eq('company_id', companyId)
        .eq('kind', 'legal')
        .not('extracted_text', 'is', null)

      const docsSearched = legalDocs?.filter(d => d.extracted_text?.trim()) ?? []
      const docTexts = docsSearched.length
        ? docsSearched.map(d => `--- ${d.title} ---\n${d.extracted_text.trim()}`).join('\n\n')
        : null

      const systemPrompt = buildAskSystemPrompt({ industry, country, province, city, docTexts })

      // Build full conversation history for context
      const history = answers.flatMap(a => [
        { role: 'user',      content: a.question },
        { role: 'assistant', content: a.answer   },
      ])

      const reply = await runToolCall({
        companyId,
        userId,
        toolId:       'safety-vault',
        kind:         'generate',
        model:        HAIKU,
        systemPrompt,
        messages:     [...history, { role: 'user', content: q }],
        maxTokens:    1200,
      })

      setAnswers(prev => [...prev, { question: q, answer: reply, docsSearched: docsSearched.map(d => d.title) }])
      setTimeout(() => answerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100)
    } catch (err) {
      setAskError(err?.message || 'Something went wrong. Please try again.')
    } finally {
      setAsking(false)
    }
  }

  // ── Upload ─────────────────────────────────────────────────────────────────
  async function handleUpload(file) {
    if (!file) return
    const err = validateFile(file)
    if (err) { setUploadErr(err); return }
    setUploading(true); setUploadErr(''); setUploadPct(0)
    try {
      const newDoc = await uploadKnowledgeFile(file, {
        companyId, userId, kind: 'legal',
        title: file.name.replace(/\.[^.]+$/, ''),
        onProgress: pct => setUploadPct(pct),
      })
      setDocs(prev => [newDoc, ...prev])
    } catch (err) {
      setUploadErr(err?.message || 'Upload failed.')
    } finally {
      setUploading(false); setUploadPct(0)
    }
  }

  async function handleDelete(doc) {
    if (!window.confirm(`Delete "${doc.title}"?`)) return
    await deleteKnowledgeFile(doc.id, doc.file_path).catch(() => {})
    setDocs(prev => prev.filter(d => d.id !== doc.id))
  }

  async function handleView(doc) {
    const url = await getSignedUrl(doc.file_path, 120).catch(() => null)
    if (url) window.open(url, '_blank', 'noopener')
  }


  return (
    <div className="min-h-screen bg-ink-50">

      {/* ── Dark header ───────────────────────────────────────────────────── */}
      <div className="bg-white border-b border-ink-100">
        <div className="max-w-5xl mx-auto px-8 py-5">
          <BackToTools className="mb-2.5" />
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] mb-0.5 text-brand-700">
            Safety
          </div>
          <h1 className="text-xl font-bold text-ink-900 leading-tight">
            Your safety documents, and the rules where you work
          </h1>
          <p className="text-sm text-ink-500 mt-0.5 max-w-2xl">
            Two things in one place: the safety documents your own company has, and the rules for your trade in the area you work in.
            Ask a question and the answer is drawn from both, with the source shown.
          </p>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-8 py-6 space-y-5">

        {/* ── Renewal alerts (top of page when anything is within 30 days) ── */}
        {alerts.length > 0 && (
          <RenewalAlertsBanner
            alerts={alerts}
            onOpenVault={() => setVaultOpen(true)}
          />
        )}

        {/* ── Disclaimer ──────────────────────────────────────────────────── */}
        <Disclaimer />

        {/* ── Main ask card ────────────────────────────────────────────────── */}
        <div className="bg-white border border-ink-100 rounded-xl shadow-sm overflow-hidden">
          <div className="bg-ink-900 px-5 py-3.5">
            <span className="text-[10.5px] font-semibold uppercase tracking-widest text-brand-400">
              Ask about the rules where you work
            </span>
          </div>

          <div className="grid md:grid-cols-2 gap-0 divide-y md:divide-y-0 md:divide-x divide-ink-100">

            {/* Left: location context */}
            <div className="p-5 space-y-4">
              <p className="text-xs font-semibold text-ink-500 uppercase tracking-wider">Where you work and what you do</p>

              {/* Country toggle */}
              <div>
                <label className="block text-xs font-semibold text-ink-600 mb-1.5">Country</label>
                <div className="flex gap-2">
                  {['Canada', 'United States'].map(c => (
                    <button key={c} type="button" onClick={() => saveContext({ country: c })}
                      className={`flex-1 py-2 rounded-lg border text-xs font-semibold transition-colors ${
                        country === c ? 'bg-brand-600 border-brand-600 text-white' : 'border-ink-200 text-ink-500 hover:border-brand-300 bg-white'
                      }`}
                    >
                      {c === 'Canada' ? '🇨🇦 Canada' : '🇺🇸 United States'}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-ink-600 mb-1.5">Industry</label>
                <input type="text" value={industry} onChange={e => saveContext({ industry: e.target.value })}
                  placeholder="e.g. Construction, Healthcare, Food service…"
                  className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm text-ink-800 focus:outline-none focus:ring-2 focus:ring-brand-300"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-ink-600 mb-1.5">
                  {country === 'United States' ? 'State' : 'Province / Territory'}
                </label>
                <input type="text" value={province} onChange={e => saveContext({ province: e.target.value })}
                  placeholder={country === 'United States' ? 'e.g. Texas, California…' : 'e.g. British Columbia, Ontario…'}
                  className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm text-ink-800 focus:outline-none focus:ring-2 focus:ring-brand-300"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-ink-600 mb-1.5">City / Municipality</label>
                <input type="text" value={city} onChange={e => saveContext({ city: e.target.value })}
                  placeholder="e.g. Vancouver, Calgary, Austin…"
                  className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm text-ink-800 focus:outline-none focus:ring-2 focus:ring-brand-300"
                />
              </div>

              {/* Docs indicator */}
              <div className="flex items-center gap-2 pt-1">
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${docs.length > 0 ? 'bg-green-500' : 'bg-ink-300'}`} />
                <span className="text-[11px] text-ink-400">
                  {docs.length > 0
                    ? `${docs.length} compliance doc${docs.length > 1 ? 's' : ''} uploaded. Will be searched first`
                    : 'No docs uploaded yet. Answers will use AI + regulatory knowledge'}
                </span>
              </div>
            </div>

            {/* Right: question input */}
            <div className="p-5 flex flex-col">
              <p className="text-xs font-semibold text-ink-500 uppercase tracking-wider mb-4">Your question</p>

              <textarea
                value={question}
                onChange={e => setQuestion(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleAsk() }}
                placeholder="e.g. What are the WorkSafe regulations on asbestos removal in British Columbia? Do I need a specific licence?"
                rows={5}
                className="flex-1 w-full rounded-xl border border-ink-200 px-4 py-3 text-sm text-ink-800 resize-none focus:outline-none focus:ring-2 focus:ring-brand-300 leading-relaxed"
              />

              <div className="mt-3 flex items-center justify-between gap-3">
                <span className="text-[10px] text-ink-400">⌘↵ to send</span>
                <button
                  type="button"
                  onClick={() => handleAsk()}
                  disabled={asking || !question.trim()}
                  className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all duration-300 disabled:cursor-not-allowed ${
                    asking
                      ? 'bg-ink-900 border border-brand-500/30 text-brand-400 min-w-[180px] justify-center'
                      : 'bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white'
                  }`}
                >
                  {asking ? (
                    <AskingLabel />
                  ) : (
                    <>
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth="2">
                        <circle cx="6.5" cy="6.5" r="4.5"/>
                        <path strokeLinecap="round" d="M10.5 10.5l3 3"/>
                      </svg>
                      Search &amp; Ask
                    </>
                  )}
                </button>
              </div>

              {askError && (
                <p className="mt-2 text-xs text-red-600 font-medium">{askError}</p>
              )}
            </div>
          </div>
        </div>

        {/* ── Answer thread ────────────────────────────────────────────────── */}
        {answers.length > 0 && (
          <div className="space-y-4" ref={answerRef}>
            <ContextUsedLine summary={contextSummary} />
            {answers.map((a, i) => (
              <AnswerCard key={i} question={a.question} answer={a.answer} docsSearched={a.docsSearched} />
            ))}
            {asking && <ThinkingCard />}
          </div>
        )}
        {answers.length === 0 && asking && <ThinkingCard />}

        {/* ── Document vault (collapsible) ─────────────────────────────────── */}
        <CollapsibleSection
          title="Your company's safety documents"
          badge={docs.length ? `${docs.length} file${docs.length > 1 ? 's' : ''}` : null}
          badgeTone={docs.length ? 'green' : null}
          open={vaultOpen}
          onToggle={() => setVaultOpen(o => !o)}
          hint="Your own policies, certificates, training records and inspection reports. These are read first when you ask a question below."
        >
          {/* Drop zone */}
          <div
            className={`mx-5 mt-5 border-2 border-dashed rounded-xl p-6 text-center transition-colors cursor-pointer ${
              dragging ? 'border-brand-400 bg-brand-50' : 'border-ink-200 hover:border-brand-300 hover:bg-ink-50'
            }`}
            onDragOver={e => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer?.files?.[0]; if (f) handleUpload(f) }}
            onClick={() => fileRef.current?.click()}
          >
            <input ref={fileRef} type="file" accept=".pdf,.txt,.md,.csv" className="hidden"
              onChange={e => handleUpload(e.target.files?.[0])} />
            {uploading ? (
              <div className="space-y-2">
                <p className="text-sm font-semibold text-ink-600">Uploading…</p>
                <div className="mx-auto w-48 h-1.5 bg-ink-100 rounded-full overflow-hidden">
                  <div className="h-full bg-brand-500 rounded-full transition-all" style={{ width: `${uploadPct}%` }} />
                </div>
              </div>
            ) : (
              <>
                <div className="text-3xl mb-2 opacity-40">📁</div>
                <p className="text-sm font-semibold text-ink-700">Drop a compliance document here, or click to browse</p>
                <p className="text-xs text-ink-400 mt-1">PDF, TXT, Markdown, CSV · Max 10 MB</p>
                <p className="text-[11px] text-ink-400 mt-2">Licences · WCB certificates · Insurance · Safety policies · Inspection records</p>
              </>
            )}
          </div>
          {uploadErr && <p className="mx-5 mt-2 text-xs text-red-600 font-medium">{uploadErr}</p>}

          {docs.length > 0 ? (
            <div className="mt-4 mb-5 divide-y divide-ink-50">
              {docs.map(doc => (
                <DocRow
                  key={doc.id}
                  doc={doc}
                  renewalIso={companyId ? getRenewalDate(companyId, doc.id) : null}
                  onSetRenewal={iso => recordRenewal(doc.id, iso)}
                  onView={() => handleView(doc)}
                  onDelete={() => handleDelete(doc)}
                />
              ))}
            </div>
          ) : (
            !uploading && (
              <p className="px-5 py-6 text-sm text-ink-400 text-center">
                No compliance documents yet. Upload your business licence or WCB certificate to get started.
              </p>
            )
          )}
        </CollapsibleSection>

        {/* ── Footer disclaimer ─────────────────────────────────────────────── */}
        <ToolDisclaimer toolId="safety-vault" />
      </div>
    </div>
  )
}

// ── Asking label (cycles through steps inside the button) ─────────────────────

const ASK_STEPS = [
  'Searching your docs…',
  'Checking regulations…',
  'Finding the authority…',
  'Writing your answer…',
]

function AskingLabel() {
  const [step, setStep] = useState(0)

  useEffect(() => {
    const t = setInterval(() => setStep(s => (s + 1) % ASK_STEPS.length), 2000)
    return () => clearInterval(t)
  }, [])

  return (
    <span className="flex items-center gap-2">
      <span className="w-1.5 h-1.5 rounded-full bg-brand-400 animate-pulse flex-shrink-0" />
      <span className="transition-all duration-300">{ASK_STEPS[step]}</span>
    </span>
  )
}

// ── Answer card ───────────────────────────────────────────────────────────────

function AnswerCard({ question, answer, docsSearched = [] }) {
  return (
    <div className="bg-white border border-ink-100 rounded-xl shadow-sm overflow-hidden">
      {/* Question header */}
      <div className="bg-ink-50 border-b border-ink-100 px-5 py-3 flex items-start gap-3">
        <svg className="w-4 h-4 text-brand-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth="2">
          <circle cx="6.5" cy="6.5" r="4.5"/>
          <path strokeLinecap="round" d="M10.5 10.5l3 3"/>
        </svg>
        <p className="text-sm font-semibold text-ink-800">{question}</p>
      </div>

      {/* Doc sources searched */}
      {docsSearched.length > 0 && (
        <div className="px-5 py-2.5 bg-green-50 border-b border-green-100 flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-bold uppercase tracking-wider text-green-700">Docs searched:</span>
          {docsSearched.map(title => (
            <span key={title} className="text-[11px] font-medium text-green-800 bg-white border border-green-200 px-2 py-0.5 rounded-full">
              📄 {title}
            </span>
          ))}
        </div>
      )}

      {/* Answer */}
      <div className="px-5 py-4">
        <div className="text-sm text-ink-800 leading-relaxed whitespace-pre-wrap">
          {answer}
        </div>
      </div>
    </div>
  )
}

function ThinkingCard() {
  return (
    <div className="bg-white border border-ink-100 rounded-xl shadow-sm px-5 py-4">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          {[0, 150, 300].map(delay => (
            <span key={delay} className="w-2 h-2 rounded-full bg-brand-400 animate-bounce"
              style={{ animationDelay: `${delay}ms` }} />
          ))}
        </div>
        <span className="text-sm text-ink-400">Searching your docs and regulatory sources…</span>
      </div>
    </div>
  )
}

// ── Collapsible section ───────────────────────────────────────────────────────

function CollapsibleSection({ title, badge, badgeTone, open, onToggle, hint, action, children }) {
  const badgeClass = {
    green: 'bg-green-100 text-green-700',
    brand: 'bg-brand-100 text-brand-700',
  }[badgeTone] ?? 'bg-ink-100 text-ink-500'

  return (
    <div className="bg-white border border-ink-100 rounded-xl shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full bg-ink-900 px-5 py-3.5 flex items-center justify-between gap-3 text-left"
      >
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <span className="text-[10.5px] font-semibold uppercase tracking-widest text-brand-400">
            {title}
          </span>
          {badge && (
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap flex-shrink-0 ${badgeClass}`}>
              {badge}
            </span>
          )}
          {hint && (
            <span className="text-[11px] text-ink-600 truncate hidden sm:block">{hint}</span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0" onClick={e => e.stopPropagation()}>
          {action}
          <span className={`text-ink-400 text-sm transition-transform ${open ? 'rotate-180' : ''}`}>▾</span>
        </div>
      </button>

      {open && children}
    </div>
  )
}

// ── Disclaimer ────────────────────────────────────────────────────────────────

// ⚠️ 10 Oct, Daniel: this page "needs to have a disclaimer". It had one, but an
// ✕ hid it for the rest of the session, so most of the time it was not there.
// On a page that answers questions about safety law it stays put.
function Disclaimer() {
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
      <span className="text-xl flex-shrink-0 mt-0.5" aria-hidden>⚠️</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-amber-900 mb-0.5">Please read this first</p>
        <p className="text-[13px] text-amber-900 leading-relaxed">
          This page gives general information to help you find the right rule. It is not legal advice and it is not a safety program.
          Rules change, and they differ from one area to the next.
          <strong> Before you act on anything here, check it with the regulator for your area, a lawyer, or a certified safety professional.</strong>
        </p>
      </div>
    </div>
  )
}

// ── Renewal alerts banner ─────────────────────────────────────────────────────

function RenewalAlertsBanner({ alerts, onOpenVault }) {
  // Tone is driven by the soonest-due item.
  const soonest = alerts[0]?.days ?? 0
  const tone = soonest < 0
    ? { bg: 'bg-red-50',    border: 'border-red-200',    text: 'text-red-900',    accent: 'text-red-700',    icon: '⚠️' }
    : soonest <= 7
      ? { bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-900', accent: 'text-orange-700', icon: '⏰' }
      : { bg: 'bg-amber-50',  border: 'border-amber-200',  text: 'text-amber-900',  accent: 'text-amber-700',  icon: '🗓️' }

  return (
    <div className={`${tone.bg} ${tone.border} border rounded-xl px-5 py-4 flex items-start gap-3`}>
      <span className="text-2xl flex-shrink-0 leading-none mt-0.5">{tone.icon}</span>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-bold ${tone.text} mb-1`}>
          {alerts.length} compliance item{alerts.length > 1 ? 's' : ''} need{alerts.length === 1 ? 's' : ''} attention
        </p>
        <ul className="space-y-1">
          {alerts.slice(0, 4).map(({ doc, iso, days }) => (
            <li key={doc.id} className="flex items-baseline gap-2 text-xs">
              <span className={`font-semibold ${tone.accent} whitespace-nowrap`}>
                {days < 0
                  ? `Overdue by ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'}`
                  : days === 0
                    ? 'Expires today'
                    : `${days} day${days === 1 ? '' : 's'} left`}
              </span>
              <span className={`${tone.text} truncate`}>· {doc.title}</span>
              <span className={`${tone.accent} opacity-60 whitespace-nowrap`}>({fmtDate(iso)})</span>
            </li>
          ))}
          {alerts.length > 4 && (
            <li className={`text-[11px] ${tone.accent} opacity-70`}>
              +{alerts.length - 4} more, open the vault to see all
            </li>
          )}
        </ul>
        <button
          type="button"
          onClick={onOpenVault}
          className={`mt-2 text-[11px] font-bold ${tone.accent} hover:underline`}
        >
          Open vault →
        </button>
      </div>
    </div>
  )
}

// ── Document row ──────────────────────────────────────────────────────────────

function DocRow({ doc, renewalIso, onSetRenewal, onView, onDelete }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft]     = useState(renewalIso ?? '')
  const days = daysUntil(renewalIso)

  // Pill colour for the renewal date — drives the banner consistency
  const renewalPill = (() => {
    if (days === null)         return null
    if (days < 0)               return { cls: 'bg-red-100 text-red-700 border-red-200',       label: `Overdue · ${fmtDate(renewalIso)}` }
    if (days <= 7)              return { cls: 'bg-orange-100 text-orange-700 border-orange-200', label: `${days}d left · ${fmtDate(renewalIso)}` }
    if (days <= 30)             return { cls: 'bg-amber-100 text-amber-700 border-amber-200', label: `${days}d left · ${fmtDate(renewalIso)}` }
    return { cls: 'bg-ink-50 text-ink-500 border-ink-200', label: `Renews ${fmtDate(renewalIso)}` }
  })()

  function handleSave() {
    onSetRenewal(draft || null)
    setEditing(false)
  }
  function handleClear() {
    setDraft('')
    onSetRenewal(null)
    setEditing(false)
  }

  return (
    <div className="px-5 py-3 hover:bg-ink-50 transition-colors group">
      <div className="flex flex-wrap sm:flex-nowrap items-center gap-x-3 gap-y-1.5">
        <span className="text-xl flex-shrink-0">{/pdf/i.test(doc.mime_type) ? '📄' : '📝'}</span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-ink-800 truncate">{doc.title}</div>
          <div className="text-[11px] text-ink-400 flex items-center gap-2 flex-wrap">
            <span>{fmtDate(doc.created_at)} · {fmtSize(doc.size_bytes)}</span>
            {doc.status === 'failed' && <span className="text-amber-600 font-medium">⚠ could not read</span>}
            {renewalPill && (
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${renewalPill.cls}`}>
                {renewalPill.label}
              </span>
            )}
          </div>
        </div>
        {/* Hover-only on a mouse. On a phone there is no hover: the buttons
            were invisible yet still took the row's width, squeezing the file
            name to "Co…" (11 Nov audit). They sit on their own line there. */}
        <div className="flex items-center gap-1 w-full sm:w-auto pl-8 sm:pl-0 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
          <button type="button" onClick={() => setEditing(v => !v)}
            className="px-2.5 py-1.5 text-[11px] font-semibold text-ink-500 hover:bg-ink-100 rounded-md transition-colors">
            {renewalIso ? 'Edit renewal' : 'Set renewal'}
          </button>
          <button type="button" onClick={onView}
            className="px-2.5 py-1.5 text-[11px] font-semibold text-brand-600 hover:bg-brand-50 rounded-md transition-colors">
            View
          </button>
          <button type="button" onClick={onDelete}
            className="px-2.5 py-1.5 text-[11px] font-semibold text-red-500 hover:bg-red-50 rounded-md transition-colors">
            Delete
          </button>
        </div>
      </div>

      {editing && (
        <div className="mt-2.5 ml-9 flex items-center gap-2 flex-wrap">
          <label className="text-[11px] font-semibold text-ink-600">Renewal date:</label>
          <input
            type="date" max="9999-12-31"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            className="rounded-md border border-ink-200 px-2 py-1 text-xs text-ink-800 focus:outline-none focus:ring-2 focus:ring-brand-300"
          />
          <button type="button" onClick={handleSave}
            className="px-3 py-1 text-[11px] font-bold text-white bg-brand-600 hover:bg-brand-700 rounded-md">
            Save
          </button>
          {renewalIso && (
            <button type="button" onClick={handleClear}
              className="px-3 py-1 text-[11px] font-semibold text-red-500 hover:bg-red-50 rounded-md">
              Clear
            </button>
          )}
          <button type="button" onClick={() => { setDraft(renewalIso ?? ''); setEditing(false) }}
            className="px-3 py-1 text-[11px] font-semibold text-ink-400 hover:text-ink-700">
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}
