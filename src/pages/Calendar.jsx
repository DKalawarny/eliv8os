import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useSubscription } from '../hooks/useSubscription'
import {
  buildCalendarEvents,
  buildDailyPlan,
  startOfMonth,
  addMonthsStart,
  monthLabel,
} from '../lib/calendarEvents'
import { toDateString } from '../lib/milestoneDates'

import MonthGrid from '../components/calendar/MonthGrid'
import DayDetail from '../components/calendar/DayDetail'

const HOURS_KEY    = 'growthos:calHoursPerDay'
const WEEKENDS_KEY = 'growthos:calSkipWeekends'
const HOUR_PRESETS = [1, 2, 3, 4, 6, 8]

export default function Calendar() {
  const { profile } = useAuth()
  const { subscription, trialEndsAt } = useSubscription()

  const [data, setData] = useState({ loading: true })
  const [anchor, setAnchor]         = useState(() => startOfMonth(new Date()))
  const [selectedDateStr, setSelectedDateStr] = useState(() => toDateString(new Date()))

  // Planner settings — persisted so the user's preference survives a refresh
  const [hoursPerDay, setHoursPerDay] = useState(() => {
    try { const n = parseFloat(localStorage.getItem(HOURS_KEY)); return Number.isFinite(n) ? n : 4 }
    catch { return 4 }
  })
  const [skipWeekends, setSkipWeekends] = useState(() => {
    try { return localStorage.getItem(WEEKENDS_KEY) !== 'false' }
    catch { return true }
  })

  useEffect(() => {
    try { localStorage.setItem(HOURS_KEY, String(hoursPerDay)) } catch {}
  }, [hoursPerDay])

  useEffect(() => {
    try { localStorage.setItem(WEEKENDS_KEY, String(skipWeekends)) } catch {}
  }, [skipWeekends])

  useEffect(() => {
    if (!profile?.company_id) return
    let cancelled = false

    ;(async () => {
      const sinceIso = new Date()
      sinceIso.setMonth(sinceIso.getMonth() - 12)

      const [msRes, ciRes, docsRes] = await Promise.all([
        supabase
          .from('milestones')
          .select('id, title, timeframe, start_date, end_date, completed, actions, actions_done')
          .eq('company_id', profile.company_id),
        supabase
          .from('checkins')
          .select('id, win, revenue_update, created_at')
          .eq('company_id', profile.company_id)
          .gte('created_at', sinceIso.toISOString())
          .order('created_at', { ascending: false }),
        supabase
          .from('documents')
          .select('id, tool_id, title, created_at')
          .eq('company_id', profile.company_id)
          .gte('created_at', sinceIso.toISOString())
          .order('created_at', { ascending: false }),
      ])

      if (cancelled) return
      setData({
        loading:    false,
        milestones: msRes.data   ?? [],
        checkins:   ciRes.data   ?? [],
        documents:  docsRes.data ?? [],
      })
    })()

    return () => { cancelled = true }
  }, [profile?.company_id])

  const eventsByDate = useMemo(
    () => buildCalendarEvents({
      milestones:  data.milestones,
      checkins:    data.checkins,
      documents:   data.documents,
      trialEndsAt,
      subscription,
    }),
    [data.milestones, data.checkins, data.documents, trialEndsAt, subscription],
  )

  // Rebuild the daily plan whenever milestones or settings change
  const dailyPlan = useMemo(
    () => buildDailyPlan(data.milestones ?? [], { hoursPerDay, skipWeekends }),
    [data.milestones, hoursPerDay, skipWeekends],
  )

  const selectedEvents   = eventsByDate.get(selectedDateStr) ?? []
  const selectedSessions = dailyPlan.get(selectedDateStr)   ?? []

  const handleMarkComplete = async (milestoneId) => {
    if (!profile?.company_id) return
    // One click closed the whole milestone, steps still open or not (11 Nov
    // audit). Ask only when something is actually unfinished.
    const ms = (data.milestones ?? []).find(m => m.id === milestoneId)
    const done = new Set(ms?.actions_done ?? [])
    const open = (ms?.actions ?? []).filter(a => !done.has(a)).length
    if (open > 0 && !window.confirm(`"${ms.title}" still has ${open} step${open === 1 ? '' : 's'} not done. Mark the whole milestone complete anyway?`)) return
    const { error } = await supabase
      .from('milestones')
      .update({ completed: true })
      .eq('id', milestoneId)
      .eq('company_id', profile.company_id)
    if (!error) {
      setData(prev => ({
        ...prev,
        milestones: (prev.milestones ?? []).map(m =>
          m.id === milestoneId ? { ...m, completed: true } : m
        ),
      }))
    }
  }

  return (
    <div className="min-h-screen bg-ink-50">

      {/* ── Dark header ─────────────────────────────────────────────────── */}
      <div className="bg-white border-b border-ink-100">
        <div className="max-w-7xl mx-auto px-8 py-5">
          <div className="flex items-center justify-between gap-6 flex-wrap">

            {/* Left: title */}
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] mb-0.5 text-brand-700">
                Plan
              </div>
              <h1 className="text-xl font-bold text-ink-900 leading-tight">
                Your day-by-day plan
              </h1>
              <p className="text-[11px] text-ink-400 mt-1 max-w-md leading-snug">
                Auto-generated from your roadmap milestones. Click any day to see what to work on.
              </p>
            </div>

            {/* Right: planner controls */}
            <div className="flex items-center gap-4 flex-wrap">
              {/* Hours per day */}
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold text-ink-400 uppercase tracking-wider whitespace-nowrap">
                  Hrs / task / day
                </span>
                <div className="flex items-center gap-1">
                  {HOUR_PRESETS.map(h => (
                    <button
                      key={h}
                      type="button"
                      onClick={() => setHoursPerDay(h)}
                      className={`w-8 h-7 rounded text-xs font-bold transition-colors ${
                        hoursPerDay === h
                          ? 'bg-brand-500 text-white'
                          : 'bg-ink-800 text-ink-400 hover:bg-ink-700 hover:text-ink-200'
                      }`}
                    >
                      {h}
                    </button>
                  ))}
                </div>
              </div>

              {/* Skip weekends toggle */}
              <button
                type="button"
                onClick={() => setSkipWeekends(v => !v)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors border ${
                  skipWeekends
                    ? 'bg-brand-500/15 border-brand-500/30 text-brand-300'
                    : 'bg-ink-800 border-ink-700 text-ink-400 hover:text-ink-200'
                }`}
              >
                <span className={`w-3 h-3 rounded-sm border flex items-center justify-center flex-shrink-0 ${
                  skipWeekends ? 'bg-brand-500 border-brand-500' : 'border-ink-500'
                }`}>
                  {skipWeekends && (
                    <svg viewBox="0 0 10 10" fill="none" className="w-2 h-2">
                      <path d="M1.5 5l2.5 2.5 4.5-4.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </span>
                Weekdays only
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Month nav toolbar ───────────────────────────────────────────── */}
      <div className="max-w-7xl mx-auto px-8 pt-5 pb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <NavButton onClick={() => setAnchor(a => addMonthsStart(a, -1))} label="←" ariaLabel="Previous month" />
          <NavButton
            onClick={() => {
              const today = new Date()
              setAnchor(startOfMonth(today))
              setSelectedDateStr(toDateString(today))
            }}
            label="Today"
          />
          <NavButton onClick={() => setAnchor(a => addMonthsStart(a, 1))} label="→" ariaLabel="Next month" />
        </div>
        <h2 className="text-base font-semibold text-ink-800">{monthLabel(anchor)}</h2>
        <Legend />
      </div>

      {/* ── Grid + side panel ───────────────────────────────────────────── */}
      <div className="max-w-7xl mx-auto px-8 pb-8">
        {data.loading ? (
          <LoadingSkeleton />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
            <MonthGrid
              anchor={anchor}
              eventsByDate={eventsByDate}
              dailyPlan={dailyPlan}
              selectedDateStr={selectedDateStr}
              onSelectDay={setSelectedDateStr}
            />
            <DayDetail
              dateStr={selectedDateStr}
              events={selectedEvents}
              sessions={selectedSessions}
              hoursPerDay={hoursPerDay}
              onMarkComplete={handleMarkComplete}
            />
          </div>
        )}
      </div>
    </div>
  )
}

// ── Nav button ────────────────────────────────────────────────────────────────

function NavButton({ onClick, label, ariaLabel }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel ?? label}
      className="px-3 py-1.5 border border-ink-200 rounded-md text-sm text-ink-700 bg-white hover:bg-ink-50 transition-colors"
    >
      {label}
    </button>
  )
}

// ── Legend ────────────────────────────────────────────────────────────────────

function Legend() {
  return (
    <div className="hidden md:flex items-center gap-3 text-[11px] text-ink-500">
      <LegendDot color="bg-brand-500" label="Due"     />
      <LegendDot color="bg-green-500" label="Done"    />
      <LegendDot color="bg-red-500"   label="Overdue" />
      <LegendDot color="bg-amber-500" label="Billing" />
    </div>
  )
}

function LegendDot({ color, label }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`w-2 h-2 rounded-full ${color}`} />
      {label}
    </span>
  )
}

// ── Loading skeleton ──────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
      <div className="h-[560px] bg-ink-100 rounded-xl animate-pulse" />
      <div className="h-[560px] bg-ink-100 rounded-xl animate-pulse" />
    </div>
  )
}
