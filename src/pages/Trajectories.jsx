import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ComposedChart, Area, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine,
  ResponsiveContainer,
} from 'recharts'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { streamToolCall } from '../lib/anthropic'
import { isDemoCompany } from '../lib/demo'

// ── Action plan helpers ───────────────────────────────────────────────────────

function planCacheKey(companyId, cur, tgt, mo) {
  return `growthos:traj-plan:${companyId}:${cur}:${tgt}:${mo}`
}

// The plan prompt is deliberately narrower than the advisor prompt: this is a
// one-shot JSON generator, not a conversation. But it inherits the same
// posture — no growth advice that only works if nothing goes wrong, and no
// implying that a bigger number is self-evidently the right goal.
const PLAN_SYSTEM_PROMPT = `You are Solomon, advisor to a business owner. Generate a specific, practical action plan for getting from their current revenue to their target.

Return ONLY valid JSON — no prose, no markdown fences:
{
  "summary": "2-sentence framing of the biggest levers for this specific gap",
  "categories": [
    {
      "name": "Category name",
      "icon": "single emoji",
      "actions": [
        {
          "title": "Specific action title (imperative, under 10 words)",
          "why": "One sentence: why this action matters for hitting the target",
          "priority": "critical" | "high" | "medium"
        }
      ]
    }
  ]
}

Rules:
- 4-5 categories (e.g. Sales, Operations, Finance, Team, Systems)
- 3-4 actions per category
- Be SPECIFIC to the industry, revenue gap, and timeline — not generic advice
- Do NOT duplicate milestone-type goals — focus on systems, processes, tools, relationships
- Keep "why" fields to one short sentence (under 15 words)
- Priority "critical" = first 90 days, "high" = first 6 months, "medium" = ongoing

Posture:
- Growth is a means here, not the point. Do not write anything that treats a
  bigger number as self-evidently good, and never imply the target is deserved
  or promised.
- If the gap is unrealistic for the timeline, say so in the summary. An owner
  who is told a 4x in 12 months is achievable, and then misses it, was not
  helped. Name it plainly rather than generating a plan that pretends.
- Prefer actions that make the business steadier — margin, collections,
  written process, the right hire — over actions that only add top-line.
- No action should require the owner to cut a corner he would be uncomfortable
  explaining to the person on the other side of it.
`

function buildPlanPrompt({ industry, location, currentRev, targetRev, timelineMo, milestones, primaryGoal }) {
  const gap = targetRev - currentRev
  const existing = milestones?.filter(m => !m.completed).map(m => `- ${m.title}`).join('\n') || 'None yet'
  return `Business: ${industry || 'General'} | Location: ${location || 'Not specified'}
Current annual revenue: $${currentRev.toLocaleString()}
Target annual revenue: $${targetRev.toLocaleString()} (gap: $${gap.toLocaleString()})
Timeline: ${timelineMo} months
Primary goal: ${primaryGoal || 'Grow revenue'}

Existing roadmap milestones (do not duplicate these):
${existing}

Generate a specific action plan to bridge this revenue gap. Focus on what's NOT already in the roadmap.`
}

/**
 * Trajectories — /trajectories
 *
 * Forward-looking business projection. Not "what happened" — "where are you going."
 *
 * The owner sets their current annual revenue + target. The app draws a
 * compound-growth projection curve to that target over their goal timeline,
 * overlays roadmap milestone markers, and shows three pace scenarios
 * (steady / sprint / relaxed) so the owner can see how much timing matters
 * to the financial outcome.
 *
 * The cards at the bottom translate the target into practical terms — what
 * the owner could draw, how many households it carries, giving (only if he
 * opted in), runway — and say plainly that the number has a cost.
 *
 * Data:
 *   - business_profiles: current_revenue (text range), goal_timeline, primary_goal
 *   - milestones: title, end_date, completed, completed_date
 *   All projection inputs (exact $ values) live in local state with sensible
 *   defaults parsed from the profile.
 */

// ── Revenue range → midpoint (annual $) ───────────────────────────────────────

const REVENUE_MIDPOINTS = {
  'Pre-revenue':      0,
  '$0 – $100k':      50_000,
  '$100k – $500k':  300_000,
  '$500k – $1M':    750_000,
  '$1M – $5M':    3_000_000,
  '$5M – $10M':   7_500_000,
  '$10M+':        12_000_000,
}

function parseRevenue(label) {
  if (label in REVENUE_MIDPOINTS) return REVENUE_MIDPOINTS[label]
  // Older profiles (and the demo) hold a typed figure, not a range: "2.8M",
  // "$450k", "450000". Read it rather than opening the page at $0.
  const m = String(label ?? '').replace(/[$,\s]/g, '').match(/^(\d+(?:\.\d+)?)([kKmM]?)$/)
  if (!m) return 0
  const mult = { k: 1_000, m: 1_000_000 }[m[2].toLowerCase()] ?? 1
  return Math.round(Number(m[1]) * mult)
}

// ── Goal timeline → months ────────────────────────────────────────────────────

// ⚠️ Every value returned here must be one the Timeline dropdown offers. It
// used to return 42 for "3–5 years" and 72 for "5+ years", neither of which
// the dropdown has, so the box read "6 months" while the chart said 42.
function parseTimelineMonths(label) {
  if (!label) return 24
  if (label.includes('6 month')) return 6
  if (label.includes('5+'))      return 60
  if (/3\s*(–|-|to)\s*5/.test(label)) return 48
  if (/(2\s*(–|-|to)\s*)?3 year/.test(label)) return 36
  if (label.includes('1 year'))  return 12
  if (label.includes('2 year'))  return 24
  return 24
}

// ── Month index → human label ─────────────────────────────────────────────────

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function monthIndexToLabel(m) {
  const d = new Date()
  d.setMonth(d.getMonth() + m)
  const yr = String(d.getFullYear()).slice(-2)
  return `${MONTHS[d.getMonth()]} '${yr}`
}

// ── "YYYY-MM" → month offset from today ───────────────────────────────────────

function endDateToMonths(dateStr) {
  if (!dateStr) return null
  const d = new Date((dateStr.length === 7 ? dateStr + '-28' : dateStr))
  const now = new Date()
  const months = (d.getFullYear() - now.getFullYear()) * 12 + (d.getMonth() - now.getMonth())
  return months
}

// ── Revenue formatter ─────────────────────────────────────────────────────────

function fmtRev(val) {
  if (!val && val !== 0) return '—'
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`
  if (val >= 1_000)     return `$${Math.round(val / 1_000)}k`
  return `$${val}`
}

function fmtRevFull(val) {
  if (!val && val !== 0) return '—'
  return `$${val.toLocaleString()}`
}

// ── Projection curve builder ──────────────────────────────────────────────────

function buildProjection(currentAnnual, targetAnnual, totalMonths) {
  // Use a $1 floor so pre-revenue businesses still see a curve
  const cur = Math.max(1, currentAnnual || 0)
  if (!targetAnnual || totalMonths <= 0) return []
  if (cur >= targetAnnual) return []
  currentAnnual = cur

  // Compound monthly growth rate to reach target in totalMonths
  const steadyR = Math.pow(targetAnnual / currentAnnual, 1 / totalMonths) - 1
  // Sprint: reach target 30% sooner
  const sprintR = Math.pow(targetAnnual / currentAnnual, 1 / (totalMonths * 0.7)) - 1
  // Relaxed: 35% more time
  const relaxR  = Math.pow(targetAnnual / currentAnnual, 1 / (totalMonths * 1.35)) - 1

  const cap = targetAnnual * 1.25   // chart ceiling
  const step = totalMonths <= 12 ? 1 : totalMonths <= 36 ? 2 : 3

  const points = []
  for (let m = 0; m <= totalMonths + step; m += step) {
    points.push({
      m,
      label: monthIndexToLabel(m),
      steady: Math.round(Math.min(currentAnnual * Math.pow(1 + steadyR, m), cap)),
      sprint: Math.round(Math.min(currentAnnual * Math.pow(1 + sprintR, m), cap)),
      relax:  Math.round(Math.min(currentAnnual * Math.pow(1 + relaxR,  m), cap)),
    })
  }
  return points
}

// ── Custom tooltip ────────────────────────────────────────────────────────────

function ProjectionTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-xl px-3 py-2.5 text-xs" style={{ background: '#1e2330', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }}>
      <div className="font-semibold mb-1.5" style={{ color: 'rgba(255,255,255,0.5)' }}>{label}</div>
      {payload.map(p => (
        <div key={p.dataKey} className="flex items-center gap-2 py-0.5">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: p.color }} />
          <span className="capitalize" style={{ color: 'rgba(255,255,255,0.4)' }}>{p.dataKey}:</span>
          <span className="font-bold" style={{ color: '#F59E0B' }}>{fmtRev(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Trajectories() {
  const { profile, company } = useAuth()
  const [milestones,  setMilestones]  = useState(null)
  const [bizProfile,  setBizProfile]  = useState(null)

  // Revenue inputs — user-editable, defaulted from profile
  const [currentRev,  setCurrentRev]  = useState('')
  const [targetRev,   setTargetRev]   = useState('')
  const [timelineMo,  setTimelineMo]  = useState(24)
  const [inputsReady, setInputsReady] = useState(false)
  const [trackGiving, setTrackGiving] = useState(false)

  // Action plan
  const [plan,          setPlan]         = useState(null)   // parsed JSON
  const [planLoading,   setPlanLoading]  = useState(false)
  const [planError,     setPlanError]    = useState('')
  const [streamingText, setStreamingText] = useState('')   // live raw text as it arrives
  const [checkedItems,  setCheckedItems]  = useState({})   // { "Category|Title": true }
  const [addedKeys,     setAddedKeys]     = useState(new Set()) // keys added to roadmap
  const planRef     = useRef()
  const streamRef   = useRef()  // scrolls streaming text box

  // ── Fetch data ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!profile?.company_id) return
    Promise.all([
      supabase
        .from('milestones')
        .select('id, title, end_date, completed, completed_date')
        .eq('company_id', profile.company_id)
        .order('end_date', { ascending: true }),
      supabase
        .from('business_profiles')
        .select('current_revenue, goal_timeline, primary_goal, industry, location')
        .eq('company_id', profile.company_id)
        .maybeSingle(),
      // Giving is opt-in and off by default (migration 028). This page only
      // asks so it can stay SILENT about giving for the owners who never
      // turned it on — surfacing it uninvited is precisely the move the
      // opt-in exists to prevent.
      supabase
        .from('companies')
        .select('track_giving')
        .eq('id', profile.company_id)
        .maybeSingle(),
    ]).then(([msRes, bpRes, coRes]) => {
      setMilestones(msRes.data ?? [])
      setTrackGiving(coRes?.data?.track_giving === true)
      const bp = bpRes.data
      setBizProfile(bp)
      if (bp && !inputsReady) {
        const cur = parseRevenue(bp.current_revenue)
        const tgt = cur > 0 ? Math.min(cur * 3, 10_000_000) : 100_000
        setCurrentRev(cur)
        setTargetRev(tgt)
        setTimelineMo(parseTimelineMonths(bp.goal_timeline))
        setInputsReady(true)

        // Restore cached plan for this input combo
        try {
          const cached = JSON.parse(localStorage.getItem(planCacheKey(profile.company_id, cur, Math.min(cur * 3, 10_000_000), parseTimelineMonths(bp.goal_timeline))) || 'null')
          if (cached) setPlan(cached)
        } catch { /* ignore */ }

        // Restore checked items
        try {
          const saved = JSON.parse(localStorage.getItem(`growthos:traj-checked:${profile.company_id}`) || '{}')
          setCheckedItems(saved)
        } catch { /* ignore */ }
      }
    }).catch(() => {
      setMilestones([])
    })
  }, [profile?.company_id])  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Generate action plan (streaming) ─────────────────────────────────────
  async function handleGeneratePlan() {
    const cur = Number(currentRev)
    const tgt = Number(targetRev)
    if (!cur && !tgt) return
    setPlanLoading(true)
    setPlanError('')
    setPlan(null)
    setStreamingText('')
    setTimeout(() => planRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80)

    try {
      const raw = await streamToolCall({
        companyId:    profile.company_id,
        userId:       profile.id,
        toolId:       'gbp-optimizer',
        kind:         'generate',
        systemPrompt: PLAN_SYSTEM_PROMPT,
        messages:     [{ role: 'user', content: buildPlanPrompt({
          industry:    bizProfile?.industry,
          location:    bizProfile?.location,
          currentRev:  cur,
          targetRev:   tgt,
          timelineMo:  Number(timelineMo),
          milestones,
          primaryGoal: bizProfile?.primary_goal,
        }) }],
        maxTokens: 4000,
        json:      true,
        onChunk:   (_chunk, full) => {
          setStreamingText(full)
          // keep the streaming box scrolled to bottom
          requestAnimationFrame(() => {
            if (streamRef.current) streamRef.current.scrollTop = streamRef.current.scrollHeight
          })
        },
      })

      let parsed
      try {
        parsed = JSON.parse(raw)
      } catch {
        const lastClose = raw.lastIndexOf('},')
        if (lastClose > 0) {
          try { parsed = JSON.parse(raw.slice(0, lastClose + 1) + ']}]}') }
          catch { throw new Error('Plan response was malformed. Please try regenerating.') }
        } else {
          throw new Error('Could not parse the plan response. Please try regenerating.')
        }
      }

      setStreamingText('')
      setPlan(parsed)
      try {
        localStorage.setItem(planCacheKey(profile.company_id, cur, tgt, timelineMo), JSON.stringify(parsed))
      } catch { /* ignore */ }
    } catch (err) {
      setStreamingText('')
      // The edge refuses AI for the demo with a 403; show the sentence, not
      // the raw "Claude function error 403: {...}".
      setPlanError(isDemoCompany(company)
        ? 'Solomon is switched off in this demo. In your own account he writes the plan here.'
        : err?.message || 'Could not generate plan. Please try again.')
    } finally {
      setPlanLoading(false)
    }
  }

  function toggleChecked(key) {
    setCheckedItems(prev => {
      const next = { ...prev, [key]: !prev[key] }
      try { localStorage.setItem(`growthos:traj-checked:${profile.company_id}`, JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }

  async function handleAddToRoadmap(categoryName, action) {
    if (!profile?.company_id) return
    const { error } = await supabase.from('milestones').insert({
      company_id:       profile.company_id,
      title:            action.title,
      description:      action.why ?? null,
      source:           'trajectory',
      category:         'trajectory',
      start_date:       null,
      end_date:         null,
      completed:        false,
      progress_percent: 0,
      sort_order:       9999,
    })
    if (!error) {
      setAddedKeys(prev => new Set([...prev, `${categoryName}|${action.title}`]))
    }
  }

  function clearPlan() {
    setPlan(null)
    try { localStorage.removeItem(planCacheKey(profile.company_id, Number(currentRev), Number(targetRev), timelineMo)) } catch { /* ignore */ }
  }

  // ── Projection series ──────────────────────────────────────────────────────
  const projData = useMemo(
    () => buildProjection(Number(currentRev), Number(targetRev), Number(timelineMo)),
    [currentRev, targetRev, timelineMo],
  )

  // ── Milestone markers (upcoming, limit to 6 for readability) ───────────────
  const markers = useMemo(() => {
    if (!milestones) return []
    return milestones
      .map(m => {
        const dateStr   = m.completed ? m.completed_date : m.end_date
        const monthOff  = endDateToMonths(dateStr)
        return { ...m, monthOff }
      })
      .filter(m => m.monthOff !== null && m.monthOff >= -1 && m.monthOff <= Number(timelineMo) + 3)
      .slice(0, 8)
  }, [milestones, timelineMo])

  // ── What the target would actually mean ───────────────────────────────────
  //
  // ⚠️ This block used to be headed "What hitting $X/yr unlocks for you" and
  // listed take-home, profit, runway — three of four cards pointing at money
  // arriving in the owner's pocket. That is the single most prosperity-adjacent
  // surface in the product, and the line Daniel drew is explicit: this must
  // never read like a wealth-preacher app.
  //
  // The arithmetic is not the problem — an owner genuinely needs to know what
  // he could draw and what team he could carry. The framing was. So: the
  // near-duplicate profit card is gone, what the money is FOR sits alongside
  // what it pays, and the section says plainly that the number has a cost.
  const target = Number(targetRev)
  const outcomes = target > 0 ? [
    {
      icon: '💸',
      label: 'What you could draw',
      value: fmtRev(Math.round(target * 0.28 / 12)),
      note: '~28% owner draw after ops & tax',
    },
    {
      icon: '👥',
      label: 'People this could support',
      value: `${Math.max(1, Math.floor(target * 0.40 / 65_000))} households`,
      note: '~40% of revenue on payroll at $65k avg',
    },
    // Only for owners who turned giving on themselves.
    ...(trackGiving ? [{
      icon: '🤲',
      label: 'What you could give',
      value: fmtRev(Math.round(target * 0.10 / 12)),
      note: 'a tenth, monthly, your number, not ours',
    }] : []),
    {
      icon: '🏦',
      label: 'Runway you could build',
      value: `${Math.min(24, Math.max(3, Math.round((target * 0.15 / 12) / (target * 0.82 / 12) * 12)))} mo/yr`,
      note: 'saving 15% of revenue each month',
    },
  ] : []

  const loading = milestones === null

  return (
    <div className="min-h-screen bg-ink-50">

      {/* ── Dark header ──────────────────────────────────────────────────────── */}
      <div className="bg-white border-b border-ink-100">
        <div className="max-w-6xl mx-auto px-8 py-6">
          <div
            className="text-[10px] font-bold uppercase tracking-[0.2em] mb-1"
            style={{ color: 'rgba(245,158,11,0.7)' }}
          >
            Growth Trajectories
          </div>
          <h1 className="text-2xl font-bold text-ink-900 leading-tight">
            Where your business is headed.
          </h1>
          <p className="text-sm text-ink-500 mt-1 max-w-2xl">
            Your revenue projection, three pace scenarios, and what hitting your target actually means for your life.
            Adjust the inputs below to model any scenario.
          </p>
        </div>
      </div>

    <div className="p-6 sm:p-8 max-w-6xl mx-auto">

      {/* ── Revenue inputs ───────────────────────────────────────────────────── */}
      <div className="bg-white border border-ink-100 rounded-xl shadow-sm p-5 mb-5">
        <div className="text-[10px] font-bold uppercase tracking-widest text-ink-400 mb-4">
          Projection inputs
        </div>
        <div className="grid sm:grid-cols-3 gap-4">
          <InputField
            label="Current annual revenue"
            prefix="$"
            value={currentRev}
            onChange={setCurrentRev}
            placeholder="e.g. 120000"
            hint={bizProfile?.current_revenue ? `Profile: ${bizProfile.current_revenue}` : ''}
          />
          <InputField
            label="Target annual revenue"
            prefix="$"
            value={targetRev}
            onChange={setTargetRev}
            placeholder="e.g. 500000"
            hint="Your goal, what does success look like?"
          />
          <div>
            <label className="block text-xs font-semibold text-ink-600 mb-1.5">
              Timeline
            </label>
            <select
              value={timelineMo}
              onChange={e => setTimelineMo(Number(e.target.value))}
              className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm text-ink-800 focus:outline-none focus:ring-2 focus:ring-brand-300"
            >
              {[
                { v: 6,  l: '6 months' },
                { v: 12, l: '1 year'   },
                { v: 24, l: '2 years'  },
                { v: 36, l: '3 years'  },
                { v: 48, l: '4 years'  },
                { v: 60, l: '5 years'  },
              ].map(o => (
                <option key={o.v} value={o.v}>{o.l}</option>
              ))}
            </select>
            <p className="text-[11px] text-ink-400 mt-1">
              {bizProfile?.goal_timeline ? `Profile: ${bizProfile.goal_timeline}` : 'Set in Settings → Profile'}
            </p>
          </div>
        </div>
      </div>

      {/* ── Projection chart ─────────────────────────────────────────────────── */}
      {loading ? (
        <div className="h-[360px] bg-white border border-ink-100 rounded-xl animate-pulse" />
      ) : projData.length === 0 ? (
        <EmptyChart />
      ) : (
        <div
          className="rounded-xl overflow-hidden mb-5"
          style={{
            background: 'linear-gradient(145deg, #0d1117 0%, #111827 60%, #0f1923 100%)',
            border: '1px solid rgba(255,255,255,0.06)',
            boxShadow: '0 0 40px rgba(245,158,11,0.05), 0 16px 32px rgba(0,0,0,0.3)',
          }}
        >
          <div className="px-5 pt-5 pb-3 flex items-start justify-between flex-wrap gap-3">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] mb-0.5"
                style={{ color: 'rgba(245,158,11,0.7)' }}>
                Revenue projection
              </div>
              <div className="text-sm font-semibold" style={{ color: 'rgba(255,255,255,0.7)' }}>
                {fmtRevFull(Number(currentRev))} →{' '}
                <span style={{ color: '#F59E0B' }}>{fmtRevFull(Number(targetRev))}</span>
                {' '}over {timelineMo} months
              </div>
            </div>
            {/* Legend */}
            <div className="flex items-center gap-4 text-[11px]" style={{ color: 'rgba(255,255,255,0.35)' }}>
              <LegendDot color="#F59E0B" label="Steady" />
              <LegendDot color="#6EE7B7" label="Sprint −30%" dashed />
              <LegendDot color="rgba(255,255,255,0.2)" label="Relaxed +35%" dashed />
            </div>
          </div>

          <ResponsiveContainer width="100%" height={320}>
            <ComposedChart
              data={projData}
              margin={{ top: 10, right: 24, bottom: 0, left: 8 }}
            >
              <defs>
                <linearGradient id="steadyGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#F59E0B" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#F59E0B" stopOpacity={0.0} />
                </linearGradient>
              </defs>

              <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.05)" />

              <XAxis
                dataKey="m"
                type="number"
                domain={[0, Number(timelineMo)]}
                tickFormatter={monthIndexToLabel}
                tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.25)' }}
                axisLine={false}
                tickLine={false}
                tickCount={Math.min(8, Math.ceil(timelineMo / 3) + 1)}
              />
              <YAxis
                tickFormatter={fmtRev}
                tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.25)' }}
                axisLine={false}
                tickLine={false}
                width={48}
              />

              <Tooltip content={<ProjectionTooltip />} />

              {/* Steady pace — amber filled area */}
              <Area
                dataKey="steady"
                stroke="#F59E0B"
                strokeWidth={2.5}
                fill="url(#steadyGrad)"
                dot={false}
                activeDot={{ r: 4, fill: '#F59E0B', strokeWidth: 0 }}
              />

              {/* Sprint — green dashed */}
              <Line
                dataKey="sprint"
                stroke="#6EE7B7"
                strokeWidth={1.5}
                strokeDasharray="5 3"
                dot={false}
                activeDot={{ r: 3, strokeWidth: 0 }}
              />

              {/* Relaxed — dim white dashed */}
              <Line
                dataKey="relax"
                stroke="rgba(255,255,255,0.2)"
                strokeWidth={1.5}
                strokeDasharray="4 4"
                dot={false}
                activeDot={{ r: 3, strokeWidth: 0 }}
              />

              {/* Milestone markers */}
              {markers.map((m, i) => (
                <ReferenceLine
                  key={m.id}
                  x={m.monthOff}
                  stroke={m.completed ? '#6EE7B7' : 'rgba(245,158,11,0.6)'}
                  strokeWidth={1}
                  strokeDasharray="3 3"
                  label={{
                    value: String(i + 1),
                    position: 'top',
                    fontSize: 9,
                    fontWeight: 700,
                    fill: m.completed ? '#6EE7B7' : '#F59E0B',
                  }}
                />
              ))}

              {/* "You are here" */}
              <ReferenceLine
                x={0}
                stroke="rgba(255,255,255,0.4)"
                strokeWidth={1.5}
                label={{
                  value: 'Now',
                  position: 'insideTopRight',
                  fontSize: 9,
                  fontWeight: 700,
                  fill: 'rgba(255,255,255,0.5)',
                }}
              />
            </ComposedChart>
          </ResponsiveContainer>

          {/* Milestone legend below chart */}
          {markers.length > 0 && (
            <div className="px-5 pb-5 pt-3" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              <div className="text-[10px] font-semibold uppercase tracking-wider mb-2"
                style={{ color: 'rgba(255,255,255,0.25)' }}>
                Roadmap milestones on this timeline
              </div>
              <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1">
                {markers.map((m, i) => (
                  <div key={m.id} className="flex items-center gap-2 text-xs">
                    <span
                      className="flex-shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-black text-white"
                      style={{ background: m.completed ? '#0b6b4e' : '#F59E0B' }}
                    >
                      {i + 1}
                    </span>
                    <span style={{ color: m.completed ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.7)' }}
                      className={`flex-1 truncate text-xs ${m.completed ? 'line-through' : ''}`}>
                      {m.title}
                    </span>
                    <span className="flex-shrink-0 tabular-nums text-[10px]"
                      style={{ color: 'rgba(255,255,255,0.3)' }}>
                      {m.completed ? '✓ done' : monthIndexToLabel(m.monthOff)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Scenario comparison ──────────────────────────────────────────────── */}
      {projData.length > 0 && (
        <div className="grid sm:grid-cols-3 gap-4 mb-5">
          <ScenarioCard
            label="Sprint"
            color="text-green-700"
            bg="bg-green-50 border-green-200"
            dot="bg-green-500"
            months={Math.round(timelineMo * 0.7)}
            current={Number(currentRev)}
            target={Number(targetRev)}
            desc="-30% of your timeline"
          />
          <ScenarioCard
            label="Steady"
            color="text-brand-700"
            bg="bg-brand-50 border-brand-200"
            dot="bg-brand-500"
            months={timelineMo}
            current={Number(currentRev)}
            target={Number(targetRev)}
            desc="Your current plan"
            highlight
          />
          <ScenarioCard
            label="Relaxed"
            color="text-ink-600"
            bg="bg-ink-50 border-ink-200"
            dot="bg-ink-400"
            months={Math.round(timelineMo * 1.35)}
            current={Number(currentRev)}
            target={Number(targetRev)}
            desc="+35% more time"
          />
        </div>
      )}

      {/* ── Action plan ──────────────────────────────────────────────────────── */}
      {projData.length > 0 && (
        <div ref={planRef} className="bg-white border border-ink-100 rounded-xl shadow-sm overflow-hidden mb-5">
          <div className="bg-ink-900 px-5 py-3.5 flex items-center justify-between gap-3">
            <div>
              <span className="text-[10.5px] font-semibold uppercase tracking-widest text-brand-400">
                Action plan
              </span>
              {plan && (
                <span className="ml-3 text-[10px] text-ink-500">
                  to reach {fmtRev(Number(targetRev))}/yr
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              {plan && (
                <button
                  type="button"
                  onClick={clearPlan}
                  className="text-[10.5px] text-ink-500 hover:text-ink-300 transition-colors"
                >
                  Clear
                </button>
              )}
              <button
                type="button"
                onClick={handleGeneratePlan}
                disabled={planLoading}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  background: 'linear-gradient(135deg, #5b21b6, #7c3aed)',
                  color: '#fff',
                }}
              >
                {planLoading ? (
                  <>
                    <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Generating…
                  </>
                ) : plan ? '↺ Regenerate' : '✦ Generate action plan'}
              </button>
            </div>
          </div>

          {/* Body */}
          {!plan && !planLoading && (
            <div className="px-5 py-8 text-center">
              <div className="text-3xl mb-3 opacity-30">🗺️</div>
              <p className="text-sm font-semibold text-ink-700 mb-1">
                Get a custom action plan for your revenue target
              </p>
              <p className="text-xs text-ink-400 max-w-md mx-auto leading-relaxed">
                Solomon will analyse your revenue gap, industry, and timeline, then generate specific actions
                you need to take beyond your roadmap milestones to actually hit {fmtRev(Number(targetRev))}/yr.
              </p>
              {planError && (
                <p className="mt-3 text-xs text-red-600 font-medium">{planError}</p>
              )}
            </div>
          )}

          {planLoading && (
            <div>
              <div className="px-5 pt-4 pb-2 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-brand-500 animate-pulse" />
                <p className="text-xs font-semibold text-ink-500">
                  Solomon is building your plan…
                </p>
              </div>
              {/* Live streaming text */}
              <div
                ref={streamRef}
                className="mx-5 mb-4 rounded-lg overflow-y-auto text-[10.5px] leading-relaxed font-mono"
                style={{
                  background: '#0d1117',
                  border: '1px solid rgba(255,255,255,0.08)',
                  color: 'rgba(245,158,11,0.75)',
                  maxHeight: '260px',
                  padding: '12px 14px',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {streamingText || ' '}
                <span className="inline-block w-1.5 h-3.5 bg-amber-400 opacity-80 animate-pulse ml-0.5 align-text-bottom" />
              </div>
            </div>
          )}

          {plan && !planLoading && (
            <div className="divide-y divide-ink-50">
              {/* Summary */}
              {plan.summary && (
                <div className="px-5 py-4 bg-brand-50 border-b border-brand-100">
                  <p className="text-sm text-brand-900 leading-relaxed">{plan.summary}</p>
                </div>
              )}

              {/* Categories */}
              {plan.categories?.map(cat => (
                <ActionCategory
                  key={cat.name}
                  category={cat}
                  checkedItems={checkedItems}
                  onToggle={toggleChecked}
                  addedKeys={addedKeys}
                  onAddToRoadmap={handleAddToRoadmap}
                />
              ))}

              {planError && (
                <div className="px-5 py-3">
                  <p className="text-xs text-red-600 font-medium">{planError}</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Outcome cards ────────────────────────────────────────────────────── */}
      {outcomes.length > 0 && (
        <div className="bg-white border border-ink-100 rounded-xl shadow-sm overflow-hidden">
          <div className="bg-ink-900 px-5 py-3.5">
            <span className="text-[10.5px] font-semibold uppercase tracking-widest text-brand-400">
              What {fmtRev(target)}/yr would actually mean
            </span>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-ink-50">
            {outcomes.map(o => (
              <div key={o.label} className="px-5 py-5">
                <div className="text-2xl mb-2">{o.icon}</div>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-400 mb-1">{o.label}</div>
                <div className="text-xl font-black text-ink-900 tabular-nums mb-1">{o.value}</div>
                <div className="text-[11px] text-ink-400 leading-snug">{o.note}</div>
              </div>
            ))}
          </div>
          <div className="px-5 py-3 bg-ink-50 border-t border-ink-100">
            <p className="text-[11px] text-ink-400 leading-relaxed">
              Estimates from typical margins. Use <a href="/tools/cfo" className="underline hover:text-ink-600">Finances</a> with
              your real numbers for anything you intend to act on. And a number
              this size has a cost in hours, people and risk. Worth asking
              Solomon what that cost is before you commit to the date.
            </p>
          </div>
        </div>
      )}

      {!loading && projData.length === 0 && (
        <div className="mt-5 text-center text-sm text-ink-400 py-8">
          Enter a current revenue below your target to see the projection.
        </div>
      )}
    </div>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function InputField({ label, prefix, value, onChange, placeholder, hint }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-ink-600 mb-1.5">{label}</label>
      <div className="relative">
        {prefix && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-400 font-medium">
            {prefix}
          </span>
        )}
        <input
          type="number"
          min="0"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className={`w-full rounded-lg border border-ink-200 py-2 pr-3 text-sm text-ink-800 focus:outline-none focus:ring-2 focus:ring-brand-300 ${prefix ? 'pl-7' : 'pl-3'}`}
        />
      </div>
      {hint && <p className="text-[11px] text-ink-400 mt-1">{hint}</p>}
    </div>
  )
}

function LegendDot({ color, label, dashed }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {dashed ? (
        <span className="w-6 inline-block" style={{ borderTop: `2px dashed ${color}` }} />
      ) : (
        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
      )}
      {label}
    </span>
  )
}

function ScenarioCard({ label, color, bg, dot, months, current, target, desc, highlight }) {
  const yrs = months >= 12
    ? `${(months / 12).toFixed(1).replace(/\.0$/, '')} yr${months >= 24 ? 's' : ''}`
    : `${months} mo`

  const r = current > 0 && target > current
    ? ((Math.pow(target / current, 1 / months) - 1) * 100).toFixed(1)
    : null

  return (
    <div className={`rounded-xl border p-4 ${bg} ${highlight ? 'ring-1 ring-brand-300' : ''}`}>
      <div className="flex items-center gap-2 mb-3">
        <span className={`w-2.5 h-2.5 rounded-full ${dot} flex-shrink-0`} />
        <span className={`text-xs font-bold ${color}`}>{label}</span>
        {highlight && (
          <span className="ml-auto text-[10px] bg-brand-100 text-brand-700 font-bold px-1.5 py-0.5 rounded-full">
            Your plan
          </span>
        )}
      </div>
      <div className={`text-2xl font-black tabular-nums ${color} mb-0.5`}>{yrs}</div>
      <div className="text-xs text-ink-500 mb-2">{desc}</div>
      {r && (
        <div className="text-[11px] text-ink-400">
          ~{r}% monthly growth needed
        </div>
      )}
    </div>
  )
}

// ── Action plan components ────────────────────────────────────────────────────

function ActionCategory({ category, checkedItems, onToggle, addedKeys, onAddToRoadmap }) {
  const [open, setOpen] = useState(true)
  const total = category.actions?.length ?? 0
  const done  = category.actions?.filter(a => checkedItems[`${category.name}|${a.title}`]).length ?? 0

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-5 py-3.5 text-left hover:bg-ink-50 transition-colors"
      >
        <span className="text-xl leading-none flex-shrink-0">{category.icon}</span>
        <span className="flex-1 text-sm font-bold text-ink-900">{category.name}</span>
        <span className="text-[11px] text-ink-400 tabular-nums">{done}/{total}</span>
        <span className={`text-ink-400 text-xs transition-transform ${open ? 'rotate-180' : ''}`}>▾</span>
      </button>

      {open && (
        <ul className="border-t border-ink-50">
          {category.actions?.map(action => (
            <ActionItem
              key={action.title}
              action={action}
              categoryName={category.name}
              checked={!!checkedItems[`${category.name}|${action.title}`]}
              added={addedKeys.has(`${category.name}|${action.title}`)}
              onToggle={() => onToggle(`${category.name}|${action.title}`)}
              onAddToRoadmap={onAddToRoadmap}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function ActionItem({ action, categoryName, checked, added, onToggle, onAddToRoadmap }) {
  const [saving, setSaving] = useState(false)

  async function handleAdd() {
    setSaving(true)
    await onAddToRoadmap(categoryName, action)
    setSaving(false)
  }

  const priorityStyle =
    action.priority === 'critical' ? 'bg-red-50 text-red-700 border-red-100' :
    action.priority === 'high'     ? 'bg-amber-50 text-amber-700 border-amber-100' :
                                     'bg-ink-50 text-ink-500 border-ink-100'

  return (
    <li className={`px-5 py-3.5 border-b border-ink-50 last:border-0 transition-colors ${checked ? 'bg-ink-50/50' : 'hover:bg-ink-50/30'}`}>
      <div className="flex items-start gap-3">
        {/* Checkbox */}
        <button
          type="button"
          onClick={onToggle}
          className={`mt-0.5 flex-shrink-0 rounded border-2 flex items-center justify-center transition-all ${
            checked ? 'bg-brand-600 border-brand-600' : 'border-ink-300 hover:border-brand-400'
          }`}
          style={{ width: '18px', height: '18px' }}
          aria-label={checked ? 'Mark incomplete' : 'Mark complete'}
        >
          {checked && (
            <svg viewBox="0 0 12 10" className="w-2.5 h-2.5" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="1,5 4,8 11,1" />
            </svg>
          )}
        </button>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-2 flex-wrap">
            <span className={`text-sm font-semibold leading-snug ${checked ? 'text-ink-400 line-through' : 'text-ink-900'}`}>
              {action.title}
            </span>
            {action.priority && action.priority !== 'medium' && (
              <span className={`flex-shrink-0 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${priorityStyle}`}>
                {action.priority}
              </span>
            )}
          </div>
          {action.why && (
            <p className={`text-xs mt-0.5 leading-relaxed ${checked ? 'text-ink-300' : 'text-ink-500'}`}>
              {action.why}
            </p>
          )}

          {/* Add to side quests */}
          <div className="mt-1.5">
            {added ? (
              <Link
                to="/roadmap"
                className="inline-flex items-center gap-1 text-[10px] font-semibold text-green-600 hover:text-green-700 transition-colors"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="2">
                  <polyline points="1,6 4,9 11,2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Added to side quests, view on roadmap →
              </Link>
            ) : (
              <button
                type="button"
                onClick={handleAdd}
                disabled={saving}
                className="inline-flex items-center gap-1 text-[10px] font-semibold text-orange-500 hover:text-orange-700 disabled:opacity-40 transition-colors"
              >
                {saving ? 'Adding…' : '⚡ Add to side quests'}
              </button>
            )}
          </div>
        </div>
      </div>
    </li>
  )
}

function EmptyChart() {
  return (
    <div className="h-[320px] bg-white border border-ink-100 rounded-xl flex flex-col items-center justify-center text-center px-6 mb-5">
      <div className="text-4xl mb-3 opacity-30">📈</div>
      <p className="text-sm font-semibold text-ink-600">Enter your current and target revenue above</p>
      <p className="text-xs text-ink-400 mt-1">Make sure your target is higher than your current revenue to generate a projection.</p>
    </div>
  )
}
