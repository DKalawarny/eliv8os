import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { useParams } from 'react-router-dom'

/**
 * StaffPortal — the field crew's view of their assignments.
 *
 * Lives at /staff/:token. Anyone with the link can open this page; the token
 * IS the authentication. No Supabase session is needed (and shouldn't be —
 * staff aren't auth.users rows).
 *
 * Mobile-first by design. Big touch targets, single-column layout, no
 * sidebar / no nav. The crew is standing on a job site holding a phone in
 * a glove; this isn't the place for chrome.
 *
 * All data flows through the `staff-portal` Edge Function. We never call
 * Supabase tables directly because:
 *   1. The browser has no user JWT — RLS would have nothing to check
 *   2. The Edge Function does the token verification + revocation check
 *      in one place, so this page never has to reason about it
 *   3. Future write operations (photo upload, status change) all reuse
 *      the same auth-by-token plumbing
 *
 * Network strategy: load on mount, optimistic updates on status change.
 * If a write fails the local state rolls back and an inline error appears
 * on the affected card.
 */

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? ''

/**
 * Call the staff-portal Edge Function. Uses anon-key auth because the
 * caller has no user session — the Function itself enforces auth via
 * the staff token in the body.
 */
async function callPortal(op, extra = {}) {
  const url = `${SUPABASE_URL}/functions/v1/staff-portal`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type':  'application/json',
      // anon key satisfies Supabase's edge gateway; the function itself
      // does the real auth from the token in the body
      'apikey':         SUPABASE_ANON_KEY,
      'Authorization':  `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ op, ...extra }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    // Server's `error` string is a short code — surface that, not the
    // raw status. The UI maps codes to human messages.
    throw new Error(body?.error || `http_${res.status}`)
  }
  return body
}

// Friendly copy for the codes the Edge Function returns. Anything we
// don't recognize falls through to a generic "something went wrong" so
// we never blank-screen on an unexpected error.
const ERROR_COPY = {
  invalid_token:    "This link doesn't look right. Ask the person who sent it to resend.",
  revoked:          'This link has been replaced. Ask for a fresh one.',
  staff_removed:    "You've been removed from the team. Reach out to your manager if this is a mistake.",
  company_mismatch: "This link doesn't match your team anymore. Ask for a fresh one.",
  not_found:        "That task isn't yours, or it was removed. Refresh to see your current list.",
}

export default function StaffPortal() {
  const { token } = useParams()
  const [state, setState] = useState({ phase: 'loading', data: null, error: null })

  // ---- Load on mount + when the URL token changes ----
  useEffect(() => {
    let cancelled = false
    if (!token) {
      setState({ phase: 'error', error: 'invalid_token', data: null })
      return
    }
    ;(async () => {
      try {
        const data = await callPortal('load', { token })
        if (!cancelled) setState({ phase: 'ready', data, error: null })
      } catch (err) {
        if (!cancelled) setState({ phase: 'error', error: err.message, data: null })
      }
    })()
    return () => { cancelled = true }
  }, [token])

  // ---- Optimistic checklist tick ----
  // Same pattern as status change — flip locally, fire network, revert by
  // re-loading on error. Each item already carries the optimistic _pending
  // flag so the checkbox dims while the write resolves.
  const toggleChecklistItem = useCallback(async (workOrderId, itemId, nextDone) => {
    setState(s => {
      if (!s.data?.work_orders) return s
      const now = new Date().toISOString()
      return {
        ...s,
        data: {
          ...s.data,
          work_orders: s.data.work_orders.map(w =>
            w.id !== workOrderId ? w : {
              ...w,
              checklist_items: (w.checklist_items ?? []).map(i =>
                i.id !== itemId ? i : {
                  ...i,
                  done:    nextDone,
                  done_at: nextDone ? now : null,
                  _pending: true,
                }
              ),
            }
          ),
        },
      }
    })
    try {
      await callPortal('updateChecklistItem', { token, itemId, done: nextDone })
      setState(s => {
        if (!s.data?.work_orders) return s
        return {
          ...s,
          data: {
            ...s.data,
            work_orders: s.data.work_orders.map(w =>
              w.id !== workOrderId ? w : {
                ...w,
                checklist_items: (w.checklist_items ?? []).map(i =>
                  i.id !== itemId ? i : { ...i, _pending: false }
                ),
              }
            ),
          },
        }
      })
    } catch {
      // Roll back the whole list — re-fetch is simplest and re-orders
      // anything that drifted in another tab too.
      try {
        const data = await callPortal('load', { token })
        setState({ phase: 'ready', data, error: null })
      } catch (err) {
        setState({ phase: 'error', error: err.message, data: null })
      }
    }
  }, [token])

  // ---- Add a step comment ----
  // The "loop-closing" write — crew posts a note (typed or voice-transcribed)
  // against a checklist step. Optimistic: drop a synthetic row in immediately
  // so the input clears and the comment shows under the step; reconcile from
  // the server response when it lands. If the network call fails, refetch the
  // whole portal so we don't leave a ghost row floating.
  //
  // promptType defaults to 'free' (the always-on 💬 button). Workflow-triggered
  // prompts pass their own promptType so Solomon can cluster later.

  // ⚠️ 2 Sep — the end-of-shift recap writes here now, not to step comments.
  // It is the crew's account of the day: what happened on this job, in their
  // words, stored the moment they hit send. Nobody in the office can edit it
  // afterwards — they can only add a note alongside (036) — because the whole
  // point is that it is the one thing in Solomon's context the owner did not
  // write himself.
  const submitDailyLog = async (workOrderId, whatHappened, blockers, hours, day = {}) => {
    try {
      const res = await callPortal('submitDailyLog', {
        token, workOrderId, whatHappened, blockers, hours,
        whoOnSite: day.whoOnSite, safetyNote: day.safetyNote, injury: day.injury,
        injuryDetail: day.injuryDetail, incidentReportFiled: day.incidentReportFiled, flhaDone: day.flhaDone,
        onSiteStaffIds: day.onSiteStaffIds,
        scheduleStatus: day.scheduleStatus, percentComplete: day.percentComplete, unplannedCost: day.unplannedCost, unplannedCostNote: day.unplannedCostNote,
        metrics: day.metrics,
      })
      return res?.ok ? { ok: true } : { ok: false }
    } catch {
      return { ok: false }
    }
  }
  // A foreman fixes their OWN recent log in place (today/yesterday). Keeps
  // Solomon's input to one current truth instead of a pile of corrections.
  const editDailyLog = useCallback(async (logId, fields) => {
    try {
      const res = await callPortal('editDailyLog', { token, logId, ...fields })
      if (res?.ok && res.log) {
        setState(s => ({ ...s, data: { ...s.data, recent_logs: (s.data?.recent_logs ?? []).map(l => l.id === logId ? { ...l, ...res.log } : l) } }))
        return { ok: true }
      }
      return { ok: false }
    } catch {
      return { ok: false }
    }
  }, [token])
  const addStepComment = useCallback(async (workOrderId, itemId, { text, isVoice, promptType }) => {
    const trimmed = (text ?? '').trim()
    if (!trimmed) return { ok: false, error: 'empty' }
    const tempId = `temp-${Math.random().toString(36).slice(2)}`
    const optimistic = {
      id:                tempId,
      checklist_item_id: itemId,
      work_order_id:     workOrderId,
      text:              trimmed,
      is_voice:          !!isVoice,
      prompt_type:       promptType ?? 'free',
      created_at:        new Date().toISOString(),
      author_name:       'You',
      _pending:          true,
    }
    setState(s => {
      if (!s.data?.work_orders) return s
      return {
        ...s,
        data: {
          ...s.data,
          work_orders: s.data.work_orders.map(w =>
            w.id !== workOrderId ? w : {
              ...w,
              checklist_items: (w.checklist_items ?? []).map(i =>
                i.id !== itemId ? i : { ...i, comments: [optimistic, ...(i.comments ?? [])] }
              ),
            }
          ),
        },
      }
    })
    try {
      const res = await callPortal('addStepComment', {
        token,
        itemId,
        text:       trimmed,
        isVoice:    !!isVoice,
        promptType: promptType ?? 'free',
      })
      // Reconcile: replace the temp row with the server's authoritative row
      // (real id, server timestamp). We don't refetch — the rest of the data
      // is unchanged.
      setState(s => {
        if (!s.data?.work_orders) return s
        return {
          ...s,
          data: {
            ...s.data,
            work_orders: s.data.work_orders.map(w =>
              w.id !== workOrderId ? w : {
                ...w,
                checklist_items: (w.checklist_items ?? []).map(i =>
                  i.id !== itemId ? i : {
                    ...i,
                    comments: (i.comments ?? []).map(c =>
                      c.id === tempId ? res.comment : c
                    ),
                  }
                ),
              }
            ),
          },
        }
      })
      return { ok: true }
    } catch (err) {
      // Drop the optimistic row and surface the error to the panel so the
      // crew knows to retry — better than a silent failure where they think
      // the comment landed.
      setState(s => {
        if (!s.data?.work_orders) return s
        return {
          ...s,
          data: {
            ...s.data,
            work_orders: s.data.work_orders.map(w =>
              w.id !== workOrderId ? w : {
                ...w,
                checklist_items: (w.checklist_items ?? []).map(i =>
                  i.id !== itemId ? i : { ...i, comments: (i.comments ?? []).filter(c => c.id !== tempId) }
                ),
              }
            ),
          },
        }
      })
      return { ok: false, error: err.message }
    }
  }, [token])

  // ---- Optimistic status change ----
  // We flip the card to the new status locally, fire the network call,
  // and revert on error. Saves a refresh round-trip and matches the
  // muscle memory of the rest of the app.
  const setStatus = useCallback(async (workOrderId, nextStatus) => {
    setState(s => {
      if (!s.data?.work_orders) return s
      return {
        ...s,
        data: {
          ...s.data,
          work_orders: s.data.work_orders.map(w =>
            w.id === workOrderId ? { ...w, status: nextStatus, _pending: true } : w
          ),
        },
      }
    })
    try {
      await callPortal('updateStatus', { token, workOrderId, status: nextStatus })
      setState(s => {
        if (!s.data?.work_orders) return s
        return {
          ...s,
          data: {
            ...s.data,
            work_orders: s.data.work_orders.map(w =>
              w.id === workOrderId ? { ...w, _pending: false } : w
            ),
          },
        }
      })
    } catch (err) {
      // Roll back — fetch the original from a fresh load so we don't
      // have to remember what status was set before the optimistic flip.
      try {
        const data = await callPortal('load', { token })
        setState({ phase: 'ready', data, error: null })
      } catch {
        setState({ phase: 'error', error: err.message, data: null })
      }
    }
  }, [token])

  // ---- Render branches ----
  if (state.phase === 'loading') {
    return (
      <div className="min-h-screen bg-ink-50 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-brand-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (state.phase === 'error') {
    const msg = ERROR_COPY[state.error] || 'Something went wrong loading your tasks. Try refreshing the page.'
    return (
      <div className="min-h-screen bg-ink-50 px-5 py-16 flex items-start justify-center">
        <div className="bg-white border border-ink-200 rounded-2xl p-6 max-w-sm w-full text-center shadow-sm">
          <div className="text-3xl mb-3">⚠️</div>
          <p className="text-sm text-ink-800 leading-relaxed">{msg}</p>
          {state.error && !ERROR_COPY[state.error] && (
            <p className="text-[11px] text-ink-300 mt-3 font-mono break-all">{state.error}</p>
          )}
        </div>
      </div>
    )
  }

  const { staff, company, work_orders, recent_logs, crew, metrics_defs } = state.data ?? {}
  const open       = (work_orders ?? []).filter(w => w.status !== 'done')
  const inProgress = (work_orders ?? []).filter(w => w.status === 'in_progress')
  const completed  = (work_orders ?? []).filter(w => w.status === 'done')

  return (
    <div className="crew-shell min-h-screen bg-ink-50 pb-24">

      {/* Header — kept short. The crew's name + which company they're
          working for is all the orientation needed. */}
      <header className="bg-white border-b border-ink-200 px-5 py-4 sticky top-0 z-10">
        <div className="max-w-xl mx-auto w-full">
          <p className="text-[11px] font-semibold text-ink-400 uppercase tracking-widest">
            {company?.name ? `Working for ${company.name}` : 'Your tasks'}
          </p>
          <h1 className="text-lg font-bold text-ink-900 leading-snug mt-0.5">
            Hi {staff?.name?.split(' ')[0] || 'team'}
          </h1>
        </div>
      </header>

      <main className="px-5 pt-5 space-y-6 max-w-xl mx-auto w-full">

        {/* Open tasks — hidden entirely when nothing is assigned, so a crew
            member who only uses the daily log never sees an empty shelf. */}
        {open.length > 0 && (
          <section>
            <h2 className="text-xs font-bold uppercase tracking-wider text-ink-500 mb-2.5">
              To do <span className="text-ink-400">· {open.length}</span>
            </h2>
            <ul className="space-y-2.5">
              {open.map(w => (
                <WorkOrderCard key={w.id} order={w} onSetStatus={setStatus} onToggleChecklistItem={toggleChecklistItem} onAddStepComment={addStepComment} />
              ))}
            </ul>
          </section>
        )}

        {/* End-of-shift recap — appears once the crew has at least one
            in-progress job. The crew taps it when they're wrapping up to
            leave a single thought per active job: "anything slow you
            down today?" That's the highest-signal end-of-day question
            and the one Solomon will cluster against to surface things
            like "your crew flags this tool gap on every kitchen demo."
            Each WO gets its own textarea so the crew can split thoughts
            cleanly across jobs they touched. */}
        {/* Always a place to log the day. With no assigned job in the system,
            a general entry (work_order_id = null) so a foreman can still log. */}
        <ShiftEndRecap
          workOrders={inProgress.length > 0 ? inProgress : [{ id: '__general__', title: 'Your day' }]}
          crew={crew ?? []}
          metricDefs={metrics_defs ?? []}
          onSubmitDailyLog={submitDailyLog}
        />

        {/* Your recent logs — edit your own words if you got something wrong,
            so the office and Solomon see the correction, not a contradiction. */}
        {(recent_logs ?? []).length > 0 && (
          <RecentLogsEditor logs={recent_logs} workOrders={work_orders ?? []} onEdit={editDailyLog} />
        )}

        {/* Completed — keep these in view but visually dimmed. The crew
            wants to see what they finished without it competing for
            attention with what's still on the list. */}
        {completed.length > 0 && (
          <section>
            <h2 className="text-xs font-bold uppercase tracking-wider text-ink-500 mb-2.5">
              Done <span className="text-ink-400">· {completed.length}</span>
            </h2>
            <ul className="space-y-2.5">
              {completed.map(w => (
                <WorkOrderCard key={w.id} order={w} onSetStatus={setStatus} onToggleChecklistItem={toggleChecklistItem} onAddStepComment={addStepComment} dim />
              ))}
            </ul>
          </section>
        )}
      </main>

      <footer className="mt-10 px-5 text-center text-[11px] text-ink-400">
        Bookmark this page. Same link works every time.
      </footer>
    </div>
  )
}

/**
 * Single work-order card. Mobile-first: big tappable status pills, plenty
 * of vertical padding so a gloved thumb can hit the right one.
 */
function WorkOrderCard({ order, onSetStatus, onToggleChecklistItem, onAddStepComment, dim = false }) {
  const due = order.due_date ? formatDueDate(order.due_date) : null
  const overdue = order.due_date && new Date(order.due_date) < startOfToday() && order.status !== 'done'
  const items   = order.checklist_items ?? []
  const doneCount = items.filter(i => i.done).length
  const allRequiredDone = items.filter(i => i.required).every(i => i.done)

  // Only one comment panel open at a time per WO card — keeps the screen
  // simple on a phone and means the user can't accidentally start typing
  // into the wrong step's panel. The shape carries the prompt context so
  // workflow-triggered prompts (start_walk, job_close) share the same
  // panel UI but with the right tag and placeholder.
  //
  // Shape: { itemId, promptType, placeholder, autoFocus } | null
  const [openComment, setOpenComment] = useState(null)

  // Workflow prompt detection — derive from the comments already loaded.
  // The crew sees a start_walk banner on backlog WOs that haven't been
  // walked yet, and a job_close prompt after marking done. These are the
  // moments where the field has the freshest context and the smallest
  // delta-cost to capture a thought.
  const firstItem      = items[0]
  const hasStartWalk   = items.some(i => (i.comments ?? []).some(c => c.prompt_type === 'start_walk'))
  const hasJobClose    = items.some(i => (i.comments ?? []).some(c => c.prompt_type === 'job_close'))
  const needsStartWalk = order.status === 'backlog' && !hasStartWalk && !!firstItem
  const needsJobClose  = order.status === 'done'    && !hasJobClose  && !!firstItem

  function openWorkflowPrompt(promptType, placeholder) {
    if (!firstItem) return
    setOpenComment({ itemId: firstItem.id, promptType, placeholder, autoFocus: true })
  }

  // Hook the status setter so "Done" auto-opens the job_close prompt the
  // FIRST time the WO transitions to done. We don't pester on subsequent
  // taps (would happen if the crew toggles back and forth) — the panel
  // only auto-opens when hasJobClose is still false.
  const handleSetStatus = (woId, nextStatus) => {
    onSetStatus?.(woId, nextStatus)
    if (nextStatus === 'done' && order.status !== 'done' && !hasJobClose && firstItem) {
      // Open after a tick so the optimistic status update has rendered first.
      setTimeout(() => {
        openWorkflowPrompt('job_close', 'Quick close-out, what would you tell the next foreman on this kind of job?')
      }, 50)
    }
  }

  return (
    <li className={`bg-white border rounded-xl px-4 py-3.5 shadow-sm ${
      dim ? 'opacity-60 border-ink-150' : 'border-ink-200'
    }`}>

      {/* Title + priority */}
      <div className="flex items-start gap-2.5">
        <p className={`flex-1 text-sm font-semibold leading-snug ${
          order.status === 'done' ? 'line-through text-ink-500' : 'text-ink-900'
        }`}>
          {order.title}
        </p>
        {order.priority === 'high' && (
          <span className="flex-shrink-0 text-[10px] font-bold text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full uppercase tracking-wider">
            High
          </span>
        )}
      </div>

      {/* Description, if any */}
      {order.description && (
        <p className="mt-1.5 text-xs text-ink-600 leading-relaxed">{order.description}</p>
      )}

      {/* Files the office sent with this job: plans, drawings, photos */}
      {order.attachments?.length > 0 && (
        <div className="mt-2.5 rounded-lg border border-ink-150 bg-ink-50/60 px-3 py-2">
          <p className="text-[10.5px] font-bold uppercase tracking-wider text-ink-500 mb-1">Files for this job</p>
          <ul className="flex flex-col gap-1">
            {order.attachments.map(f => (
              <li key={f.id}>
                <a
                  href={f.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-semibold text-brand-700 hover:text-brand-800 underline underline-offset-2 break-all"
                >
                  {f.title || 'Open file'}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Due-date — colored if overdue */}
      {due && (
        <p className={`mt-2 text-[11px] font-semibold ${
          overdue ? 'text-red-600' : 'text-ink-500'
        }`}>
          {overdue ? 'Overdue · ' : (order.start_date ? `From ${formatDueDate(order.start_date)}, due ` : 'Due ')}{due}
        </p>
      )}

      {/* Start-walk prompt — fires on backlog WOs that haven't gotten a
          start_walk note yet. The site walk is the moment the crew has the
          freshest read on whether the quote matches reality; capturing
          differences here is what catches scope creep before it hits the
          owner as a surprise. Tap-to-open; auto-focuses the textarea so
          the crew can talk into it without an extra tap. */}
      {needsStartWalk && (
        <button
          type="button"
          onClick={() => openWorkflowPrompt('start_walk', 'Walked the site? Anything different from the quote: extra rooms, wrong material, surprise hazards?')}
          className="mt-3 w-full text-left bg-brand-50 hover:bg-brand-100 border border-brand-200 rounded-lg px-3 py-2 transition-colors"
        >
          <div className="flex items-center gap-2">
            <span aria-hidden className="text-base">🚶</span>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-bold text-brand-800 uppercase tracking-wider">Site walk</p>
              <p className="text-[12px] text-brand-900 leading-snug">Anything different from the quote?</p>
            </div>
            <span className="text-[11px] font-semibold text-brand-700">Add note →</span>
          </div>
        </button>
      )}

      {/* Job-close prompt — fires on done WOs that haven't gotten a
          close-out note yet. Auto-opens once via handleSetStatus when the
          crew marks the job done; this banner is the persistent re-open
          path in case they dismissed without saving. This is the highest-
          value comment for Solomon long-term: "what would you tell the
          next foreman" generates the most actionable SOP deltas. */}
      {needsJobClose && (
        <button
          type="button"
          onClick={() => openWorkflowPrompt('job_close', 'What would you tell the next foreman on this kind of job?')}
          className="mt-3 w-full text-left bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg px-3 py-2 transition-colors"
        >
          <div className="flex items-center gap-2">
            <span aria-hidden className="text-base">📋</span>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-bold text-emerald-800 uppercase tracking-wider">Job close-out</p>
              <p className="text-[12px] text-emerald-900 leading-snug">What would you tell the next foreman?</p>
            </div>
            <span className="text-[11px] font-semibold text-emerald-700">Add note →</span>
          </div>
        </button>
      )}

      {/* Checklist — big touch targets, sized for a gloved thumb. Required
          unchecked items show a small badge so the crew knows what's blocking
          a "done" status. Tapping the whole row toggles, not just the box. */}
      {items.length > 0 && (
        <div className="mt-3">
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-[10px] font-bold uppercase tracking-wider text-ink-500">
              Checklist · {doneCount} of {items.length}
            </p>
            {!allRequiredDone && items.some(i => i.required && !i.done) && (
              <span className="text-[9px] font-bold text-amber-700">
                {items.filter(i => i.required && !i.done).length} required left
              </span>
            )}
          </div>
          {/* Progress bar */}
          <div className="h-1 bg-ink-100 rounded-full overflow-hidden mb-2">
            <div
              className="h-full bg-emerald-500 transition-all duration-300"
              style={{ width: `${items.length ? (doneCount / items.length) * 100 : 0}%` }}
            />
          </div>
          <ul className="space-y-1.5">
            {items.map(item => {
              const commentCount = (item.comments ?? []).length
              const commentOpen  = openComment?.itemId === item.id
              return (
                <li
                  key={item.id}
                  className={`rounded-lg border select-none transition-colors ${
                    item.done
                      ? 'bg-emerald-50 border-emerald-200'
                      : 'bg-white border-ink-200'
                  } ${item._pending ? 'opacity-60' : ''}`}
                >
                  {/* Toggle row — tapping here ticks/unticks the step.
                      Pulled out of the surrounding <li> so the comment
                      panel below can be tapped without flipping the
                      checkbox. */}
                  <div
                    onClick={() => !item._pending && onToggleChecklistItem?.(order.id, item.id, !item.done)}
                    className={`flex items-start gap-2.5 px-2.5 py-2 cursor-pointer ${
                      item.done ? '' : 'active:bg-ink-50'
                    }`}
                  >
                    {/* Big touch target for the checkbox itself */}
                    <span className={`mt-0.5 w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 ${
                      item.done
                        ? 'bg-emerald-600 border-emerald-600'
                        : 'bg-white border-ink-300'
                    }`}>
                      {item.done && (
                        <svg viewBox="0 0 16 16" fill="none" stroke="white" strokeWidth="2.5" className="w-3 h-3">
                          <polyline points="3 8 7 12 13 4" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      )}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className={`text-[13px] leading-snug ${item.done ? 'line-through text-ink-500' : 'text-ink-900 font-medium'}`}>
                        {item.text}
                      </p>
                      {item.notes && (
                        <p className="text-[11px] text-ink-500 mt-0.5 leading-relaxed">{item.notes}</p>
                      )}
                    </div>
                    {item.required && !item.done && (
                      <span className="text-[9px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full uppercase tracking-wider flex-shrink-0">
                        Req
                      </span>
                    )}
                  </div>

                  {/* Comment toggle row — sits below the toggle area so a
                      tap here never flips the checkbox. The 💬 button
                      shows the existing comment count when there are any,
                      so the crew can tell at-a-glance whether anyone (them
                      or another shift) has left notes on this step. */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      setOpenComment(prev =>
                        prev?.itemId === item.id
                          ? null
                          : { itemId: item.id, promptType: 'free', placeholder: 'Add a note for the office or next crew...', autoFocus: false }
                      )
                    }}
                    className="w-full flex items-center justify-between px-2.5 pb-2 pt-0.5 text-[11px] text-ink-500 hover:text-ink-700"
                  >
                    <span className="flex items-center gap-1.5">
                      <span aria-hidden>💬</span>
                      <span>
                        {commentCount === 0
                          ? 'Add a note'
                          : commentCount === 1
                            ? '1 note'
                            : `${commentCount} notes`}
                      </span>
                    </span>
                    <span className="text-ink-400 text-[10px]">{commentOpen ? 'Hide' : 'Show'}</span>
                  </button>

                  {commentOpen && (
                    <CommentPanel
                      comments={item.comments ?? []}
                      defaultPromptType={openComment.promptType}
                      placeholder={openComment.placeholder}
                      autoFocus={openComment.autoFocus}
                      onSubmit={({ text, isVoice, promptType }) =>
                        onAddStepComment?.(order.id, item.id, { text, isVoice, promptType })
                      }
                    />
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {/* Status switcher — three big buttons, current state highlighted.
          The "_pending" flag during an optimistic update dims them while
          the network call resolves. */}
      <div className="mt-3 grid grid-cols-3 gap-2">
        <StatusButton
          label="To do"
          active={order.status === 'backlog'}
          pending={order._pending}
          onClick={() => handleSetStatus(order.id, 'backlog')}
        />
        <StatusButton
          label="In progress"
          active={order.status === 'in_progress'}
          pending={order._pending}
          onClick={() => handleSetStatus(order.id, 'in_progress')}
        />
        <StatusButton
          label="Done"
          active={order.status === 'done'}
          pending={order._pending}
          variant="done"
          onClick={() => handleSetStatus(order.id, 'done')}
        />
      </div>
    </li>
  )
}

/**
 * CommentPanel — the loop-closing UI.
 *
 * Renders the comment history for a single checklist step and gives the
 * crew a textarea + voice button to add a new note. This is the field-
 * level write-back channel that lets SOPs get smarter over time:
 * once enough crews flag the same friction on the same kind of step,
 * the platform can surface it as a suggested SOP improvement.
 *
 * Voice-to-text uses the browser-native SpeechRecognition API. There's
 * no server-side audio: the browser does the transcription locally and
 * we POST the text. That keeps storage costs flat and means transcripts
 * are searchable from day one (Solomon reads text, not audio).
 *
 * Defensive about browser support: SpeechRecognition is Chrome/Edge/
 * Safari-mobile. If the API isn't present we hide the 🎤 button entirely
 * rather than show a broken control. Typed comments still work everywhere.
 */
function RecentLogsEditor({ logs, workOrders, onEdit }) {
  const titleFor = (id) => workOrders.find(w => w.id === id)?.title
  return (
    <section>
      <h2 className="text-xs font-bold uppercase tracking-wider text-ink-500 mb-2.5">Your recent logs</h2>
      <ul className="space-y-2.5">
        {logs.map(log => (
          <RecentLogRow key={log.id} log={log} jobTitle={titleFor(log.work_order_id)} onEdit={onEdit} />
        ))}
      </ul>
    </section>
  )
}

function RecentLogRow({ log, jobTitle, onEdit }) {
  const [editing, setEditing]   = useState(false)
  const [what, setWhat]         = useState(log.what_happened ?? '')
  const [blockers, setBlockers] = useState(log.blockers ?? '')
  const [hours, setHours]       = useState(log.hours_on_site ?? '')
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState('')
  const fmt = (d) => { try { return new Date(d + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) } catch { return d } }

  async function save() {
    setSaving(true); setError('')
    const res = await onEdit(log.id, {
      whatHappened: what.trim(), blockers: blockers.trim(), hours: String(hours ?? '').trim(),
      whoOnSite: log.who_on_site, safetyNote: log.safety_note, injury: log.injury,
    })
    setSaving(false)
    if (res?.ok) setEditing(false)
    else setError('Could not save. Tap Save to try again.')
  }

  return (
    <li className="rounded-xl border border-ink-100 bg-white p-3.5">
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-[12px] font-semibold text-ink-700">{fmt(log.log_date)}{jobTitle ? ` \u00b7 ${jobTitle}` : ''}</span>
        <div className="flex items-center gap-2">
          {log.edited_at && <span className="text-[11px] text-amber-600 font-medium">edited</span>}
          {!editing && <button type="button" onClick={() => setEditing(true)} className="text-[12px] font-semibold text-brand-700">Edit</button>}
        </div>
      </div>
      {!editing ? (
        <>
          <p className="text-[13px] text-ink-800 leading-snug">{log.what_happened}</p>
          {log.blockers && <p className="text-[12px] text-ink-500 mt-1 leading-snug">Got in the way: {log.blockers}</p>}
          {log.hours_on_site != null && <p className="text-[12px] text-ink-400 mt-0.5">{log.hours_on_site}h on site</p>}
          {log.office_note && (
            <div className="mt-2 rounded-md bg-brand-50 border border-brand-100 px-2.5 py-2 text-[12px] text-ink-700 leading-snug">
              <span className="font-semibold text-brand-700">From the office:</span> {log.office_note}
            </div>
          )}
        </>
      ) : (
        <div className="space-y-2 mt-1">
          <textarea value={what} onChange={e => setWhat(e.target.value)} rows={2} placeholder="What got done?" className="w-full text-[14px] rounded-lg border border-ink-200 p-2" />
          <textarea value={blockers} onChange={e => setBlockers(e.target.value)} rows={2} placeholder="Anything slow you down?" className="w-full text-[14px] rounded-lg border border-ink-200 p-2" />
          <input value={hours} onChange={e => setHours(e.target.value)} inputMode="decimal" placeholder="Hours" className="w-24 text-[14px] rounded-lg border border-ink-200 p-2" />
          {error && <p className="text-[12px] text-red-600">{error}</p>}
          <div className="flex items-center gap-2">
            <button type="button" disabled={saving} onClick={save} className="px-3.5 py-2 rounded-lg bg-brand-600 text-white text-[13px] font-semibold disabled:opacity-50">{saving ? 'Saving\u2026' : 'Save'}</button>
            <button type="button" disabled={saving} onClick={() => { setEditing(false); setWhat(log.what_happened ?? ''); setBlockers(log.blockers ?? ''); setHours(log.hours_on_site ?? ''); setError('') }} className="px-3 py-2 text-[13px] text-ink-500">Cancel</button>
          </div>
        </div>
      )}
    </li>
  )
}

function CommentPanel({ comments, onSubmit, defaultPromptType = 'free', placeholder = 'Add a note for the office or next crew...', autoFocus = false }) {
  const [draft, setDraft]         = useState('')
  const [voiceUsed, setVoiceUsed] = useState(false)
  const [sending, setSending]     = useState(false)
  const [error, setError]         = useState(null)
  // Restored. The per-field mic change (02a4753) renamed THIS declaration to
  // micField by mistake, leaving every use of `recording` below undefined, so
  // opening any note box on the crew page threw.
  const [recording, setRecording] = useState(false)
  const recognitionRef            = useRef(null)
  const textareaRef               = useRef(null)

  // When a workflow-trigger panel mounts (start_walk banner, job_close prompt,
  // shift_end recap), auto-focus the textarea so the crew can talk or type
  // immediately without an extra tap. Defaults off for the always-on 💬 panel
  // so opening it doesn't yank the keyboard up unexpectedly.
  useEffect(() => {
    if (autoFocus) textareaRef.current?.focus()
  }, [autoFocus])

  const SpeechRecognition = useMemo(
    () => (typeof window !== 'undefined'
      ? (window.SpeechRecognition || window.webkitSpeechRecognition)
      : null),
    [],
  )
  const voiceSupported = !!SpeechRecognition

  // Stop recording on unmount so an abandoned panel doesn't keep the mic
  // active. The cleanup is fire-and-forget — recognition.stop() can throw
  // if the engine is mid-tear-down and we don't care.
  useEffect(() => {
    return () => {
      try { recognitionRef.current?.stop() } catch { /* noop */ }
    }
  }, [])

  const startRecording = () => {
    if (!voiceSupported || recording) return
    const recognition = new SpeechRecognition()
    recognition.continuous     = true
    recognition.interimResults = false
    recognition.lang           = 'en-US'

    recognition.onresult = (event) => {
      // Each event delivers one or more "final" chunks since interimResults
      // is off. Pull each chunk and append to the draft; reset the chunk
      // accumulator per event so we never double-append.
      let chunk = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          chunk += event.results[i][0].transcript + ' '
        }
      }
      if (chunk.trim()) {
        setDraft(prev => (prev ? prev.trimEnd() + ' ' : '') + chunk.trim())
        setVoiceUsed(true)
      }
    }
    recognition.onerror = (e) => {
      // Most common: user denied mic permission. Show a quiet error so the
      // crew knows why nothing happened, and don't crash the panel.
      console.warn('[staff-portal] speech recognition error:', e.error)
      setError(
        e.error === 'not-allowed' || e.error === 'service-not-allowed'
          ? 'Mic permission was denied. Tap the lock icon in your browser to allow it.'
          : 'Voice input had a hiccup. Try again, or type the note.'
      )
      setRecording(false)
    }
    recognition.onend = () => setRecording(false)

    try {
      recognition.start()
      recognitionRef.current = recognition
      setRecording(true)
      setError(null)
    } catch (err) {
      console.warn('[staff-portal] recognition.start failed', err)
      setError('Could not start voice input on this browser.')
    }
  }

  const stopRecording = () => {
    try { recognitionRef.current?.stop() } catch { /* noop */ }
    setRecording(false)
  }

  const submit = async () => {
    if (!draft.trim() || sending) return
    setSending(true)
    setError(null)
    // If still recording when the crew taps Send, stop first so the engine
    // doesn't keep transcribing into the next note.
    if (recording) stopRecording()
    const res = await onSubmit?.({ text: draft, isVoice: voiceUsed, promptType: defaultPromptType })
    setSending(false)
    if (res?.ok) {
      setDraft('')
      setVoiceUsed(false)
    } else if (res?.error) {
      setError('Could not save the note. Tap Send to try again.')
    }
  }

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className="px-2.5 pb-2.5 pt-0.5 border-t border-ink-100 bg-ink-50/50 rounded-b-lg space-y-2"
    >
      {/* Existing comments — newest first. Keep dense; this lives inside
          a card on a phone screen and the crew shouldn't have to scroll
          forever. */}
      {comments.length > 0 && (
        <ul className="space-y-1.5 pt-1.5">
          {comments.map(c => (
            <li key={c.id} className={`bg-white border border-ink-200 rounded-md px-2 py-1.5 ${c._pending ? 'opacity-60' : ''}`}>
              <div className="flex items-center gap-1.5 text-[10px] text-ink-500 mb-0.5">
                <span className="font-semibold text-ink-700">{c.author_name || 'Crew'}</span>
                <span>·</span>
                <span>{formatRelativeTime(c.created_at)}</span>
                {c.is_voice && <span aria-label="Voice note" title="Voice note">🎤</span>}
                {c.prompt_type && c.prompt_type !== 'free' && (
                  <span className="text-[9px] uppercase tracking-wider text-brand-700 bg-brand-50 border border-brand-200 rounded-full px-1.5">
                    {PROMPT_LABEL[c.prompt_type] ?? c.prompt_type}
                  </span>
                )}
              </div>
              <p className="text-[12px] text-ink-800 leading-snug whitespace-pre-wrap">{c.text}</p>
            </li>
          ))}
        </ul>
      )}

      {/* Draft input — textarea + 🎤 + Send. Textarea grows up to a small
          cap so a long voice transcript doesn't push the buttons off
          screen on a phone. */}
      <div className="bg-white border border-ink-200 rounded-md p-1.5 space-y-1.5">
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder}
          rows={2}
          className="w-full text-[12px] leading-snug px-1.5 py-1 bg-transparent resize-none focus:outline-none placeholder:text-ink-400"
          maxLength={4000}
        />
        <div className="flex items-center justify-between gap-2">
          {voiceSupported ? (
            <button
              type="button"
              onClick={recording ? stopRecording : startRecording}
              disabled={sending}
              className={`text-[11px] font-semibold px-2.5 py-1 rounded-md border transition-colors flex items-center gap-1 ${
                recording
                  ? 'bg-red-50 text-red-700 border-red-200 animate-pulse'
                  : 'bg-white text-ink-700 border-ink-200 hover:bg-ink-50'
              }`}
            >
              <span aria-hidden>🎤</span>
              {recording ? 'Stop' : 'Voice'}
            </button>
          ) : (
            <span className="text-[10px] text-ink-400">Voice not supported on this browser</span>
          )}
          <button
            type="button"
            onClick={submit}
            disabled={!draft.trim() || sending}
            className="text-[11px] font-semibold px-3 py-1 rounded-md bg-brand-600 text-white border border-brand-600 hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {sending ? 'Sending...' : 'Send'}
          </button>
        </div>
        {error && (
          <p className="text-[10px] text-red-600 leading-tight">{error}</p>
        )}
      </div>
    </div>
  )
}

/**
 * ShiftEndRecap — page-level end-of-day reflection.
 *
 * Collapses to a single "End my shift" button when not in use. Expanded,
 * shows one textarea per in-progress WO so the crew can leave a quick
 * "anything slow you down" thought per job without re-opening each one.
 *
 * Submit fires one daily log per non-empty textarea, in parallel.
 *
 * ⚠️ 2 Sep — this used to write a STEP COMMENT anchored to the first checklist
 * item of the job, with a comment admitting why: "workflow-level
 * reflection has no single-step anchor". It was pinning a note about the whole
 * day onto an unrelated step because there was nowhere else to put it — and
 * the filter it needed (`checklist_items?.[0]`) silently dropped the recap
 * entirely for any job with no SOP attached, which are often the jobs
 * worth hearing about.
 *
 * daily_logs (035) is that missing place. Same form, same voice input, same
 * "End my shift" button — it just lands somewhere that means what it says, and
 * Solomon reads it as the crew's account of the day rather than as a stray
 * comment on step one.
 *
 * The voice button is shared at the top — recording flows into whichever
 * textarea last had focus, so the crew can tap a textarea, talk, tap
 * another textarea, talk. Simpler than a 🎤 per WO and the natural way a
 * crew member moves through their thoughts at end-of-shift.
 */
function YesNo({ value, onChange }) {
  return (
    <div className="inline-flex rounded-lg bg-ink-100 p-0.5 flex-shrink-0">
      <button type="button" onClick={() => onChange(true)} className={`text-[11px] font-semibold px-3.5 py-1 rounded-md transition-all ${value === true ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-800'}`}>Yes</button>
      <button type="button" onClick={() => onChange(false)} className={`text-[11px] font-semibold px-3.5 py-1 rounded-md transition-all ${value === false ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-800'}`}>No</button>
    </div>
  )
}

function FieldMic({ active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={active ? 'Stop dictation' : 'Dictate into this box'}
      title={active ? 'Stop dictation' : 'Talk instead of type'}
      className={`flex-shrink-0 w-7 h-7 rounded-md border flex items-center justify-center text-[13px] transition-colors ${active ? 'bg-red-50 border-red-200 animate-pulse' : 'bg-white border-ink-200 hover:bg-ink-50'}`}
    >
      <span aria-hidden>🎤</span>
    </button>
  )
}

function ShiftEndRecap({ workOrders, crew = [], metricDefs = [], onSubmitDailyLog }) {
  // Which box is recording. This state was declared in CommentPanel by mistake
  // (02a4753), so this component threw "micField is not defined" the moment the
  // daily-log form rendered in a browser that supports dictation, which is
  // every crew phone. It lives here, where it is used.
  const [micField, setMicField] = useState(null)
  const general = workOrders.length === 1 && workOrders[0]?.id == null
  const [expanded, setExpanded] = useState(false)
  const [drafts, setDrafts]     = useState({})              // { [workOrderId]: what got done }
  const [blockerDrafts, setBlockerDrafts] = useState({})   // { [workOrderId]: what got in the way }
  const [hourDrafts, setHourDrafts]       = useState({})   // { [workOrderId]: hours on site }
  const [schedDrafts, setSchedDrafts]     = useState({})   // { [woId]: 'ahead'|'on'|'behind' }
  const [pctDrafts, setPctDrafts]         = useState({})   // { [woId]: percent complete }
  const [costDrafts, setCostDrafts]       = useState({})   // { [woId]: unplanned cost yes/no }
  const [costNoteDrafts, setCostNoteDrafts] = useState({})
  const [metricDrafts, setMetricDrafts] = useState({})   // { [woId]: { [metricKey]: value } }
  // ⚠️ Day-level, not per-job. Who was on site and whether anyone got hurt are
  // facts about the DAY — asking them once per job would get three
  // contradictory answers from the same person about the same crew.
  const [onSiteIds, setOnSiteIds]         = useState(() => new Set())
  const [whoOnSite, setWhoOnSite]         = useState('')
  const [safetyNote, setSafetyNote]       = useState('')
  const [injury, setInjury]               = useState(false)
  const [injuryDetail, setInjuryDetail]   = useState('')
  const [reportFiled, setReportFiled]     = useState(null)   // null | true | false
  const [flhaDone, setFlhaDone]           = useState(null)   // null | true | false
  // ⚠️ 2 Sep — still tracked, currently unread. It used to travel to the step
  // comment as is_voice; daily_logs has no such column and does not need one —
  // a dictated account of the day is not worth less than a typed one. Kept
  // because the tracking is free and the flag is the right shape if we ever
  // want it. Delete it rather than inventing a use for it.
  const [voiceWoIds, setVoiceWoIds] = useState(() => new Set())  // which drafts touched by voice
  const [recording, setRecording] = useState(false)
  const [sending, setSending]     = useState(false)
  const [error, setError]         = useState(null)
  const [success, setSuccess]     = useState(false)
  // When this visit last sent a recap. The form folds away 1.5s after a send,
  // and the folded card said nothing, so a crew member could not tell it had
  // gone (11 Nov audit).
  const [sentAt, setSentAt]       = useState(null)
  const recognitionRef            = useRef(null)

  const SpeechRecognition = useMemo(
    () => (typeof window !== 'undefined'
      ? (window.SpeechRecognition || window.webkitSpeechRecognition)
      : null),
    [],
  )
  const voiceSupported = !!SpeechRecognition

  useEffect(() => {
    return () => { try { recognitionRef.current?.stop() } catch { /* noop */ } }
  }, [])

  // One recognition at a time, routed to the field whose 🎤 was tapped, so the
  // crew dictates into the exact box they mean — no "last textarea you tapped"
  // guessing. micField holds the key of the box currently recording.
  const stopMic = () => { try { recognitionRef.current?.stop() } catch { /* noop */ } ; setMicField(null) }
  const toggleMic = (fieldKey, append) => {
    if (!voiceSupported) return
    if (micField === fieldKey) { stopMic(); return }              // tapping the live mic stops it
    try { recognitionRef.current?.stop() } catch { /* noop */ }   // switching fields: stop the old one
    const recognition = new SpeechRecognition()
    recognition.continuous     = true
    recognition.interimResults = false
    recognition.lang           = 'en-US'
    recognition.onresult = (event) => {
      let chunk = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) chunk += event.results[i][0].transcript + ' '
      }
      if (chunk.trim()) append(chunk.trim())
    }
    recognition.onerror = (e) => {
      console.warn('[staff-portal] recognition error:', e.error)
      setError(
        e.error === 'not-allowed' || e.error === 'service-not-allowed'
          ? 'Mic permission was denied. Tap the lock icon in your browser to allow it.'
          : 'Voice input had a hiccup. Try again, or type the note.'
      )
      setMicField(f => (f === fieldKey ? null : f))
    }
    recognition.onend = () => setMicField(f => (f === fieldKey ? null : f))
    try {
      recognition.start()
      recognitionRef.current = recognition
      setMicField(fieldKey)
      setError(null)
    } catch (err) {
      console.warn('[staff-portal] recognition start failed', err)
      setError('Could not start voice input on this browser.')
    }
  }
  const appendInto  = (setter) => (chunk) => setter(prev => (prev ? prev.trimEnd() + ' ' : '') + chunk)
  const appendDraft = (woId) => (chunk) => setDrafts(prev => ({ ...prev, [woId]: (prev[woId] ? prev[woId].trimEnd() + ' ' : '') + chunk }))
  const appendBlk   = (woId) => (chunk) => setBlockerDrafts(prev => ({ ...prev, [woId]: (prev[woId] ? prev[woId].trimEnd() + ' ' : '') + chunk }))

  const submit = async () => {
    if (sending) return
    const toSend = workOrders
      .map(w => ({
        wo:       w,
        text:     (drafts[w.id] ?? '').trim(),
        blockers: (blockerDrafts[w.id] ?? '').trim(),
        hours:    (hourDrafts[w.id] ?? '').trim(),
      }))
      // ⚠️ No longer requires a checklist item. It used to — because the note
      // had to be pinned to one — which silently dropped the recap for any job
      // without a SOP attached. Those are often the jobs worth hearing
      // about.
      // ⚠️ A blocker on its own still counts. "Nothing got done, waited two
      // hours for access" is the most useful log of the lot, and requiring the
      // first box would throw it away. what_happened is NOT NULL, so fall back
      // to the blocker text rather than refusing the submit.
      // ⚠️ A day-level fact is enough on its own. "Nothing to report on the
      // jobs, but someone got hurt" must not be thrown away because both job
      // boxes were empty.
      .filter(x => x.text.length > 0 || x.blockers.length > 0 || injury || safetyNote.trim().length > 0 || flhaDone !== null || onSiteIds.size > 0)
      .map(x => ({ ...x, text: x.text || x.blockers || (injury ? 'Injury reported, see the note.' : 'Nothing to add on the work itself.') }))
    if (toSend.length === 0) return
    if (micField) stopMic()
    setSending(true)
    setError(null)
    setSuccess(false)
    try {
      // Fire in parallel — each comment is independent. Aggregate failures
      // into a single error message rather than per-WO callouts; this is
      // an end-of-shift convenience flow, not a place to triage.
      const results = await Promise.all(
        toSend.map(({ wo, text, blockers, hours }) => onSubmitDailyLog(wo.id === '__general__' ? null : wo.id, text, blockers, hours, { whoOnSite, onSiteStaffIds: [...onSiteIds], safetyNote, injury, injuryDetail, incidentReportFiled: reportFiled, flhaDone, scheduleStatus: schedDrafts[wo.id] ?? null, percentComplete: pctDrafts[wo.id] ?? null, unplannedCost: costDrafts[wo.id] ?? null, unplannedCostNote: costNoteDrafts[wo.id] ?? null, metrics: metricDrafts[wo.id] ?? null }))
      )
      const failed = results.filter(r => !r?.ok)
      if (failed.length === 0) {
        setDrafts({})
        setBlockerDrafts({})
        setHourDrafts({})
        setSchedDrafts({})
        setPctDrafts({})
        setCostDrafts({})
        setCostNoteDrafts({})
        setMetricDrafts({})
        setOnSiteIds(new Set())
        setWhoOnSite('')
        setSafetyNote('')
        setInjury(false)
        setInjuryDetail('')
        setReportFiled(null)
        setFlhaDone(null)
        setVoiceWoIds(new Set())
        setSuccess(true)
        setSentAt(new Date())
        // Auto-collapse after a beat so the crew can move on without a
        // dangling form. The success message stays briefly so they know it
        // landed.
        setTimeout(() => { setExpanded(false); setSuccess(false) }, 1500)
      } else {
        setError(`Saved ${results.length - failed.length} of ${results.length} notes. Tap Submit to retry the rest.`)
      }
    } catch (err) {
      setError(`Could not save: ${err.message}`)
    } finally {
      setSending(false)
    }
  }

  if (!expanded) {
    return (
      <section>
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="w-full bg-white border border-dashed border-ink-300 hover:border-brand-400 hover:bg-brand-50/40 rounded-xl py-3 px-4 transition-colors text-left flex items-center gap-3"
        >
          <div className="flex-1">
            <p className="text-sm font-bold text-ink-900">Today's log</p>
            {sentAt
              ? <p className="text-[11px] text-emerald-700 font-semibold leading-snug">✓ Sent at {sentAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}. The office has it. You can add more any time.</p>
              : <p className="text-[11px] text-ink-500 leading-snug">How's today going? Add to it any time, the office reads it tomorrow.</p>}
          </div>
          <span className="text-[11px] font-semibold text-brand-700">Open →</span>
        </button>
      </section>
    )
  }

  return (
    <section className="bg-white border border-ink-200 rounded-xl shadow-sm">
      <div className="px-4 py-3 border-b border-ink-100 flex items-center justify-between bg-gradient-to-r from-brand-50 to-transparent">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-bold text-ink-900">Today's log</h2>
        </div>
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="text-[11px] font-semibold text-ink-500 hover:text-ink-800"
        >
          Cancel
        </button>
      </div>

      <div className="px-4 py-3 space-y-3">
        <p className="text-[12px] text-ink-600 leading-relaxed">
          {general
            ? 'How did today go? What got done, anything that slowed you up, who was on site. The office reads this tomorrow morning.'
            : 'Anything slow you down on these jobs today? Leave a note per job, the office reads these tomorrow morning.'}
        </p>

        {/* ⚠️ Asked ONCE for the day, above the per-job boxes. Who was on site
            and whether anyone got hurt are facts about the day, not about a
            job — asking per job would get three different answers from
            one person about the same crew. */}
        <div className="mb-3 space-y-2 rounded-xl border border-ink-100 bg-ink-50/40 p-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-ink-400">Site &amp; safety</p>
          <div className="space-y-1.5">
            <p className="text-[11px] font-semibold text-ink-500">Who was on site today?</p>
            {crew.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {crew.map(c => {
                  const on = onSiteIds.has(c.id)
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setOnSiteIds(prev => { const n = new Set(prev); n.has(c.id) ? n.delete(c.id) : n.add(c.id); return n })}
                      className={`text-[11px] font-medium px-2.5 py-1 rounded-full border transition-colors ${on ? 'bg-teal-600 text-white border-teal-600' : 'bg-white text-ink-600 border-ink-200 hover:bg-ink-50'}`}
                    >
                      {c.name}
                    </button>
                  )
                })}
              </div>
            )}
            <input
              type="text"
              value={whoOnSite}
              onChange={(e) => setWhoOnSite(e.target.value)}
              placeholder="Anyone else? Subs, visitors, anyone not on the list"
              maxLength={500}
              className="w-full text-[12px] px-2 py-1.5 bg-white border border-ink-200 rounded-md focus:outline-none focus:ring-1 focus:ring-brand-400 placeholder:text-ink-400"
            />
          </div>
          <div className="relative">
            <textarea
              value={safetyNote}
              onChange={(e) => setSafetyNote(e.target.value)}
              placeholder="Anything unsafe or a near miss? Even if nothing came of it."
              rows={2}
              maxLength={4000}
              className="w-full text-[12px] leading-snug px-2 py-1.5 pr-10 bg-white border border-ink-200 rounded-md resize-none focus:outline-none focus:ring-1 focus:ring-brand-400 placeholder:text-ink-400"
            />
            {voiceSupported && <div className="absolute bottom-1.5 right-1.5"><FieldMic active={micField === 'safety'} onClick={() => toggleMic('safety', appendInto(setSafetyNote))} /></div>}
          </div>
          <div className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md border border-ink-150 bg-white">
            <span className="text-[12px] text-ink-700 leading-snug">Field level hazard assessment done today?</span>
            <YesNo value={flhaDone} onChange={setFlhaDone} />
          </div>
          <label className="flex items-start gap-2 px-2 py-2 rounded-md bg-red-50 border border-red-200 cursor-pointer">
            <input
              type="checkbox"
              checked={injury}
              onChange={(e) => setInjury(e.target.checked)}
              className="mt-0.5 flex-shrink-0"
            />
            <span className="text-[12px] leading-snug text-ink-800">
              Someone was hurt today
              <span className="block text-[11px] text-ink-500 mt-0.5">
                This tells the office straight away. It is not a WorkSafe report, that
                still has to be filed properly.
              </span>
            </span>
          </label>
          {injury && (
            <div className="space-y-2 pl-2 border-l-2 border-red-200">
              <div className="relative">
                <textarea
                  value={injuryDetail}
                  onChange={(e) => setInjuryDetail(e.target.value)}
                  placeholder="What happened?"
                  rows={2}
                  maxLength={4000}
                  className="w-full text-[12px] leading-snug px-2 py-1.5 pr-10 bg-white border border-ink-200 rounded-md resize-none focus:outline-none focus:ring-1 focus:ring-red-300 placeholder:text-ink-400"
                />
                {voiceSupported && <div className="absolute bottom-1.5 right-1.5"><FieldMic active={micField === 'injury'} onClick={() => toggleMic('injury', appendInto(setInjuryDetail))} /></div>}
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] text-ink-700 leading-snug">Was an incident report filled out?</span>
                <YesNo value={reportFiled} onChange={setReportFiled} />
              </div>
            </div>
          )}
        </div>

        <ul className="space-y-2.5">
          {workOrders.map(wo => (
            <li key={wo.id ?? 'general'} className="border border-ink-150 rounded-lg p-2.5 bg-ink-50/40">
              <p className="text-[12px] font-bold text-ink-900 mb-1 leading-snug">{wo.title}</p>
              {/* ⚠️ 2 Sep — there was ONE box here and it sent what_happened.
                  blockers and hours_on_site existed in the table, in Solomon's
                  context, in the prompt (where blockers is called "the field the
                  whole thing exists for") and in the amber panel on /logs — and
                  NOTHING COULD EVER FILL THEM. The only blockers in the database
                  were seeded by hand. A column nobody can write to is not a
                  feature, it is a promise the UI cannot keep.

                  Two boxes, not one merged box, because they answer different
                  questions and merging them buries the second. What happened is
                  the record; what got in the way is the thing worth fixing, and
                  the one that shows a pattern when it repeats. */}
              <div className="relative">
                <textarea
                  value={drafts[wo.id] ?? ''}
                  onChange={(e) => setDrafts(prev => ({ ...prev, [wo.id]: e.target.value }))}
                  placeholder="What got done?"
                  rows={2}
                  maxLength={4000}
                  className="w-full text-[12px] leading-snug px-2 py-1.5 pr-10 bg-white border border-ink-200 rounded-md resize-none focus:outline-none focus:ring-1 focus:ring-brand-400 placeholder:text-ink-400"
                />
                {voiceSupported && <div className="absolute bottom-1.5 right-1.5"><FieldMic active={micField === `what:${wo.id}`} onClick={() => toggleMic(`what:${wo.id}`, appendDraft(wo.id))} /></div>}
              </div>
              <div className="relative mt-1.5">
                <textarea
                  value={blockerDrafts[wo.id] ?? ''}
                  onChange={(e) => setBlockerDrafts(prev => ({ ...prev, [wo.id]: e.target.value }))}
                  placeholder="Anything slow you down? Locked door, missing part, waiting on another trade…"
                  rows={2}
                  maxLength={4000}
                  className="w-full text-[12px] leading-snug px-2 py-1.5 pr-10 bg-amber-50/60 border border-amber-200 rounded-md resize-none focus:outline-none focus:ring-1 focus:ring-amber-400 placeholder:text-ink-400"
                />
                {voiceSupported && <div className="absolute bottom-1.5 right-1.5"><FieldMic active={micField === `blockers:${wo.id}`} onClick={() => toggleMic(`blockers:${wo.id}`, appendBlk(wo.id))} /></div>}
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <input
                  type="number" min="0" max="24" step="0.5" inputMode="decimal"
                  value={hourDrafts[wo.id] ?? ''}
                  onChange={(e) => setHourDrafts(prev => ({ ...prev, [wo.id]: e.target.value }))}
                  placeholder="Hours"
                  className="w-24 text-[12px] px-2 py-1.5 bg-white border border-ink-200 rounded-md focus:outline-none focus:ring-1 focus:ring-brand-400 placeholder:text-ink-400"
                />
                <span className="text-[11px] text-ink-400">on site</span>
              </div>
              <div className="mt-2 pt-2 border-t border-ink-100 space-y-2">
                <p className="text-[10px] font-bold uppercase tracking-widest text-ink-400">Progress &amp; cost</p>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-[11px] text-ink-500">On track?</span>
                  <div className="inline-flex rounded-lg bg-ink-100 p-0.5">
                    {[['ahead', 'Ahead'], ['on', 'On track'], ['behind', 'Behind']].map(([v, l]) => {
                      const on = schedDrafts[wo.id] === v
                      return (
                        <button key={v} type="button" onClick={() => setSchedDrafts(prev => ({ ...prev, [wo.id]: on ? null : v }))}
                          className={`text-[11px] font-semibold px-2.5 py-1 rounded-md transition-all ${on ? (v === 'behind' ? 'bg-red-500 text-white shadow-sm' : 'bg-white text-ink-900 shadow-sm') : 'text-ink-500 hover:text-ink-800'}`}>{l}</button>
                      )
                    })}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <input type="number" min="0" max="100" inputMode="numeric" value={pctDrafts[wo.id] ?? ''} onChange={(e) => setPctDrafts(prev => ({ ...prev, [wo.id]: e.target.value }))} placeholder="% done" className="w-20 text-[12px] px-2 py-1.5 bg-white border border-ink-200 rounded-md focus:outline-none focus:ring-1 focus:ring-brand-400 placeholder:text-ink-400" />
                  <span className="text-[11px] text-ink-400">how far along</span>
                </div>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-[11px] text-ink-500">Any unplanned cost today?</span>
                  <YesNo value={costDrafts[wo.id] ?? null} onChange={(v) => setCostDrafts(prev => ({ ...prev, [wo.id]: v }))} />
                </div>
                {costDrafts[wo.id] === true && (
                  <textarea value={costNoteDrafts[wo.id] ?? ''} onChange={(e) => setCostNoteDrafts(prev => ({ ...prev, [wo.id]: e.target.value }))} placeholder="Extra material, rework, equipment, standby…" rows={2} maxLength={4000} className="w-full text-[12px] leading-snug px-2 py-1.5 bg-white border border-ink-200 rounded-md resize-none focus:outline-none focus:ring-1 focus:ring-brand-400 placeholder:text-ink-400" />
                )}
                {metricDefs.map(def => (
                  <div key={def.key} className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-ink-500 leading-snug">{def.label}</span>
                    <input
                      type="number" inputMode="decimal"
                      value={metricDrafts[wo.id]?.[def.key] ?? ''}
                      onChange={(e) => setMetricDrafts(prev => ({ ...prev, [wo.id]: { ...(prev[wo.id] || {}), [def.key]: e.target.value } }))}
                      className="w-24 text-[12px] px-2 py-1.5 bg-white border border-ink-200 rounded-md focus:outline-none focus:ring-1 focus:ring-brand-400"
                    />
                  </div>
                ))}
              </div>
            </li>
          ))}
        </ul>

        {error && <p className="text-[11px] text-red-600 leading-tight">{error}</p>}
        {success && <p className="text-[11px] text-emerald-700 font-semibold">All notes saved.</p>}

        <button
          type="button"
          onClick={submit}
          disabled={sending || Object.values(drafts).every(t => !t.trim())}
          className="w-full text-sm font-bold px-3 py-2 rounded-md bg-brand-600 text-white border border-brand-600 hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {sending ? 'Sending...' : 'Submit recap'}
        </button>
      </div>
    </section>
  )
}

// Human label for each prompt_type — shown as a small badge on the
// comment row so the crew (and owner, later) can scan and see "this
// was a job-close reflection" vs "this was a shift-end gripe."
// Keep in sync with ALLOWED_PROMPT_TYPES in staff-portal/index.ts.
//
// Note on the 'near_miss' label: deliberately labelled "Flag for office"
// in the UI even though the schema value is 'near_miss'. The schema
// captures the cluster (Solomon looks for near-miss patterns), but the
// user-facing copy avoids implying this is a safety-compliance entry.
// FLHA and formal incident reporting live in the CRM, not here. See
// migration 021's "what this is NOT" block.
const PROMPT_LABEL = {
  free:          null,                  // no badge for free-form
  start_walk:    'Start walk',
  shift_end:     'Shift end',
  step_complete: 'Step done',
  job_close:     'Job close',
  near_miss:     'Flag for office',
}

function StatusButton({ label, active, pending, onClick, variant }) {
  const base = 'px-2 py-2 rounded-lg text-[11px] font-semibold transition-colors border'
  const palette = variant === 'done'
    ? (active
        ? 'bg-emerald-600 text-white border-emerald-600'
        : 'bg-white text-emerald-700 border-emerald-200 hover:bg-emerald-50')
    : (active
        ? 'bg-brand-600 text-white border-brand-600'
        : 'bg-white text-ink-700 border-ink-200 hover:bg-ink-50')
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className={`${base} ${palette} ${pending ? 'opacity-60 cursor-wait' : ''}`}
    >
      {label}
    </button>
  )
}

// ---- date helpers ----
// Inlined rather than imported from the existing date helpers in
// lib/milestoneDates so the staff portal stays self-contained. If we
// ever need more date logic here, extract it.

function startOfToday() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

// "just now" / "3m ago" / "2h ago" / "yesterday" / "May 8" — compact
// because each comment row only has space for a small byline.
function formatRelativeTime(iso) {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const diffSec = Math.floor((Date.now() - t) / 1000)
  if (diffSec < 30)   return 'just now'
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`
  if (diffSec < 86_400) {
    const h = Math.floor(diffSec / 3600)
    return `${h}h ago`
  }
  if (diffSec < 86_400 * 2) return 'yesterday'
  const d = new Date(t)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function formatDueDate(iso) {
  // ISO date (YYYY-MM-DD) — parse locally to avoid timezone surprises
  // where a "due 2026-05-12" looks like "due May 11" in PT.
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const today = startOfToday()
  const oneDay = 86_400_000
  const diff = Math.round((date - today) / oneDay)
  if (diff === 0)  return 'today'
  if (diff === 1)  return 'tomorrow'
  if (diff === -1) return 'yesterday'
  if (diff > 1 && diff < 7) return date.toLocaleDateString(undefined, { weekday: 'long' })
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
