import { Fragment, useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import TeamSection from '../components/settings/TeamSection'
import OneOffJob from '../components/dailylogs/OneOffJob'

/**
 * DailyLogs — the office's view of what the crew wrote at the end of the day.
 *
 * ⚠️ THIS IS A READING SCREEN, NOT AN EDITING ONE. The crew's account
 * (what_happened / blockers) is rendered and never editable here. The only
 * thing the office can add is its own note alongside it. That is the whole
 * value of the table — it is the one input in Solomon's context the owner did
 * not write — and a screen that let the office revise it would quietly turn
 * ground truth back into a filtered report.
 *
 * ⚠️ MARKING SOMETHING READ CHANGES NOTHING DOWNSTREAM. Solomon reads every
 * log whether or not it has been reviewed. Review is a pass over the data, not
 * a queue in front of it — otherwise an unreviewed backlog would look
 * identical to a quiet week, and silence would be mistaken for calm.
 *
 * ⚠️ Daniel, 2 Sep: "I don't think the PM needs Solomon for the chat." So this
 * page is deliberately self-contained — it reads daily_logs and nothing else.
 * When roles land, a PM gets this, the board and SOPs, and neither the
 * advisor nor the numbers.
 */
// ⚠️ 2 Sep — dates rendered as raw "2026-09-01". An owner scanning a week of
// logs is asking "was that yesterday or last Tuesday", and an ISO string makes
// him do the arithmetic every row.
function dateBucket(iso) {
  if (!iso) return 'Undated'
  const d = new Date(iso.length <= 10 ? iso + 'T00:00:00' : iso)
  const now = new Date()
  const mid = x => new Date(x.getFullYear(), x.getMonth(), x.getDate())
  const days = Math.round((mid(now) - mid(d)) / 86400000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return 'Earlier this week'
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleString('en-CA', { month: 'long' })
  return d.toLocaleString('en-CA', { month: 'long', year: 'numeric' })
}

function fullDate(iso) {
  if (!iso) return ''
  const d = new Date(iso.length <= 10 ? iso + 'T00:00:00' : iso)
  return d.toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}

// A stable colour per crew member so the eye can track one person down the feed
// instead of getting lost in a wall of identical cards (Daniel, 8 Oct).
const CREW_COLORS = ['#2f8f6b', '#2563eb', '#d97706', '#7c3aed', '#db2777', '#0891b2', '#65a30d', '#c2410c']
function personColor(name) {
  const str = String(name || '')
  let h = 0
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0
  return CREW_COLORS[h % CREW_COLORS.length]
}
function initials(name) {
  return String(name || '?').trim().split(/\s+/).slice(0, 2).map(w => (w[0] || '').toUpperCase()).join('') || '?'
}

function humanDate(iso) {
  if (!iso) return ''
  const d = new Date(`${iso}T00:00:00`)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const days = Math.round((today - d) / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7)  return d.toLocaleDateString(undefined, { weekday: 'long' })
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
}

/**
 * ⭐ THE POINT OF THE PAGE, not a nice-to-have.
 *
 * One locked door is a bad morning. The same locked door four times is a
 * system nobody wrote down — that is Daniel's own insight, and it is the whole
 * reason blockers get collected. But a reverse-chronological list buries it:
 * the two entries that rhyme are days apart and the reader has to hold both in
 * his head to notice.
 *
 * Deliberately crude matching. Real overlap in a foreman's phrasing shows up in
 * the nouns he reaches for, and anything cleverer would need embeddings and
 * would start claiming patterns that are not there. Two logs sharing two
 * uncommon words is a hint worth showing, phrased as a question rather than a
 * finding.
 */
function repeatedBlockers(logs) {
  const STOP = new Set(['the','and','for','was','were','with','that','this','from','they','them','had','has','have','been','into','over','about','again','then','than','when','what','who','not','but','out','all','are','our','you','your','his','her','its','it','on','in','to','of','a','i','at','by','up','me','my','no','so','as','is','be','an','or','if','we','he'])
  const words = t => new Set(String(t).toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(w => w.length > 3 && !STOP.has(w)))
  const withBlockers = logs.filter(l => l.blockers?.trim())
  // Matching logs are joined into one GROUP. Returning pairs showed one gate
  // locked three times as two pairs, the same log printed in both (11 Nov
  // audit). A group lists each day once.
  const parent = withBlockers.map((_, i) => i)
  const root = i => (parent[i] === i ? i : (parent[i] = root(parent[i])))
  for (let i = 0; i < withBlockers.length; i++) {
    for (let j = i + 1; j < withBlockers.length; j++) {
      const a = words(withBlockers[i].blockers)
      const b = words(withBlockers[j].blockers)
      if ([...a].filter(w => b.has(w)).length >= 2) parent[root(j)] = root(i)
    }
  }
  const groups = new Map()
  withBlockers.forEach((l, i) => {
    const r = root(i)
    if (!groups.has(r)) groups.set(r, [])
    groups.get(r).push(l)
  })
  return [...groups.values()]
    .filter(g => g.length >= 2)
    .map(g => [...g].sort((x, y) => String(x.log_date).localeCompare(String(y.log_date))))
    .sort((x, y) => y.length - x.length)
    .slice(0, 2)
}

export default function DailyLogs() {
  const { profile, company } = useAuth()
  const ownerName   = profile?.full_name || profile?.name || profile?.email?.split('@')[0] || 'Your manager'
  const companyName = company?.name || 'the team'
  const [showCrew, setShowCrew] = useState(() => { try { return new URLSearchParams(window.location.search).get('crew') === '1' } catch { return false } })
  const [logs, setLogs]       = useState([])
  const [loading, setLoading] = useState(true)
  const [drafts, setDrafts]   = useState({})   // { [logId]: text }
  const [shareDrafts, setShareDrafts] = useState({}) // { [logId]: bool } crew-visible toggle
  const [saving, setSaving]   = useState(null) // logId currently saving

  // Office notes — the day-to-day things that are not about any one job.
  // Deliberately a separate stream from the crew's logs; see migration 037 for
  // why they are not the same table.
  const [notes, setNotes]         = useState([])
  const [noteDraft, setNoteDraft] = useState('')
  const [noteSaving, setNoteSaving] = useState(false)
  const [noteJob, setNoteJob]       = useState('')
  const [jobs, setJobs]             = useState([])
  // ⚠️ Search filters BOTH streams from one box. Two search fields on one page
  // is a small cruelty — you would have to remember which half you were
  // looking in, which is the thing you came here because you had forgotten.
  const [q, setQ] = useState('')
  const [limit, setLimit] = useState(100)
  const [jobFilter, setJobFilter] = useState('')
  const [sendOpen, setSendOpen] = useState(false)

  const load = useCallback(async () => {
    if (!profile?.company_id) return
    const { data, error } = await supabase
      .from('daily_logs')
      .select('id, log_date, what_happened, blockers, hours_on_site, pm_note, pm_note_shared, reviewed_at, edited_at, staff_member_id, work_order_id, who_on_site, safety_note, injury, injury_detail, incident_report_filed, flha_done, on_site_staff_ids, schedule_status, percent_complete, unplanned_cost, unplanned_cost_note, metrics')
      .eq('company_id', profile.company_id)
      .order('log_date', { ascending: false })
      .limit(limit)
    if (error) { setLoading(false); return }

    // Names are resolved client-side rather than joined, so a deleted staff
    // member leaves the log readable instead of taking it down with them.
    const [{ data: staff }, { data: orders }, { data: co }] = await Promise.all([
      supabase.from('staff_members').select('id, name').eq('company_id', profile.company_id),
      supabase.from('work_orders').select('id, title').eq('company_id', profile.company_id),
      supabase.from('companies').select('log_metrics').eq('id', profile.company_id).maybeSingle(),
    ])
    setJobs(orders ?? [])
    const staffById = new Map((staff ?? []).map(s => [s.id, s.name]))
    const woById    = new Map((orders ?? []).map(o => [o.id, o.title]))
    const metricLabels = new Map(((co?.log_metrics) ?? []).map(m => [m.key, m.label]))

    const { data: noteRows } = await supabase
      .from('office_notes')
      .select('id, note, note_date, created_at, author_profile, status, work_order_id')
      .eq('company_id', profile.company_id)
      .order('created_at', { ascending: false })
      .limit(50)
    setNotes(noteRows ?? [])

    setLogs((data ?? []).map(l => ({
      ...l,
      person: staffById.get(l.staff_member_id) ?? 'Crew',
      job:    woById.get(l.work_order_id) ?? null,
      // Resolved here, where the name map exists. The render used to reach for
      // staffById directly, which is out of scope there and threw on any log
      // that had people ticked as on site.
      onSiteNames: (l.on_site_staff_ids ?? []).map(id => staffById.get(id)).filter(Boolean),
      numbers: l.metrics ? Object.entries(l.metrics).map(([k, v]) => ({ label: metricLabels.get(k) ?? k, value: v })) : [],
    })))
    setLoading(false)
  }, [profile?.company_id, limit])

  useEffect(() => { load() }, [load])

  // "Manage crew" on the Tasks page lands here with ?crew=1. The setup now
  // sits at the bottom of the page, so open it AND bring it into view.
  useEffect(() => {
    if (!showCrew || loading) return
    const t = setTimeout(() => document.getElementById('crew-setup')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading])

  // Deep-link from the dashboard "things on your list" counter: scroll to the
  // notes box so that counter lands somewhere distinct from the logs counter.
  useEffect(() => {
    if (window.location.hash === '#office-notes') {
      const t = setTimeout(() => document.getElementById('office-notes')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 350)
      return () => clearTimeout(t)
    }
  }, [])

  const saveNote = async (log) => {
    const note = (drafts[log.id] ?? log.pm_note ?? '').trim()
    setSaving(log.id)
    const { error } = await supabase
      .from('daily_logs')
      .update({
        pm_note:        note || null,
        pm_note_shared: shareDrafts[log.id] ?? (log.pm_note_shared ?? true),
        reviewed_by:    profile.id,
        reviewed_at:    new Date().toISOString(),
      })
      .eq('id', log.id)
    setSaving(null)
    if (!error) {
      setDrafts(d => { const n = { ...d }; delete n[log.id]; return n })
      setShareDrafts(d => { const n = { ...d }; delete n[log.id]; return n })
      load()
    }
  }

  const addNote = async () => {
    const text = noteDraft.trim()
    if (!text || noteSaving) return
    setNoteSaving(true)
    const { error } = await supabase.from('office_notes').insert({
      company_id:     profile.company_id,
      author_profile: profile.id,
      note:           text,
      work_order_id:  noteJob || null,
    })
    setNoteSaving(false)
    if (!error) { setNoteDraft(''); setNoteJob(''); load() }
  }

  // ⚠️ Done notes stay on the page. A note that got done is still the record
  // that it needed doing — "need a new saw" ticked off three times in a quarter
  // says something a disappearing checkbox would erase.
  const setNoteStatus = async (id, status) => {
    await supabase
      .from('office_notes')
      .update({ status, done_at: status === 'done' ? new Date().toISOString() : null })
      .eq('id', id)
    setNotes(ns => ns.map(n => (n.id === id ? { ...n, status } : n)))
  }

  const deleteNote = async (id) => {
    await supabase.from('office_notes').delete().eq('id', id)
    load()
  }

  const needle   = q.trim().toLowerCase()
  const hit      = (...vals) => !needle || vals.some(v => String(v ?? '').toLowerCase().includes(needle))
  const shownNotes = notes.filter(n => hit(n.note, n.note_date))
  const logJobs    = [...new Set(logs.map(l => l.job).filter(Boolean))].sort()
  // His notes that sit on a specific log, newest first, for the side panel.
  const pinned     = logs.filter(l => (l.pm_note ?? '').trim() && hit(l.pm_note, l.person, l.job))
  const shownLogs  = logs.filter(l => (!jobFilter || l.job === jobFilter) && hit(l.what_happened, l.blockers, l.pm_note, l.person, l.job, l.log_date, l.who_on_site, l.safety_note))

  if (loading) {
    return <div className="p-8 text-sm text-ink-500">Loading the logs…</div>
  }

  return (
    <div className="p-6 md:p-8 max-w-6xl">
      {/* ⚠️ 10 Oct — ONE LAYOUT, agreed with Daniel before building ("let's
          talk it through so it comes out properly, not add-ons"). The page had
          grown into five things stacked in one column: crew setup, send a job,
          search, his list, then the logs. His notes "get kind of lost".
          Now: the crew's logs are the page (left), his notes sit beside them
          and scroll on their own (right) so he can write while he reads, and
          the set-once crew setup is collapsed at the bottom. Do not add a new
          block above the logs; a new thing belongs in one of these places. */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
      <h1 className="text-xl font-bold text-ink-900">Daily logs</h1>
      {/* ⚠️ 2 Sep — the old blurb explained the PLUMBING: "you cannot change
          what they wrote... Solomon reads every log either way". Daniel: "I
          don't like the description, the notes are more just for the owner,
          it's to keep jobs sorted." Right — the reader does not care what
          Solomon does with it, he cares what the page is FOR. Say that, and let
          the two sections explain the difference between themselves. */}
      <p className="text-xs text-ink-500 mt-1.5 max-w-xl leading-relaxed">
        What the crew wrote from site at the end of each day, with your own notes
        beside it. Between them they keep the jobs straight, instead of that living
        in your head and half a dozen text messages.
      </p>
        </div>
        <button
          type="button"
          onClick={() => setSendOpen(v => !v)}
          className={`flex-shrink-0 px-5 py-2.5 rounded-lg text-sm font-bold transition-colors ${sendOpen ? 'border border-ink-200 bg-white text-ink-900' : 'bg-brand-600 hover:bg-brand-700 text-white'}`}
        >
          {sendOpen ? 'Close' : '+ Send a job and files to the crew'}
        </button>
      </div>


      <OneOffJob
        open={sendOpen}
        profile={profile}
        company={company}
        onCreated={row => setJobs(prev => [{ id: row.id, title: row.title }, ...prev])}
      />


      <div className="mt-6 grid gap-6 items-start lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          <div className="flex flex-col sm:flex-row gap-3">
      {/* ⚠️ One search box for both streams. Daniel: "is there a way of looking
          back on notes, this is important." Scrolling was the only way back.
          Matches the note, the crew's account, the blockers and the office's
          note — i.e. everything anyone typed — because a searcher does not know
          or care which field their half-remembered phrase landed in. */}
      <input
        type="search"
        value={q}
        onChange={e => setQ(e.target.value)}
        placeholder="Search the logs and your notes: a word, a name, a job"
        className="w-full rounded-lg bg-white border border-ink-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300"
      />
      {logJobs.length > 0 && (
        <select
          value={jobFilter}
          onChange={e => setJobFilter(e.target.value)}
          className="w-full sm:w-64 flex-shrink-0 rounded-lg border border-ink-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-300"
        >
          <option value="">All jobs</option>
          {logJobs.map(j => <option key={j} value={j}>{j}</option>)}
        </select>
      )}

          </div>

      {(() => {
        const groups = repeatedBlockers(logs)  // pattern always over ALL logs, not the filtered view
        if (!groups.length) return null
        const most = groups[0].length
        return (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-5 py-4">
            <p className="text-[11px] font-bold uppercase tracking-wider text-amber-700">
              {most === 2 ? 'Same thing came up twice' : `Same thing came up ${most} times`}
            </p>
            <p className="text-[13px] text-ink-700 mt-1.5 leading-relaxed">
              Worth a look, different days ran into something similar. It may be
              coincidence, or it may be one thing you can fix once.
            </p>
            <ul className="mt-3 space-y-3">
              {groups.map((g, i) => (
                <li key={i} className="text-[13px] text-ink-800 leading-relaxed">
                  {g.map(l => (
                    <div key={l.id}>
                      <span className="text-ink-500">{humanDate(l.log_date)}:</span> {l.blockers}
                    </div>
                  ))}
                </li>
              ))}
            </ul>
          </div>
        )
      })()}

      {/* ⚠️ The crew section gets its own header. Daniel: "the notes should be
          explained better — general notes vs notes for that day's job the
          foreman gave at the end of the day." Without a heading the two blocks
          look like one list with different formatting. */}
      <div className="mt-6 mb-3">
        <h2 className="text-[11px] font-bold uppercase tracking-wider text-ink-500">
          From the crew &middot; end of day
        </h2>
        <p className="text-[12px] text-ink-400 mt-0.5 max-w-xl leading-relaxed">
          What each person wrote from site when they finished, about the job they were
          on. Their words stay as written. Add your own note under any log.
        </p>
      </div>

      {logs.length === 0 && (
        <div className="mt-8 rounded-xl border border-ink-100 bg-white px-5 py-6">
          <p className="text-sm font-semibold text-ink-900">No crew logs yet.</p>
          <p className="text-[13px] text-ink-500 mt-1.5 leading-relaxed">
            Crew write these from the link they already use for their jobs, under
            &ldquo;End my shift&rdquo;. Nothing here means nobody has written one. Not that the days went smoothly.
          </p>
        </div>
      )}

      <div className="mt-6 space-y-4">
        {(() => { let lastBucket = null; return shownLogs.map(log => {
          const draft = drafts[log.id] ?? log.pm_note ?? ''
          const shareWithCrew = shareDrafts[log.id] ?? (log.pm_note_shared ?? true)
          const dirty = draft.trim() !== (log.pm_note ?? '').trim() || shareWithCrew !== (log.pm_note_shared ?? true)
          const bucket = dateBucket(log.log_date)
          const showHeader = bucket !== lastBucket
          lastBucket = bucket
          return (
            <Fragment key={log.id}>
              {showHeader && (
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-ink-400 pt-3 first:pt-0">{bucket}</h3>
              )}
            <div id={`log-${log.id}`} className="rounded-xl border border-ink-100 border-l-4 bg-white overflow-hidden scroll-mt-6" style={{ borderLeftColor: personColor(log.person) }}>
              <div className="px-5 py-3 border-b border-ink-100 flex items-center justify-between gap-3 flex-wrap">
                <div className="min-w-0 flex items-center gap-2.5">
                  <span className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0" style={{ background: personColor(log.person) }}>{initials(log.person)}</span>
                  <span className="text-sm font-semibold text-ink-900">{log.person}</span>
                  {log.job && <span className="text-[13px] text-ink-500"> · {log.job}</span>}
                </div>
                <div className="flex items-center gap-3 text-[12px] text-ink-400">
                  {log.hours_on_site != null && <span>{log.hours_on_site}h on site</span>}
                  <span title={log.log_date} className="font-medium text-ink-600">{fullDate(log.log_date)}</span>
                  {log.edited_at && <span className="text-amber-600 font-medium" title={`Edited by the crew ${new Date(log.edited_at).toLocaleString()}`}>edited</span>}
                  {log.reviewed_at && <span className="text-brand-600 font-semibold">read</span>}
                </div>
              </div>

              <div className="px-5 py-4 space-y-3">
                {/* ⚠️ Injury sits ABOVE everything, in red, before the account of
                    the day. Daniel: "the quicker Solomon knows the better" —
                    the same is true of the owner reading the page. */}
                {log.injury && (
                  <div className="rounded-lg bg-red-50 border border-red-300 px-3 py-2">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-red-700">Someone was hurt</p>
                    {log.injury_detail && (
                      <p className="text-[14px] text-ink-900 mt-1 leading-relaxed whitespace-pre-wrap">{log.injury_detail}</p>
                    )}
                    <p className={`text-[12px] mt-1 font-semibold ${log.incident_report_filed === true ? 'text-green-700' : 'text-red-700'}`}>
                      {log.incident_report_filed === true
                        ? 'Incident report filed'
                        : log.incident_report_filed === false
                          ? 'Incident report NOT filed yet'
                          : 'Incident report: crew did not say'}
                    </p>
                    <p className="text-[12px] text-ink-500 mt-1">Reported by the crew. This is not a WorkSafe report, that still has to be filed.</p>
                  </div>
                )}
                {(() => {
                  const names = log.onSiteNames ?? []
                  const parts = [...names, ...(log.who_on_site ? [log.who_on_site] : [])]
                  return parts.length ? <p className="text-[13px] text-ink-500">On site: {parts.join(', ')}</p> : null
                })()}
                {log.flha_done != null && (
                  <p className={`text-[12px] font-medium ${log.flha_done ? 'text-ink-500' : 'text-amber-700'}`}>
                    FLHA: {log.flha_done ? 'done' : 'not done'}
                  </p>
                )}
                <p className="text-[15px] text-ink-900 leading-relaxed whitespace-pre-wrap">
                  {log.what_happened}
                </p>
                {log.safety_note && (
                  <div className="rounded-lg bg-orange-50 border border-orange-200 px-3 py-2">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-orange-700">Safety</p>
                    <p className="text-[14px] text-ink-800 mt-1 leading-relaxed whitespace-pre-wrap">{log.safety_note}</p>
                  </div>
                )}
                {log.blockers && (
                  <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-amber-700">Got in the way</p>
                    <p className="text-[14px] text-ink-800 mt-1 leading-relaxed whitespace-pre-wrap">{log.blockers}</p>
                  </div>
                )}
                {(log.schedule_status || log.percent_complete != null || log.unplanned_cost) && (
                  <div className="flex flex-wrap items-center gap-2 text-[12px]">
                    {log.schedule_status && (
                      <span className={`px-2 py-0.5 rounded-full font-semibold ${log.schedule_status === 'behind' ? 'bg-red-100 text-red-700' : log.schedule_status === 'ahead' ? 'bg-green-100 text-green-700' : 'bg-ink-100 text-ink-600'}`}>
                        {log.schedule_status === 'behind' ? 'Behind' : log.schedule_status === 'ahead' ? 'Ahead' : 'On track'}
                      </span>
                    )}
                    {log.percent_complete != null && <span className="text-ink-500">{log.percent_complete}% done</span>}
                    {log.unplanned_cost && (
                      <span className="text-red-700 font-medium">Unplanned cost{log.unplanned_cost_note ? `: ${log.unplanned_cost_note}` : ''}</span>
                    )}
                  </div>
                )}
                {log.numbers?.length > 0 && (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-600">
                    {log.numbers.map((n, i) => (
                      <span key={i}><span className="text-ink-400">{n.label}:</span> <span className="font-semibold">{n.value}</span></span>
                    ))}
                  </div>
                )}

                <div className="pt-1">
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-ink-500 mb-1.5">
                    Your note on this log
                  </label>
                  <textarea
                    value={draft}
                    onChange={e => setDrafts(d => ({ ...d, [log.id]: e.target.value }))}
                    rows={2}
                    placeholder="A note on this log. The crew sees it unless you keep it private."
                    className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300 resize-none"
                  />
                  <label className="mt-2 flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={shareWithCrew}
                      onChange={e => setShareDrafts(d => ({ ...d, [log.id]: e.target.checked }))}
                      className="w-3.5 h-3.5 rounded text-brand-600 focus:ring-brand-400 border-ink-300"
                    />
                    <span className="text-[11px] text-ink-500">
                      {shareWithCrew ? 'The crew sees this on their job' : 'Private, only you and Solomon'}
                    </span>
                  </label>
                  {/* ⚠️ 2 Sep — this rendered a DISABLED button labelled "Read"
                      once a note was saved, which reads as an action you are
                      not allowed to take. It was a status wearing a button's
                      clothes, and the header already showed "read" anyway.
                      Now: a button only when there is something to do, and the
                      state said in words when there is not. */}
                  <div className="mt-2 flex items-center gap-3 min-h-[36px]">
                    {(dirty || !log.reviewed_at) ? (
                      <button
                        type="button"
                        onClick={() => saveNote(log)}
                        disabled={saving === log.id}
                        className="px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:bg-ink-300 text-white text-sm font-medium transition-colors"
                      >
                        {saving === log.id
                          ? 'Saving…'
                          : dirty ? (log.pm_note ? 'Update note' : 'Save note') : 'Mark as read'}
                      </button>
                    ) : (
                      <span className="text-[12px] text-ink-400">Saved.</span>
                    )}
                    {dirty && <span className="text-[12px] text-amber-700">Unsaved</span>}
                  </div>
                </div>
              </div>
            </div>
            </Fragment>
          )
        }) })()}
        {logs.length >= limit && (
          <button
            type="button"
            onClick={() => setLimit(l => l + 100)}
            className="w-full mt-2 py-2.5 rounded-lg border border-ink-200 text-sm font-semibold text-ink-600 hover:bg-ink-50 transition-colors"
          >
            Load older logs
          </button>
        )}
      </div>
        </div>

      {/* ⚠️ Office notes sit ABOVE the crew logs on purpose. This is the box the
          person at the desk actually reaches for — the crew's logs arrive on
          their own, but a note about the day only exists if somebody writes it,
          and a compose box below a hundred log cards never gets found.
          It is also what makes the note field visible at all when there are no
          logs yet: Daniel asked "where is the area for the PM to make notes?"
          precisely because the per-log note field only renders once a log
          exists, so with an empty list the whole feature was invisible. */}
      <aside
        id="office-notes"
        className="rounded-xl border border-ink-100 bg-white scroll-mt-20 lg:sticky lg:top-4 lg:max-h-[calc(100vh_-_7rem)] lg:overflow-y-auto"
      >
        <div className="px-4 py-3 border-b border-ink-100 sticky top-0 bg-white z-10 rounded-t-xl">
          <h2 className="text-[11px] font-bold uppercase tracking-wider text-ink-500">Your notes</h2>
          <p className="text-[12px] text-ink-400 mt-0.5 leading-relaxed">
            Jot things down while you read. Things to remember, chase or buy. Only you and the office see these.
          </p>
        </div>
        <div className="px-4 py-4">
          <textarea
            value={noteDraft}
            onChange={e => setNoteDraft(e.target.value)}
            rows={3}
            placeholder="A note to yourself. e.g. Supplier rang, steel goes up 6% from the first."
            className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300 resize-none"
          />
          <div className="mt-2 flex items-center gap-2 flex-wrap">
          <select
            value={noteJob}
            onChange={e => setNoteJob(e.target.value)}
            className="flex-1 min-w-0 rounded-lg border border-ink-200 px-2 py-2 text-sm text-ink-600 focus:outline-none focus:ring-2 focus:ring-brand-300"
          >
            <option value="">Not about a job</option>
            {jobs.map(j => <option key={j.id} value={j.id}>{j.title}</option>)}
          </select>
          <button
            type="button"
            onClick={addNote}
            disabled={noteSaving || !noteDraft.trim()}
            className="px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:bg-ink-200 text-white text-sm font-medium transition-colors"
          >
            {noteSaving ? 'Saving…' : 'Add note'}
          </button>
          </div>

          {shownNotes.length > 0 && (
            <ul className="mt-4 space-y-2.5">
              {shownNotes.map(n => (
                <li key={n.id} className="group border-t border-ink-100 pt-2.5 first:border-t-0 first:pt-0">
                  <p className={`text-[14px] leading-relaxed whitespace-pre-wrap ${
                    n.status === 'done' ? 'text-ink-400 line-through' : 'text-ink-800'
                  }`}>
                    {n.note}
                  </p>
                  <p className="text-[12px] text-ink-400 mt-0.5" title={n.note_date}>
                    {humanDate(n.note_date)}
                    {n.work_order_id && ` · ${jobs.find(j => j.id === n.work_order_id)?.title ?? 'a job'}`}
                  </p>
                  {/* Three explicit labels, not a click-to-cycle circle: Daniel
                      wanted check marks AND "assurance it's all self-explanatory".
                      "Working on it" is a real answer, so three, not two. */}
                  <div className="flex items-center gap-1 mt-1.5">
                    {[['open', 'To do'], ['doing', 'Doing'], ['done', 'Done']].map(([val, label]) => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => setNoteStatus(n.id, val)}
                        className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors ${
                          (n.status ?? 'open') === val
                            ? val === 'done'
                              ? 'bg-brand-600 border-brand-600 text-white'
                              : 'bg-ink-900 border-ink-900 text-white'
                            : 'border-ink-200 text-ink-400 hover:border-ink-300'
                        }`}
                      >
                        {val === 'done' ? '✓ ' : ''}{label}
                      </button>
                    ))}
                    {/* Only the author can delete; RLS enforces it. */}
                    {n.author_profile === profile?.id && (
                      <button
                        type="button"
                        onClick={() => deleteNote(n.id)}
                        className="ml-auto text-[12px] text-ink-300 hover:text-red-600 lg:opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {/* Notes written ON a log live with that log. Listed here too so
              everything he has written is in one place; tapping one jumps to
              the log it belongs to. */}
          {pinned.length > 0 && (
            <div className="mt-5 pt-4 border-t border-ink-100">
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-ink-500">Your notes on a log</h3>
              <ul className="mt-2 space-y-2.5">
                {pinned.map(l => (
                  <li key={l.id}>
                    <button
                      type="button"
                      onClick={() => document.getElementById(`log-${l.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
                      className="text-left w-full group/pin"
                    >
                      <span className="block text-[14px] text-ink-800 leading-relaxed group-hover/pin:text-brand-700">{l.pm_note}</span>
                      <span className="block text-[12px] text-ink-400 mt-0.5">
                        {humanDate(l.log_date)} · {l.person}{l.job ? ` · ${l.job}` : ''} · {l.pm_note_shared === false ? 'private' : 'the crew sees this'}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </aside>
      </div>

      {/* Field crew & reminders — moved here from Settings so the crew setup
          (reminder times, the numbers they report, the roster) lives with the
          logs. People/roles stay in Settings (Daniel, 8 Oct). */}
      <div id="crew-setup" className="mt-12 scroll-mt-6">
        {/* A full-width row with a title, a line of what is inside and a clear
            open/close, because as a small text link at the foot of the page
            this "gets lost a bit" (Daniel, 10 Oct). */}
        <button
          onClick={() => {
            const opening = !showCrew
            setShowCrew(opening)
            // The row sits at the foot of the page, so what opened was below
            // the screen and it looked as if nothing happened. Bring the row
            // to the top so the section opens in view.
            // More than once: the section loads its content after it opens,
            // and until that arrives the page is too short to scroll this far.
            if (opening) [80, 450, 1000].forEach(ms => setTimeout(() => document.getElementById('crew-setup')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), ms))
          }}
          aria-expanded={showCrew}
          className="w-full flex items-center justify-between gap-4 rounded-xl border border-ink-200 bg-white px-5 py-4 text-left"
        >
          <span>
            <span className="block text-base font-bold text-ink-900">Crew and reminders</span>
            <span className="block text-sm text-ink-600 mt-0.5">
              Who is on the crew, which days and what time they are reminded to write up the day, and what they report.
            </span>
          </span>
          <span className="flex-shrink-0 text-sm font-bold text-brand-700">{showCrew ? 'Close' : 'Open'}</span>
        </button>
        {showCrew && (
          <div className="mt-3">
            <TeamSection companyId={profile?.company_id} companyName={companyName} ownerName={ownerName} />
          </div>
        )}
      </div>

    </div>
  )
}
