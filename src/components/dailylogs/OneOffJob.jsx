import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { sendTaskAssigned } from '../../lib/email'
import { uploadTaskAttachment, validateAttachment, openTaskAttachment, TASK_ATTACH_MAX_MB } from '../../lib/taskAttachments'

/**
 * Send a job to the crew, with files, from the Daily logs page.
 *
 * ⚠️ 9 Oct, Daniel on the first version: "it doesn't need to be a one off job
 * and i don't want it focussed on, also maybe it has a start and end date."
 * So it is a quiet line that opens, the same weight as "Field crew &
 * reminders" above it, the wording is any job, and a job can run over a span
 * of days. (The `one_off` column name is internal: it marks what was sent
 * from here so the look-back list can find it.)
 *
 * It is a real task, not a new kind of thing: the crew's portal already lists
 * every task a person is on, so creating one with a date and people IS putting
 * it on their daily checklist. The files ride along as task attachments, which
 * the portal hands back as links the crew can open on site.
 */
const todayLocal = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function fetchSent(companyId) {
  const { data: rows } = await supabase.from('work_orders')
    .select('id, title, description, status, start_date, due_date, created_at, assigned_staff_ids, staff_member_id')
    .eq('company_id', companyId).eq('one_off', true)
    .order('created_at', { ascending: false }).limit(15)
  const ids = (rows ?? []).map(r => r.id)
  let files = []
  if (ids.length) {
    const { data } = await supabase.from('work_order_attachments')
      .select('id, work_order_id, title, file_path').in('work_order_id', ids).order('created_at', { ascending: true })
    files = data ?? []
  }
  return (rows ?? []).map(r => ({ ...r, files: files.filter(f => f.work_order_id === r.id) }))
}

export default function OneOffJob({ profile, company, onCreated, open = false }) {
  const companyId = profile?.company_id
  const [staff, setStaff]     = useState([])
  const [title, setTitle]     = useState('')
  const [day, setDay]         = useState(todayLocal)   // start
  const [endDay, setEndDay]   = useState('')           // optional end
  const [notes, setNotes]     = useState('')
  const [who, setWho]         = useState([])
  const [files, setFiles]     = useState([])
  const [busy, setBusy]       = useState(false)
  const [error, setError]     = useState(null)
  const [sent, setSent]       = useState(null)
  const fileInput = useRef(null)
  // What has already gone out, newest first, so the office can look back on
  // what was sent, to whom, and check the files are all there.
  const [sentJobs, setSentJobs] = useState([])

  const [sentTick, setSentTick] = useState(0)
  const loadSent = () => setSentTick(t => t + 1)

  useEffect(() => {
    if (!companyId) return
    let cancelled = false
    fetchSent(companyId).then(rows => { if (!cancelled) setSentJobs(rows) })
    return () => { cancelled = true }
  }, [companyId, sentTick])

  useEffect(() => {
    if (!companyId) return
    let cancelled = false
    supabase.from('staff_members').select('id, name, email').eq('company_id', companyId).order('name')
      .then(({ data }) => { if (!cancelled) setStaff(data ?? []) })
    return () => { cancelled = true }
  }, [companyId])

  function addFiles(list) {
    const next = []
    for (const f of Array.from(list ?? [])) {
      const bad = validateAttachment(f)
      if (bad) { setError(`${f.name}: ${bad}`); continue }
      next.push(f)
    }
    if (next.length) setFiles(prev => [...prev, ...next])
  }

  const toggleWho = id => setWho(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])

  async function send() {
    if (!title.trim() || who.length === 0 || busy) return
    setBusy(true); setError(null); setSent(null)
    const payload = {
      title:              title.trim(),
      description:        notes.trim() || null,
      // One day: that day is the due date. A span: starts on the first,
      // due on the last. An end before the start is ignored, not saved.
      start_date:         endDay && endDay > day ? day : null,
      due_date:           (endDay && endDay > day ? endDay : day) || null,
      priority:           'medium',
      status:             'backlog',
      staff_member_id:    who[0],
      assigned_staff_ids: who,
      one_off:            true,
    }
    const { data: row, error: err } = await supabase.from('work_orders')
      .insert({ company_id: companyId, created_by: profile.id, ...payload })
      .select().single()
    if (err || !row) { setBusy(false); setError(err?.message || 'That did not save. Try again.'); return }

    // Files after the task exists. One that fails is named, the task stays.
    const failed = []
    for (const f of files) {
      try { await uploadTaskAttachment({ file: f, companyId, workOrderId: row.id, userId: profile.id }) }
      catch (e) { failed.push(`${f.name} (${e.message})`) }
    }

    const ownerName = profile?.full_name || profile?.name || profile?.email?.split('@')[0] || 'Your manager'
    const people = staff.filter(s => who.includes(s.id))
    people.forEach(s => {
      if (!s.email) return
      sendTaskAssigned({
        to: s.email, staffId: s.id, staffName: s.name, ownerName,
        companyName: company?.name || 'the team',
        taskTitle: payload.title, taskDescription: payload.description,
        priority: payload.priority, dueDate: payload.due_date,
      })
    })

    setSent({
      names: people.map(s => s.name.split(' ')[0]),
      day: payload.start_date || payload.due_date,
      endDay: payload.start_date ? payload.due_date : null,
      fileCount: files.length - failed.length,
      noEmail: people.filter(s => !s.email).map(s => s.name.split(' ')[0]),
    })
    if (failed.length) setError(`The job was sent, but these files did not upload: ${failed.join(', ')}`)
    setTitle(''); setNotes(''); setWho([]); setFiles([]); setEndDay(''); setBusy(false)
    onCreated?.(row)
    loadSent()
  }

  const nameOf = id => staff.find(s => s.id === id)?.name?.split(' ')[0]
  const STATUS = { backlog: 'Not started', in_progress: 'In progress', review: 'In review', done: 'Done' }

  const shortDay = iso => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
  const dayLabel = iso => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <div>
      {open && (
        <div className="mt-4 rounded-xl border border-ink-100 bg-white px-5 py-4 flex flex-col gap-3">
          <p className="text-[12.5px] text-ink-500 leading-relaxed">
            Name the job, pick who is on it and the days it runs, and attach any plans or files.
            Once sent, the job is in three places: on each person's own page with the files ready to open,
            on your Tasks board, and in the list under this form.
          </p>
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="What is the job? e.g. Deep clean, 14 Birch Street"
            className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300"
          />
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-[12px] font-semibold text-ink-600">
              Starts
              <input
                type="date" max="9999-12-31"
                value={day}
                onChange={e => setDay(e.target.value)}
                className="rounded-lg border border-ink-200 px-3 py-2 text-sm font-normal text-ink-700 focus:outline-none focus:ring-2 focus:ring-brand-300"
              />
            </label>
            <label className="flex flex-col gap-1 text-[12px] font-semibold text-ink-600">
              Ends
              <input
                type="date" max="9999-12-31"
                value={endDay}
                min={day || undefined}
                onChange={e => setEndDay(e.target.value)}
                className="rounded-lg border border-ink-200 px-3 py-2 text-sm font-normal text-ink-700 focus:outline-none focus:ring-2 focus:ring-brand-300"
              />
            </label>
            <span className="text-[12px] text-ink-400 pb-2.5">Leave the end empty for a single day.</span>
          </div>

          <div>
            <p className="text-[12px] font-semibold text-ink-600 mb-1.5">Who is on this job?</p>
            {staff.length === 0 ? (
              <p className="text-[12px] text-ink-400">No crew yet. Add them under Crew and reminders at the bottom of this page.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {staff.map(s => {
                  const on = who.includes(s.id)
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => toggleWho(s.id)}
                      aria-pressed={on}
                      className={`text-[12.5px] px-3 py-1.5 rounded-full border transition-colors ${
                        on ? 'bg-ink-900 border-ink-900 text-white' : 'border-ink-200 text-ink-600 hover:border-ink-300'
                      }`}
                    >
                      {s.name}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={3}
            placeholder="Anything they need to know. Where to park, who to ask for, what done looks like."
            className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300 resize-y"
          />

          <div
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); addFiles(e.dataTransfer.files) }}
            className="rounded-lg border border-dashed border-ink-200 px-4 py-3"
          >
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="text-[12.5px] text-ink-600">
                <span className="font-semibold">Plans, drawings, photos.</span> Drop files here or choose them. Up to {TASK_ATTACH_MAX_MB}MB each.
              </p>
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                className="text-xs font-semibold text-brand-700 hover:text-brand-800"
              >
                Choose files
              </button>
              <input ref={fileInput} type="file" multiple className="hidden" onChange={e => { addFiles(e.target.files); e.target.value = '' }} />
            </div>
            {files.length > 0 && (
              <ul className="mt-2 flex flex-col gap-1">
                {files.map((f, i) => (
                  <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-3 text-[12.5px] text-ink-700">
                    <span className="truncate">{f.name}</span>
                    <button
                      type="button"
                      onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))}
                      className="flex-shrink-0 text-ink-400 hover:text-red-700"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <button
              type="button"
              onClick={send}
              disabled={busy || !title.trim() || who.length === 0}
              className="px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold disabled:opacity-50 transition-colors"
            >
              {busy ? 'Sending…' : 'Send to the crew'}
            </button>
            {(!title.trim() || who.length === 0) && (
              <span className="text-[12px] text-ink-400">Needs a job name and at least one person.</span>
            )}
          </div>

          {sent && (
            <p className="text-[13px] text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 leading-relaxed">
              Sent to {sent.names.join(' and ')}. The job is on their link{sent.day ? (sent.endDay ? ` from ${dayLabel(sent.day)} to ${dayLabel(sent.endDay)}` : ` for ${dayLabel(sent.day)}`) : ''}
              {sent.fileCount > 0 ? `, with ${sent.fileCount} file${sent.fileCount === 1 ? '' : 's'} attached` : ''}.
              {sent.noEmail.length > 0 && ` No email on file for ${sent.noEmail.join(' and ')}, so they will see the job when they next open their link.`}
            </p>
          )}
          {error && <p className="text-[13px] text-red-700">{error}</p>}
        </div>
      )}

      {open && (
        <div className="mt-3 rounded-xl border border-ink-100 bg-white px-5 py-4">
          <p className="text-[11px] font-bold uppercase tracking-wider text-ink-500 mb-2">What you have sent</p>
          {sentJobs.length === 0 && (
            <p className="text-sm text-ink-600">Nothing sent yet. Each job you send from here is listed in this spot, with who it went to and its files.</p>
          )}
          <ul className="flex flex-col divide-y divide-ink-100">
            {sentJobs.map(j => {
              const ids = j.assigned_staff_ids?.length ? j.assigned_staff_ids : (j.staff_member_id ? [j.staff_member_id] : [])
              const names = ids.map(nameOf).filter(Boolean)
              return (
                <li key={j.id} className="py-2.5 flex flex-col gap-1">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-[14px] font-semibold text-ink-900 leading-snug">{j.title}</p>
                    <span className="flex-shrink-0 text-[11px] text-ink-500 whitespace-nowrap mt-0.5">{STATUS[j.status] ?? j.status}</span>
                  </div>
                  <p className="text-[12px] text-ink-500">
                    {j.due_date ? (j.start_date ? `${shortDay(j.start_date)} to ${shortDay(j.due_date)}` : `For ${dayLabel(j.due_date)}`) : 'No day set'}
                    {names.length > 0 && ` · ${names.join(', ')}`}
                    {` · sent ${new Date(j.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`}
                  </p>
                  {j.description && <p className="text-[13px] text-ink-700 leading-snug">{j.description}</p>}
                  {j.files.length > 0 ? (
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      {j.files.map(f => (
                        <button
                          key={f.id}
                          type="button"
                          onClick={() => openTaskAttachment(f)}
                          className="text-[12.5px] font-semibold text-brand-700 hover:text-brand-800 underline underline-offset-2"
                        >
                          {f.title || 'Open file'}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[12px] text-ink-400">No files went with this one.</p>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
