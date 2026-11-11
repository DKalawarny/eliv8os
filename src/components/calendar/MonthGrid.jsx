import { getMonthGrid } from '../../lib/calendarEvents'

/**
 * MonthGrid — 7×6 cell grid for a single month.
 *
 * Each cell now has two layers:
 *   1. Event chips  (milestone due/start, check-in dot, billing)  — top of cell
 *   2. Work-session bars (coloured strips from the daily planner)  — bottom
 *
 * The session bars are intentionally simple: a thin strip of the milestone's
 * assigned colour with a small hour label. Clicking the day opens DayDetail
 * which gives the full breakdown.
 */

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export default function MonthGrid({ anchor, eventsByDate, dailyPlan = new Map(), selectedDateStr, onSelectDay }) {
  const cells = getMonthGrid(anchor)

  return (
    <div className="bg-white border border-ink-100 rounded-xl overflow-hidden shadow-sm">
      {/* Weekday header */}
      <div className="grid grid-cols-7 border-b border-ink-100 bg-ink-50">
        {WEEKDAYS.map(d => (
          <div key={d} className="px-2 py-2 text-[11px] font-semibold text-ink-500 uppercase tracking-wide text-center">
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 grid-rows-6">
        {cells.map(cell => (
          <DayCell
            key={cell.dateStr}
            cell={cell}
            events={eventsByDate.get(cell.dateStr) ?? []}
            sessions={dailyPlan.get(cell.dateStr) ?? []}
            isSelected={cell.dateStr === selectedDateStr}
            onSelect={() => onSelectDay(cell.dateStr)}
          />
        ))}
      </div>
    </div>
  )
}

// ── Day cell ──────────────────────────────────────────────────────────────────

function DayCell({ cell, events, sessions, isSelected, onSelect }) {
  const visibleEvents  = events.slice(0, 2)
  const overflowEvents = Math.max(0, events.length - visibleEvents.length)
  const hasSessions    = sessions.length > 0

  const bg =
    isSelected       ? 'bg-brand-50 ring-2 ring-brand-500 ring-inset z-10 relative'
    : !cell.inMonth  ? 'bg-ink-50/60'
    : cell.isWeekend ? 'bg-ink-50/30'
                     : 'bg-white'

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex flex-col min-h-[92px] border-r border-b border-ink-100 p-1.5 text-left transition-colors hover:bg-brand-50/30 ${bg}`}
      aria-label={`${cell.dateStr}${sessions.length ? `, ${sessions.length} work session${sessions.length > 1 ? 's' : ''}` : ''}`}
    >
      {/* Day number */}
      <div className="flex items-center justify-between mb-1">
        <span className={
          cell.isToday
            ? 'inline-flex items-center justify-center w-5 h-5 rounded-full bg-brand-500 text-white text-[11px] font-bold'
            : `text-[11px] font-medium ${cell.inMonth ? 'text-ink-700' : 'text-ink-300'}`
        }>
          {cell.date.getDate()}
        </span>
      </div>

      {/* Event chips — keep compact, max 2 */}
      <div className="hidden sm:block space-y-0.5 flex-1">
        {visibleEvents.map(ev => <EventChip key={ev.id} event={ev} />)}
        {overflowEvents > 0 && (
          <div className="text-[10px] text-ink-400 px-1">+{overflowEvents} more</div>
        )}
      </div>
      {/* A phone's day cell is ~50px: a title shrank to an unreadable "▸ …"
          (11 Nov audit). Dots there; tapping the day lists them in full. */}
      <div className="sm:hidden flex flex-wrap gap-0.5 flex-1 content-start">
        {events.slice(0, 6).map(ev => (
          <span key={ev.id} className={`w-1.5 h-1.5 rounded-full ${eventDot(ev)}`} />
        ))}
      </div>

      {/* Work-session bars — bottom of cell */}
      {hasSessions && cell.inMonth && (
        <div className="mt-1 space-y-0.5">
          {sessions.map(s => (
            <div
              key={s.milestoneId}
              className="flex items-center gap-1 rounded-sm px-1 py-0.5"
              style={{ background: s.color.light }}
            >
              <div
                className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                style={{ background: s.color.bar }}
              />
              <span
                className="text-[9px] font-bold truncate leading-none"
                style={{ color: s.color.text }}
              >
                {s.hours}h
              </span>
            </div>
          ))}
        </div>
      )}
    </button>
  )
}

// ── Event chips ───────────────────────────────────────────────────────────────

function eventDot(event) {
  if (event.type === 'milestone-end') {
    const st = event.meta?.status ?? 'open'
    return st === 'completed' ? 'bg-green-500' : st === 'overdue' ? 'bg-red-500' : 'bg-brand-500'
  }
  if (event.type === 'trial-end') return 'bg-amber-500'
  if (event.type === 'subscription-canceled') return 'bg-red-500'
  if (event.type === 'subscription-renewal') return 'bg-blue-500'
  return 'bg-ink-300'
}

function EventChip({ event }) {
  switch (event.type) {
    case 'trial-end':
      return <Chip tone="amber" strong>⏳ {event.title}</Chip>
    case 'subscription-canceled':
      return <Chip tone="red" strong>✕ {event.title}</Chip>
    case 'subscription-renewal':
      return <Chip tone="blue">↻ {event.title}</Chip>
    case 'milestone-end': {
      const status = event.meta?.status ?? 'open'
      const tone   = status === 'completed' ? 'green' : status === 'overdue' ? 'red' : 'brand'
      return <Chip tone={tone} strong>• {event.title}</Chip>
    }
    case 'milestone-start':
      return <Chip tone="gray">▸ {event.title}</Chip>
    case 'checkin':
      return (
        <div className="flex items-center gap-1 text-[11px] text-ink-500 px-1 truncate">
          <span aria-hidden>📝</span>
          <span className="truncate">{event.title}</span>
        </div>
      )
    case 'document':
      return (
        <div className="flex items-center gap-1 text-[11px] text-ink-500 px-1 truncate">
          <span aria-hidden>{event.meta?.icon ?? '📄'}</span>
          <span className="truncate">{event.title}</span>
        </div>
      )
    default:
      return null
  }
}

function Chip({ tone = 'gray', strong = false, children }) {
  const toneClass = {
    brand: 'bg-brand-100 text-brand-800 border-brand-200',
    green: 'bg-green-100 text-green-800 border-green-200',
    amber: 'bg-amber-100 text-amber-800 border-amber-200',
    red:   'bg-red-100   text-red-800   border-red-200',
    blue:  'bg-blue-100  text-blue-800  border-blue-200',
    gray:  'bg-ink-100   text-ink-600   border-ink-200',
  }[tone]

  return (
    <div className={`truncate border rounded px-1.5 py-0.5 text-[10px] leading-tight ${toneClass} ${strong ? 'font-semibold' : ''}`}>
      {children}
    </div>
  )
}
