import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { sendTaskAssigned } from '../lib/email'
import { AMOUNTS_EMBED, withAmounts, canSeeJobCosts, saveJobAmounts } from '../lib/jobAmounts'
import { listTaskAttachments, uploadTaskAttachment, deleteTaskAttachment, openTaskAttachment, removeFilesForTask, TASK_ATTACH_MAX_MB } from '../lib/taskAttachments'

/**
 * Jobs — /board
 *
 * 4-column kanban: Backlog → In Progress → Review → Done
 * Cards are draggable between columns. Each card can be assigned to either:
 *   - An app user (profiles table)
 *   - An external staff member (staff_members table — name + email only)
 *
 * When a staff member with an email is assigned, an "📧 Email task" button
 * appears on the card — clicking it opens the user's mail client with the
 * task pre-filled.
 *
 * Setup: requires work_orders + staff_members tables. If missing, the page
 * shows a one-time setup screen with the SQL to run.
 */

// ── Column + priority config ──────────────────────────────────────────────────

const COLUMNS = [
  { key: 'backlog',     label: 'Not started',   headerCls: 'bg-ink-100   text-ink-700',   dotCls: 'bg-ink-400'   },
  { key: 'in_progress', label: 'In progress', headerCls: 'bg-brand-100 text-brand-800', dotCls: 'bg-brand-500' },
  { key: 'review',      label: 'Review',      headerCls: 'bg-amber-100 text-amber-800', dotCls: 'bg-amber-500' },
  { key: 'done',        label: 'Done',        headerCls: 'bg-green-100 text-green-800', dotCls: 'bg-green-500' },
]
const COLUMN_KEYS = COLUMNS.map(c => c.key)

const PRIORITIES = [
  { key: 'low',    label: 'Low',    strip: 'bg-ink-200',    badge: 'bg-ink-50    text-ink-500    border-ink-200'    },
  { key: 'medium', label: 'Medium', strip: 'bg-amber-400',  badge: 'bg-amber-50  text-amber-700  border-amber-200'  },
  { key: 'high',   label: 'High',   strip: 'bg-orange-400', badge: 'bg-orange-50 text-orange-700 border-orange-200' },
  { key: 'urgent', label: 'Urgent', strip: 'bg-red-500',    badge: 'bg-red-50    text-red-700    border-red-200'    },
]
const PRIORITY_MAP = Object.fromEntries(PRIORITIES.map(p => [p.key, p]))

// ── Helpers ───────────────────────────────────────────────────────────────────

function initials(str) {
  if (!str) return '?'
  return str.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
}

function Avatar({ member, size = 'md' }) {
  const sz = size === 'sm' ? 'w-6 h-6 text-[9px]' : size === 'lg' ? 'w-9 h-9 text-sm' : 'w-7 h-7 text-[10px]'
  if (member?.avatar_url) {
    return <img src={member.avatar_url} alt={member?.name} className={`${sz} rounded-full object-cover flex-shrink-0`} />
  }
  const bg = member?._type === 'staff' ? 'bg-teal-600' : 'bg-brand-600'
  return (
    <div className={`${sz} rounded-full ${bg} flex items-center justify-center font-bold text-white flex-shrink-0`}>
      {initials(member?.name || member?.email)}
    </div>
  )
}

function fmtDate(d) {
  if (!d) return null
  return new Date(d + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function isOverdue(d) {
  if (!d) return false
  return new Date(d + 'T23:59:59') < new Date()
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Board() {
  const { profile, company, role } = useAuth()
  // "How tasks work" strip. Shown until dismissed, remembered per company, the
  // same way the SOPs page remembers its own.
  const howKey = profile?.company_id ? `tasks_how_dismissed_${profile.company_id}` : null
  const [howHidden, setHowHidden] = useState(false)
  const showHow = !howHidden && !(howKey && typeof window !== 'undefined' && localStorage.getItem(howKey) === '1')
  function dismissHow() {
    setHowHidden(true)
    try { if (howKey) localStorage.setItem(howKey, '1') } catch { /* storage blocked */ }
  }
  const seeCosts = canSeeJobCosts(role, company)
  const companyId    = profile?.company_id
  const [searchParams, setSearchParams] = useSearchParams()

  const [appUsers,         setAppUsers]         = useState([])   // profiles with Eliv8 OS accounts
  const [staff,            setStaff]            = useState([])   // external staff_members
  const [workOrders,       setWorkOrders]        = useState([])
  const [milestones,       setMilestones]        = useState([])
  // Active SOPs for the "Start from SOP" picker in the create modal.
  // Each row carries its items inline so we can spawn the checklist in one
  // round-trip after the WO is inserted — no second fetch needed.
  const [templates,        setTemplates]         = useState([])
  const [loading,          setLoading]           = useState(true)
  const [setupNeeded,      setSetupNeeded]       = useState(false)
  const [staffSetupNeeded, setStaffSetupNeeded]  = useState(false)
  const [filterCid,        setFilterCid]         = useState(null)
  const [showModal,        setShowModal]         = useState(false)
  const [editingOrder,     setEditingOrder]      = useState(null)
  const [dragId,           setDragId]            = useState(null)

  // ── Field flags (the crew's "Flag for office" stream) ──────────────────────
  // Lightweight inbox over work_order_step_comments where prompt_type =
  // 'near_miss' — the things the crew tagged for owner attention. Loaded
  // lazily when the drawer is first opened so the kanban load isn't slowed
  // by a query 95% of users won't open on a given visit. We keep the COUNT
  // up-to-date on a slower poll, though, so the header badge is honest.
  const [flags,            setFlags]            = useState([])
  const [flagsLoading,     setFlagsLoading]     = useState(false)
  const [flagsOpen,        setFlagsOpen]        = useState(false)
  const [flagCount,        setFlagCount]        = useState(0)
  // Unified member list — each tagged with _type and _cid (prefixed ID string)
  const allMembers = [
    ...appUsers.map(p => ({ ...p, _type: 'profile', _cid: `p:${p.id}` })),
    ...staff.map(s =>    ({ ...s, _type: 'staff',   _cid: `s:${s.id}` })),
  ]
  const memberByCid = Object.fromEntries(allMembers.map(m => [m._cid, m]))

  // Which combined ID a job is assigned to
  function getAssigneeCid(order) {
    if (order.staff_member_id) return `s:${order.staff_member_id}`
    if (order.assigned_to)     return `p:${order.assigned_to}`
    return null
  }

  // All the people on a job (crew + an app user), as assignee cids.
  function getAssigneeCids(order) {
    const cids = []
    for (const id of (order.assigned_staff_ids ?? [])) cids.push(`s:${id}`)
    if (order.staff_member_id && !cids.includes(`s:${order.staff_member_id}`)) cids.push(`s:${order.staff_member_id}`)
    if (order.assigned_to) cids.push(`p:${order.assigned_to}`)
    return cids
  }

  useEffect(() => {
    if (!companyId) return
    loadAll()
  }, [companyId])

  // When the page is opened from a Roadmap "Job" link OR from the
  // SOPs page's "Use this SOP" CTA, auto-open the new-order modal
  // pre-filled. Wait until loading is done so milestones + templates are in
  // the dropdowns.
  useEffect(() => {
    if (loading) return
    const msId       = searchParams.get('ms_id')
    const msTitle    = searchParams.get('ms_title')
    const task       = searchParams.get('task')
    const playbookId = searchParams.get('playbook_id')
    if (!msId && !msTitle && !task && !playbookId) return

    // Pre-fill the title from the SOP name when arriving from SOPs
    // and there's no explicit task hint — saves the owner one input. The user
    // can overwrite it before saving.
    let titleHint = task ?? ''
    if (!titleHint && playbookId) {
      const tpl = templates.find(t => t.id === playbookId)
      if (tpl?.name && tpl.name !== 'Untitled SOP') titleHint = tpl.name
    }

    setEditingOrder({
      status:       'backlog',
      title:        titleHint,
      milestone_id: msId        ? msId    : '',
      template_id:  playbookId  ? playbookId : '',
      // Store the milestone title as a hint even if it isn't the task title
      _ms_hint:     msTitle     ?? '',
    })
    setShowModal(true)
    // Clean the URL so a refresh doesn't re-open the modal
    setSearchParams({}, { replace: true })
  }, [loading])

  async function loadAll() {
    setLoading(true)
    const [usersRes, staffRes, ordersRes, msRes, tplRes] = await Promise.all([
      supabase.from('profiles').select('id, name, email, avatar_url').eq('company_id', companyId),
      supabase.from('staff_members').select('*').eq('company_id', companyId).order('name'),
      supabase.from('work_orders').select(`*, ${AMOUNTS_EMBED}`).eq('company_id', companyId).order('created_at', { ascending: false }),
      supabase.from('milestones').select('id, title, source').eq('company_id', companyId).eq('completed', false).order('sort_order', { ascending: true }),
      // SOPs — load with items nested so we can spawn the checklist
      // in one go on WO create. Failing silently (e.g. before migration 020
      // is applied) means the picker just won't appear — the rest of the
      // page keeps working.
      supabase
        .from('work_order_templates')
        .select(`
          id, name,
          items:work_order_template_items(id, position, text, notes, required)
        `)
        .eq('company_id', companyId)
        .is('archived_at', null)
        .order('updated_at', { ascending: false }),
    ])
    // Detect missing table via both the Postgres "undefined_table" code (42P01)
    // and the PostgREST schema-cache miss code (PGRST200 / "schema cache" message).
    const tableMissing = (err) =>
      err?.code === '42P01' ||
      err?.code === 'PGRST200' ||
      err?.message?.toLowerCase().includes('schema cache')

    if (tableMissing(ordersRes.error)) { setSetupNeeded(true); setLoading(false); return }
    if (tableMissing(staffRes.error))  setStaffSetupNeeded(true)
    setAppUsers(usersRes.data  ?? [])
    setStaff(staffRes.data    ?? [])
    setWorkOrders(withAmounts(ordersRes.data))
    setMilestones(msRes.data   ?? [])
    // Templates may not exist yet (migration 020 unapplied) — fall back to []
    // so the picker is just hidden, no error UI.
    if (!tableMissing(tplRes.error)) {
      const sorted = (tplRes.data ?? []).map(t => ({
        ...t,
        items: (t.items || []).slice().sort((a, b) => a.position - b.position),
      }))
      setTemplates(sorted)
    } else {
      setTemplates([])
    }
    setLoading(false)
  }

  async function handleSave(data) {
    // Decode the prefixed combined ID back to the right FK
    const cids = Array.isArray(data.assignee_cids) ? data.assignee_cids : []
    const staffIds   = [...new Set(cids.filter(c => c.startsWith('s:')).map(c => c.slice(2)))]
    const profileIds = cids.filter(c => c.startsWith('p:')).map(c => c.slice(2))
    const assigned_to     = profileIds[0] ?? null
    const staff_member_id = staffIds[0] ?? null

    // Only include staff_member_id when the user picked a staff member
    // AND the column is confirmed to exist — avoids a silent Postgres error
    // when work_orders was created with the old setup SQL.
    // ⭐ Amounts are saved separately (migration 077); only people allowed to
    // see job costs ever send them.
    const toNum = v => (v === '' || v == null ? null : Number(v))
    const amounts = { quoted: toNum(data.quoted_amount), cost: toNum(data.cost_amount), invoiced: toNum(data.invoiced_amount) }
    const payload = {
      title:        data.title,
      description:  data.description || null,
      assigned_to,
      due_date:     data.due_date || null,
      priority:     data.priority,
      // ⚠️ Empty string becomes NULL, not 0. "Not entered" and "this job made
      // nothing" are different facts and only one of them is a problem — the
      // same reasoning as the giving field in migration 028.
      milestone_id: data.milestone_id || null,
      status:       data.status,
      ...(staff_member_id && !staffSetupNeeded ? { staff_member_id } : {}),
      ...(!staffSetupNeeded ? { assigned_staff_ids: staffIds } : {}),
      // template_id is set when the user picked a SOP in the create modal.
      // It's a back-reference for reporting ("what % of WOs use a SOP?")
      // and lets us style the WO card differently if we want to flag it.
      ...(data.template_id ? { template_id: data.template_id } : {}),
    }

    // Capture the previous assignee BEFORE the write so we can tell if the
    // staff_member changed on edit. Only used to decide whether to fire the
    // task-assigned email — we don't want to re-spam someone every time a
    // title or due-date gets tweaked.
    const previousStaffIds = data.id
      ? (workOrders.find(o => o.id === data.id)?.assigned_staff_ids ?? [])
      : []
    const newStaffIds = staffIds.filter(id => !previousStaffIds.includes(id))

    if (data.id) {
      const { error } = await supabase.from('work_orders').update(payload).eq('id', data.id)
      if (!error && seeCosts) await saveJobAmounts({ workOrderId: data.id, companyId, ...amounts })
      if (!error) {
        setWorkOrders(prev => prev.map(o =>
          o.id === data.id ? { ...o, ...payload, ...(seeCosts ? { quoted_amount: amounts.quoted, cost_amount: amounts.cost, invoiced_amount: amounts.invoiced } : {}) } : o
        ))
        newStaffIds.forEach(sid => notifyStaffAssignee({ staff_member_id: sid, payload }))
      }
      setShowModal(false); setEditingOrder(null)
      return error?.message ?? null
    } else {
      const { data: row, error } = await supabase.from('work_orders').insert({
        company_id: companyId,
        created_by: profile.id,
        ...payload,
        priority: payload.priority || 'medium',
        status:   payload.status   || 'backlog',
      }).select().single()
      if (!error && row && seeCosts) await saveJobAmounts({ workOrderId: row.id, companyId, ...amounts })
      if (!error && row) {
        setWorkOrders(prev => [{ ...row, quoted_amount: seeCosts ? amounts.quoted : null, cost_amount: seeCosts ? amounts.cost : null, invoiced_amount: seeCosts ? amounts.invoiced : null }, ...prev])
        // ── Spawn checklist items from the chosen SOP ────────────────
        // The copy is deliberate (see migration 020): editing the template
        // later mustn't change in-flight checklists. We fire-and-forget on
        // failure here — the WO is the user's primary action, and the items
        // can always be re-spawned manually if this somehow fails.
        if (data.template_id) {
          await spawnChecklistFromTemplate(row.id, data.template_id)
        }
        setShowModal(false); setEditingOrder(null)
        newStaffIds.forEach(sid => notifyStaffAssignee({ staff_member_id: sid, payload }))
      }
      return error?.message ?? null
    }
  }

  /**
   * Copy every step of a SOP template onto a freshly-created work
   * order as checklist_items. Pulled from the in-memory `templates` array
   * so we don't double-fetch.
   *
   * Each instance carries template_item_id back-reference (for reporting),
   * plus its own copy of text/notes/required/position so future edits to
   * the source template don't bleed into in-flight work.
   */
  async function spawnChecklistFromTemplate(workOrderId, templateId) {
    const tpl = templates.find(t => t.id === templateId)
    if (!tpl?.items?.length) return
    const rows = tpl.items.map(item => ({
      work_order_id:    workOrderId,
      template_item_id: item.id,
      position:         item.position,
      text:             item.text,
      notes:            item.notes,
      required:         item.required,
    }))
    const { error } = await supabase.from('work_order_checklist_items').insert(rows)
    if (error) console.warn('Failed to spawn checklist items:', error.message)
  }

  /**
   * Fire-and-forget task-assigned email to a staff member. Looks up the
   * staff row from the in-memory list (already loaded by loadAll), skips
   * silently if no email is on file. Errors are logged but don't surface
   * — the job save is the user's primary action.
   */
  function notifyStaffAssignee({ staff_member_id, payload }) {
    const staffRow = staff.find(s => s.id === staff_member_id)
    if (!staffRow?.email) return
    const ownerName   = profile?.full_name || profile?.name || profile?.email?.split('@')[0] || 'Your manager'
    const companyName = company?.name || 'the team'
    sendTaskAssigned({
      to:              staffRow.email,
      staffId:         staff_member_id,
      staffName:       staffRow.name,
      ownerName,
      companyName,
      taskTitle:       payload.title,
      taskDescription: payload.description,
      priority:        payload.priority,
      dueDate:         payload.due_date,
    })
  }

  async function handleMove(orderId, newStatus) {
    setWorkOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: newStatus } : o))
    await supabase.from('work_orders').update({ status: newStatus }).eq('id', orderId)
  }

  async function handleDelete(orderId, title) {
    if (!window.confirm(`Delete "${title || 'this task'}"? This cannot be undone.`)) return
    setWorkOrders(prev => prev.filter(o => o.id !== orderId))
    await removeFilesForTask(orderId)
    await supabase.from('work_orders').delete().eq('id', orderId)
  }

  function handleEmailTask(order) {
    const cid    = getAssigneeCid(order)
    const member = cid ? memberByCid[cid] : null
    if (!member?.email) return
    const name = member.name || member.email
    const subject = encodeURIComponent(`Task assigned: ${order.title}`)
    const lines = [
      `Hi ${name},`,
      '',
      `You've been assigned a task:`,
      '',
      `📋 ${order.title}`,
    ]
    if (order.description) lines.push('', order.description)
    lines.push('', `Priority: ${PRIORITY_MAP[order.priority]?.label ?? order.priority}`)
    if (order.due_date) lines.push(`Due: ${fmtDate(order.due_date)}`)
    lines.push('', 'Log in to Eliv8 OS to view the full board and update progress.')
    window.location.href = `mailto:${member.email}?subject=${subject}&body=${encodeURIComponent(lines.join('\n'))}`
  }

  function openNew(status = 'backlog')  { setEditingOrder({ status }); setChecklistItems([]); setShowModal(true) }
  function openEdit(order)              {
    setEditingOrder({ ...order, assignee_cids: getAssigneeCids(order) })
    setChecklistItems([])              // clear stale items from a previous edit
    setShowModal(true)
    loadChecklistItems(order.id)
  }

  // ── Checklist items (for the WO currently in the edit modal) ──────────────
  // Stored at page level so handleToggleChecklistItem can update both the
  // child modal's view and the parent's state in one place. Cleared each
  // time the modal opens to avoid flashing the previous WO's list.
  const [checklistItems, setChecklistItems] = useState([])

  async function loadChecklistItems(workOrderId) {
    const { data, error } = await supabase
      .from('work_order_checklist_items')
      .select('id, position, text, notes, required, done, done_at, done_by_user_id, done_by_staff_member_id')
      .eq('work_order_id', workOrderId)
      .order('position', { ascending: true })
    // Silent failure — if migration 020 isn't applied the table won't exist
    // and the modal just shows no checklist. We don't want to error-banner
    // the whole edit flow over a missing optional feature.
    if (error) return

    // ── Pull step comments for this WO and group by item ─────────────────
    // This is the field-level write-back stream: crew leaving notes against
    // specific steps from the staff portal. Owner reads them here in the
    // edit modal to close the loop ("crew flagged the dust barrier step
    // was missing tape — let me add that to the SOP").
    //
    // We resolve author names client-side from the lists we already have
    // in memory (staff + appUsers in the parent component pass through
    // separately for rendering), so this stays a single network call.
    // Silent-fail if migration 021 isn't applied — items just show with
    // no comments attached.
    let commentsByItem = new Map()
    const itemIds = (data ?? []).map(d => d.id)
    if (itemIds.length) {
      const { data: comments, error: cErr } = await supabase
        .from('work_order_step_comments')
        .select('id, checklist_item_id, staff_member_id, user_id, text, is_voice, prompt_type, created_at')
        .in('checklist_item_id', itemIds)
        .order('created_at', { ascending: false })
      if (!cErr) {
        for (const c of comments ?? []) {
          const arr = commentsByItem.get(c.checklist_item_id) ?? []
          arr.push(c)
          commentsByItem.set(c.checklist_item_id, arr)
        }
      }
    }

    setChecklistItems((data ?? []).map(item => ({
      ...item,
      comments: commentsByItem.get(item.id) ?? [],
    })))
  }

  // ── Field-flag count (cheap header badge) ──────────────────────────────────
  // Runs once on page load + after the drawer closes (someone might have
  // flagged things in another tab). Just a count(*) — no comment text — so
  // it's fast and we don't pay for the full list when the drawer is closed.
  async function loadFlagCount() {
    const { count, error: err } = await supabase
      .from('work_order_step_comments')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .eq('prompt_type', 'near_miss')
    // Silent fail — if migration 021 isn't applied yet, just show no badge.
    if (err) return
    setFlagCount(count ?? 0)
  }

  // ── Full field-flag list (loaded on drawer open) ──────────────────────────
  // Pulls every 'near_miss' comment + the WO title for jump-to-job context.
  // Newest first, no pagination yet (we cap implicitly via the prompt_type
  // filter being narrow — if a single company starts hitting hundreds we add
  // a 50-row limit + "load more"). Author names resolved client-side from
  // the staff + appUsers we already have in state.
  async function loadFlags() {
    setFlagsLoading(true)
    const { data, error: err } = await supabase
      .from('work_order_step_comments')
      .select(`
        id, checklist_item_id, work_order_id, staff_member_id, user_id,
        text, is_voice, prompt_type, created_at,
        work_orders!inner(id, title)
      `)
      .eq('company_id', companyId)
      .eq('prompt_type', 'near_miss')
      .order('created_at', { ascending: false })
      .limit(100)
    setFlagsLoading(false)
    if (err) {
      // Silent fail like the rest — the drawer just shows "no flags yet".
      setFlags([])
      return
    }
    setFlags(data ?? [])
  }

  // Initial badge load — kicks off alongside loadAll so the header shows the
  // right count from the first render.
  useEffect(() => {
    if (!companyId) return
    loadFlagCount()
  }, [companyId])

  /**
   * Tick / untick a checklist item. Optimistic — flips local state first,
   * persists in the background. Reverts on error.
   *
   * Records done_by_user_id so we can later show "checked by Daniel · 2h ago"
   * if we want; the staff portal sets done_by_staff_member_id on its side.
   */
  async function handleToggleChecklistItem(itemId, nextDone) {
    setChecklistItems(prev => prev.map(i =>
      i.id === itemId
        ? { ...i, done: nextDone, done_at: nextDone ? new Date().toISOString() : null,
            done_by_user_id: nextDone ? profile.id : null }
        : i
    ))
    const payload = nextDone
      ? { done: true,  done_at: new Date().toISOString(), done_by_user_id: profile.id, done_by_staff_member_id: null }
      : { done: false, done_at: null,                       done_by_user_id: null,        done_by_staff_member_id: null }
    const { error } = await supabase
      .from('work_order_checklist_items')
      .update(payload)
      .eq('id', itemId)
    if (error) {
      // Roll back: reload from server so we don't have to remember the previous state
      const currentOrder = editingOrder?.id
      if (currentOrder) loadChecklistItems(currentOrder)
    }
  }
  function onDrop(status)               { if (dragId) { handleMove(dragId, status); setDragId(null) } }

  const filtered     = filterCid
    ? workOrders.filter(o => getAssigneeCids(o).includes(filterCid))
    : workOrders
  const milestoneMap = Object.fromEntries(milestones.map(m => [m.id, m]))

  // ── Loading ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen bg-ink-50">
        <div className="bg-ink-900 h-20 animate-pulse" />
        {/* Match the real board's responsive layout: one column on mobile so the
            skeleton doesn't introduce a 4-column overflow that the real board
            avoids via overflow-x-auto. */}
        <div className="max-w-7xl mx-auto px-4 sm:px-8 py-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1,2,3,4].map(i => <div key={i} className="h-48 sm:h-96 bg-white rounded-xl animate-pulse shadow-sm" />)}
        </div>
      </div>
    )
  }

  // ── Setup screen ─────────────────────────────────────────────────────────

  if (setupNeeded) {
    return (
      <div className="min-h-screen bg-ink-50">
        <div className="bg-white border-b border-ink-100 px-4 sm:px-8 py-6">
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-brand-700 mb-0.5">Tasks</div>
          <h1 className="text-xl font-bold text-ink-900">Tasks</h1>
        </div>
        <div className="max-w-2xl mx-auto px-4 sm:px-8 py-12">
          <div className="bg-white border border-ink-100 rounded-xl shadow-sm p-8 text-center">
            <div className="text-4xl mb-4">🛠️</div>
            <h2 className="text-lg font-bold text-ink-900 mb-2">One-time setup required</h2>
            <p className="text-sm text-ink-500 mb-6 leading-relaxed">
              Run this SQL in your Supabase dashboard → SQL Editor, then click the button below.
            </p>
            <pre className="text-left text-[11px] bg-ink-900 text-green-400 rounded-xl p-4 overflow-x-auto leading-relaxed whitespace-pre-wrap">
{`-- Jobs table
create table public.work_orders (
  id uuid default gen_random_uuid() primary key,
  company_id uuid references public.companies(id)
    on delete cascade not null,
  created_by uuid references public.profiles(id),
  assigned_to uuid references public.profiles(id),
  staff_member_id uuid,
  title text not null,
  description text,
  status text not null default 'backlog',
  priority text not null default 'medium',
  due_date date,
  milestone_id uuid references public.milestones(id)
    on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.work_orders enable row level security;
create policy "Company members can manage jobs"
on public.work_orders for all
using (company_id = (
  select company_id from public.profiles
  where id = auth.uid()
));

-- Staff members table (external team, email only)
create table public.staff_members (
  id uuid default gen_random_uuid() primary key,
  company_id uuid references public.companies(id)
    on delete cascade not null,
  name text not null,
  email text,
  role text,
  created_at timestamptz default now()
);
alter table public.staff_members enable row level security;
create policy "Company members can manage staff"
on public.staff_members for all
using (company_id = (
  select company_id from public.profiles
  where id = auth.uid()
));

-- Link jobs → staff members
alter table public.work_orders
  add constraint work_orders_staff_member_fk
  foreign key (staff_member_id)
  references public.staff_members(id)
  on delete set null;`}
            </pre>
            <button type="button" onClick={loadAll}
              className="mt-6 px-5 py-2.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold transition-colors">
              I've run it, load the board
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Board ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-ink-50">

      {/* Dark header */}
      <div className="bg-white border-b border-ink-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-8 py-4 sm:py-5 flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-brand-700 mb-0.5">Tasks</div>
            <h1 className="text-xl font-bold text-ink-900 leading-tight">Tasks</h1>
          </div>
          {/* Action cluster — collapses gracefully on mobile:
              - Field flags + Manage team hide their text labels (icon-only)
              - New task shows a "+" only on the smallest screens
              The flag count badge stays visible on every breakpoint since
              it's the whole point of the button. */}
          <div className="flex items-center gap-2 sm:gap-3">
            <button
              type="button"
              onClick={() => {
                setFlagsOpen(true)
                loadFlags()
              }}
              aria-label="Flags from the crew"
              className="relative flex items-center gap-2 px-3 sm:px-4 py-2 rounded-lg bg-ink-800 hover:bg-ink-700 text-ink-200 hover:text-white text-sm font-semibold transition-colors border border-ink-700"
            >
              <span aria-hidden>🚩</span>
              <span className="hidden sm:inline">Flags from the crew</span>
              {flagCount > 0 && (
                <span className="ml-0.5 sm:ml-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500 text-ink-900">
                  {flagCount > 99 ? '99+' : flagCount}
                </span>
              )}
            </button>
            <Link to="/logs?crew=1"
              aria-label="Manage crew"
              className="flex items-center gap-2 px-3 sm:px-4 py-2 rounded-lg bg-ink-800 hover:bg-ink-700 text-ink-200 hover:text-white text-sm font-semibold transition-colors border border-ink-700">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 20 20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="7" cy="7" r="3"/><path d="M1 18c0-3.3 2.7-6 6-6h.5"/>
                <circle cx="14" cy="12" r="3"/><path d="M11 18c0-1.7 1.3-3 3-3s3 1.3 3 3"/>
              </svg>
              <span className="hidden sm:inline">Manage crew</span>
            </Link>
            <button type="button" onClick={() => openNew()}
              aria-label="New task"
              className="flex items-center gap-2 px-3 sm:px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold transition-colors">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth="2">
                <path d="M8 3v10M3 8h10" strokeLinecap="round" />
              </svg>
              <span className="hidden sm:inline">New task</span>
            </button>
          </div>
        </div>
      </div>

      {showHow && (
        <div className="max-w-7xl mx-auto px-4 sm:px-8 pt-4">
          <HowTasksWork onDismiss={dismissHow} />
        </div>
      )}

      {/* Member filter strip */}
      <div className="max-w-7xl mx-auto px-4 sm:px-8 pt-4 pb-2 flex items-center gap-2 flex-wrap">
        <button type="button" onClick={() => setFilterCid(null)}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors border ${
            filterCid === null
              ? 'bg-ink-900 text-white border-ink-900'
              : 'bg-white text-ink-600 border-ink-200 hover:border-ink-400'
          }`}>
          All
        </button>
        {allMembers.map(m => (
          <button key={m._cid} type="button"
            onClick={() => setFilterCid(filterCid === m._cid ? null : m._cid)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors border ${
              filterCid === m._cid
                ? 'bg-ink-900 text-white border-ink-900'
                : 'bg-white text-ink-600 border-ink-200 hover:border-ink-400'
            }`}>
            <Avatar member={m} size="sm" />
            {m.name || m.email}
            {m._type === 'staff' && (
              <span className="text-[9px] font-bold uppercase tracking-wider opacity-60">staff</span>
            )}
          </button>
        ))}
        <span className="text-[11px] text-ink-400 ml-1">
          {filtered.length} task{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Kanban grid — horizontally scrolls on screens narrower than ~780px.
          The 4-column kanban is the standard pattern (Linear/Trello/Asana all
          do this on mobile); column min-width of ~180px keeps cards readable. */}
      <div className="max-w-7xl mx-auto px-4 sm:px-8 pb-10 overflow-x-auto">
        <div className="grid grid-cols-4 gap-3 sm:gap-4 min-w-[780px] pt-2">
          {COLUMNS.map(col => {
            const cards = filtered.filter(o => o.status === col.key)
            return (
              <div key={col.key} className="flex flex-col"
                onDragOver={e => e.preventDefault()}
                onDrop={() => onDrop(col.key)}>

                {/* Column header */}
                <div className={`flex items-center gap-2 px-3 py-2 rounded-xl mb-3 ${col.headerCls}`}>
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${col.dotCls}`} />
                  <span className="text-xs font-bold flex-1">{col.label}</span>
                  <span className="text-xs font-bold opacity-50">{cards.length}</span>
                </div>

                {/* Cards */}
                <div className="space-y-3 flex-1 min-h-[100px]">
                  {cards.map(order => {
                    const members = getAssigneeCids(order).map(c => memberByCid[c]).filter(Boolean)
                    return (
                      <WorkOrderCard
                        key={order.id}
                        order={order}
                        members={members}
                        milestone={milestoneMap[order.milestone_id]}
                        onEdit={() => openEdit(order)}
                        onMove={s => handleMove(order.id, s)}
                        onDelete={() => handleDelete(order.id, order.title)}
                        onDragStart={() => setDragId(order.id)}
                        onEmail={() => handleEmailTask(order)}
                      />
                    )
                  })}
                  {cards.length === 0 && (
                    <div className="border-2 border-dashed border-ink-150 rounded-xl h-24 flex items-center justify-center">
                      <span className="text-xs text-ink-300">Drop cards here</span>
                    </div>
                  )}
                </div>

                {/* Add shortcut */}
                <button type="button" onClick={() => openNew(col.key)}
                  className="mt-3 flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-ink-400 hover:text-ink-700 hover:bg-white hover:shadow-sm transition-all w-full border border-transparent hover:border-ink-100">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 14 14" stroke="currentColor" strokeWidth="2">
                    <path d="M7 2v10M2 7h10" strokeLinecap="round" />
                  </svg>
                  Add to {col.label.toLowerCase()}
                </button>
              </div>
            )
          })}
        </div>
      </div>

      {/* Job modal */}
      {showModal && (
        <WorkOrderModal
          seeCosts={seeCosts}
          companyId={companyId}
          userId={profile?.id}
          order={editingOrder}
          appUsers={appUsers}
          staff={staff}
          milestones={milestones}
          templates={templates}
          checklistItems={checklistItems}
          onToggleChecklistItem={handleToggleChecklistItem}
          onSave={handleSave}
          onClose={() => { setShowModal(false); setEditingOrder(null); setChecklistItems([]) }}
        />
      )}

      {/* Field-flags drawer */}
      {flagsOpen && (
        <FlagsDrawer
          flags={flags}
          loading={flagsLoading}
          workOrders={workOrders}
          staff={staff}
          appUsers={appUsers}
          onClose={() => {
            setFlagsOpen(false)
            // Refresh badge count on close — someone might've flagged
            // things in another tab.
            loadFlagCount()
          }}
          onOpenWorkOrder={(woId) => {
            const wo = workOrders.find(w => w.id === woId)
            if (!wo) return
            setFlagsOpen(false)
            setEditingOrder(wo)
            loadChecklistItems(woId)
            setShowModal(true)
          }}
        />
      )}

    </div>
  )
}

// ── Job card ───────────────────────────────────────────────────────────

function WorkOrderCard({ order, members = [], milestone, onEdit, onMove, onDelete, onDragStart, onEmail }) {
  const member = members[0] ?? null
  const priority = PRIORITY_MAP[order.priority] ?? PRIORITY_MAP.medium
  const colIdx   = COLUMN_KEYS.indexOf(order.status)
  const overdue  = isOverdue(order.due_date)
  const hasEmail = !!member?.email

  return (
    <div draggable onDragStart={onDragStart}
      className="bg-white border border-ink-100 rounded-xl shadow-sm overflow-hidden cursor-grab active:cursor-grabbing group hover:shadow-md transition-shadow">

      {/* Priority colour strip */}
      <div className={`h-1 w-full ${priority.strip}`} />

      <div className="p-3.5">

        {/* Title + action buttons */}
        <div className="flex items-start gap-2 mb-2">
          <h3 className="text-sm font-semibold text-ink-900 leading-snug flex-1">{order.title}</h3>
          <div className="flex items-center gap-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 pointer-coarse:opacity-100 transition-opacity">
            <button type="button" onClick={onEdit}
              className="p-1.5 rounded-lg hover:bg-ink-100 text-ink-400 hover:text-ink-700 transition-colors" title="Edit">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.8">
                <path d="M8.5 1.5l2 2-7 7H1.5v-2l7-7z" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button type="button" onClick={onDelete}
              className="p-1.5 rounded-lg hover:bg-red-50 text-ink-400 hover:text-red-500 transition-colors" title="Delete">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.8">
                <path d="M2 3h8M5 3V2h2v1M4 3v7h4V3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>

        {/* Description */}
        {order.description && (
          <p className="text-[11px] text-ink-400 mb-2.5 leading-relaxed line-clamp-2">{order.description}</p>
        )}

        {/* Milestone badge */}
        {milestone && (
          <div className="mb-2.5">
            {/* truncate has no effect on a flex box's own text; the "…" needs
                the text in its own span. */}
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-brand-700 bg-brand-50 border border-brand-200 px-2 py-0.5 rounded-full max-w-full" title={milestone.title}>
              <span aria-hidden>🗺️</span>
              <span className="truncate min-w-0">{milestone.title}</span>
            </span>
          </div>
        )}

        {/* Priority badge */}
        <div className="mb-2.5">
          <span className={`inline-block text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${priority.badge}`}>
            {priority.label}
          </span>
        </div>

        {/* Footer: assignee + email button + due date */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            {members.length > 0 ? (
              <>
                <div className="flex -space-x-1.5 flex-shrink-0">
                  {members.slice(0, 3).map((m, i) => <Avatar key={i} member={m} size="sm" />)}
                </div>
                <span className="text-[11px] font-medium text-ink-600 truncate">
                  {member.name || member.email}{members.length > 1 ? ` +${members.length - 1}` : ''}
                </span>
                {hasEmail && (
                  <button type="button" onClick={onEmail}
                    title={`Email task to ${member.email}`}
                    className="ml-0.5 p-1 rounded hover:bg-teal-50 text-teal-600 hover:text-teal-700 transition-colors flex-shrink-0">
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 14 14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="1" y="3" width="12" height="9" rx="1.5"/>
                      <path d="M1 4.5l6 4 6-4"/>
                    </svg>
                  </button>
                )}
              </>
            ) : (
              <span className="text-[11px] text-ink-300 italic">Unassigned</span>
            )}
          </div>
          {order.due_date && (
            <span className={`text-[10px] font-semibold flex-shrink-0 ${overdue ? 'text-red-500' : 'text-ink-400'}`}>
              {overdue ? '⚠ ' : ''}{fmtDate(order.due_date)}
            </span>
          )}
        </div>

        {/* Move buttons */}
        <div className="flex items-center gap-1 mt-3 pt-2.5 border-t border-ink-50">
          <button type="button"
            onClick={() => colIdx > 0 && onMove(COLUMN_KEYS[colIdx - 1])}
            disabled={colIdx === 0}
            className="flex-1 flex items-center justify-center gap-1 py-1 rounded-lg text-[10px] font-semibold whitespace-nowrap text-ink-400 hover:bg-ink-50 hover:text-ink-700 disabled:opacity-25 disabled:cursor-not-allowed transition-colors">
            ← {colIdx > 0 ? COLUMNS[colIdx - 1].label : ''}
          </button>
          <button type="button"
            onClick={() => colIdx < COLUMN_KEYS.length - 1 && onMove(COLUMN_KEYS[colIdx + 1])}
            disabled={colIdx === COLUMN_KEYS.length - 1}
            className="flex-1 flex items-center justify-center gap-1 py-1 rounded-lg text-[10px] font-semibold whitespace-nowrap text-ink-400 hover:bg-ink-50 hover:text-ink-700 disabled:opacity-25 disabled:cursor-not-allowed transition-colors">
            {colIdx < COLUMN_KEYS.length - 1 ? COLUMNS[colIdx + 1].label : ''} →
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Job modal ──────────────────────────────────────────────────────────

function WorkOrderModal({ order, appUsers, staff, milestones, templates = [], checklistItems = [], onToggleChecklistItem, onSave, onClose, seeCosts = true, companyId, userId }) {
  // ⚠️ 2 Sep — the two halves of a job record never referenced each other.
  // /logs was a flat stream and the Board showed jobs; standing on Northgate
  // you could not see what the crew wrote about it, and reading a log you could
  // not tell which job it was. Read-only here on purpose — the crew's account
  // is not editable from the office, and this is the office.
  const [jobLogs, setJobLogs] = useState([])
  useEffect(() => {
    if (!order?.id) { setJobLogs([]); return }
    let cancelled = false
    supabase
      .from('daily_logs')
      .select('id, log_date, what_happened, blockers, hours_on_site, staff_member_id')
      .eq('work_order_id', order.id)
      .order('log_date', { ascending: false })
      .limit(10)
      .then(({ data }) => { if (!cancelled) setJobLogs(data ?? []) })
    return () => { cancelled = true }
  }, [order?.id])

  // Files that ride along with this task (a floor plan, one-off instructions).
  // Not the library, not Solomon's — just a file attached to the task.
  const [atts, setAtts]       = useState([])
  const [attBusy, setAttBusy] = useState(false)
  const [attDrag, setAttDrag] = useState(false)
  const [attErr, setAttErr]   = useState(null)
  const attInput = useRef(null)
  useEffect(() => {
    if (!order?.id) { setAtts([]); return }
    let cancelled = false
    listTaskAttachments(order.id).then(a => { if (!cancelled) setAtts(a) }).catch(() => {})
    return () => { cancelled = true }
  }, [order?.id])
  async function addFiles(fileList) {
    const files = Array.from(fileList || [])
    if (!files.length || !order?.id) return
    setAttBusy(true); setAttErr(null)
    for (const file of files) {
      try { const row = await uploadTaskAttachment({ file, companyId, workOrderId: order.id, userId }); setAtts(prev => [row, ...prev]) }
      catch (e) { setAttErr(e.message || 'Upload failed') }
    }
    setAttBusy(false)
  }
  async function removeAtt(att) {
    setAtts(prev => prev.filter(a => a.id !== att.id))
    try { await deleteTaskAttachment(att) } catch { /* ignore */ }
  }

  const fromRoadmap = !!(order?._ms_hint || order?.milestone_id) && !order?.id
  const isCreate    = !order?.id
  const [form, setForm] = useState({
    id:           order?.id           ?? null,
    title:        order?.title        ?? '',
    description:  order?.description  ?? '',
    assignee_cids: order?.assignee_cids ?? [],
    due_date:     order?.due_date     ?? '',
    priority:     order?.priority     ?? 'medium',
    milestone_id: order?.milestone_id ?? '',
    status:       order?.status       ?? 'backlog',
    // template_id is only meaningful on create; we hide the picker on edit.
    // Setting one and submitting will spawn its steps as checklist items on
    // the new WO (see spawnChecklistFromTemplate in the parent). Honoured
    // when prefilled via ?playbook_id=<id> from the SOPs page CTA.
    template_id:  order?.template_id ?? '',
    // ⚠️ Always optional. A job must remain creatable with all three blank —
    // the moment one is required this stops being a job record and becomes an
    // estimating tool nobody asked for. '' is sent as null, never 0.
    quoted_amount:   order?.quoted_amount   ?? '',
    cost_amount:     order?.cost_amount     ?? '',
    invoiced_amount: order?.invoiced_amount ?? '',
  })
  const [saving,   setSaving]   = useState(false)
  const [saveErr,  setSaveErr]  = useState(null)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function submit(e) {
    e.preventDefault()
    if (!form.title.trim()) return
    setSaving(true)
    setSaveErr(null)
    const errMsg = await onSave(form)
    setSaving(false)
    if (errMsg) setSaveErr(errMsg)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">

        <div className="bg-ink-900 px-6 py-4 flex items-center justify-between">
          <span className="text-sm font-bold text-white">
            {form.id ? 'Edit task' : 'New task'}
          </span>
          <button type="button" onClick={onClose} className="text-ink-500 hover:text-white transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth="2">
              <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <form onSubmit={submit} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
          {jobLogs.length > 0 && (
            <div className="rounded-lg border border-ink-150 bg-ink-50/50 px-4 py-3">
              <p className="text-[11px] font-bold uppercase tracking-wider text-ink-500 mb-2">
                What the crew wrote on this job
              </p>
              <ul className="space-y-2.5">
                {jobLogs.map(l => (
                  <li key={l.id} className="text-[12px] leading-relaxed">
                    <span className="text-ink-400">
                      {(staff ?? []).find(m => m.id === l.staff_member_id)?.name ?? 'Crew'} · {l.log_date}
                      {l.hours_on_site != null ? ` · ${l.hours_on_site}h` : ''}
                    </span>
                    <p className="text-ink-800 mt-0.5 whitespace-pre-wrap">{l.what_happened}</p>
                    {l.blockers && (
                      <p className="text-amber-800 mt-1 whitespace-pre-wrap">
                        Got in the way: {l.blockers}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Roadmap context banner */}
          {fromRoadmap && (
            <div className="flex items-center gap-2 bg-brand-50 border border-brand-200 rounded-xl px-3 py-2.5">
              <span className="text-sm">🗺️</span>
              <div className="min-w-0">
                <p className="text-[11px] font-bold text-brand-700">From roadmap</p>
                {order?._ms_hint && (
                  <p className="text-[11px] text-brand-600 truncate">{order._ms_hint}</p>
                )}
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-ink-600 mb-1.5">Task *</label>
            <input type="text" value={form.title} onChange={e => set('title', e.target.value)}
              placeholder={order?._ms_hint ? `Task for "${order._ms_hint}"…` : 'What needs to get done?'}
              required autoFocus
              className="w-full rounded-xl border border-ink-200 px-3 py-2.5 text-sm text-ink-800 focus:outline-none focus:ring-2 focus:ring-brand-300" />
          </div>

          <div>
            <label className="block text-xs font-semibold text-ink-600 mb-1.5">Details</label>
            <textarea value={form.description} onChange={e => set('description', e.target.value)}
              placeholder="Add context, steps, or notes…" rows={3}
              className="w-full rounded-xl border border-ink-200 px-3 py-2.5 text-sm text-ink-800 focus:outline-none focus:ring-2 focus:ring-brand-300 resize-none" />
          </div>

          {/* SOP picker — only on create, only if any active SOPs exist.
              Picking one spawns its steps as a checklist on the new WO. */}
          {isCreate && templates.length > 0 && (
            <div>
              <label className="block text-xs font-semibold text-ink-600 mb-1.5">
                Start from a SOP <span className="text-ink-400 font-normal">(optional)</span>
              </label>
              <select value={form.template_id} onChange={e => set('template_id', e.target.value)}
                className="w-full rounded-xl border border-ink-200 px-3 py-2.5 text-sm text-ink-800 focus:outline-none focus:ring-2 focus:ring-brand-300">
                <option value="">No SOP, blank job</option>
                {templates.map(t => (
                  <option key={t.id} value={t.id}>
                    {t.name} {t.items?.length ? `(${t.items.length} steps)` : ''}
                  </option>
                ))}
              </select>
              {form.template_id && (() => {
                const tpl = templates.find(t => t.id === form.template_id)
                const n   = tpl?.items?.length ?? 0
                return (
                  <p className="mt-1.5 text-[11px] text-ink-500 leading-relaxed">
                    {n} step{n === 1 ? '' : 's'} from this SOP go with the task, so whoever is on it has the procedure to follow.
                  </p>
                )
              })()}
            </div>
          )}

          {/* Assign to — shows both app users and staff */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-ink-600 mb-1.5">Assign to <span className="font-normal text-ink-400">· one or more</span></label>
              <div className="rounded-xl border border-ink-200 max-h-36 overflow-y-auto divide-y divide-ink-100">
                {[...appUsers.map(m => ({ cid: `p:${m.id}`, label: m.name || m.email })),
                  ...staff.map(st => ({ cid: `s:${st.id}`, label: st.name }))].map(({ cid, label }) => {
                  const on = (form.assignee_cids ?? []).includes(cid)
                  return (
                    <label key={cid} className="flex items-center gap-2 px-3 py-2 text-sm text-ink-800 cursor-pointer hover:bg-ink-50">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => set('assignee_cids', on
                          ? (form.assignee_cids ?? []).filter(c => c !== cid)
                          : [...(form.assignee_cids ?? []), cid])}
                        className="w-3.5 h-3.5 rounded text-brand-600 focus:ring-brand-400 border-ink-300"
                      />
                      {label}
                    </label>
                  )
                })}
                {appUsers.length + staff.length === 0 && (
                  <p className="px-3 py-2 text-xs text-ink-400">No one to assign yet. Add crew on the Daily logs page.</p>
                )}
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-ink-600 mb-1.5">Column</label>
              <select value={form.status} onChange={e => set('status', e.target.value)}
                className="w-full rounded-xl border border-ink-200 px-3 py-2.5 text-sm text-ink-800 focus:outline-none focus:ring-2 focus:ring-brand-300">
                {COLUMNS.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-ink-600 mb-1.5">Priority</label>
              <select value={form.priority} onChange={e => set('priority', e.target.value)}
                className="w-full rounded-xl border border-ink-200 px-3 py-2.5 text-sm text-ink-800 focus:outline-none focus:ring-2 focus:ring-brand-300">
                {PRIORITIES.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-ink-600 mb-1.5">Due date</label>
              <input type="date" max="9999-12-31" value={form.due_date} onChange={e => set('due_date', e.target.value)}
                className="w-full rounded-xl border border-ink-200 px-3 py-2.5 text-sm text-ink-800 focus:outline-none focus:ring-2 focus:ring-brand-300" />
            </div>

            {/* ⭐ Only for people allowed to see job costs (migration 077). */}
            {seeCosts && (<>
            {/* ⭐ 2 Sep — what the job quoted, cost and made. Added because
                Daniel scoped a PM to "job numbers, not company numbers" and
                checking that turned up that no job numbers existed at all.
                It also lets Solomon connect the crew's account of a job to what
                it actually made, which nothing did before.
                ⚠️ All three optional, forever. Blank is "not entered", not 0. */}
            <div>
              <label className="block text-xs font-semibold text-ink-600 mb-1.5">
                The numbers <span className="font-normal text-ink-400">optional</span>
              </label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  ['quoted_amount',   'Quoted'],
                  ['cost_amount',     'Cost'],
                  ['invoiced_amount', 'Invoiced'],
                ].map(([key, label]) => (
                  <div key={key}>
                    <input
                      type="number" min="0" step="0.01" inputMode="decimal"
                      value={form[key]}
                      onChange={e => set(key, e.target.value)}
                      placeholder={label}
                      className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300"
                    />
                    <span className="block text-[11px] text-ink-400 mt-1">{label}</span>
                  </div>
                ))}
              </div>

              {/* ⚠️ 2 Sep — the numbers went in and nothing ever showed the
                  result. You could type quoted, cost and invoiced and the card
                  looked identical whether the job made money or lost it, which
                  is data entry with no payoff. Two facts, only when they can
                  actually be computed:
                    quoted vs invoiced = scope — work done and not charged for,
                      or charged for and never quoted
                    invoiced vs cost   = what the job actually made
                  ⚠️ Blank stays blank. A missing figure shows nothing rather
                  than being treated as zero, because "not entered" and "made
                  nothing" are different facts. */}
              {(() => {
                const q = form.quoted_amount   === '' ? null : Number(form.quoted_amount)
                const c = form.cost_amount     === '' ? null : Number(form.cost_amount)
                const i = form.invoiced_amount === '' ? null : Number(form.invoiced_amount)
                const money = n => `$${Math.round(n).toLocaleString()}`
                const bits = []
                if (q != null && i != null && q !== i) {
                  const d = i - q
                  bits.push(d > 0
                    ? `Invoiced ${money(d)} over the quote`
                    : `Invoiced ${money(-d)} under the quote`)
                }
                if (i != null && c != null && i > 0) {
                  const pct = Math.round(((i - c) / i) * 100)
                  bits.push(`Made ${money(i - c)}, ${pct}% margin`)
                }
                if (!bits.length) return null
                return (
                  <p className="mt-2 text-[12px] text-ink-600 leading-relaxed">
                    {bits.join(' · ')}
                  </p>
                )
              })()}
            </div>
            </>)}
          </div>

          {milestones.length > 0 && (
            <div>
              <label className="block text-xs font-semibold text-ink-600 mb-1.5">
                Link to milestone <span className="text-ink-400 font-normal">(optional)</span>
              </label>
              <select value={form.milestone_id} onChange={e => set('milestone_id', e.target.value)}
                className="w-full rounded-xl border border-ink-200 px-3 py-2.5 text-sm text-ink-800 focus:outline-none focus:ring-2 focus:ring-brand-300">
                <option value="">No milestone</option>
                {milestones.filter(m => m.source !== 'trajectory').length > 0 && (
                  <optgroup label="Roadmap">
                    {milestones.filter(m => m.source !== 'trajectory').map(m => (
                      <option key={m.id} value={m.id}>{m.title}</option>
                    ))}
                  </optgroup>
                )}
                {milestones.filter(m => m.source === 'trajectory').length > 0 && (
                  <optgroup label="Side Quests">
                    {milestones.filter(m => m.source === 'trajectory').map(m => (
                      <option key={m.id} value={m.id}>{m.title}</option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>
          )}

          {/* Checklist — only on edit, only if items exist on this WO.
              Crew can tick from the staff portal; office can tick here. */}
          {form.id && checklistItems.length > 0 && (
            <div>
              {(() => {
                const doneCount = checklistItems.filter(i => i.done).length
                const total     = checklistItems.length
                const pct       = total ? Math.round((doneCount / total) * 100) : 0
                return (
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-semibold text-ink-600">
                      Checklist <span className="text-ink-400 font-normal">· {doneCount} of {total}</span>
                    </label>
                    <span className="text-[10px] font-bold text-ink-500">{pct}%</span>
                  </div>
                )
              })()}
              {/* Progress bar */}
              <div className="h-1 bg-ink-100 rounded-full overflow-hidden mb-2">
                <div
                  className="h-full bg-emerald-500 transition-all duration-300"
                  style={{ width: `${checklistItems.length ? (checklistItems.filter(i => i.done).length / checklistItems.length) * 100 : 0}%` }}
                />
              </div>
              <ul className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
                {checklistItems.map(item => {
                  const comments = item.comments ?? []
                  return (
                    <li key={item.id} className="bg-ink-50 border border-ink-100 rounded-lg px-2.5 py-2">
                      <div className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          checked={item.done}
                          onChange={e => onToggleChecklistItem?.(item.id, e.target.checked)}
                          className="mt-0.5 w-4 h-4 rounded text-brand-600 focus:ring-brand-400 border-ink-300 cursor-pointer"
                        />
                        <div className="flex-1 min-w-0">
                          <p className={`text-xs leading-snug ${item.done ? 'line-through text-ink-400' : 'text-ink-800'}`}>
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

                      {/* Field notes from the crew — the loop-closing read.
                          These are what the crew posted from the staff portal
                          against this specific step. Owner reads them here
                          and can decide whether the underlying SOP
                          should learn from what they're saying. */}
                      {comments.length > 0 && (
                        <ul className="mt-2 ml-6 space-y-1 border-l-2 border-brand-200 pl-2">
                          {comments.map(c => {
                            const author = c.staff_member_id
                              ? (staff.find(s => s.id === c.staff_member_id)?.name ?? 'Crew')
                              : c.user_id
                                ? (appUsers.find(u => u.id === c.user_id)?.name ?? 'Office')
                                : 'Crew'
                            const promptLabel = BOARD_PROMPT_LABEL[c.prompt_type]
                            return (
                              <li key={c.id} className="bg-white border border-ink-200 rounded-md px-2 py-1.5">
                                <div className="flex items-center gap-1.5 text-[10px] text-ink-500 mb-0.5 flex-wrap">
                                  <span className="font-semibold text-ink-700">{author}</span>
                                  <span>·</span>
                                  <span>{boardFormatRelativeTime(c.created_at)}</span>
                                  {c.is_voice && <span title="Voice note" aria-label="Voice note">🎤</span>}
                                  {promptLabel && (
                                    <span className="text-[9px] uppercase tracking-wider text-brand-700 bg-brand-50 border border-brand-200 rounded-full px-1.5">
                                      {promptLabel}
                                    </span>
                                  )}
                                </div>
                                <p className="text-[12px] text-ink-800 leading-snug whitespace-pre-wrap">{c.text}</p>
                              </li>
                            )
                          })}
                        </ul>
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
          )}

          {!isCreate && (
            <div>
              <label className="block text-xs font-semibold text-ink-600 mb-1.5">
                Attachments <span className="font-normal text-ink-400">optional</span>
              </label>
              <div
                onDragOver={e => { e.preventDefault(); setAttDrag(true) }}
                onDragLeave={() => setAttDrag(false)}
                onDrop={e => { e.preventDefault(); setAttDrag(false); addFiles(e.dataTransfer.files) }}
                onClick={() => !attBusy && attInput.current?.click()}
                className={`cursor-pointer rounded-xl border-2 border-dashed px-4 py-5 text-center transition-colors ${attDrag ? 'border-brand-400 bg-brand-50' : 'border-ink-200 hover:border-ink-300'} ${attBusy ? 'opacity-60 pointer-events-none' : ''}`}
              >
                <div className="text-xl mb-1" aria-hidden>📎</div>
                <div className="text-xs font-semibold text-ink-700">{attBusy ? 'Uploading…' : 'Drop files here, or click to browse'}</div>
                <div className="text-[10px] text-ink-400 mt-0.5">Floor plans, instructions, photos, up to {TASK_ATTACH_MAX_MB} MB each</div>
                <input ref={attInput} type="file" multiple className="hidden" onChange={e => { addFiles(e.target.files); e.target.value = '' }} />
              </div>
              {attErr && <p className="text-[11px] text-red-600 mt-1">⚠ {attErr}</p>}
              {atts.length > 0 && (
                <ul className="mt-2 space-y-1.5">
                  {atts.map(a => (
                    <li key={a.id} className="flex items-center gap-2 rounded-lg border border-ink-150 bg-white px-3 py-2">
                      <span aria-hidden>📄</span>
                      <button type="button" onClick={() => openTaskAttachment(a)} className="flex-1 min-w-0 text-left text-sm text-brand-700 hover:underline truncate">
                        {a.title || 'File'}
                      </button>
                      <span className="text-[10px] text-ink-400 flex-shrink-0">{a.size_bytes ? `${(a.size_bytes/1024/1024).toFixed(1)} MB` : ''}</span>
                      <button type="button" onClick={() => removeAtt(a)} className="text-ink-300 hover:text-red-500 text-xs flex-shrink-0" aria-label="Remove">✕</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {saveErr && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
              ⚠ {saveErr}
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border border-ink-200 text-sm font-semibold text-ink-600 hover:bg-ink-50 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={!form.title.trim() || saving}
              className="flex-1 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white text-sm font-bold transition-colors">
              {saving ? 'Saving…' : form.id ? 'Save changes' : 'Create task'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

/**
 * FlagsDrawer — the owner's read of the crew's "Flag for office" stream.
 *
 * Slides in from the right. Lists every comment with prompt_type='near_miss'
 * for this company, newest first. Each row shows author + WO context + the
 * flagged note, with a one-click jump back to the job's edit modal.
 *
 * What this is: an inbox of things the crew thought the office should
 * know about — tool gaps, surprise hazards, scope creep, near-misses,
 * customer comments. The point is the owner doesn't have to open every
 * WO to find them; they're collected here.
 *
 * What this is NOT: the FLHA / incident report register. Those are
 * compliance artifacts and live in the CRM. See migration 021's
 * "what this is NOT" block for the boundary.
 */
function FlagsDrawer({ flags, loading, workOrders, staff, appUsers, onClose, onOpenWorkOrder }) {
  // Build a quick lookup so we don't .find() per flag during render
  const woById = useMemo(
    () => Object.fromEntries(workOrders.map(w => [w.id, w])),
    [workOrders],
  )

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div
        className="flex-1 bg-ink-900/40 backdrop-blur-sm"
        onClick={onClose}
        aria-label="Close field flags"
      />
      {/* Drawer */}
      <div className="w-full max-w-md bg-white shadow-2xl flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-ink-100 flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-brand-600 mb-0.5">From site</p>
            <h2 className="text-lg font-bold text-ink-900">Flags from the crew</h2>
          </div>
          <button
            onClick={onClose}
            className="text-ink-400 hover:text-ink-700 text-sm font-semibold"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <p className="text-sm text-ink-500 text-center py-8">Loading flags...</p>
          ) : flags.length === 0 ? (
            <div className="text-center py-8">
              <div className="text-3xl mb-2">🚩</div>
              <p className="text-sm font-semibold text-ink-900 mb-1">Nothing flagged yet</p>
              <p className="text-sm text-ink-600 leading-relaxed">
                A flag is a short note a crew member sends you from site, on one step of a task: a tool that is missing,
                a step that does not match the real job, something the office needs to sort out. They tap
                "Flag for office" on their own page and the note lands here, across every task, so none get buried.
              </p>
              <p className="text-xs text-ink-500 max-w-xs mx-auto leading-relaxed">
                When the crew taps "Flag for office" on a step from the staff
                portal, the note shows up here so it doesn't get buried in a
                specific job.
              </p>
            </div>
          ) : (
            <ul className="space-y-3">
              {flags.map(f => {
                const wo = woById[f.work_order_id] ?? f.work_orders ?? null
                const author = f.staff_member_id
                  ? (staff.find(s => s.id === f.staff_member_id)?.name ?? 'Crew')
                  : f.user_id
                    ? (appUsers.find(u => u.id === f.user_id)?.name ?? 'Office')
                    : 'Crew'
                return (
                  <li key={f.id} className="bg-amber-50/40 border border-amber-200 rounded-lg p-3">
                    <div className="flex items-center gap-1.5 text-[10px] text-ink-600 mb-1 flex-wrap">
                      <span className="font-bold text-ink-800">{author}</span>
                      <span>·</span>
                      <span>{boardFormatRelativeTime(f.created_at)}</span>
                      {f.is_voice && <span title="Voice note" aria-label="Voice note">🎤</span>}
                      <span>·</span>
                      <button
                        type="button"
                        onClick={() => onOpenWorkOrder(f.work_order_id)}
                        className="font-semibold text-brand-700 hover:text-brand-800 underline-offset-2 hover:underline"
                      >
                        {wo?.title || 'Open job'}
                      </button>
                    </div>
                    <p className="text-sm text-ink-900 leading-snug whitespace-pre-wrap">{f.text}</p>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {/* Footer — small reminder of the boundary, so an owner reading
            this drawer for the first time doesn't assume it's compliance. */}
        <div className="px-5 py-3 border-t border-ink-100 bg-ink-50/40">
          <p className="text-[10px] text-ink-500 leading-snug">
            Use these to fix the SOP or the plan so the same thing stops coming up. A flag is not a safety record:
            an injury or a hazard belongs in that day's daily log, and the official report still has to be filed.
          </p>
        </div>
      </div>
    </div>
  )
}

// Mirrors PROMPT_LABEL in StaffPortal.jsx — kept in sync by hand because
// these two files have no shared module yet and copying a small map is
// cheaper than wiring an import. If we add a third reader, factor out.
//
// 'near_miss' is labelled "Flag for office" rather than "Near miss" —
// the schema value clusters near-miss-style flags for Solomon, but the
// owner-facing copy avoids implying this is a compliance record. FLHA
// and formal incident reporting live in the CRM. See migration 021.
const BOARD_PROMPT_LABEL = {
  free:          null,
  start_walk:    'Start walk',
  shift_end:     'Shift end',
  step_complete: 'Step done',
  job_close:     'Job close',
  near_miss:     'Flag for office',
}

// Compact relative-time formatter for the comment byline. Same logic as
// the StaffPortal helper; kept local to avoid pulling that file into
// the Board's module graph.
function boardFormatRelativeTime(iso) {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const diffSec = Math.floor((Date.now() - t) / 1000)
  if (diffSec < 30)   return 'just now'
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`
  if (diffSec < 86_400) return `${Math.floor(diffSec / 3600)}h ago`
  if (diffSec < 86_400 * 2) return 'yesterday'
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/**
 * ⚠️ 10 Oct, Daniel: "this page does look a bit intimidating, I think it needs
 * explanation on how things work." Four columns, seven name filters and three
 * header buttons with nothing saying what any of it is for. Three steps and one
 * line naming the buttons, dismissible.
 */
function HowTasksWork({ onDismiss }) {
  const steps = [
    ['Add a task and pick who is on it',
     'A task is one piece of work: a site visit, a quote to send, a step from your roadmap. Give it a name, choose one or more people, and a due date if there is one.'],
    ['Move it along as it goes',
     'Drag a card to the next column, or use the arrows on the card. Review is for work you want to look at before calling it done.'],
    ['Your crew sees their own tasks',
     'Each person gets the tasks they are on through their own link, with any SOP steps and files you attached. They do not need a login.'],
  ]
  return (
    <div className="bg-white border border-ink-100 rounded-xl shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-ink-100 flex items-center justify-between">
        <h2 className="text-[11px] font-bold uppercase tracking-wider text-ink-500">How tasks work</h2>
        <button onClick={onDismiss} className="text-[11px] font-semibold text-ink-400 hover:text-ink-700">Got it, hide</button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-ink-100">
        {steps.map(([title, body], i) => (
          <div key={title} className="px-5 py-4">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="w-6 h-6 rounded-full bg-brand-100 text-brand-700 text-[11px] font-bold flex items-center justify-center">{i + 1}</span>
              <h3 className="text-sm font-bold text-ink-900">{title}</h3>
            </div>
            <p className="text-xs text-ink-600 leading-relaxed">{body}</p>
          </div>
        ))}
      </div>
      <p className="px-5 py-3 border-t border-ink-100 text-xs text-ink-500 leading-relaxed">
        <span className="font-semibold text-ink-700">The names along the top</span> show one person's tasks.{' '}
        <span className="font-semibold text-ink-700">Flags from the crew</span> are short notes they send you from site about one step of a task.{' '}
        <span className="font-semibold text-ink-700">Manage crew</span> is where you add people and set their reminders.
      </p>
    </div>
  )
}
