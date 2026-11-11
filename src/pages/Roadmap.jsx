import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { uploadKnowledgeFile, validateFile, listFilesForMilestone } from '../lib/knowledgeFiles'
import { sendTaskAssigned } from '../lib/email'
import Tooltip from '../components/ui/Tooltip'
import { getBookLink, AFFILIATE_DISCLOSURE, AFFILIATE_ACTIVE } from '../lib/affiliateLinks'
import { stepProgress, storedProgress } from '../lib/milestoneProgress'
import BookLinks from '../components/tools/BookLinks'

// Which book topics a milestone's category leans toward.
const MILESTONE_BOOK_TOPICS = {
  team: ['second-in-command', 'hiring', 'advancement', 'care'],
  systems: ['process', 'operating-rhythm'],
  revenue: ['cash', 'focus'],
  finance: ['cash', 'open-book'],
  exit: ['succession', 'family-succession'],
  foundation: ['process', 'focus'],
}
import { callClaude, SONNET, HAIKU } from '../lib/anthropic'
import { fetchWebsiteContent } from '../lib/websiteScraper'
import { buildAdvisorContext } from '../lib/advisorContext'
import { downloadICS } from '../lib/icsExport'
import {
  parseDate,
  getDateRange,
  detectBottlenecks,
  assignMilestoneDates,
  buildDependencyUpdates,
} from '../lib/milestoneDates'
import {
  computeWeightedProgress,
  classifyMilestone,
} from '../lib/milestoneProgress'
import { roadmapDrift, describeDrift } from '../lib/roadmapFingerprint'

/**
 * Roadmap — the owner's 24-month plan, designed for a non-technical user.
 *
 * Visual hierarchy, top to bottom:
 *   1. Progress summary (X of Y done)
 *   2. Bottleneck banner (only if there are any)
 *   3. "Do this next" hero — the one milestone they should focus on RIGHT NOW,
 *      with numbered actions, target date, progress slider, and a big button.
 *      This is the single most important thing on the page.
 *   4. "See your whole plan" section with Timeline/List toggle for browsing.
 *
 * Why this design:
 *   - Most owners don't want a Gantt chart — they want to know what to do next.
 *     The hero answers that in one glance.
 *   - "Next" = next incomplete milestone whose dependencies are all complete,
 *     preferring in-progress ones first. This avoids sending them off to chase
 *     something that's actually blocked.
 *   - The Gantt + List are supporting views for people who want the bigger
 *     picture. They're still valuable, just not the star.
 *
 * Status model (per milestone):
 *   done        completed=true
 *   overdue     incomplete + end_date in past
 *   in-progress incomplete + progress_percent > 0
 *   ready       incomplete + 0 progress + all deps done
 *   blocked     incomplete + some deps still open
 *
 * Bottleneck = overdue AND has at least one dependent. Shown with a red ring.
 */

const TIMEFRAME_ORDER = [
  '0-3 months',
  '3-6 months',
  '6-12 months',
  '12-18 months',
  '18-24 months',
]

/** Plain-language labels for timeframe bucket headings. */
const TIMEFRAME_LABEL = {
  '0-3 months':   'Right now',
  '3-6 months':   'Next few months',
  '6-12 months':  'Later this year',
  '12-18 months': 'Next year',
  '18-24 months': 'Two years out',
}

const CATEGORY_TONES = {
  foundation: 'bg-amber-50  text-amber-700  border-amber-200',
  systems:    'bg-blue-50   text-blue-700   border-blue-200',
  team:       'bg-violet-50 text-violet-700 border-violet-200',
  revenue:    'bg-green-50  text-green-700  border-green-200',
  exit:       'bg-rose-50   text-rose-700   border-rose-200',
  trajectory: 'bg-orange-50 text-orange-700 border-orange-200',
}

const CATEGORY_BAR = {
  foundation: { base: '#FEF3C7', fill: '#D97706' },
  systems:    { base: '#DBEAFE', fill: '#2563EB' },
  team:       { base: '#EDE9FE', fill: '#7C3AED' },   // was teal: read as a second green beside revenue
  revenue:    { base: '#d6e9df', fill: '#0b6b4e' },
  exit:       { base: '#FFE4E6', fill: '#E11D48' },
  trajectory: { base: '#FFEDD5', fill: '#EA580C' },
  _default:   { base: '#F3F4F6', fill: '#4B5563' },
}

// Human-readable name + one-liner for each category, used in tooltips
// and the Roadmap legend pill. Keep these short — they appear inside a
// small dark bubble at hover time.
const CATEGORY_LABELS = {
  foundation: { label: 'Foundation', desc: 'Legal, structure, basics' },
  systems:    { label: 'Systems',    desc: 'Tools, processes, software' },
  team:       { label: 'Team',       desc: 'Hiring, org chart, people' },
  revenue:    { label: 'Revenue',    desc: 'Sales, marketing, growth' },
  exit:       { label: 'Exit',       desc: 'Long-term salability moves' },
  trajectory: { label: 'Trajectory', desc: 'Strategic direction' },
}

// Status colors for the left-edge bar. Mirrors the inline logic in
// MilestoneRow so the legend pill can render dots that match exactly.
// (Inline logic still wins — this is documentation, not the source of
// truth — keep the two in sync if either changes.)
const STATUS_BAR_COLORS = {
  bottleneck:  { color: '#f87171', label: 'Bottleneck',     desc: 'Blocking other milestones'   },
  done:        { color: '#2f8f6d', label: 'Done',           desc: 'Completed'                    },
  inProgress:  { color: '#6366f1', label: 'In progress',    desc: 'Started, not finished yet'    },
  overdue:     { color: '#fbbf24', label: 'Behind',         desc: 'Past target date'             },
  blocked:     { color: '#d1d5db', label: 'Waiting',        desc: 'Waiting on a dependency'      },
  ready:       { color: '#e2e8f0', label: 'Ready to start', desc: 'Available to work on'         },
}

/** Colored chip for each row's status. Copy-first, no jargon. */
const STATUS_STYLES = {
  done:          { label: 'Done',            tone: 'bg-green-100 text-green-800 border-green-200' },
  overdue:       { label: 'Behind schedule', tone: 'bg-red-100   text-red-800   border-red-200' },
  'in-progress': { label: 'In progress',     tone: 'bg-brand-100 text-brand-800 border-brand-200' },
  ready:         { label: 'Ready to start',  tone: 'bg-ink-100  text-ink-700  border-ink-200' },
  blocked:       { label: 'Waiting',         tone: 'bg-ink-100  text-ink-500  border-ink-200' },
}

// Rotating bank of milestone-completion pump-up messages
const CELEBRATION_BANK = [
  { headline: 'MILESTONE CRUSHED! 🔥', sub: "That's what momentum looks like." },
  { headline: "LET'S GO! 🚀", sub: 'Another one down. Keep the energy up.' },
  { headline: 'DONE. 💪', sub: 'You said you\'d do it. You did it.' },
  { headline: 'THAT\'S PROGRESS. ⚡', sub: 'Every win compounds. This one counts.' },
  { headline: 'BOOM. 🎯', sub: 'Dialled in and delivering. That\'s you.' },
  { headline: 'ONE MORE BLOCK LAID. 🏗️', sub: 'The business gets stronger every time.' },
  { headline: 'WINNER\'S MOVE. 🏆', sub: 'Operators who finish things win.' },
  { headline: 'BUILT. ✅', sub: 'Not planned. Not started. Built.' },
]

const VIEW_STORAGE_KEY = 'growthos:roadmapView'
const PACE_STORAGE_KEY = 'growthos:roadmapPace'
const PACE_AUTO_KEY    = 'growthos:roadmapPaceAuto'

/**
 * Five pace presets. `mul` is applied to the remaining duration of each
 * milestone relative to today — 0.5 halves the time, 1.5 adds 50% more.
 */
const PACE_PRESETS = [
  { id: 'relaxed',   label: 'Relaxed',     mul: 1.5,  emoji: '🐢',
    activeCls: 'bg-teal-50   text-teal-700   border-teal-300',   desc: '~36 months', blurb: 'More room on every step' },
  { id: 'steady',    label: 'Steady',      mul: 1.0,  emoji: '🚶',
    activeCls: 'bg-ink-100   text-ink-900   border-ink-300',     desc: 'Your plan', blurb: 'The plan as written' },
  { id: 'focused',   label: 'Focused',     mul: 0.75, emoji: '🏃',
    activeCls: 'bg-brand-50  text-brand-700 border-brand-300',   desc: '~18 months', blurb: 'A quarter faster' },
  { id: 'ambitious', label: 'Ambitious',   mul: 0.6,  emoji: '⚡',
    activeCls: 'bg-amber-50  text-amber-700 border-amber-300',   desc: '~15 months', blurb: 'Tight, little slack' },
  { id: 'sprint',    label: 'Full sprint', mul: 0.5,  emoji: '🚀',
    activeCls: 'bg-rose-50   text-rose-700  border-rose-300',    desc: '~12 months', blurb: 'Half the time' },
]

const PX_PER_MONTH     = 100
const ROW_HEIGHT       = 56
const BAR_HEIGHT       = 28
const LABEL_COLUMN_PX  = 240

export default function Roadmap() {
  const { profile, company } = useAuth()
  // ⚠️ Does this plan still describe the business they have? Milestones are
  // generated once and never re-checked against the profile they came from, so
  // changing industry, revenue band or the primary goal leaves every milestone
  // answering a question the owner stopped asking — silently. See
  // src/lib/roadmapFingerprint.js.
  const [drift, setDrift] = useState([])
  const [milestones, setMilestones] = useState([])
  const [loading, setLoading]       = useState(true)
  const [assigneesByMilestone, setAssigneesByMilestone] = useState(new Map())
  // Per-action-step assignees: key = `${milestone_id}::${action_step_text}` → person
  // Keyed off the job's `title` column (which is set to the action step
  // text when a job is created from the inline "+ Task" button).
  const [actionAssigneesByKey, setActionAssigneesByKey] = useState(new Map())
  // Companion map: same key → work_order id. Lets the modal UPDATE the
  // existing row when an action is reassigned, instead of inserting a
  // duplicate job every time the owner picks a new person.
  const [actionWorkOrderIdByKey, setActionWorkOrderIdByKey] = useState(new Map())
  // Tasks linked to milestones, with status. null until loaded, so progress is
  // not "corrected" downward during the moment before the tasks arrive.
  const [milestoneTasks, setMilestoneTasks] = useState(null)
  // Bumped after a successful modal save so the orders loader re-runs and
  // the per-action map reflects the new assignment immediately (no full
  // page reload required).
  const [ordersRefreshTick, setOrdersRefreshTick] = useState(0)
  const [teamMembers, setTeamMembers]           = useState([])    // profiles + staff for assignment picker
  // Active SOPs for the "Start from SOP" picker in the quick WO modal.
  // Each row carries its items inline so we can spawn the checklist in one
  // round-trip after the WO inserts. Empty array if migration 020 isn't applied.
  const [templates,   setTemplates]             = useState([])
  const [assignColMissing, setAssignColMissing] = useState(false) // true if assignee_cid column missing
  const [workOrderDraft, setWorkOrderDraft]     = useState(null)  // { milestoneId, milestoneTitle, taskTitle }
  const [expandedId, setExpandedId] = useState(null)
  const [updatingId, setUpdatingId] = useState(null)
  const [view, setView]             = useState(() => getInitialView())

  // Celebration toast — fires on every milestone completion
  const [celebration, setCelebration]   = useState(null)   // { headline, sub } | null
  const celebTimerRef                   = useRef(null)

  // Inline roadmap regeneration (all-done flow)
  const [regenPhase, setRegenPhase]   = useState('idle')   // 'idle'|'confirm'|'running'
  const [regenError, setRegenError]   = useState(null)

  // Chat / add-item panel
  const [chatInput, setChatInput]           = useState('')
  const [chatPhase, setChatPhase]           = useState('idle')  // 'idle'|'loading'|'preview'
  const [chatSuggestion, setChatSuggestion] = useState(null)
  const chatInputRef                        = useRef(null)

  // Pace control — multiplier scales remaining milestone durations for preview/save
  const [paceMul, setPaceMul] = useState(() => {
    try {
      const n = parseFloat(localStorage.getItem(PACE_STORAGE_KEY))
      return Number.isFinite(n) && n > 0 ? n : 1.0
    } catch { return 1.0 }
  })
  const [paceConfirm,  setPaceConfirm]  = useState(false)
  const [applyingPace, setApplyingPace] = useState(false)
  // Auto-pace: remembers whether the owner wants pace auto-set from their history
  const [paceAuto, setPaceAuto] = useState(() => {
    try { return localStorage.getItem(PACE_AUTO_KEY) === 'true' } catch { return false }
  })
  // Prevent the auto-apply from re-firing every render
  const paceAutoApplied = useRef(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!profile?.company_id) return
      const [{ data: bp }, { data: co }] = await Promise.all([
        supabase.from('business_profiles').select('*').eq('company_id', profile.company_id).maybeSingle(),
        supabase.from('companies').select('roadmap_built_from').eq('id', profile.company_id).maybeSingle(),
      ])
      if (cancelled) return
      setDrift(roadmapDrift(co?.roadmap_built_from, bp))
    })().catch(() => { /* non-fatal — a missing warning beats a broken roadmap */ })
    return () => { cancelled = true }
  }, [profile?.company_id])

  useEffect(() => {
    try { localStorage.setItem(VIEW_STORAGE_KEY, view) } catch { /* non-critical */ }
  }, [view])

  useEffect(() => {
    try { localStorage.setItem(PACE_STORAGE_KEY, String(paceMul)) } catch {}
  }, [paceMul])

  useEffect(() => {
    try { localStorage.setItem(PACE_AUTO_KEY, String(paceAuto)) } catch {}
  }, [paceAuto])

  // On first milestone load, if the owner has auto-pace on, snap to their
  // learned pace so the roadmap opens already calibrated to their real speed.
  useEffect(() => {
    if (paceAutoApplied.current || !milestones.length || !paceAuto) return
    paceAutoApplied.current = true
    // learnedPace is computed below in a memo — read the raw value here
    // by running the same calculation inline so we don't create a circular dep.
    const candidates = milestones.filter(m =>
      m.completed && m.completed_date && m.start_date && m.end_date
    )
    if (candidates.length < 2) return
    const ratios = candidates.flatMap(m => {
      const startMs = parseDate(m.start_date)?.getTime()
      const endMs   = parseDate(m.end_date)?.getTime()
      const doneMs  = new Date(m.completed_date).getTime()
      if (!startMs || !endMs || endMs <= startMs || doneMs < startMs) return []
      return [Math.max(0.2, Math.min(2.0, (doneMs - startMs) / (endMs - startMs)))]
    })
    if (ratios.length < 2) return
    const avg = ratios.reduce((a, b) => a + b, 0) / ratios.length
    setPaceMul(snapToPreset(Math.round(avg * 100) / 100))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [milestones.length, paceAuto])

  useEffect(() => {
    if (!profile?.company_id) return
    let cancelled = false

    ;(async () => {
      const { data } = await supabase
        .from('milestones')
        .select('*')
        .eq('company_id', profile.company_id)
        .order('sort_order', { ascending: true })
      if (cancelled) return
      setMilestones(data ?? [])
      setLoading(false)
      // Detect missing assignee_cid column — if column doesn't exist, PostgREST
      // omits the key entirely from returned rows (as opposed to returning null).
      if (data?.length > 0 && !('assignee_cid' in data[0])) {
        setAssignColMissing(true)
      }
    })()

    return () => { cancelled = true }
  }, [profile?.company_id])

  // Load work-order assignees so each milestone row can show who's on it.
  // Runs independently — silently no-ops if the work_orders table isn't set
  // up yet (boards setup screen handles that separately).
  useEffect(() => {
    if (!profile?.company_id) return
    let cancelled = false
    ;(async () => {
      const [ordersRes, profilesRes, staffRes] = await Promise.all([
        supabase
          .from('work_orders')
          .select('id, milestone_id, title, status, assigned_to, staff_member_id, assigned_staff_ids, due_date, created_at')
          .eq('company_id', profile.company_id)
          .not('milestone_id', 'is', null)
          // Order by created_at ascending so the latest row overwrites
          // earlier ones in the per-action map — when a duplicate exists
          // from before this fix, the newest assignment is the one shown.
          .order('created_at', { ascending: true }),
        supabase.from('profiles').select('id, name, email').eq('company_id', profile.company_id),
        supabase.from('staff_members').select('id, name, email').eq('company_id', profile.company_id),
      ])
      if (cancelled) return
      // Bail silently if the table doesn't exist yet
      if (ordersRes.error?.code === '42P01' || ordersRes.error?.code === 'PGRST200') return

      const profileMap = Object.fromEntries((profilesRes.data ?? []).map(p => [p.id, p]))
      const staffMap   = Object.fromEntries((staffRes.data   ?? []).map(s => [s.id, s]))

      const map        = new Map() // milestone_id -> [person, ...]
      const actionMap  = new Map() // `${milestone_id}::${title}` -> person (latest wins)
      const woIdMap    = new Map() // `${milestone_id}::${title}` -> work_order id (latest wins)
      for (const o of (ordersRes.data ?? [])) {
        if (!o.milestone_id) continue
        // Who's on this task. `assigned_staff_ids` (the multi-assignee array)
        // is the field the app and the demo seed actually write, so it wins;
        // `assigned_to` (a profile) and `staff_member_id` (one staffer) are
        // the older single-assignee fallbacks. Reading only the fallbacks is
        // what hid the seeded roadmap assignees.
        const staffIds = Array.isArray(o.assigned_staff_ids) ? o.assigned_staff_ids : []
        let persons = staffIds
          .map(id => (staffMap[id] ? { ...staffMap[id], _t: 'staff' } : null))
          .filter(Boolean)
        if (persons.length === 0) {
          const single = o.assigned_to && profileMap[o.assigned_to]
                           ? { ...profileMap[o.assigned_to], _t: 'profile' }
                       : o.staff_member_id && staffMap[o.staff_member_id]
                           ? { ...staffMap[o.staff_member_id], _t: 'staff' }
                       : null
          if (single) persons = [single]
        }

        // Per-action-step index — uses the job's title, which the
        // inline "+ Task" button sets to the exact action step text.
        // We record the id even if there's no person assigned yet, so a
        // reassignment of an existing-but-unassigned job also takes
        // the UPDATE path.
        if (o.title) {
          // ⚠️ 1 Sep — this stored only the id, so the reassign modal had no
          // way to show the due date already on the job. See the state
          // initialiser in the modal for what that cost.
          woIdMap.set(`${o.milestone_id}::${o.title}`, { id: o.id, due_date: o.due_date ?? null })
        }

        if (persons.length === 0) continue

        // Per-milestone roll-up — every distinct person on the task
        if (!map.has(o.milestone_id)) map.set(o.milestone_id, [])
        const arr = map.get(o.milestone_id)
        for (const person of persons) {
          if (person?.id && !arr.find(a => a.id === person.id)) arr.push(person)
        }

        // Per-action-step assignee — the primary (first) person drives the
        // reassign modal, which is single-person.
        if (o.title) {
          actionMap.set(`${o.milestone_id}::${o.title}`, persons[0])
        }
      }
      setAssigneesByMilestone(map)
      setActionAssigneesByKey(actionMap)
      setActionWorkOrderIdByKey(woIdMap)
      setMilestoneTasks(ordersRes.data ?? [])
    })()
    return () => { cancelled = true }
  }, [profile?.company_id, ordersRefreshTick])

  // Load all team members (app profiles + staff) for the inline assignment picker
  useEffect(() => {
    if (!profile?.company_id) return
    let cancelled = false
    ;(async () => {
      const [profilesRes, staffRes] = await Promise.all([
        supabase.from('profiles').select('id, name, email').eq('company_id', profile.company_id),
        supabase.from('staff_members').select('id, name, email').eq('company_id', profile.company_id),
      ])
      if (cancelled) return
      const members = [
        ...(profilesRes.data ?? []).map(p => ({ ...p, _cid: `p:${p.id}`, _t: 'profile' })),
        ...(staffRes.data   ?? []).map(s => ({ ...s, _cid: `s:${s.id}`, _t: 'staff'   })),
      ]
      setTeamMembers(members)
    })()
    return () => { cancelled = true }
  }, [profile?.company_id])

  // Load SOPs (with their steps nested) so the QuickWorkOrderModal can
  // offer "Start from SOP" and spawn the checklist on insert. Silent
  // failure on missing table — the picker just won't appear until migration
  // 020 is applied.
  useEffect(() => {
    if (!profile?.company_id) return
    let cancelled = false
    ;(async () => {
      const { data, error } = await supabase
        .from('work_order_templates')
        .select(`
          id, name,
          items:work_order_template_items(id, position, text, notes, required)
        `)
        .eq('company_id', profile.company_id)
        .is('archived_at', null)
        .order('updated_at', { ascending: false })
      if (cancelled) return
      if (error) { setTemplates([]); return }
      const sorted = (data ?? []).map(t => ({
        ...t,
        items: (t.items || []).slice().sort((a, b) => a.position - b.position),
      }))
      setTemplates(sorted)
    })()
    return () => { cancelled = true }
  }, [profile?.company_id])

  // -----------------------------------------------------------------------
  // Derived state
  // -----------------------------------------------------------------------
  const milestonesById = useMemo(() => {
    const map = new Map()
    for (const m of milestones) map.set(m.id, m)
    return map
  }, [milestones])

  /** Map of milestone id → status key. Computed once per state change. */
  const statusById = useMemo(() => {
    const completedIds = new Set(milestones.filter(m => m.completed).map(m => m.id))
    const today = new Date()
    const todayStr = toYmd(today)
    const map = new Map()
    for (const m of milestones) {
      map.set(m.id, classifyMilestone(m, completedIds, todayStr))
    }
    return map
  }, [milestones])

  /** id → how many other milestones list this one in their depends_on. */
  const dependentCountById = useMemo(() => {
    const map = new Map()
    for (const m of milestones) {
      for (const dep of (m.depends_on ?? [])) {
        map.set(dep, (map.get(dep) ?? 0) + 1)
      }
    }
    return map
  }, [milestones])

  const nextMilestone = useMemo(
    () => getNextActionable(milestones.filter(m => m.source !== 'trajectory'), statusById),
    [milestones, statusById]
  )

  /**
   * Pace-scaled milestone dates — only affects start_date / end_date for display.
   * Completed milestones keep their original dates; status / weights / deps use
   * the raw `milestones` array throughout so logic stays accurate.
   */
  const scaledMilestones = useMemo(() => {
    if (paceMul === 1.0) return milestones
    const today = new Date()
    return milestones.map(m => m.completed ? m : {
      ...m,
      start_date: m.start_date ? scaleDate(m.start_date, paceMul, today) : null,
      end_date:   m.end_date   ? scaleDate(m.end_date,   paceMul, today) : null,
    })
  }, [milestones, paceMul])

  /** Latest scaled end_date across all incomplete milestones → shown as projected finish. */
  const projectedFinish = useMemo(() => {
    const ends = scaledMilestones
      .filter(m => !m.completed && m.end_date)
      .map(m => m.end_date)
      .sort()
    return ends.length > 0 ? ends[ends.length - 1] : null
  }, [scaledMilestones])

  /** The same finish date at the plan's own pace, so each preset can show where it lands. */
  const baseFinish = useMemo(() => {
    const ends = milestones.filter(m => !m.completed && m.end_date).map(m => m.end_date).sort()
    return ends.length > 0 ? ends[ends.length - 1] : null
  }, [milestones])

  /**
   * Learned pace — derived from how long completed milestones actually took
   * vs. how long they were planned to take.
   *
   *   ratio_i = actual_days / planned_days   (per milestone)
   *   learnedPace = average(ratio_i)
   *
   * A ratio < 1 means the owner finishes faster than planned (sprinter).
   * A ratio > 1 means they take longer (needs more runway).
   * Capped to [0.2, 2.0] to resist outlier distortion.
   * Requires ≥ 2 data points before we surface any suggestion.
   */
  const { learnedPace, learnedDataPoints } = useMemo(() => {
    const candidates = milestones.filter(m =>
      m.completed && m.completed_date && m.start_date && m.end_date
    )
    const ratios = candidates.flatMap(m => {
      const startMs = parseDate(m.start_date)?.getTime()
      const endMs   = parseDate(m.end_date)?.getTime()
      const doneMs  = new Date(m.completed_date).getTime()
      if (!startMs || !endMs || endMs <= startMs || doneMs < startMs) return []
      return [Math.max(0.2, Math.min(2.0, (doneMs - startMs) / (endMs - startMs)))]
    })
    if (ratios.length < 2) return { learnedPace: null, learnedDataPoints: ratios.length }
    const avg = ratios.reduce((a, b) => a + b, 0) / ratios.length
    return { learnedPace: Math.round(avg * 100) / 100, learnedDataPoints: ratios.length }
  }, [milestones])

  // Trajectory milestones live in their own "Side Quests" section — exclude from main plan
  const trajectoryMilestones = useMemo(
    () => milestones.filter(m => m.source === 'trajectory'),
    [milestones]
  )

  const grouped     = useMemo(() => groupByTimeframe(scaledMilestones.filter(m => m.source !== 'trajectory')), [scaledMilestones])
  const dateRange   = useMemo(() => getDateRange(scaledMilestones.filter(m => m.source !== 'trajectory')), [scaledMilestones])
  const bottlenecks = useMemo(() => detectBottlenecks(milestones.filter(m => m.source !== 'trajectory')), [milestones])

  /**
   * Weighted progress — each milestone contributes `weight / ΣW` of the total
   * bar, multiplied by its own progress_percent. So a 10-weight hire that's
   * 50% done moves the bar more than a 2-weight admin task that's 100% done.
   *
   *   share_i    = weight_i / totalWeight
   *   filled_i   = share_i × (progress_percent_i / 100)
   *   overall%   = Σ filled_i × 100
   *
   * We return sharePctById so the UI can show "~X% of your plan" next to each
   * milestone (helps the owner understand why the bar moved the way it did).
   */
  const { weightedPct, sharePctById } = useMemo(
    () => computeWeightedProgress(milestones.filter(m => m.source !== 'trajectory')),
    [milestones]
  )

  const completed = milestones.filter(m => m.completed && m.source !== 'trajectory').length
  const total     = milestones.filter(m => m.source !== 'trajectory').length

  // -----------------------------------------------------------------------
  // Mutations (optimistic, revert on error)
  // -----------------------------------------------------------------------
  function fireCelebration() {
    const msg = CELEBRATION_BANK[Math.floor(Math.random() * CELEBRATION_BANK.length)]
    setCelebration(msg)
    if (celebTimerRef.current) clearTimeout(celebTimerRef.current)
    celebTimerRef.current = setTimeout(() => setCelebration(null), 4000)
  }

  async function handleSetSideQuestDates(milestoneId, startDate, endDate) {
    const { error } = await supabase
      .from('milestones')
      .update({ start_date: startDate || null, end_date: endDate || null })
      .eq('id', milestoneId)
    if (!error) {
      setMilestones(prev => prev.map(m =>
        m.id === milestoneId ? { ...m, start_date: startDate || null, end_date: endDate || null } : m
      ))
    }
  }

  async function toggleComplete(milestone) {
    const next = !milestone.completed
    setUpdatingId(milestone.id)

    setMilestones(prev => prev.map(m =>
      m.id === milestone.id
        ? {
            ...m,
            completed:        next,
            progress_percent: next ? 100 : 0,
            completed_date:   next ? new Date().toISOString() : null,
          }
        : m
    ))

    if (next) fireCelebration()

    const { error } = await supabase
      .from('milestones')
      .update({ completed: next })
      .eq('id', milestone.id)

    setUpdatingId(null)
    if (error) setMilestones(prev => prev.map(m => m.id === milestone.id ? milestone : m))
  }

  // ⭐ Progress is COUNTED, not dragged (Daniel, 11 Oct). See stepProgress.
  const countedById = useMemo(() => {
    const map = new Map()
    if (milestoneTasks === null) return map
    for (const m of milestones) {
      const c = stepProgress(m, milestoneTasks)
      if (c) map.set(m.id, c)
    }
    return map
  }, [milestones, milestoneTasks])

  // Keep the stored number equal to the count, so the overall bar, Home and
  // Solomon all read the same figure this page shows. Only unfinished
  // milestones, and only when the number is actually different, so this
  // settles after one pass.
  useEffect(() => {
    const fixes = milestones
      .filter(m => !m.completed && countedById.has(m.id))
      .map(m => ({ m, want: storedProgress(countedById.get(m.id)) }))
      .filter(x => x.want !== Number(x.m.progress_percent ?? 0))
    if (fixes.length === 0) return
    setMilestones(prev => prev.map(m => {
      const f = fixes.find(x => x.m.id === m.id)
      return f ? { ...m, progress_percent: f.want } : m
    }))
    fixes.forEach(f => { supabase.from('milestones').update({ progress_percent: f.want }).eq('id', f.m.id).then(() => {}) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countedById])

  /** Tick or untick one step. The count, and so the gauge, follows. */
  async function toggleStep(milestone, step) {
    const actions = Array.isArray(milestone.actions) ? milestone.actions : []
    const done = new Set((Array.isArray(milestone.actions_done) ? milestone.actions_done : []).filter(a => actions.includes(a)))
    if (done.has(step)) done.delete(step); else done.add(step)
    const next = actions.filter(a => done.has(a))
    setMilestones(prev => prev.map(m => (m.id === milestone.id ? { ...m, actions_done: next } : m)))
    const { error } = await supabase.from('milestones').update({ actions_done: next }).eq('id', milestone.id)
    if (error) setMilestones(prev => prev.map(m => (m.id === milestone.id ? milestone : m)))
  }

  async function setProgress(milestone, newPct) {
    // Locked when there is something to count: the number comes from the steps
    // and tasks, and a drag (here or on the timeline) must not overwrite it.
    if (countedById.has(milestone.id)) return
    const clamped = Math.max(0, Math.min(100, Math.round(newPct)))
    if (clamped === (milestone.progress_percent ?? 0)) return

    const derivedCompleted = clamped === 100
    const wasComplete = milestone.completed

    setMilestones(prev => prev.map(m =>
      m.id === milestone.id
        ? {
            ...m,
            progress_percent: clamped,
            completed:        derivedCompleted,
            completed_date:   derivedCompleted ? new Date().toISOString() : null,
          }
        : m
    ))

    // Celebrate when dragging slider to 100 for the first time
    if (derivedCompleted && !wasComplete) fireCelebration()

    const { error } = await supabase
      .from('milestones')
      .update({ progress_percent: clamped })
      .eq('id', milestone.id)

    if (error) setMilestones(prev => prev.map(m => m.id === milestone.id ? milestone : m))
  }

  // Open the quick work-order popup from a roadmap row
  function handleOpenWorkOrder(milestoneId, milestoneTitle, taskTitle = '') {
    // If a job already exists for this exact action step, pass its
    // id into the draft — the modal will UPDATE instead of inserting a
    // duplicate. The key matches what the orders loader builds.
    const key = `${milestoneId}::${taskTitle || milestoneTitle}`
    const existingWorkOrder    = actionWorkOrderIdByKey.get(key) ?? null
    const existingWorkOrderId  = existingWorkOrder?.id ?? null
    const existingDueDate      = existingWorkOrder?.due_date ?? null
    const existingAssigneePerson = actionAssigneesByKey.get(key) ?? null
    // Pre-populate the dropdown with the current assignee (if any) so
    // "Reassign" opens showing who's there now, not blank.
    const existingAssigneeCid = existingAssigneePerson
      ? `${existingAssigneePerson._t === 'staff' ? 's' : 'p'}:${existingAssigneePerson.id}`
      : ''
    setWorkOrderDraft({
      milestoneId,
      milestoneTitle,
      taskTitle,
      existingWorkOrderId,
      existingDueDate,
      existingAssigneeCid,
    })
  }

  // Assign a team member to a milestone (optimistic, with column-missing guard)
  async function handleAssignMilestone(milestoneId, cid) {
    const prev = milestones.find(m => m.id === milestoneId)
    setMilestones(ms => ms.map(m =>
      m.id === milestoneId ? { ...m, assignee_cid: cid || null } : m
    ))
    const { error } = await supabase
      .from('milestones')
      .update({ assignee_cid: cid || null })
      .eq('id', milestoneId)
    if (error) {
      // Column doesn't exist yet — revert and show migration hint
      if (error.code === '42703' || error.message?.toLowerCase().includes('assignee_cid')) {
        setAssignColMissing(true)
        setMilestones(ms => ms.map(m =>
          m.id === milestoneId ? { ...m, assignee_cid: prev?.assignee_cid ?? null } : m
        ))
      }
    }
  }

  // -----------------------------------------------------------------------
  // Regenerate roadmap inline (used by the AllDoneCard)
  // -----------------------------------------------------------------------
  async function handleRegen() {
    if (!profile?.company_id) return
    setRegenPhase('running')
    setRegenError(null)

    try {
      // Fetch business profile and full intelligence context in parallel.
      // bizContext includes uploaded knowledge files, financial snapshots, and
      // the synthesised library intelligence — giving the roadmap the same
      // rich picture every tool and the Advisor already has.
      const [{ data: bp, error: bpErr }, bizContext] = await Promise.all([
        supabase
          .from('business_profiles')
          .select('*')
          .eq('company_id', profile.company_id)
          .maybeSingle(),
        buildAdvisorContext(profile.company_id, { userId: profile.id }).catch(() => null),
      ])
      if (bpErr) throw new Error(bpErr.message)
      if (!bp) throw new Error('Business profile not found.')

      let websiteContent = bp.website_content
      if (bp.website) {
        const fresh = await fetchWebsiteContent(bp.website)
        if (fresh) websiteContent = fresh
      }

      const raw = await callClaude({
        model: SONNET,
        promptKey: 'ROADMAP_SYSTEM_PROMPT',
        messages: [{
          role: 'user',
          content: JSON.stringify({
            business_name:        bp.business_name,
            industry:             bp.industry,
            location:             bp.location,
            team_size:            bp.team_size,
            hours_per_week:       bp.hours_per_week,
            last_revenue:         bp.last_revenue,
            current_revenue:      bp.current_revenue,
            profit_margin:        bp.profit,
            primary_goals:        bp.primary_goal,
            goal_timeline:        bp.goal_timeline,
            website_content:      websiteContent,
            // Full intelligence context — knowledge files + synthesised analysis.
            // Claude uses these to anchor milestones in what the documents actually
            // reveal, not just what the profile fields say.
            knowledge_files:      bizContext?.knowledge_files      ?? null,
            library_intelligence: bizContext?.library_intelligence ?? null,
          }),
        }],
        maxTokens: 4000,
        json: true,
      })

      const parsed = safeParseJson(raw)
      if (!parsed?.milestones?.length) throw new Error("Couldn't read the AI response. Try again.")

      const { error: delErr } = await supabase
        .from('milestones').delete().eq('company_id', profile.company_id)
      if (delErr) throw new Error(`Could not clear old milestones: ${delErr.message}`)

      const datedMilestones = assignMilestoneDates(parsed.milestones)
      const rows = datedMilestones.map((m, i) => ({
        company_id:  profile.company_id,
        title:       String(m.title ?? '').slice(0, 200),
        description: m.description ?? null,
        timeframe:   m.timeframe ?? null,
        category:    m.category ?? null,
        actions:     Array.isArray(m.actions) ? m.actions : [],
        books:       Array.isArray(m.books)   ? m.books   : [],
        sort_order:  i,
        start_date:  m.start_date ?? null,
        end_date:    m.end_date ?? null,
        weight:      sanitizeWeight(m.weight),
      }))

      const { data: insertedRows, error: insErr } = await supabase
        .from('milestones').insert(rows).select('id')
      if (insErr) throw new Error(`Could not save new milestones: ${insErr.message}`)

      const depUpdates = buildDependencyUpdates(parsed.milestones, insertedRows ?? [])
      if (depUpdates.length > 0) {
        await Promise.all(depUpdates.map(u =>
          supabase.from('milestones').update({ depends_on: u.depends_on }).eq('id', u.id)
        ))
      }

      if (websiteContent && websiteContent !== bp.website_content) {
        await supabase.from('business_profiles')
          .update({ website_content: websiteContent })
          .eq('company_id', profile.company_id)
      }

      // Reload milestones in place — no navigation required
      const { data: fresh } = await supabase
        .from('milestones')
        .select('*')
        .eq('company_id', profile.company_id)
        .order('sort_order', { ascending: true })
      setMilestones(fresh ?? [])
      setRegenPhase('idle')
    } catch (err) {
      setRegenError(err.message ?? 'Something went wrong.')
      setRegenPhase('idle')
    }
  }

  // -----------------------------------------------------------------------
  // Chat — add new items to the plan
  // -----------------------------------------------------------------------
  async function handleChatSubmit() {
    const text = chatInput.trim()
    if (!text) return
    setChatPhase('loading')

    const milestoneContext = milestones.map(m => ({
      title:     m.title,
      timeframe: m.timeframe,
      category:  m.category,
      completed: m.completed,
    }))

    // Pull the full intelligence context so the suggestion is grounded in the
    // owner's actual documents, not just the milestone list.
    const bizContext = await buildAdvisorContext(profile?.company_id, { userId: profile?.id }).catch(() => null)

    const intelligenceBlock = bizContext?.library_intelligence
      ? `\nBusiness intelligence from uploaded documents:\n${JSON.stringify(bizContext.library_intelligence, null, 2)}`
      : ''

    const prompt = `You are a strategic advisor for a small business. The owner has these existing roadmap milestones:
${JSON.stringify(milestoneContext, null, 2)}
${intelligenceBlock}

The owner says: "${text}"

Suggest a single new milestone that addresses what they've described. Make it specific to this business — reference any relevant gaps, opportunities, or document findings if intelligence data is available. Return only valid JSON:
{
  "title": "short action-oriented title",
  "description": "2-3 sentence description, specific to this business",
  "timeframe": "0-3 months" | "3-6 months" | "6-12 months" | "12-18 months" | "18-24 months",
  "category": "foundation" | "systems" | "team" | "revenue" | "exit",
  "actions": ["step 1", "step 2", "step 3"],
  "weight": 1-10,
  "reasoning": "one sentence: where it fits and why this timeframe"
}`

    try {
      const raw = await callClaude({
        model: HAIKU,
        messages: [{ role: 'user', content: prompt }],
        maxTokens: 700,
        json: true,
      })
      const suggestion = safeParseJson(raw)
      if (!suggestion?.title) throw new Error('Bad response')
      setChatSuggestion(suggestion)
      setChatPhase('preview')
    } catch {
      setChatPhase('idle')
    }
  }

  async function handleAddSuggestion() {
    if (!chatSuggestion || !profile?.company_id) return
    setChatPhase('loading')

    const newRow = {
      company_id:  profile.company_id,
      title:       chatSuggestion.title,
      description: chatSuggestion.description ?? null,
      timeframe:   chatSuggestion.timeframe ?? null,
      category:    chatSuggestion.category ?? null,
      actions:     Array.isArray(chatSuggestion.actions) ? chatSuggestion.actions : [],
      books:       [],
      sort_order:  milestones.length,
      weight:      sanitizeWeight(chatSuggestion.weight),
      source:      'chat',
    }

    const { data, error } = await supabase
      .from('milestones').insert(newRow).select()
    if (!error && data?.[0]) {
      setMilestones(prev => [...prev, data[0]])
    }
    setChatInput('')
    setChatSuggestion(null)
    setChatPhase('idle')
  }

  function handleChatCancel() {
    setChatSuggestion(null)
    setChatInput('')
    setChatPhase('idle')
  }

  // -----------------------------------------------------------------------
  // Pace — lock the previewed scale into the actual milestone dates
  // -----------------------------------------------------------------------
  async function handleApplyPace() {
    if (!profile?.company_id) return
    setApplyingPace(true)
    const today = new Date()
    try {
      await Promise.all(
        milestones
          .filter(m => !m.completed && (m.start_date || m.end_date))
          .map(m => supabase.from('milestones').update({
            ...(m.start_date ? { start_date: scaleDate(m.start_date, paceMul, today) } : {}),
            ...(m.end_date   ? { end_date:   scaleDate(m.end_date,   paceMul, today) } : {}),
          }).eq('id', m.id))
      )
      // Reload so UI reflects the now-saved dates and resets to 1× pace
      const { data } = await supabase
        .from('milestones').select('*')
        .eq('company_id', profile.company_id)
        .order('sort_order', { ascending: true })
      setMilestones(data ?? [])
      setPaceMul(1.0)
      setPaceConfirm(false)
    } catch (err) {
      console.error('[applyPace]', err)
    }
    setApplyingPace(false)
  }

  // -----------------------------------------------------------------------
  // Loading / empty
  // -----------------------------------------------------------------------
  if (loading) {
    return (
      <div className="p-8 max-w-6xl mx-auto">
        <div className="h-8 w-48 bg-ink-200 rounded animate-pulse mb-4" />
        <div className="h-2 w-full bg-ink-100 rounded animate-pulse mb-8" />
        <div className="h-48 bg-ink-100 rounded-2xl animate-pulse mb-6" />
        {[1, 2, 3].map(i => (
          <div key={i} className="h-16 bg-ink-100 rounded-lg animate-pulse mb-2" />
        ))}
      </div>
    )
  }

  if (regenPhase === 'running') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-ink-900 px-4">
        <div
          className="absolute top-1/4 left-1/2 -translate-x-1/2 w-96 h-96 rounded-full pointer-events-none"
          style={{ background: 'radial-gradient(circle, rgba(245,158,11,0.12) 0%, transparent 70%)' }}
        />
        <div className="relative text-center">
          <div className="w-14 h-14 mx-auto mb-8 relative">
            <div className="absolute inset-0 rounded-full border-4 border-ink-700" />
            <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-brand-400 animate-spin" />
          </div>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-brand-400 mb-3">Chapter complete</p>
          <h2 className="text-2xl font-bold text-white mb-3 tracking-tight">Building your next chapter…</h2>
          <p className="text-ink-400 text-sm max-w-xs mx-auto leading-relaxed">
            Solomon is mapping out your next 24 months. This takes 10–20 seconds.
          </p>
        </div>
      </div>
    )
  }

  if (total === 0) {
    return (
      <div className="p-8 max-w-6xl mx-auto">
        <h1 className="text-3xl font-bold text-ink-900 mb-2 tracking-tight">Your roadmap</h1>
        <div className="bg-white border border-dashed border-ink-200 rounded-xl p-8 text-center mt-6">
          <p className="text-ink-500">No milestones yet. Finish onboarding and yours show up.</p>
        </div>
      </div>
    )
  }

  const allDone = completed === total

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------
  return (
    <div className="p-4 sm:p-8 max-w-6xl mx-auto">

      {/* Celebration toast — fixed overlay, auto-dismisses */}
      {celebration && (
        <CelebrationToast headline={celebration.headline} sub={celebration.sub} />
      )}

      <header className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold text-ink-900 tracking-tight">Your roadmap</h1>
          <p className="text-ink-400 text-sm mt-1">
            A step-by-step plan to grow your business over the next 24 months.
          </p>
        </div>
        {milestones.length > 0 && (
          <button
            type="button"
            onClick={() => downloadICS(milestones.filter(m => m.end_date || m.start_date), company?.name)}
            className="flex items-center gap-2 px-3.5 py-2 rounded-lg border border-ink-200 bg-white hover:bg-ink-50 text-xs font-semibold text-ink-600 hover:text-ink-900 transition-colors flex-shrink-0"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth="1.8">
              <rect x="2" y="3" width="12" height="11" rx="1.5" />
              <path d="M5 1v4M11 1v4M2 7h12" strokeLinecap="round" />
            </svg>
            Export to calendar (.ics)
          </button>
        )}
      </header>

      {/* Migration hint — shown when assignee_cid column is missing */}
      {assignColMissing && (
        <div className="mb-4 border border-amber-200 bg-amber-50 rounded-xl p-4">
          <p className="text-sm font-semibold text-amber-800 mb-1">⚠️ One quick database update needed</p>
          <p className="text-xs text-amber-700 mb-2">
            Run this in your Supabase SQL Editor to enable milestone assignment:
          </p>
          <pre className="text-[11px] bg-white border border-amber-200 rounded-lg p-3 overflow-x-auto text-amber-900 font-mono select-all">
{`ALTER TABLE public.milestones
  ADD COLUMN IF NOT EXISTS assignee_cid TEXT;`}
          </pre>
        </div>
      )}

      {/* Progress summary — weighted by each milestone's business-impact weight */}
      <ProgressSummary completed={completed} total={total} pct={weightedPct} />

      {/* Bottleneck banner — only when there are blockers */}
      {bottlenecks.size > 0 && (
        <BottleneckBanner count={bottlenecks.size} />
      )}

      {/* The star of the show */}
      {nextMilestone ? (
        <NextUpCard
          milestone={nextMilestone}
          dependents={dependentCountById.get(nextMilestone.id) ?? 0}
          sharePct={sharePctById.get(nextMilestone.id) ?? 0}
          updating={updatingId === nextMilestone.id}
          assignees={assigneesByMilestone.get(nextMilestone.id) ?? []}
          actionAssigneesByKey={actionAssigneesByKey}
          counted={countedById.get(nextMilestone.id) ?? null}
          onToggleStep={toggleStep}
          onSetProgress={setProgress}
          onComplete={toggleComplete}
        />
      ) : allDone ? (
        <AllDoneCard
          regenPhase={regenPhase}
          regenError={regenError}
          onRegen={handleRegen}
          onConfirm={() => setRegenPhase('confirm')}
          onCancelRegen={() => { setRegenPhase('idle'); setRegenError(null) }}
        />
      ) : (
        <EverythingBlockedCard />
      )}

      {/* Side Quests for Greatness — trajectory action plan items */}
      {trajectoryMilestones.length > 0 && (
        <SideQuestsSection
          milestones={trajectoryMilestones}
          statusById={statusById}
          onToggleComplete={toggleComplete}
          onSetDates={handleSetSideQuestDates}
        />
      )}

      {/* ⚠️ Drift notice. Sits ABOVE the plan on purpose: if the roadmap was
          built for a different business, that changes how to read everything
          below it, so it cannot be a footnote.

          ⚠️ It states the change and stops. No "regenerate now" button, and no
          nagging: regenerating wipes every milestone and the progress on them,
          and a plan built before a goal changed may still be the right plan —
          the owner knows which. Same reason slipped milestones are surfaced
          rather than quietly re-dated. It is dismissible in the sense that it
          disappears the moment the roadmap is regenerated, and not before. */}
      {drift.length > 0 && (
        <div
          className="mb-6 rounded-xl border px-4 py-3 flex items-start gap-3"
          style={{ background: 'rgba(245,158,11,0.06)', borderColor: 'rgba(245,158,11,0.35)' }}
          role="status"
        >
          <span aria-hidden className="mt-0.5 flex-shrink-0">⚠️</span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900">
              {describeDrift(drift)}
            </p>
            <p className="text-[13px] text-gray-600 mt-1 leading-snug">
              The milestones below were planned for the earlier answers, so some of
              them may be solving a problem you no longer have. It may still be the
              right plan. You would know better than the plan does. Rebuilding it
              from your current profile is under Settings &rarr; Danger, and it
              replaces every milestone, including the ones you have made progress on.
            </p>
          </div>
        </div>
      )}

      {/* Full-plan browser */}
      <section>

        {/* Pace control */}
        <PaceControl
          paceMul={paceMul}
          projectedFinish={projectedFinish}
          baseFinish={baseFinish}
          paceConfirm={paceConfirm}
          applying={applyingPace}
          learnedPace={learnedPace}
          learnedDataPoints={learnedDataPoints}
          paceAuto={paceAuto}
          onChangePace={(mul) => { setPaceMul(mul); setPaceConfirm(false) }}
          onConfirm={() => setPaceConfirm(true)}
          onApply={handleApplyPace}
          onCancelConfirm={() => setPaceConfirm(false)}
          onToggleAuto={() => {
            const next = !paceAuto
            setPaceAuto(next)
            if (next && learnedPace) {
              setPaceMul(snapToPreset(learnedPace))
              setPaceConfirm(false)
            }
          }}
        />

        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <div>
            <h2 className="text-lg font-semibold text-ink-900">
              {nextMilestone ? "What's coming after" : 'Your whole plan'}
            </h2>
            <p className="text-xs text-ink-400">
              {nextMilestone
                ? 'Everything else in your 24-month plan.'
                : 'Browse every milestone in the roadmap.'}
            </p>
          </div>
          <ViewToggle value={view} onChange={setView} />
        </div>

        {/* Legend — collapsed by default. Once an owner has used the page
            a few times they don't need this expanded; it sits as a single
            small pill at the top until they click it. */}
        <RoadmapLegend />

        {view === 'timeline' ? (
          <GanttView
            milestones={scaledMilestones}
            dateRange={dateRange}
            bottlenecks={bottlenecks}
            statusById={statusById}
            milestonesById={milestonesById}
            featuredId={nextMilestone?.id ?? null}
            onSetProgress={setProgress}
          />
        ) : (
          <ListView
            grouped={grouped}
            expandedId={expandedId}
            updatingId={updatingId}
            bottlenecks={bottlenecks}
            statusById={statusById}
            milestonesById={milestonesById}
            dependentCountById={dependentCountById}
            sharePctById={sharePctById}
            assigneesByMilestone={assigneesByMilestone}
            actionAssigneesByKey={actionAssigneesByKey}
            countedById={countedById}
            onToggleStep={toggleStep}
            teamMembers={teamMembers}
            featuredId={nextMilestone?.id ?? null}
            onToggleExpand={id => setExpandedId(expandedId === id ? null : id)}
            onToggleComplete={toggleComplete}
            onSetProgress={setProgress}
            onAssignMilestone={handleAssignMilestone}
            onOpenWorkOrder={handleOpenWorkOrder}
          />
        )}
      </section>

      {/* Chat / add-items panel */}
      <ChatPanel
        chatInput={chatInput}
        setChatInput={setChatInput}
        chatPhase={chatPhase}
        chatSuggestion={chatSuggestion}
        inputRef={chatInputRef}
        onSubmit={handleChatSubmit}
        onConfirm={handleAddSuggestion}
        onCancel={handleChatCancel}
      />

      {AFFILIATE_ACTIVE && (
        <footer className="mt-12 pt-6 border-t border-ink-100">
          <p className="text-xs text-ink-400 leading-relaxed">{AFFILIATE_DISCLOSURE}</p>
        </footer>
      )}

      {/* Quick work-order popup — opens inline, no navigation */}
      {workOrderDraft && (
        <QuickWorkOrderModal
          draft={workOrderDraft}
          teamMembers={teamMembers}
          templates={templates}
          profile={profile}
          company={company}
          onClose={(didSave) => {
            setWorkOrderDraft(null)
            // Re-run the orders loader so the assignee pill appears (or
            // updates) on the action step immediately, without waiting
            // for a full page reload.
            if (didSave) setOrdersRefreshTick(t => t + 1)
          }}
        />
      )}
    </div>
  )
}

// ============================================================================
// Roadmap legend — collapsible pill explaining the colors and chips
// ============================================================================
/**
 * Anchored at the top of the milestone list. Collapsed by default so the
 * row of pills below it is the visual focus; one click expands a compact
 * panel listing every dot, bar, and chip with their meaning.
 *
 * Pulls from the same CATEGORY_LABELS and STATUS_BAR_COLORS maps that the
 * row uses, so a future color/label change to the row updates the legend
 * automatically.
 *
 * Persisted "open" state would be nice (so an owner who wants it open
 * always doesn't have to re-click on every page load), but starting with
 * in-memory state — we can promote to localStorage if anyone asks.
 */
function RoadmapLegend() {
  const [open, setOpen] = useState(false)
  return (
    <div className="mb-4">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`inline-flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
          open
            ? 'bg-ink-100 text-ink-800 border-ink-200'
            : 'bg-white text-ink-600 border-ink-200 hover:bg-ink-50'
        }`}
        aria-expanded={open}
      >
        <span aria-hidden>{open ? '▾' : '▸'}</span>
        What do these colors mean?
      </button>

      {open && (
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-4 bg-white border border-ink-150 rounded-xl p-4 shadow-sm">

          {/* Status — left-edge bar */}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-ink-500 mb-2">
              Left-edge bar · status
            </p>
            <ul className="space-y-1.5">
              {Object.values(STATUS_BAR_COLORS).map(s => (
                <li key={s.label} className="flex items-start gap-2 text-xs text-ink-700">
                  <span
                    className="mt-1 w-3 h-3 rounded-sm flex-shrink-0"
                    style={{ backgroundColor: s.color }}
                  />
                  <span>
                    <span className="font-semibold">{s.label}</span>
                    <span className="block text-ink-500">{s.desc}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {/* Category — right-side dot */}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-ink-500 mb-2">
              Right-side dot · category
            </p>
            <ul className="space-y-1.5">
              {Object.entries(CATEGORY_LABELS).map(([key, info]) => (
                <li key={key} className="flex items-start gap-2 text-xs text-ink-700">
                  <span
                    className="mt-1 w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: CATEGORY_BAR[key]?.fill ?? CATEGORY_BAR._default.fill }}
                  />
                  <span>
                    <span className="font-semibold">{info.label}</span>
                    <span className="block text-ink-500">{info.desc}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {/* Assignee chips */}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-ink-500 mb-2">
              Name pills · who's on it
            </p>
            <ul className="space-y-2 text-xs text-ink-700">
              <li className="flex items-center gap-2">
                <span className="text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full">
                  Name
                </span>
                <span className="text-ink-600">Team staff, got the email</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="text-[10px] font-semibold bg-ink-100 text-ink-700 border border-ink-200 px-2 py-0.5 rounded-full">
                  Name
                </span>
                <span className="text-ink-600">App user, sees in dashboard</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="text-[10px] font-semibold bg-ink-50 text-ink-600 border border-ink-200 px-1.5 py-0.5 rounded-full">
                  +2
                </span>
                <span className="text-ink-600">More people, hover for names</span>
              </li>
            </ul>
            <p className="text-[10px] text-ink-400 mt-3 leading-relaxed">
              Tip: hover any dot or pill anywhere on the Roadmap for a quick reminder.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Side Quests for Greatness
// ============================================================================
function SideQuestsSection({ milestones, statusById, onToggleComplete, onSetDates }) {
  const [open, setOpen] = useState(true)
  const done  = milestones.filter(m => m.completed).length
  const total = milestones.length

  return (
    <div className="mb-6 bg-white border border-orange-200 rounded-xl shadow-sm overflow-hidden">
      {/* Header */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-5 py-4 bg-gradient-to-r from-orange-50 to-amber-50 border-b border-orange-100 text-left"
      >
        <span className="text-lg flex-shrink-0">⚡</span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold text-orange-900 leading-tight">
            Side Quests for Greatness
          </div>
          <div className="text-[11px] text-orange-600 mt-0.5">
            Strategic actions from your trajectory plan · {done}/{total} complete
          </div>
        </div>
        <a
          href="/trajectories"
          onClick={e => e.stopPropagation()}
          className="flex-shrink-0 text-[11px] font-semibold text-orange-700 hover:text-orange-900 px-2.5 py-1 rounded-lg border border-orange-200 bg-white transition-colors"
        >
          + Add more
        </a>
        <span className={`text-orange-400 text-sm ml-1 transition-transform ${open ? 'rotate-180' : ''}`}>▾</span>
      </button>

      {open && (
        <div>
          {milestones.length === 0 ? (
            <p className="px-5 py-6 text-sm text-ink-400 text-center">
              No side quests yet, head to{' '}
              <a href="/trajectories" className="underline text-orange-600">Trajectories</a>{' '}
              to generate your action plan.
            </p>
          ) : (
            <div className="divide-y divide-orange-50">
              {milestones.map(m => (
                <SideQuestRow
                  key={m.id}
                  milestone={m}
                  status={statusById.get(m.id) ?? 'ready'}
                  onToggleComplete={() => onToggleComplete(m)}
                  onSetDates={(start, end) => onSetDates(m.id, start, end)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function SideQuestRow({ milestone: m, status, onToggleComplete, onSetDates }) {
  const [editingDates, setEditingDates] = useState(false)
  const [startDate,    setStartDate]    = useState(m.start_date ?? '')
  const [endDate,      setEndDate]      = useState(m.end_date   ?? '')
  const [saving,       setSaving]       = useState(false)

  const today     = new Date().toISOString().slice(0, 10)
  const dueLabel  = formatFriendlyDate(m.end_date)
  const isOverdue = status === 'overdue'
  const hasDates  = !!(m.start_date || m.end_date)

  async function handleSaveDates() {
    setSaving(true)
    await onSetDates(startDate || today, endDate)
    setSaving(false)
    setEditingDates(false)
  }

  return (
    <div className={`px-5 py-3.5 transition-colors hover:bg-orange-50/40 ${m.completed ? 'opacity-60' : ''}`}>
      <div className="flex items-center gap-3">
        {/* Complete toggle */}
        <button
          type="button"
          onClick={onToggleComplete}
          className={`flex-shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${
            m.completed ? 'bg-green-500 border-green-500' : 'border-orange-300 hover:border-orange-500'
          }`}
          aria-label={m.completed ? 'Mark incomplete' : 'Mark complete'}
        >
          {m.completed && (
            <svg viewBox="0 0 12 10" className="w-2.5 h-2.5" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="1,5 4,8 11,1" />
            </svg>
          )}
        </button>

        {/* Orange accent bar */}
        <div className="w-1 h-8 rounded-full flex-shrink-0 bg-orange-300" />

        {/* Title + description */}
        <div className="flex-1 min-w-0">
          <div className={`text-sm font-semibold leading-tight ${m.completed ? 'line-through text-ink-400' : 'text-ink-900'}`}>
            {m.title}
          </div>
          {m.description && (
            <div className="text-[11px] text-ink-400 mt-0.5 truncate">{m.description}</div>
          )}
        </div>

        {/* Date / calendar action */}
        <div className="flex-shrink-0 text-right">
          {hasDates ? (
            <>
              {dueLabel && (
                <div className={`text-[11px] font-medium ${isOverdue ? 'text-red-500' : 'text-ink-500'}`}>
                  {isOverdue ? '⚠ ' : ''}{dueLabel}
                </div>
              )}
              <button
                type="button"
                onClick={() => { setStartDate(m.start_date ?? ''); setEndDate(m.end_date ?? ''); setEditingDates(true) }}
                className="text-[10px] font-semibold text-orange-500 hover:text-orange-700 transition-colors"
              >
                Edit dates
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setEditingDates(true)}
              className="flex items-center gap-1 text-[11px] font-semibold text-orange-500 hover:text-orange-700 transition-colors"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 14 14" stroke="currentColor" strokeWidth="1.8">
                <rect x="1" y="2.5" width="12" height="10" rx="1.2" />
                <path d="M4.5 1v3M9.5 1v3M1 6.5h12" strokeLinecap="round" />
              </svg>
              Add to calendar
            </button>
          )}
        </div>
      </div>

      {/* Inline date picker */}
      {editingDates && (
        <div className="mt-3 ml-10 flex flex-wrap items-end gap-3 bg-orange-50 border border-orange-200 rounded-xl px-4 py-3">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-orange-700 mb-1">Start date</label>
            <input
              type="date"
              value={startDate}
              min={today}
              onChange={e => setStartDate(e.target.value)}
              className="text-xs rounded-lg border border-orange-200 px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-orange-300 bg-white"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-orange-700 mb-1">Due date</label>
            <input
              type="date"
              value={endDate}
              min={startDate || today}
              onChange={e => setEndDate(e.target.value)}
              className="text-xs rounded-lg border border-orange-200 px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-orange-300 bg-white"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSaveDates}
              disabled={!endDate || saving}
              className="text-[11px] font-bold px-3 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white disabled:opacity-40 transition-colors"
            >
              {saving ? 'Saving…' : 'Save & add to calendar'}
            </button>
            <button
              type="button"
              onClick={() => setEditingDates(false)}
              className="text-[11px] text-ink-400 hover:text-ink-600 transition-colors"
            >
              Cancel
            </button>
          </div>
          <p className="w-full text-[10px] text-orange-600">
            Once saved, this side quest will appear in your calendar's daily planner.
          </p>
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Top-of-page components
// ============================================================================
function ProgressSummary({ completed, total, pct }) {
  const headline =
    pct === 0
      ? `Let's get started on your ${total} milestones.`
      : pct >= 100
        ? `All ${total} milestones done. Incredible.`
        : `You're ${pct}% of the way through your plan.`

  return (
    <div className="mb-6 bg-white border border-ink-100 rounded-xl shadow-sm overflow-hidden">
      <div className="bg-ink-900 px-5 py-3 flex items-center justify-between">
        <span className="text-[10.5px] font-semibold uppercase tracking-widest text-brand-400">
          Overall progress
        </span>
        <span className="text-2xl font-bold text-brand-400 tabular-nums leading-none">
          {pct}<span className="text-base">%</span>
        </span>
      </div>
      <div className="px-5 py-4">
        <div className="flex items-baseline justify-between gap-3 mb-3 flex-wrap">
          <div>
            <div className="text-sm font-semibold text-ink-900">{headline}</div>
            <div className="text-xs text-ink-400 mt-0.5">
              {completed} of {total} complete · bigger milestones move the bar more.
            </div>
          </div>
        </div>
        <div className="h-3 bg-ink-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-brand-500 to-brand-400 transition-all duration-700 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </div>
  )
}

function BottleneckBanner({ count }) {
  return (
    <div className="mb-6 bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
      <span className="text-red-600 text-xl leading-none mt-0.5">⚠</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-red-900 font-semibold">
          {count === 1 ? '1 milestone is' : `${count} milestones are`} holding up the rest of your plan
        </p>
        <p className="text-xs text-red-700 mt-0.5">
          These are behind schedule and other steps are waiting on them. Tackle these first.
        </p>
      </div>
    </div>
  )
}

/** The main call-to-action — shown when there is a next actionable milestone. */
function NextUpCard({
  milestone, dependents, sharePct, updating,
  assignees = [], actionAssigneesByKey = new Map(),
  counted = null, onToggleStep,
  onSetProgress, onComplete,
}) {
  const actions = Array.isArray(milestone.actions) ? milestone.actions : []
  const pct = Number(milestone.progress_percent ?? 0)
  const endLabel = formatFriendlyDate(milestone.end_date)

  return (
    <div className="mb-10 bg-white border border-ink-100 rounded-2xl shadow-sm overflow-hidden">
      {/* Dark header strip */}
      <div className="bg-ink-900 px-5 sm:px-6 py-3.5 flex items-center gap-3 flex-wrap">
        <span className="relative flex h-2 w-2 flex-shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-brand-400" />
        </span>
        <span className="text-[10.5px] font-semibold uppercase tracking-widest text-brand-400">
          Your focus right now
        </span>
        {milestone.category && <CategoryTag category={milestone.category} />}
        {sharePct > 0 && (
          <span
            className="text-[10px] font-semibold bg-brand-500/20 text-brand-300 border border-brand-500/30 rounded-full px-2.5 py-0.5"
            title="How much this milestone moves the overall progress bar when you finish it."
          >
            Worth {sharePct}% of your plan
          </span>
        )}
      </div>

      <div className="p-5 sm:p-6">
        {/* Title + description */}
        <h2 className="text-xl sm:text-2xl font-bold text-ink-900 leading-tight mb-2">
          {milestone.title}
        </h2>
        {milestone.description && (
          <p className="text-sm sm:text-base text-ink-500 leading-relaxed mb-5 max-w-2xl">
            {milestone.description}
          </p>
        )}

        <div className="grid md:grid-cols-2 gap-5">
          {/* Left: action checklist */}
          <div>
            <div className="text-[10.5px] uppercase tracking-widest text-ink-400 font-semibold mb-3">
              Start with these steps
            </div>
            {actions.length > 0 ? (
              <ol className="space-y-2.5">
                {actions.slice(0, 4).map((a, i) => (
                  <li key={i} className="flex items-start gap-3 text-sm text-ink-700">
                    <StepTick
                      n={i + 1}
                      weight={counted?.weightOf(a) ?? 0}
                      ticked={(milestone.actions_done ?? []).includes(a)}
                      onClick={() => onToggleStep?.(milestone, a)}
                      dark
                    />
                    <span className={`leading-relaxed pt-0.5 flex-1 ${(counted?.weightOf(a) ?? 0) === 1 ? 'text-ink-400 line-through' : ''}`}>{a}</span>
                    {/* Who has this step, same lookup the list rows use */}
                    {actionAssigneesByKey.get(`${milestone.id}::${a}`) && (
                      <AssigneeChip person={actionAssigneesByKey.get(`${milestone.id}::${a}`)} />
                    )}
                  </li>
                ))}
                {actions.length > 4 && (
                  <li className="text-xs text-ink-400 pl-9">
                    + {actions.length - 4} more below
                  </li>
                )}
              </ol>
            ) : (
              <p className="text-sm text-ink-400 italic">
                No steps yet. Break this into a few concrete moves to get it going.
              </p>
            )}
          </div>

          {/* Right: status, progress, CTA */}
          <div className="space-y-4">
            {assignees.length > 0 && (
              <div className="bg-ink-50 rounded-lg p-3 border border-ink-100">
                <div className="text-[10.5px] uppercase tracking-widest text-ink-400 font-semibold mb-1.5">Who is on this</div>
                <div className="flex flex-wrap gap-1.5">
                  {assignees.map(p => <AssigneeChip key={p.id} person={p} full />)}
                </div>
              </div>
            )}

            {endLabel && (
              <div className="bg-ink-50 rounded-lg p-3 border border-ink-100">
                <div className="text-[10.5px] uppercase tracking-widest text-ink-400 font-semibold mb-0.5">Aim to finish by</div>
                <div className="text-sm font-semibold text-ink-900">{endLabel}</div>
              </div>
            )}

            {counted ? (
              <CountedProgress counted={counted} pct={pct} />
            ) : (
              <div className="bg-ink-50 rounded-lg p-3 border border-ink-100">
                <div className="flex items-center justify-between text-xs mb-2">
                  <span className="text-ink-400 uppercase tracking-wider font-semibold">Your progress</span>
                  <span className="font-bold text-brand-600">{pct}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="5"
                  value={pct}
                  onChange={e => onSetProgress(milestone, Number(e.target.value))}
                  aria-label="Progress on this milestone"
                  className="w-full cursor-pointer"
                />
                <div className="flex justify-between text-[10px] text-ink-400 mt-0.5 px-0.5">
                  <span>Not started</span>
                  <span>Halfway</span>
                  <span>Done</span>
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={() => onComplete(milestone)}
              disabled={updating}
              className="w-full bg-gold-gradient text-white rounded-lg px-4 py-3 text-sm font-bold tracking-wide glow-gold-sm hover:glow-gold transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <CheckIcon className="w-4 h-4" />
              I've finished this
            </button>
          </div>
        </div>

        <div className="mt-5 empty:hidden">
          <BookLinks
            text={[milestone.title, milestone.description, ...actions].join(' . ')}
            prefer={MILESTONE_BOOK_TOPICS[milestone.category] ?? []}
            max={1}
            title="Worth reading for this milestone"
          />
        </div>

        {dependents > 0 && (
          <div className="mt-5 pt-4 border-t border-ink-100 text-xs text-ink-500 flex items-center gap-2">
            <span>🔓</span>
            <span>
              Finishing this unlocks <strong className="text-ink-700">{dependents} other milestone{dependents === 1 ? '' : 's'}</strong> in your plan.
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * The round marker beside a step. Click to tick the step done, click again to
 * untick. It also shows a step that is done or under way because of its TASK:
 * a full tick when the task is Done (that one is changed on the task, not
 * here), a half-filled ring when the task is in progress or in review.
 */
function StepTick({ n, weight = 0, ticked = false, onClick, dark = false }) {
  const done = weight === 1
  const under = weight > 0 && weight < 1
  const byTask = done && !ticked
  const base = dark ? 'w-6 h-6 text-xs' : 'w-5 h-5 text-[11px]'
  const look = done
    ? 'bg-brand-600 text-white border-brand-600'
    : under
      ? 'bg-brand-50 text-brand-800 border-brand-500'
      : dark ? 'bg-ink-900 text-brand-400 border-ink-900 hover:border-brand-500' : 'bg-ink-100 text-ink-700 border-ink-100 hover:border-brand-500'
  return (
    <button
      type="button"
      onClick={e => { e.stopPropagation(); if (!byTask) onClick?.() }}
      aria-pressed={done}
      title={byTask ? 'Done on its task. Change it on the Tasks board.' : done ? 'Done. Click to untick.' : under ? 'Its task is under way. Click to mark the step done.' : 'Click when this step is done.'}
      className={`flex-shrink-0 rounded-full border-2 font-bold flex items-center justify-center transition-colors ${base} ${look} ${byTask ? 'cursor-default' : 'cursor-pointer'}`}
    >
      {done ? '✓' : n}
    </button>
  )
}

/** The locked gauge: a bar and one sentence saying what it was counted from. */
function CountedProgress({ counted, pct, light = false }) {
  const shown = Math.max(pct, 0)
  const left = counted.total - counted.done - counted.partial
  const parts = [
    `${counted.done} of ${counted.total} done`,
    counted.partial > 0 ? `${counted.partial} under way` : null,
    left > 0 ? `${left} not started` : null,
  ].filter(Boolean).join(', ')
  return (
    <div className={`${light ? 'bg-white border-ink-200' : 'bg-ink-50 border-ink-100'} rounded-lg p-3 border`}>
      <div className="flex items-center justify-between text-xs mb-2">
        <span className="text-ink-600 uppercase tracking-wider font-semibold">Progress</span>
        <span className="font-bold text-brand-700 tabular-nums">{counted.pct === 100 ? 100 : shown}%</span>
      </div>
      <div className="h-2.5 w-full bg-ink-100 rounded-full overflow-hidden" role="img" aria-label={`${counted.pct}% done`}>
        <div className="h-full bg-brand-600 rounded-full transition-all" style={{ width: `${counted.pct}%` }} />
      </div>
      <p className="text-[12px] text-ink-600 mt-2 leading-snug">
        {parts}. Counted from {counted.steps > 0 ? `the ${counted.steps} step${counted.steps === 1 ? '' : 's'}` : 'the tasks'}
        {counted.steps > 0 && counted.otherTasks > 0 ? ` and ${counted.otherTasks} other task${counted.otherTasks === 1 ? '' : 's'}` : ''} on this milestone.
        Tick a step or move a task and this moves.
        {counted.pct === 100 && " Everything is done. Click I've finished this to close it."}
      </p>
    </div>
  )
}

// Small name pill for whoever is on a milestone or one of its steps. Green for
// team staff, grey for app users, matching the chips on the list rows.
function AssigneeChip({ person, full = false }) {
  const name = person.name || person.email
  return (
    <span
      className={`flex-shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap mt-0.5 border ${
        person._t === 'staff'
          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
          : 'bg-ink-100 text-ink-700 border-ink-200'
      }`}
      title={`Assigned to ${name}`}
    >
      {full ? name : (person.name?.split(' ')[0] || person.email)}
    </span>
  )
}

function CelebrationToast({ headline, sub }) {
  return (
    <div
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 pointer-events-none"
      style={{ animation: 'slideUpFade 0.35s ease' }}
    >
      <div className="bg-ink-900 border border-brand-500/40 rounded-2xl px-6 py-4 shadow-2xl flex items-center gap-4 min-w-[280px] max-w-sm">
        <div className="w-10 h-10 rounded-full bg-brand-500/20 border border-brand-500/40 flex items-center justify-center flex-shrink-0">
          <span className="text-brand-400 text-lg leading-none">✓</span>
        </div>
        <div>
          <p className="text-white font-bold text-sm tracking-wide">{headline}</p>
          <p className="text-ink-400 text-xs mt-0.5">{sub}</p>
        </div>
      </div>
      <style>{`
        @keyframes slideUpFade {
          from { opacity: 0; transform: translate(-50%, 16px); }
          to   { opacity: 1; transform: translate(-50%, 0); }
        }
      `}</style>
    </div>
  )
}

function AllDoneCard({ regenPhase, regenError, onRegen, onConfirm, onCancelRegen }) {
  return (
    <div className="mb-10 relative overflow-hidden rounded-2xl bg-ink-900">
      {/* Ambient glow */}
      <div
        className="absolute -top-16 left-1/2 -translate-x-1/2 w-80 h-80 rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(245,158,11,0.18) 0%, transparent 70%)' }}
      />
      <div className="relative p-8 sm:p-10 text-center">
        <div className="text-5xl mb-4">🏆</div>
        <p className="text-[11px] font-semibold uppercase tracking-widest text-brand-400 mb-2">
          24-month plan complete
        </p>
        <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight mb-3">
          You finished every milestone.
        </h2>
        <p className="text-ink-300 text-sm max-w-md mx-auto leading-relaxed mb-8">
          That's not common. Most people plan and never execute. You did both. Your business is stronger because of it.
          Time to set the next level of ambition.
        </p>

        {regenError && (
          <p className="text-red-400 text-sm mb-4">{regenError}</p>
        )}

        {regenPhase === 'idle' && (
          <button
            type="button"
            onClick={onConfirm}
            className="bg-gold-gradient text-white rounded-xl px-8 py-3.5 text-sm font-bold tracking-wide glow-gold hover:glow-gold transition-all duration-200"
          >
            Generate my next chapter →
          </button>
        )}

        {regenPhase === 'confirm' && (
          <div className="bg-ink-800/60 border border-ink-700 rounded-xl p-5 max-w-sm mx-auto">
            <p className="text-white text-sm font-semibold mb-1">Ready to start fresh?</p>
            <p className="text-ink-400 text-xs mb-4 leading-relaxed">
              This will replace your completed milestones with a new 24-month plan based on where your business stands today.
            </p>
            <div className="flex items-center gap-3 justify-center">
              <button
                type="button"
                onClick={onRegen}
                className="bg-gold-gradient text-white rounded-lg px-5 py-2.5 text-sm font-bold glow-gold-sm transition-all duration-200"
              >
                Yes, build my next roadmap
              </button>
              <button
                type="button"
                onClick={onCancelRegen}
                className="text-ink-400 text-sm hover:text-ink-200 transition-colors"
              >
                Not yet
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function EverythingBlockedCard() {
  return (
    <div className="mb-10 bg-white border border-ink-100 rounded-2xl shadow-sm overflow-hidden">
      <div className="bg-ink-900 px-5 py-3.5">
        <span className="text-[10.5px] font-semibold uppercase tracking-widest text-amber-400">
          On hold
        </span>
      </div>
      <div className="p-6 text-center">
        <div className="text-3xl mb-3">⏸</div>
        <h2 className="text-lg font-bold text-ink-900 mb-1">Every remaining step is waiting on something</h2>
        <p className="text-sm text-ink-500 max-w-md mx-auto leading-relaxed">
          Close out a milestone below to unlock the next one. Check the list for items marked <em>Waiting</em>.
        </p>
      </div>
    </div>
  )
}

// ============================================================================
// View toggle
// ============================================================================
function ViewToggle({ value, onChange }) {
  const options = [
    { value: 'timeline', label: 'Timeline', icon: <TimelineIcon /> },
    { value: 'list',     label: 'List',     icon: <ListIcon /> },
  ]
  return (
    <div className="inline-flex bg-ink-100 rounded-lg p-0.5">
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md transition-colors ${
            value === o.value
              ? 'bg-white text-ink-900 shadow-sm'
              : 'text-ink-600 hover:text-ink-900'
          }`}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  )
}

// ============================================================================
// Gantt (timeline) view
// ============================================================================
const GANTT_ROW_H = 64
const GANTT_BAR_H = 24

function GanttView({
  milestones, dateRange, bottlenecks, statusById, milestonesById, featuredId, onSetProgress,
}) {
  const scrollerRef = useRef(null)

  if (!dateRange || milestones.every(m => !m.start_date || !m.end_date)) {
    return (
      <div className="bg-white border border-dashed border-ink-200 rounded-2xl p-8 text-center text-sm text-ink-500">
        No dates yet. Rebuild your roadmap in Settings to add them.
      </div>
    )
  }

  const startMonth  = startOfMonth(dateRange.start)
  const endMonth    = startOfMonth(endOfMonthAfter(dateRange.end))
  const totalMonths = monthsBetween(startMonth, endMonth)
  const totalWidth  = totalMonths * PX_PER_MONTH

  const today               = new Date()
  const todayOffsetMonths   = monthsBetweenFrac(startMonth, today)
  const todayX              = todayOffsetMonths * PX_PER_MONTH
  const todayInRange        = today >= startMonth && today <= endMonth
  const currentMonthIndex   = todayInRange ? Math.floor(todayOffsetMonths) : -1

  useEffect(() => {
    const el = scrollerRef.current
    if (!el || !todayInRange) return
    const center = Math.max(0, todayX - el.clientWidth / 2 + LABEL_COLUMN_PX / 2)
    el.scrollLeft = center
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const sorted = [...milestones].sort(
    (a, b) => (a.start_date ?? '').localeCompare(b.start_date ?? '')
  )

  return (
    <div className="rounded-2xl border border-ink-200 bg-white overflow-hidden shadow-sm">

      {/* Mobile hint */}
      <p className="text-[11px] text-ink-400 px-4 py-2 border-b border-ink-100 bg-ink-50 md:hidden">
        Swipe sideways to see the full timeline →
      </p>

      <div ref={scrollerRef} className="overflow-x-auto">
        <div style={{ width: LABEL_COLUMN_PX + totalWidth, minWidth: '100%' }}>

          {/* Month header */}
          <GanttMonthHeader
            startMonth={startMonth}
            totalMonths={totalMonths}
            labelColumnPx={LABEL_COLUMN_PX}
            currentMonthIndex={currentMonthIndex}
          />

          {/* Chart body */}
          <div className="relative">

            {/* Column shading + gridlines */}
            <div
              className="absolute top-0 bottom-0 pointer-events-none"
              style={{ left: LABEL_COLUMN_PX, width: totalWidth }}
            >
              {Array.from({ length: totalMonths }).map((_, i) => (
                <div
                  key={i}
                  className="absolute top-0 bottom-0"
                  style={{
                    left:            i * PX_PER_MONTH,
                    width:           PX_PER_MONTH,
                    backgroundColor: i === currentMonthIndex ? 'rgba(99,102,241,0.04)' : 'transparent',
                    borderRight:     '1px solid rgba(0,0,0,0.05)',
                  }}
                />
              ))}
            </div>

            {/* Today line */}
            {todayInRange && (
              <div
                className="absolute top-0 bottom-0 z-10 pointer-events-none"
                style={{ left: LABEL_COLUMN_PX + todayX, width: 1.5, backgroundColor: '#6366f1' }}
              >
                <span
                  className="absolute -top-0 -translate-x-1/2 text-[9px] font-bold tracking-wide px-1.5 py-0.5 rounded-b-md text-white whitespace-nowrap"
                  style={{ backgroundColor: '#6366f1' }}
                >
                  TODAY
                </span>
              </div>
            )}

            {/* Rows */}
            {sorted.map((m, idx) => (
              <GanttRow
                key={m.id}
                milestone={m}
                startMonth={startMonth}
                labelColumnPx={LABEL_COLUMN_PX}
                status={statusById.get(m.id)}
                bottleneckBlocks={bottlenecks.get(m.id)}
                milestonesById={milestonesById}
                isFeatured={m.id === featuredId}
                isEven={idx % 2 === 0}
                onSetProgress={onSetProgress}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Legend */}
      <GanttLegend />
    </div>
  )
}

function GanttMonthHeader({ startMonth, totalMonths, labelColumnPx, currentMonthIndex }) {
  const cells = []
  const d = new Date(startMonth)
  for (let i = 0; i < totalMonths; i++) {
    cells.push({
      label:     d.toLocaleDateString(undefined, { month: 'short' }),
      yearLabel: d.getMonth() === 0 ? String(d.getFullYear()) : null,
      key:       `${d.getFullYear()}-${d.getMonth()}`,
      isCurrent: i === currentMonthIndex,
    })
    d.setMonth(d.getMonth() + 1)
  }

  return (
    <div className="flex sticky top-0 z-20 bg-ink-900 border-b border-ink-700">
      {/* Label column */}
      <div
        className="flex-shrink-0 border-r border-ink-700 px-4 flex items-center sticky left-0 z-10 bg-ink-900"
        style={{ width: labelColumnPx, height: 40 }}
      >
        <span className="text-[10px] font-bold uppercase tracking-widest text-ink-400">Milestone</span>
      </div>

      {/* Month columns */}
      <div className="flex">
        {cells.map(c => (
          <div
            key={c.key}
            className="flex-shrink-0 flex flex-col items-start justify-center px-2 relative"
            style={{ width: PX_PER_MONTH, height: 40, borderRight: '1px solid rgba(255,255,255,0.06)' }}
          >
            <span className={`text-[10px] font-semibold leading-none ${c.isCurrent ? 'text-brand-400' : 'text-ink-400'}`}>
              {c.label}
            </span>
            {c.yearLabel && (
              <span className="text-[9px] text-ink-600 mt-0.5">{c.yearLabel}</span>
            )}
            {c.isCurrent && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-brand-500 opacity-60" />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function GanttRow({
  milestone, startMonth, labelColumnPx, status, bottleneckBlocks, milestonesById,
  isFeatured, isEven, onSetProgress,
}) {
  const start = parseDate(milestone.start_date)
  const end   = parseDate(milestone.end_date)
  if (!start || !end) return null

  const offsetMonths = monthsBetweenFrac(startMonth, start)
  const durationMo   = Math.max(0.25, monthsBetweenFrac(start, end))
  const barLeft      = offsetMonths * PX_PER_MONTH
  const barWidth     = Math.max(GANTT_BAR_H, durationMo * PX_PER_MONTH) // min width so bar is always visible

  const category     = milestone.category ?? '_default'
  const colors       = CATEGORY_BAR[category] ?? CATEGORY_BAR._default
  const pct          = Number(milestone.progress_percent ?? 0)
  const isBottleneck = !!bottleneckBlocks
  const isBlocked    = status === 'blocked'
  const isDone       = milestone.completed

  // Status accent colour for the label column left border
  const accentColor = isBottleneck    ? '#f87171'
    : isDone                          ? '#2f8f6d'
    : status === 'in-progress'        ? '#6366f1'
    : status === 'overdue'            ? '#fbbf24'
    : status === 'blocked'            ? '#d1d5db'
    :                                   'transparent'

  const depNames = (milestone.depends_on ?? [])
    .map(id => milestonesById.get(id)?.title)
    .filter(Boolean)

  return (
    <div
      className="flex border-b transition-colors group/gantt-row"
      style={{
        height:          GANTT_ROW_H,
        borderColor:     'rgba(0,0,0,0.05)',
        backgroundColor: isEven ? 'white' : 'rgba(248,249,250,0.6)',
      }}
    >
      {/* Label column. Sticky, with a solid background, so the milestone
          name stays readable while the bars scroll underneath. Without it the
          timeline opens scrolled to today and every name is cut off. */}
      <div
        className="flex-shrink-0 border-r border-ink-100 px-4 flex items-center gap-3 sticky left-0 z-10"
        style={{ width: labelColumnPx, borderLeft: `3px solid ${accentColor}`, backgroundColor: isEven ? '#ffffff' : '#fafbfb' }}
      >
        {/* Category dot */}
        {milestone.category && (
          <span
            className="flex-shrink-0 w-2 h-2 rounded-full"
            style={{ backgroundColor: colors.fill }}
          />
        )}

        <div className="min-w-0 flex-1">
          <p className={`text-[12.5px] font-semibold leading-snug line-clamp-2 ${isDone ? 'line-through text-ink-300' : 'text-ink-800'} ${isFeatured ? 'text-brand-700' : ''}`}>
            {isFeatured && <span className="mr-1 text-brand-500">★</span>}
            {milestone.title}
          </p>
          <p className="text-[10px] text-ink-400 mt-0.5 truncate">
            {formatShortRange(start, end)}
            {isBottleneck && <span className="ml-1.5 text-red-400 font-semibold">· Blocking {bottleneckBlocks}</span>}
            {isBlocked     && <span className="ml-1.5 text-ink-400">· Waiting</span>}
          </p>
        </div>
      </div>

      {/* Chart area */}
      <div className="relative flex-1 flex items-center">

        {/* Bar */}
        <div
          className={`absolute rounded-full overflow-hidden ${isBlocked ? 'opacity-40' : ''}`}
          style={{
            left:            barLeft,
            width:           barWidth,
            height:          GANTT_BAR_H,
            backgroundColor: colors.base,
            boxShadow:       isBottleneck ? `0 0 0 2px #f87171` : 'none',
          }}
          title={buildBarTooltip(milestone, depNames)}
        >
          {/* Progress fill */}
          <div
            className="h-full transition-all duration-500 rounded-full"
            style={{
              width:           `${pct}%`,
              backgroundColor: isDone ? '#2f8f6d' : colors.fill,
            }}
          />

          {/* Progress % label — only when bar is wide enough */}
          {barWidth > 48 && (
            <div className="absolute inset-0 flex items-center px-3 pointer-events-none">
              <span
                className="text-[10px] font-bold truncate"
                style={{ color: pct > 55 ? 'rgba(255,255,255,0.9)' : colors.fill }}
              >
                {isDone ? '✓' : `${pct}%`}
              </span>
            </div>
          )}

          {/* Invisible range slider for drag-to-set-progress */}
          <input
            type="range"
            min="0"
            max="100"
            step="5"
            value={pct}
            onChange={e => onSetProgress(milestone, Number(e.target.value))}
            aria-label={`Progress for ${milestone.title}`}
            className="absolute inset-0 w-full h-full opacity-0 cursor-ew-resize"
          />
        </div>
      </div>
    </div>
  )
}

function GanttLegend() {
  const categories = [
    ['foundation', 'Foundation'],
    ['systems',    'Systems'],
    ['team',       'Team'],
    ['revenue',    'Revenue'],
    ['exit',       'Exit'],
  ]
  return (
    <div className="flex items-center flex-wrap gap-x-5 gap-y-2 px-5 py-3 border-t border-ink-100 bg-ink-50">
      <span className="text-[10px] font-semibold text-ink-500 uppercase tracking-wide">Category</span>
      {categories.map(([key, label]) => (
        <span key={key} className="inline-flex items-center gap-1.5 text-[11px] text-ink-600">
          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: CATEGORY_BAR[key].fill }} />
          {label}
        </span>
      ))}
      <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-ink-500">
        <span className="w-px h-3 rounded-full bg-brand-500" />
        Today
      </span>
      <span className="text-[11px] text-ink-400">· Drag bars to update progress</span>
    </div>
  )
}

// ============================================================================
// List view
// ============================================================================
function ListView({
  grouped, expandedId, updatingId, bottlenecks, statusById, milestonesById,
  dependentCountById, sharePctById, assigneesByMilestone = new Map(),
  actionAssigneesByKey = new Map(),
  countedById = new Map(), onToggleStep,
  teamMembers = [], featuredId,
  onToggleExpand, onToggleComplete, onSetProgress, onAssignMilestone, onOpenWorkOrder,
}) {
  // Drop the focus-card milestone from the list so it doesn't look duplicated.
  // Skip any bucket that becomes empty as a result.
  const filteredGroups = grouped
    .map(g => ({
      ...g,
      items: featuredId ? g.items.filter(m => m.id !== featuredId) : g.items,
    }))
    .filter(g => g.items.length > 0)

  if (filteredGroups.length === 0) {
    return (
      <div className="bg-white border border-dashed border-ink-200 rounded-xl p-6 text-center text-sm text-ink-500">
        Once you finish the step above, the rest of your plan will show up here.
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {filteredGroups.map(group => {
        const heading = TIMEFRAME_LABEL[group.timeframe] ?? group.timeframe
        // "By" means when the whole group is done: the LATEST end date. It
        // used the first row's, so a finished August milestone made "Next 90
        // days" read "By August 2026" in November (11 Nov audit).
        const lastEnd = group.items.map(m => m.end_date).filter(Boolean).sort().at(-1)
        const subtitle = lastEnd ? `By ${formatFriendlyDate(lastEnd)}` : null
        return (
          <section key={group.timeframe}>
            <div className="flex items-baseline gap-2 mb-3">
              <h3 className="text-sm font-bold text-ink-900 uppercase tracking-wider">
                {heading}
              </h3>
              {subtitle && <span className="text-xs text-ink-500">· {subtitle}</span>}
            </div>
            <div className="space-y-2">
              {group.items.map(m => (
                <MilestoneRow
                  key={m.id}
                  milestone={m}
                  status={statusById.get(m.id)}
                  expanded={expandedId === m.id}
                  updating={updatingId === m.id}
                  bottleneckBlocks={bottlenecks.get(m.id)}
                  dependents={dependentCountById.get(m.id) ?? 0}
                  sharePct={sharePctById.get(m.id) ?? 0}
                  assignees={assigneesByMilestone.get(m.id) ?? []}
                  actionAssigneesByKey={actionAssigneesByKey}
                  counted={countedById.get(m.id) ?? null}
                  onToggleStep={onToggleStep}
                  teamMembers={teamMembers}
                  milestonesById={milestonesById}
                  onToggleExpand={() => onToggleExpand(m.id)}
                  onToggleComplete={() => onToggleComplete(m)}
                  onSetProgress={onSetProgress}
                  onAssignMilestone={onAssignMilestone}
                  onOpenWorkOrder={onOpenWorkOrder}
                />
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function MilestoneRow({
  milestone, status, expanded, updating, bottleneckBlocks, dependents, sharePct,
  assignees = [], actionAssigneesByKey = new Map(), teamMembers = [],
  counted = null, onToggleStep,
  milestonesById, onToggleExpand, onToggleComplete, onSetProgress, onAssignMilestone, onOpenWorkOrder,
}) {
  const { title, description, category, actions, books, completed, depends_on } = milestone
  const statusStyle = STATUS_STYLES[status] ?? STATUS_STYLES.ready
  const isBottleneck = !!bottleneckBlocks
  const isBlocked    = status === 'blocked'
  const pct          = Number(milestone.progress_percent ?? 0)
  const firstAction  = Array.isArray(actions) && actions.length > 0 ? actions[0] : null
  const depNames     = (depends_on ?? []).map(id => milestonesById.get(id)?.title).filter(Boolean)

  // Resolve assignee_cid to a team member object for display
  const assigneePerson = milestone.assignee_cid
    ? teamMembers.find(tm => tm._cid === milestone.assignee_cid) ?? null
    : null

  // Status left-border accent
  const accentColor = isBottleneck      ? '#f87171'
    : completed                         ? '#2f8f6d'
    : status === 'in-progress'          ? '#6366f1'
    : status === 'overdue'              ? '#fbbf24'
    : status === 'blocked'              ? '#d1d5db'
    :                                     '#e2e8f0'

  return (
    <div
      className="group/row bg-white rounded-xl border border-ink-150 shadow-sm hover:shadow-md transition-shadow"
      style={{ borderLeft: `3px solid ${accentColor}` }}
    >
      <div className="flex items-center gap-3 px-4 py-3.5">

        {/* Checkbox */}
        <button
          type="button"
          onClick={onToggleComplete}
          disabled={updating || isBlocked}
          aria-label={completed ? 'Mark as not done' : 'Mark as done'}
          className={`w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-all ${
            completed  ? 'bg-green-500 border-green-500 text-white'
            : isBlocked ? 'border-ink-200 cursor-not-allowed'
            : 'border-ink-300 hover:border-brand-500'
          } ${updating ? 'opacity-40' : ''}`}
        >
          {completed && <CheckIcon className="w-3 h-3" />}
        </button>

        {/* Title — clicking expands */}
        <button
          type="button"
          onClick={onToggleExpand}
          className="flex-1 text-left min-w-0"
        >
          {/* Two lines on a phone: the name chips beside it left room for "Write …". */}
          <p className={`text-sm font-semibold leading-snug line-clamp-2 sm:line-clamp-none sm:truncate ${completed ? 'line-through text-ink-400' : 'text-ink-900'}`}>
            {title}
          </p>
          {/* On a phone the names sit under the title, not beside it. */}
          {assignees.length > 0 && (
            <div className="sm:hidden mt-1 flex flex-wrap gap-1">
              {assignees.slice(0, 3).map(p => (
                <span
                  key={p.id}
                  className={`text-[10px] font-semibold whitespace-nowrap px-2 py-0.5 rounded-full border ${
                    p._t === 'staff'
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : 'bg-ink-100 text-ink-700 border-ink-200'
                  }`}
                >
                  {p.name?.split(' ')[0] || p.email}
                </span>
              ))}
              {assignees.length > 3 && <span className="text-[10px] font-semibold text-ink-500">+{assignees.length - 3}</span>}
            </div>
          )}
          {!expanded && !completed && pct > 0 && (
            <div className="mt-1.5 flex items-center gap-2">
              <div className="h-1 w-32 bg-ink-100 rounded-full overflow-hidden">
                <div className="h-full bg-brand-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
              </div>
              <span className="text-[10px] text-ink-400 tabular-nums">{pct}%</span>
            </div>
          )}
        </button>

        {/* Due date */}
        {milestone.end_date && (
          <span className="text-[11px] text-ink-400 whitespace-nowrap flex-shrink-0 hidden sm:block">
            {formatFriendlyDate(milestone.end_date)}
          </span>
        )}

        {/*
          Assignees — display only. Two sources stacked in this order:
            1. work_orders rows on this milestone (`assignees` prop, built
               from work_orders.assigned_to / staff_member_id). This is the
               common case — "+ Task" puts people here.
            2. The legacy milestone-level `assignee_cid` (one person per
               milestone, set via a different UI). Shown only when there
               are no work-order assignees, so we don't duplicate names.

          Cap visible chips at 2 to avoid blowing out the row on a
          milestone with many actions assigned to different people; the
          rest collapse into "+N" with a tooltip listing all names.
        */}
        {assignees.length > 0 ? (
          <div className="hidden sm:flex items-center gap-1 flex-shrink-0">
            {assignees.slice(0, 2).map(p => (
              <Tooltip
                key={p.id}
                label={p.name || p.email}
                sublabel={p._t === 'staff' ? (p.email ? 'Team staff · gets email' : 'Team staff · no email on file') : 'App user · sees in dashboard'}
                position="top-right"
              >
                <span
                  className={`text-[10px] font-semibold whitespace-nowrap px-2 py-0.5 rounded-full border ${
                    p._t === 'staff'
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : 'bg-ink-100 text-ink-700 border-ink-200'
                  }`}
                >
                  {p.name?.split(' ')[0] || p.email}
                </span>
              </Tooltip>
            ))}
            {assignees.length > 2 && (
              <Tooltip
                label={`+${assignees.length - 2} more`}
                sublabel={assignees.slice(2).map(p => p.name || p.email).join(', ')}
                position="top-right"
              >
                <span className="text-[10px] font-semibold text-ink-600 bg-ink-50 border border-ink-200 px-1.5 py-0.5 rounded-full">
                  +{assignees.length - 2}
                </span>
              </Tooltip>
            )}
          </div>
        ) : assigneePerson ? (
          <Tooltip label={assigneePerson.name || assigneePerson.email}>
            <span className="text-[11px] font-semibold text-ink-500 whitespace-nowrap flex-shrink-0">
              {assigneePerson.name?.split(' ')[0] || assigneePerson.email}
            </span>
          </Tooltip>
        ) : null}

        {/* Job — on hover */}
        <button
          type="button"
          onClick={e => { e.stopPropagation(); onOpenWorkOrder?.(milestone.id, milestone.title, '') }}
          className="opacity-0 group-hover/row:opacity-100 pointer-coarse:opacity-100 transition-opacity w-7 h-7 rounded-full flex items-center justify-center border border-ink-200 hover:border-brand-300 hover:text-brand-600 text-ink-400 bg-white flex-shrink-0"
          title="Create a job"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/>
            <rect x="9" y="3" width="6" height="4" rx="1"/>
          </svg>
        </button>

        {/* Category dot — colored marker so the owner can scan the list
            and group milestones by area of the business at a glance.
            Tooltip on hover decodes the color without forcing a trip to
            the legend pill at top of the page. */}
        {category && (
          <Tooltip
            label={CATEGORY_LABELS[category]?.label || category}
            sublabel={CATEGORY_LABELS[category]?.desc}
            position="bottom-right"
          >
            <span
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{ backgroundColor: CATEGORY_BAR[category]?.fill ?? CATEGORY_BAR._default.fill }}
            />
          </Tooltip>
        )}

        {/* Expand toggle */}
        <span className="text-ink-300 text-xs select-none flex-shrink-0 w-4 text-center">
          {expanded ? '▲' : '▼'}
        </span>
      </div>

      {expanded && (
        <div className="px-4 pb-5 pl-[3.25rem] space-y-4 text-sm border-t border-ink-100 pt-4">
          {description && <p className="text-ink-700 leading-relaxed">{description}</p>}

          {!completed && counted && <CountedProgress counted={counted} pct={pct} light />}

          {/* A slider only when there is nothing to count (no steps, no tasks) */}
          {!completed && !isBlocked && !counted && (
            <div className="bg-white border border-ink-200 rounded-lg p-3">
              <div className="flex items-center justify-between text-xs mb-2">
                <span className="text-ink-600 font-semibold">Your progress</span>
                <span className="font-bold text-brand-700">{pct}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                step="5"
                value={pct}
                onChange={e => onSetProgress(milestone, Number(e.target.value))}
                className="w-full accent-brand-600 cursor-pointer"
                aria-label={`Progress for ${title}`}
              />
            </div>
          )}

          {depNames.length > 0 && (
            <div className="text-xs text-ink-600 bg-ink-50 border border-ink-200 rounded-md px-3 py-2 flex items-start gap-2">
              <span className="mt-0.5">🔗</span>
              <span>
                <span className="font-semibold">Can start after you finish:</span>{' '}
                {depNames.join(' · ')}
              </span>
            </div>
          )}

          {dependents > 0 && !completed && (
            <div className="text-xs text-brand-700 bg-brand-50 border border-brand-200 rounded-md px-3 py-2 flex items-start gap-2">
              <span className="mt-0.5">🔓</span>
              <span>
                Finishing this unlocks <strong>{dependents} other milestone{dependents === 1 ? '' : 's'}</strong>.
              </span>
            </div>
          )}

          {Array.isArray(actions) && actions.length > 0 && (
            <div>
              <div className="text-xs uppercase tracking-wide text-ink-500 font-bold mb-2">How to tackle this</div>
              <ol className="space-y-2">
                {actions.map((a, i) => {
                  // Look up who (if anyone) has a job on this exact
                  // action step. Falls through to null when the action hasn't
                  // been turned into a job yet — most steps start unassigned.
                  const actionAssignee = actionAssigneesByKey.get(`${milestone.id}::${a}`) ?? null
                  return (
                    <li key={i} className="flex items-start gap-2.5 text-ink-800 group/action">
                      <StepTick
                        n={i + 1}
                        weight={counted?.weightOf(a) ?? 0}
                        ticked={(milestone.actions_done ?? []).includes(a)}
                        onClick={() => onToggleStep?.(milestone, a)}
                      />
                      <span className={`leading-relaxed pt-px flex-1 ${(counted?.weightOf(a) ?? 0) === 1 ? 'text-ink-400 line-through' : ''}`}>{a}</span>
                      {actionAssignee && (
                        <span
                          className={`flex-shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap mt-0.5 ${
                            actionAssignee._t === 'staff'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : 'bg-ink-100 text-ink-700 border border-ink-200'
                          }`}
                          title={
                            actionAssignee._t === 'staff'
                              ? `Assigned to ${actionAssignee.name || actionAssignee.email} (team staff)`
                              : `Assigned to ${actionAssignee.name || actionAssignee.email}`
                          }
                        >
                          {actionAssignee.name?.split(' ')[0] || actionAssignee.email}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={e => { e.stopPropagation(); onOpenWorkOrder?.(milestone.id, milestone.title, a) }}
                        className="flex-shrink-0 opacity-0 group-hover/action:opacity-100 pointer-coarse:opacity-100 transition-opacity text-[10px] font-semibold text-brand-600 hover:text-brand-800 bg-brand-50 hover:bg-brand-100 border border-brand-200 px-2 py-0.5 rounded-full whitespace-nowrap mt-0.5"
                        title="Create a job for this action"
                      >
                        {actionAssignee ? 'Reassign' : '+ Task'}
                      </button>
                    </li>
                  )
                })}
              </ol>
            </div>
          )}

          {/* Books come up when the milestone's own words call for one, with
              the reason beside it (lib/bookMatch.js). Nothing fits, nothing shows. */}
          <BookLinks
            text={[title, description, ...(Array.isArray(actions) ? actions : [])].join(' . ')}
            prefer={MILESTONE_BOOK_TOPICS[category] ?? []}
            max={1}
            title="Worth reading for this milestone"
          />

          {/* Completion evidence — only shown when the milestone is done */}
          {completed && (
            <MilestoneAttachments
              milestoneId={milestone.id}
              milestoneTitle={milestone.title}
              milestoneCategory={milestone.category}
            />
          )}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Quick work-order popup — opens inline on Roadmap, no page navigation
// ============================================================================
function QuickWorkOrderModal({ draft, teamMembers, templates = [], profile, company, onClose }) {
  // Pre-fill the dropdown if reassigning. Lets the owner see who's currently
  // on this action step instead of "No one yet" when they reopen the modal.
  const [assignee_cid, setAssigneeCid] = useState(draft.existingAssigneeCid || '')
  // ⚠️ 1 Sep — this was useState(''), so the field opened BLANK every time,
  // including when reassigning a job that already had a due date.
  // Daniel: "date dont save". It did save — the update path has always written
  // it — but reopening showed nothing, so it looked like it had not.
  //
  // The save path then grew a workaround for the blankness: `if (due_date)`,
  // so a blank submit would not wipe a date the field had failed to show. Net
  // effect was that a due date could be set once and then never seen, never
  // changed to empty, and never trusted. Loading the real value fixes the
  // display AND lets the owner clear it, which is why the guard goes too.
  const [due_date,     setDueDate]     = useState(draft.existingDueDate ?? '')
  // template_id is only meaningful on the INSERT path (the picker is hidden
  // on reassign). When set, the chosen SOP's steps copy onto the new
  // WO as checklist items.
  const [template_id,  setTemplateId]  = useState('')
  const [saving, setSaving] = useState(false)
  const [err,    setErr]    = useState(null)

  // The task label — action step text if available, otherwise the milestone title
  const taskLabel = draft.taskTitle || draft.milestoneTitle
  const isReassign = !!draft.existingWorkOrderId

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true); setErr(null)

    let assigned_to    = null
    let staff_member_id = null
    if (assignee_cid?.startsWith('p:')) assigned_to    = assignee_cid.slice(2)
    if (assignee_cid?.startsWith('s:')) staff_member_id = assignee_cid.slice(2)

    // Track whether this person is "new to the action" — only then do we
    // fire the staff email. Reassigning to the SAME staff member shouldn't
    // re-spam their inbox, and clearing the assignee shouldn't send anything.
    const previousAssigneeCid = draft.existingAssigneeCid || ''
    const assigneeChanged     = assignee_cid !== previousAssigneeCid

    let error = null
    let staffColumnMissing = false

    if (isReassign) {
      // ---- UPDATE path: existing job, owner is reassigning ----
      // Set both columns explicitly so switching between profile and staff
      // assignees clears the other one. due_date is now written unconditionally
      // because the field is prefilled with the real value — so an empty box is
      // the owner deliberately clearing it, not the form having failed to load.
      const updatePayload = {
        title: taskLabel,
        assigned_to,
      }
      updatePayload.due_date = due_date || null

      let res = await supabase.from('work_orders')
        .update({ ...updatePayload, staff_member_id })
        .eq('id', draft.existingWorkOrderId)
      // Fallback for the (legacy) case where staff_member_id column doesn't
      // exist — retry without it. Email won't fire on this branch since
      // there's no column to attach the assignment to.
      if (res.error?.code === '42703' && staff_member_id) {
        staffColumnMissing = true
        res = await supabase.from('work_orders')
          .update(updatePayload)
          .eq('id', draft.existingWorkOrderId)
      }
      error = res.error
    } else {
      // ---- INSERT path: brand new job for this action ----
      const base = {
        company_id:   profile.company_id,
        created_by:   profile.id,
        title:        taskLabel,
        assigned_to,
        due_date:     due_date || null,
        priority:     'medium',
        status:       'backlog',
        milestone_id: draft.milestoneId,
        // template_id is set when the owner picked a SOP below; nullable
        // column, harmless when empty.
        ...(template_id ? { template_id } : {}),
      }

      // We need the inserted row's id to spawn checklist items, so use
      // .select().single() — costs nothing extra and keeps the spawn path
      // self-contained below.
      let res = await supabase.from('work_orders')
        .insert({ ...base, ...(staff_member_id ? { staff_member_id } : {}) })
        .select()
        .single()

      if (res.error?.code === '42703' && staff_member_id) {
        staffColumnMissing = true
        res = await supabase.from('work_orders')
          .insert(base)
          .select()
          .single()
      }
      error = res.error

      // Spawn checklist items from the chosen SOP. Fire-and-forget on
      // failure — the WO itself is the user's primary action, and the items
      // can be re-spawned manually if needed.
      if (!error && template_id && res.data?.id) {
        const tpl = templates.find(t => t.id === template_id)
        if (tpl?.items?.length) {
          const rows = tpl.items.map(item => ({
            work_order_id:    res.data.id,
            template_item_id: item.id,
            position:         item.position,
            text:             item.text,
            notes:            item.notes,
            required:         item.required,
          }))
          const { error: spawnErr } = await supabase
            .from('work_order_checklist_items')
            .insert(rows)
          if (spawnErr) console.warn('Failed to spawn checklist items:', spawnErr.message)
        }
      }
    }

    setSaving(false)
    if (error) { setErr(error.message); return }

    // Fire-and-forget: notify the staff assignee with a magic-link to /staff/{token}.
    // Conditions stacked so we don't email on every save:
    //   - assignment landed in the staff_member_id column (not profile, not nothing)
    //   - column exists (skip on legacy-fallback branches)
    //   - assignee actually CHANGED from what was there before (no re-spam on
    //     "I opened the modal and saved without changing anyone")
    if (staff_member_id && !staffColumnMissing && assigneeChanged) {
      const staff = teamMembers.find(tm => tm._cid === `s:${staff_member_id}`)
      if (staff?.email) {
        const ownerName   = profile?.name || profile?.email?.split('@')[0] || 'Your manager'
        const companyName = company?.name || 'the team'
        sendTaskAssigned({
          to:              staff.email,
          staffId:         staff_member_id,
          staffName:       staff.name || staff.email,
          ownerName,
          companyName,
          taskTitle:       taskLabel,
          taskDescription: null,
          priority:        'medium',
          dueDate:         due_date || null,
        })
      }
    }

    onClose(true)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm border border-ink-100">

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <p className="text-[11px] font-semibold text-ink-400 uppercase tracking-widest">
            {isReassign ? 'Reassign job' : 'Job'}
          </p>
          <button type="button" onClick={() => onClose(false)}
            className="text-ink-400 hover:text-ink-700 text-lg leading-none">✕</button>
        </div>

        {/* Task — shown as a fixed label, not editable */}
        <div className="px-5 pb-4">
          <div className="bg-ink-50 border border-ink-200 rounded-xl px-4 py-3">
            <p className="text-[10px] font-semibold text-ink-400 uppercase tracking-wider mb-1">{draft.milestoneTitle}</p>
            <p className="text-sm font-semibold text-ink-900 leading-snug">{taskLabel}</p>
          </div>
        </div>

        <form onSubmit={handleSave} className="px-5 pb-5 space-y-3">

          {/* Assignee */}
          <div>
            <label className="block text-xs font-semibold text-ink-600 mb-1.5">Assign to</label>
            {teamMembers.length > 0 ? (
              <select value={assignee_cid} onChange={e => setAssigneeCid(e.target.value)}
                className="w-full rounded-xl border border-ink-200 px-3 py-2.5 text-sm text-ink-800 focus:outline-none focus:ring-2 focus:ring-brand-300">
                <option value="">No one yet</option>
                {/*
                  Split into two groups so the owner can tell an App user (Danny
                  with a login) apart from a Team staff member (Danny with a
                  magic-link email). Same name across both buckets is common —
                  this layout prevents the "wrong Danny" mis-assignment that
                  silently sends no email.
                */}
                {teamMembers.some(tm => tm._t === 'profile') && (
                  <optgroup label="App users">
                    {teamMembers.filter(tm => tm._t === 'profile').map(tm => (
                      <option key={tm._cid} value={tm._cid}>{tm.name || tm.email}</option>
                    ))}
                  </optgroup>
                )}
                {teamMembers.some(tm => tm._t === 'staff') && (
                  <optgroup label="Team staff (gets email)">
                    {teamMembers.filter(tm => tm._t === 'staff').map(tm => (
                      <option key={tm._cid} value={tm._cid}>{tm.name || tm.email}</option>
                    ))}
                  </optgroup>
                )}
              </select>
            ) : (
              <p className="text-xs text-ink-400 italic">Add team members in Settings to assign tasks.</p>
            )}
          </div>

          {/* Due date */}
          <div>
            <label className="block text-xs font-semibold text-ink-600 mb-1.5">Due date</label>
            <input type="date" value={due_date} onChange={e => setDueDate(e.target.value)}
              className="w-full rounded-xl border border-ink-200 px-3 py-2.5 text-sm text-ink-800 focus:outline-none focus:ring-2 focus:ring-brand-300" />
          </div>

          {/* SOP picker — create-only. Reassign doesn't re-spawn items;
              the existing checklist stays put. Hidden entirely if no active
              SOPs exist (or migration 020 isn't applied). */}
          {!isReassign && templates.length > 0 && (
            <div>
              <label className="block text-xs font-semibold text-ink-600 mb-1.5">
                Start from a SOP <span className="text-ink-400 font-normal">(optional)</span>
              </label>
              <select value={template_id} onChange={e => setTemplateId(e.target.value)}
                className="w-full rounded-xl border border-ink-200 px-3 py-2.5 text-sm text-ink-800 focus:outline-none focus:ring-2 focus:ring-brand-300">
                <option value="">No SOP, blank job</option>
                {templates.map(t => (
                  <option key={t.id} value={t.id}>
                    {t.name}{t.items?.length ? ` (${t.items.length} steps)` : ''}
                  </option>
                ))}
              </select>
              {template_id && (() => {
                const tpl = templates.find(t => t.id === template_id)
                const n   = tpl?.items?.length ?? 0
                return (
                  <p className="mt-1.5 text-[11px] text-ink-500 leading-relaxed">
                    {n} step{n === 1 ? '' : 's'} from this SOP go with the task, so whoever is on it has the procedure to follow.
                  </p>
                )
              })()}
            </div>
          )}

          {err && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => onClose(false)}
              className="px-4 py-2 text-sm text-ink-600 hover:text-ink-900 font-medium">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="px-5 py-2 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold disabled:opacity-60 transition-colors">
              {saving ? 'Saving…' : isReassign ? 'Update' : 'Add to board'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ============================================================================
// Milestone completion evidence — inline upload attached to a single milestone
// ============================================================================
function MilestoneAttachments({ milestoneId, milestoneTitle, milestoneCategory }) {
  const { profile }             = useAuth()
  const [files, setFiles]       = useState([])
  const [loadState, setLoadState] = useState('loading')  // 'loading'|'ready'|'error'
  const [showDrop, setShowDrop] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [uploadError, setUploadError] = useState(null)
  const inputRef = useRef(null)

  useEffect(() => {
    if (!milestoneId) return
    listFilesForMilestone(milestoneId)
      .then(data => { setFiles(data); setLoadState('ready') })
      .catch(() => setLoadState('ready'))   // silently degrade — don't block the row
  }, [milestoneId])

  async function handleFile(file) {
    const err = validateFile(file)
    if (err) { setUploadError(err); return }
    if (!profile?.company_id) return

    setUploadError(null)
    setUploading(true)
    setProgress(0)

    try {
      // Build a descriptive title so it's recognisable in the Library
      const baseName  = file.name.replace(/\.[^.]+$/, '')
      const docTitle  = `${milestoneTitle}, ${baseName}`

      const row = await uploadKnowledgeFile(file, {
        companyId:   profile.company_id,
        userId:      profile.id,
        title:       docTitle,
        kind:        milestoneCategory || 'general',
        notes:       `Completion evidence for milestone: "${milestoneTitle}"`,
        milestoneId,
        onProgress:  setProgress,
      })
      setFiles(prev => [row, ...prev])
      setShowDrop(false)
    } catch (err) {
      setUploadError(err.message || 'Upload failed.')
    }
    setUploading(false)
  }

  function onDrop(e) {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer?.files?.[0]
    if (f) handleFile(f)
  }

  // Don't render the section at all while the initial fetch is in flight
  if (loadState === 'loading') return null

  const hasFiles = files.length > 0

  return (
    <div className="rounded-xl border border-green-100 bg-green-50/40 overflow-hidden">
      {/* Section header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-green-100">
        <div className="flex items-center gap-2">
          <span className="text-sm leading-none" aria-hidden>📎</span>
          <span className="text-[10.5px] font-bold uppercase tracking-widest text-green-800">
            Completion evidence
          </span>
          {hasFiles && (
            <span className="text-[10px] text-green-600 font-medium">
              {files.length} file{files.length === 1 ? '' : 's'}
            </span>
          )}
        </div>
        {!showDrop && (
          <button
            type="button"
            onClick={() => { setShowDrop(true); setUploadError(null) }}
            className="text-xs text-green-700 hover:text-green-900 font-semibold transition-colors"
          >
            + Attach document
          </button>
        )}
      </div>

      <div className="px-4 py-3 space-y-2">
        {/* Attached files list */}
        {hasFiles && (
          <div className="space-y-1.5">
            {files.map(f => (
              <div
                key={f.id}
                className="flex items-center gap-2 bg-white rounded-lg border border-green-100 px-3 py-2 text-xs"
              >
                <span className="text-base flex-shrink-0" aria-hidden>
                  {f.mime_type?.includes('pdf') ? '📕'
                    : f.mime_type?.startsWith('text/') ? '📝'
                    : f.mime_type?.includes('sheet') || f.mime_type?.includes('excel') ? '📊'
                    : '📄'}
                </span>
                <span className="flex-1 font-medium text-ink-800 truncate">{f.title}</span>
                <span className="text-ink-400 flex-shrink-0 tabular-nums">
                  {(f.size_bytes / 1024).toFixed(0)} KB
                </span>
                <span className="text-ink-300 flex-shrink-0">·</span>
                <span className="text-ink-400 flex-shrink-0">
                  {new Date(f.created_at).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Empty-state drop prompt (shows before user clicks + Attach) */}
        {!hasFiles && !showDrop && (
          <button
            type="button"
            onClick={() => { setShowDrop(true); setUploadError(null) }}
            className="w-full rounded-lg border border-dashed border-green-200 px-4 py-4 text-center hover:border-green-400 hover:bg-green-50 transition-colors group"
          >
            <div className="text-2xl mb-1" aria-hidden>📥</div>
            <div className="text-xs font-semibold text-green-700 group-hover:text-green-900">
              Attach the deliverable from this milestone
            </div>
            <div className="text-[10px] text-green-600 mt-0.5 opacity-70">
              The SOP, report, contract, or document you produced. Solomon will read it and learn from it.
            </div>
            <div className="text-[10px] text-ink-400 mt-1">PDF, Excel, CSV, TXT, Markdown · up to 10 MB</div>
            <div className="text-[10px] text-amber-600 mt-1">Keep your own copy. Solomon reads this one, but it is not your only backup.</div>
          </button>
        )}

        {/* Drop zone (after clicking Attach) */}
        {showDrop && (
          <div>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onClick={() => !uploading && inputRef.current?.click()}
              className={`cursor-pointer rounded-lg border-2 border-dashed p-5 text-center transition-colors ${
                dragOver
                  ? 'border-brand-400 bg-brand-50'
                  : 'border-ink-200 bg-white hover:border-ink-300'
              } ${uploading ? 'pointer-events-none opacity-60' : ''}`}
            >
              <div className="text-2xl mb-1" aria-hidden>📥</div>
              <div className="text-xs font-semibold text-ink-700">Drop a file here, or click to browse</div>
              <div className="text-[10px] text-ink-400 mt-0.5">PDF, Excel, CSV, TXT, Markdown · up to 10 MB</div>
            <div className="text-[10px] text-amber-600 mt-1">Keep your own copy. Solomon reads this one, but it is not your only backup.</div>
              <input
                ref={inputRef}
                type="file"
                className="hidden"
                accept=".pdf,.txt,.md,.markdown,.csv,.xlsx,.xls,application/pdf,text/plain,text/markdown,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
              />
            </div>

            {/* Upload progress */}
            {uploading && (
              <div className="mt-2">
                <div className="flex justify-between text-[10px] text-ink-500 mb-1">
                  <span>
                    {progress < 25 ? 'Uploading file…'
                      : progress < 70 ? 'Reading contents…'
                      : 'Saving to library…'}
                  </span>
                  <span>{progress}%</span>
                </div>
                <div className="h-1.5 bg-ink-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gold-gradient transition-[width] duration-300"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>
            )}

            {uploadError && (
              <p className="mt-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {uploadError}
              </p>
            )}

            {!uploading && (
              <button
                type="button"
                onClick={() => { setShowDrop(false); setUploadError(null) }}
                className="mt-2 text-[10px] text-ink-400 hover:text-ink-600 transition-colors"
              >
                Cancel
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function StatusChip({ status }) {
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.ready
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold whitespace-nowrap ${style.tone}`}>
      {style.label}
    </span>
  )
}

function StatusDot({ status, isBottleneck }) {
  const color = isBottleneck      ? 'bg-red-400'
    : status === 'done'           ? 'bg-green-400'
    : status === 'in-progress'    ? 'bg-brand-500'
    : status === 'overdue'        ? 'bg-amber-400'
    : status === 'blocked'        ? 'bg-ink-300'
    : /* ready */                   'bg-ink-200'

  const label = isBottleneck      ? 'Bottleneck'
    : STATUS_STYLES[status]?.label ?? 'Ready'

  return (
    <span
      title={label}
      className={`w-2 h-2 rounded-full flex-shrink-0 ${color}`}
    />
  )
}

// ============================================================================
// Small bits
// ============================================================================
function CategoryTag({ category }) {
  const tone = CATEGORY_TONES[category] ?? 'bg-ink-50 text-ink-700 border-ink-200'
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium flex-shrink-0 ${tone}`}>
      {category}
    </span>
  )
}

/** Tiny pill showing where a milestone came from — only renders when source is set. */
function SourceBadge({ source }) {
  if (!source) return null
  if (source === 'library') {
    return (
      <span
        className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-semibold bg-brand-50 text-brand-700 border border-brand-200 flex-shrink-0"
        title="Added from your Library Intelligence analysis"
      >
        📚 Library
      </span>
    )
  }
  if (source === 'chat') {
    return (
      <span
        className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-semibold bg-sky-50 text-sky-700 border border-sky-200 flex-shrink-0"
        title="Added via AI suggestion"
      >
        ✨ AI added
      </span>
    )
  }
  return null
}

function CategoryDot({ category }) {
  const colors = CATEGORY_BAR[category] ?? CATEGORY_BAR._default
  return <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: colors.fill }} />
}

function CheckIcon({ className = 'w-3 h-3' }) {
  return (
    <svg viewBox="0 0 12 12" className={className} fill="none" stroke="currentColor" strokeWidth="2.25">
      <path d="M2 6l2.5 2.5L10 3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function TimelineIcon() {
  return (
    <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2" y="3"  width="8"  height="2.5" rx="1" />
      <rect x="5" y="7"  width="9"  height="2.5" rx="1" />
      <rect x="3" y="11" width="6"  height="2.5" rx="1" />
    </svg>
  )
}

function ListIcon() {
  return (
    <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="3" cy="4"  r="1" />
      <circle cx="3" cy="8"  r="1" />
      <circle cx="3" cy="12" r="1" />
      <path d="M6 4h8M6 8h8M6 12h8" strokeLinecap="round" />
    </svg>
  )
}

// ============================================================================
// Pace control
// ============================================================================
function PaceControl({
  paceMul, projectedFinish, baseFinish, paceConfirm, applying,
  learnedPace, learnedDataPoints, paceAuto,
  onChangePace, onConfirm, onApply, onCancelConfirm, onToggleAuto,
}) {
  const isChanged    = paceMul !== 1.0
  // Where each pace would finish the plan, worked out from the real dates so
  // the buttons show an outcome instead of a rough month count.
  const today        = new Date()
  const finishAt     = mul => baseFinish ? (mul === 1.0 ? baseFinish : scaleDate(baseFinish, mul, today)) : null
  const monthYear    = iso => new Date(iso).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
  const active       = PACE_PRESETS.find(p => p.mul === paceMul)
  const learnedSnap  = learnedPace ? snapToPreset(learnedPace) : null
  const learnedPreset = learnedSnap ? PACE_PRESETS.find(p => p.mul === learnedSnap) : null

  // Confidence: how many milestones behind the learned pace
  const confidence = learnedDataPoints >= 10 ? 'high' : learnedDataPoints >= 5 ? 'medium' : 'low'
  const confidenceColor = confidence === 'high' ? 'bg-green-400' : confidence === 'medium' ? 'bg-amber-400' : 'bg-ink-300'

  return (
    <div className="mb-6 bg-white border border-ink-100 rounded-xl shadow-sm overflow-hidden">
      {/* Dark header */}
      <div className="bg-ink-900 px-5 py-3 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <span className="text-[10.5px] font-semibold uppercase tracking-widest text-brand-400">
            How fast do you want to go?
          </span>
          <p className="text-xs text-ink-300 mt-0.5 max-w-xl leading-relaxed">
            {paceAuto && learnedPreset
              ? `Set from your own history. You have been moving at ${learnedPreset.label} pace.`
              : 'Pick a pace and every date on your plan moves with it. Slower gives each milestone more room. Faster pulls the finish date closer. Nothing is saved until you lock it in.'}
          </p>
        </div>
        {projectedFinish && (
          <div className="text-right flex-shrink-0">
            <div className="text-[10px] text-ink-500 uppercase tracking-wide">Plan finishes</div>
            <div className={`text-sm font-bold tabular-nums ${isChanged ? 'text-brand-400' : 'text-white'}`}>
              {formatFriendlyDate(projectedFinish)}
            </div>
          </div>
        )}
      </div>

      <div className="px-5 py-4 space-y-4">
        {/* Preset buttons */}
        <div className="flex items-stretch gap-2 flex-wrap">
          {PACE_PRESETS.map(p => {
            const isActive   = paceMul === p.mul
            const isLearned  = learnedSnap === p.mul
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => onChangePace(p.mul)}
                className={`relative flex flex-col items-center gap-1 px-4 py-2.5 rounded-xl border font-semibold transition-all flex-1 min-w-[80px] ${
                  isActive
                    ? `${p.activeCls} shadow-sm`
                    : 'border-ink-200 text-ink-400 hover:border-ink-300 hover:bg-ink-50 hover:text-ink-700'
                }`}
              >
                {/* "Your pace" pip shown on the learned preset */}
                {isLearned && (
                  <span className="absolute -top-1.5 -right-1.5 text-[9px] font-bold bg-brand-500 text-white rounded-full px-1.5 py-0.5 leading-none whitespace-nowrap">
                    Yours
                  </span>
                )}
                <span className="text-xl leading-none">{p.emoji}</span>
                <span className="text-xs">{p.label}</span>
                <span className={`text-[10px] font-normal ${isActive ? 'opacity-80' : 'opacity-60'}`}>
                  {p.blurb}
                </span>
                <span className={`text-[10px] font-semibold ${isActive ? 'opacity-90' : 'opacity-60'}`}>
                  {finishAt(p.mul) ? `Done ${monthYear(finishAt(p.mul))}` : p.desc}
                </span>
              </button>
            )
          })}
        </div>

        {/* ── Learned pace section ────────────────────────────────────────── */}
        <div className="rounded-xl border border-ink-100 bg-ink-50/60 px-4 py-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-base leading-none flex-shrink-0">📊</span>
              <div className="min-w-0">
                <div className="text-[10.5px] font-bold uppercase tracking-widest text-ink-500 mb-0.5">
                  Your actual pace
                </div>
                {learnedPace && learnedPreset ? (
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-ink-900">
                      {learnedPreset.emoji} {learnedPreset.label}
                    </span>
                    <span className="text-xs text-ink-400">
                      based on {learnedDataPoints} milestone{learnedDataPoints === 1 ? '' : 's'}
                    </span>
                    {/* Confidence dots */}
                    <span className="flex items-center gap-0.5" title={`${confidence} confidence`}>
                      {[...Array(3)].map((_, i) => (
                        <span
                          key={i}
                          className={`w-1.5 h-1.5 rounded-full ${
                            i < (confidence === 'high' ? 3 : confidence === 'medium' ? 2 : 1)
                              ? confidenceColor
                              : 'bg-ink-200'
                          }`}
                        />
                      ))}
                    </span>
                  </div>
                ) : (
                  <p className="text-xs text-ink-400">
                    {learnedDataPoints === 0
                      ? 'Finish two milestones and this shows how fast you really move against the plan, so the dates can follow you instead of a guess.'
                      : 'Finish one more milestone and this shows how fast you really move against the plan.'}
                  </p>
                )}
              </div>
            </div>

            {/* Auto toggle */}
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className="text-xs text-ink-500" title="When on, your roadmap opens at the pace you actually keep.">Use my real pace</span>
              <button
                type="button"
                onClick={onToggleAuto}
                disabled={!learnedPace}
                aria-label={paceAuto ? 'Turn off auto pace' : 'Turn on auto pace'}
                title={!learnedPace ? 'Complete at least 2 milestones to enable' : undefined}
                className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                  paceAuto ? 'bg-brand-500 border-brand-500' : 'bg-ink-200 border-ink-300'
                }`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform mt-px ${
                    paceAuto ? 'translate-x-[18px]' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>
          </div>

          {paceAuto && learnedPreset && (
            <p className="text-[11px] text-ink-400 mt-2 leading-relaxed">
              Your roadmap will open at <strong className="text-ink-700">{learnedPreset.label}</strong> pace automatically.
              Pick any preset above to override for this session.
            </p>
          )}
        </div>

        {/* Changed-pace action strip */}
        {isChanged && (
          <div className="pt-1 border-t border-ink-100">
            {!paceConfirm ? (
              <div className="flex items-center gap-3 flex-wrap">
                <p className="text-xs text-ink-500 flex-1 leading-relaxed">
                  Previewing at <strong className="text-ink-800">{active?.label}</strong> pace, the Gantt below reflects adjusted dates. Your saved plan is unchanged until you lock it in.
                </p>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => onChangePace(1.0)}
                    className="text-xs text-ink-400 hover:text-ink-600 transition-colors"
                  >
                    Reset
                  </button>
                  <button
                    type="button"
                    onClick={onConfirm}
                    className="px-4 py-2 rounded-lg bg-gold-gradient text-white text-xs font-bold tracking-wide glow-gold-sm hover:glow-gold transition-all"
                  >
                    Lock in this pace →
                  </button>
                </div>
              </div>
            ) : (
              <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3">
                <p className="text-sm font-semibold text-amber-900 mb-1">Save this pace to your plan?</p>
                <p className="text-xs text-amber-700 leading-relaxed mb-3">
                  This updates the target dates on all your remaining milestones. Completed milestones stay exactly as they are. You can adjust the pace again any time.
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={onApply}
                    disabled={applying}
                    className="px-4 py-2 rounded-lg bg-amber-600 text-white text-xs font-bold hover:bg-amber-700 disabled:opacity-50 transition-colors"
                  >
                    {applying ? 'Saving…' : 'Yes, update my plan'}
                  </button>
                  <button
                    type="button"
                    onClick={onCancelConfirm}
                    className="text-xs text-amber-600 hover:text-amber-900 transition-colors"
                  >
                    Keep previewing
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// Chat panel — "What's come up?" → AI suggests where it fits
// ============================================================================
function ChatPanel({ chatInput, setChatInput, chatPhase, chatSuggestion, inputRef, onSubmit, onConfirm, onCancel }) {
  function handleKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (chatPhase === 'idle' && chatInput.trim()) onSubmit()
    }
  }

  return (
    <section className="mt-12 mb-6">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-6 h-6 rounded-full bg-brand-500/20 border border-brand-500/40 flex items-center justify-center flex-shrink-0">
          <span className="text-brand-400 text-xs leading-none">+</span>
        </div>
        <div>
          <h2 className="text-sm font-bold text-ink-900">Something come up?</h2>
          <p className="text-xs text-ink-400">Describe it and Solomon adds it to your roadmap, slotted in where it fits.</p>
        </div>
      </div>

      {chatPhase !== 'preview' && (
        <div className="bg-white border border-ink-100 rounded-xl shadow-sm p-4">
          <textarea
            ref={inputRef}
            rows={2}
            value={chatInput}
            onChange={e => setChatInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder='e.g. "I need to get certified for commercial jobs" or "a big client wants us to get liability insurance"'
            disabled={chatPhase === 'loading'}
            className="resize-none"
          />
          <div className="flex items-center justify-between mt-3">
            <p className="text-[11px] text-ink-400">Press Enter to send · Shift+Enter for new line</p>
            <button
              type="button"
              onClick={onSubmit}
              disabled={!chatInput.trim() || chatPhase === 'loading'}
              className="bg-gold-gradient text-white rounded-lg px-4 py-2 text-xs font-bold tracking-wide disabled:opacity-50 glow-gold-sm hover:glow-gold transition-all duration-200 flex items-center gap-1.5"
            >
              {chatPhase === 'loading' ? (
                <>
                  <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Thinking…
                </>
              ) : (
                'Add to my roadmap →'
              )}
            </button>
          </div>
        </div>
      )}

      {chatPhase === 'preview' && chatSuggestion && (
        <ChatSuggestionCard
          suggestion={chatSuggestion}
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      )}
    </section>
  )
}

function ChatSuggestionCard({ suggestion, onConfirm, onCancel }) {
  const tone = CATEGORY_TONES[suggestion.category] ?? 'bg-ink-50 text-ink-700 border-ink-200'

  return (
    <div className="bg-white border border-brand-200 rounded-xl shadow-sm overflow-hidden">
      {/* Gold header strip */}
      <div className="bg-ink-900 px-5 py-3 flex items-center gap-2">
        <span className="text-brand-400 text-xs font-semibold uppercase tracking-widest">Suggested addition</span>
        <span className="ml-auto text-ink-500 text-xs">{suggestion.timeframe}</span>
      </div>

      <div className="p-5">
        <div className="flex items-start gap-3 mb-3">
          <div className="flex-1">
            <h3 className="text-base font-bold text-ink-900 leading-tight mb-1">{suggestion.title}</h3>
            {suggestion.description && (
              <p className="text-sm text-ink-500 leading-relaxed">{suggestion.description}</p>
            )}
          </div>
          <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium flex-shrink-0 ${tone}`}>
            {suggestion.category}
          </span>
        </div>

        {suggestion.reasoning && (
          <div className="bg-brand-50/60 border border-brand-100 rounded-lg px-3 py-2 mb-4">
            <p className="text-xs text-brand-700 leading-relaxed">
              <span className="font-semibold">Why here: </span>{suggestion.reasoning}
            </p>
          </div>
        )}

        {Array.isArray(suggestion.actions) && suggestion.actions.length > 0 && (
          <div className="mb-4">
            <p className="text-[10.5px] font-semibold uppercase tracking-widest text-ink-400 mb-2">Steps</p>
            <ol className="space-y-1.5">
              {suggestion.actions.slice(0, 3).map((a, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-ink-700">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-ink-100 text-ink-600 text-[10px] font-bold flex items-center justify-center mt-0.5">
                    {i + 1}
                  </span>
                  <span className="leading-relaxed">{a}</span>
                </li>
              ))}
            </ol>
          </div>
        )}

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onConfirm}
            className="bg-gold-gradient text-white rounded-lg px-5 py-2.5 text-sm font-bold tracking-wide glow-gold-sm hover:glow-gold transition-all duration-200"
          >
            Add to my roadmap →
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="text-sm text-ink-400 hover:text-ink-600 transition-colors"
          >
            Discard
          </button>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Helpers
// ============================================================================
function safeParseJson(raw) {
  if (!raw) return null
  const trimmed = raw.trim().replace(/^```json\s*/i, '').replace(/```$/, '').trim()
  try { return JSON.parse(trimmed) }
  catch {
    const s = trimmed.indexOf('{'), e = trimmed.lastIndexOf('}')
    if (s === -1 || e === -1) return null
    try { return JSON.parse(trimmed.slice(s, e + 1)) }
    catch { return null }
  }
}

function sanitizeWeight(w) {
  const n = Number(w)
  if (!Number.isFinite(n)) return 5
  return Math.max(1, Math.min(10, Math.round(n)))
}

function groupByTimeframe(milestones) {
  const buckets = new Map()
  for (const m of milestones) {
    const key = m.timeframe || 'Other'
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key).push(m)
  }
  const ordered = []
  for (const tf of TIMEFRAME_ORDER) {
    if (buckets.has(tf)) {
      ordered.push({ timeframe: tf, items: buckets.get(tf) })
      buckets.delete(tf)
    }
  }
  for (const [tf, items] of buckets) ordered.push({ timeframe: tf, items })
  return ordered
}

/**
 * Pick the single milestone to highlight in the hero card.
 *
 * Precedence:
 *   1. An overdue milestone that's also a bottleneck (most urgent).
 *   2. Any in-progress, non-blocked milestone with the earliest end date.
 *   3. The earliest "ready" (not blocked, not started) milestone.
 *   4. null — every incomplete item is blocked (or nothing's left).
 */
function getNextActionable(milestones, statusById) {
  const candidates = milestones.filter(m => !m.completed)
  if (candidates.length === 0) return null

  const pick = (filter, sortKey) => {
    const subset = candidates.filter(filter)
    if (subset.length === 0) return null
    subset.sort((a, b) => (a[sortKey] ?? '').localeCompare(b[sortKey] ?? ''))
    return subset[0]
  }

  // 1. Overdue bottlenecks first.
  const overdueBlocker = pick(
    m => statusById.get(m.id) === 'overdue' && (m.depends_on ?? []).length === 0,
    'end_date',
  )
  // (Only treat as overdue-blocker if it itself isn't waiting on anything.)
  if (overdueBlocker) return overdueBlocker

  // 2. In-progress items.
  const inProgress = pick(
    m => statusById.get(m.id) === 'in-progress',
    'end_date',
  )
  if (inProgress) return inProgress

  // 3. Ready-to-start items.
  const ready = pick(
    m => statusById.get(m.id) === 'ready',
    'start_date',
  )
  if (ready) return ready

  // 4. Everything left is blocked. The hero won't render; caller shows the
  //    "everything blocked" card instead.
  return null
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function endOfMonthAfter(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 1)
}

function monthsBetween(a, b) {
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth())
}

function monthsBetweenFrac(a, b) {
  const whole = monthsBetween(a, b)
  const afterWhole = new Date(a.getFullYear(), a.getMonth() + whole, a.getDate())
  const days = (b.getTime() - afterWhole.getTime()) / (1000 * 60 * 60 * 24)
  return whole + days / 30.44
}

function formatShortRange(start, end) {
  const fmt = d => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  return `${fmt(start)}, ${fmt(end)}`
}

/** "April 2026" — readable target date for the hero card and group headings. */
function formatFriendlyDate(dateStr) {
  const d = parseDate(dateStr)
  if (!d) return null
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

function buildBarTooltip(m, depNames) {
  const lines = [
    m.title,
    `${m.progress_percent ?? 0}% complete`,
    `${m.start_date} → ${m.end_date}`,
  ]
  if (depNames.length > 0) lines.push(`Depends on: ${depNames.join(', ')}`)
  return lines.join('\n')
}

function truncate(str, n) {
  return str.length > n ? `${str.slice(0, n - 1)}…` : str
}

function toYmd(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Snap a raw pace ratio to the nearest preset multiplier. */
function snapToPreset(pace) {
  return PACE_PRESETS.reduce((a, b) =>
    Math.abs(b.mul - pace) < Math.abs(a.mul - pace) ? b : a
  ).mul
}

/**
 * Scale a milestone date by `mul` relative to today.
 *   mul < 1  → date moves closer   (faster pace)
 *   mul > 1  → date moves further  (relaxed pace)
 * Past dates are kept as-is so completed milestone history is never altered.
 */
function scaleDate(dateStr, mul, today = new Date()) {
  const d = parseDate(dateStr)
  if (!d) return dateStr
  const diffMs = d.getTime() - today.getTime()
  if (diffMs <= 0) return dateStr               // already past — leave alone
  return toYmd(new Date(today.getTime() + diffMs * mul))
}

function getInitialView() {
  try {
    const saved = localStorage.getItem(VIEW_STORAGE_KEY)
    if (saved === 'timeline' || saved === 'list') return saved
  } catch { /* ignore */ }
  if (typeof window !== 'undefined' && window.innerWidth < 768) return 'list'
  return 'timeline'
}
