import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate } from 'react-router-dom'
import WayoutShell from './WayoutShell'
import Working from './Working'
import CrisisHelp from './CrisisHelp'
import { WAYOUT_BASE } from '../../lib/wayout/brand'
import {
  loadOrCreateSession, generatePath, savePath, savePathState, markMoveDone,
  loadPlaybook, generateMoveQuestions, generatePlaybook, savePlaybook, playbookIsStale, wantPlaybook,
} from '../../lib/wayout/session'
import {
  pathIsStale, allSteps, currentStep, stepStatus, blockedBy, savedPerMonth, monthlyGap,
  parseAmount, partIsFinished, untilFor, cheer, pickFresh, DONE_LINES,
} from '../../lib/wayout/path'
import { tick, buzz } from '../../lib/wayout/feedback'
import { humanError } from '../../lib/wayout/humanError'

/**
 * ⭐⭐ THE PATH (Daniel, 31 Oct 2026). The plan's three moves as small steps,
 * tapped through like a game. Built from the mock-up he went through step by
 * step; every behaviour below is one of his notes:
 *   · bright, with energy ("it looks too dark, it needs to have energy")
 *   · type your own amount ("an option to put in your own numbers")
 *   · "It didn't work" always lets you move on ("some things can't budge")
 *   · a step that waits for a date parks itself and never blocks
 *   · the congratulations change ("so it's not all the same")
 *   · nothing blocks unless it has to be done first
 * The rules themselves are in lib/wayout/path.js, where they are tested.
 *
 * ⚠️ The paid half, like the walkthrough. Free while payments are off (102).
 */
export default function Path() {
  const navigate = useNavigate()
  const [session, setSession] = useState(null)
  const [path, setPath] = useState(null)
  const [state, setState] = useState({})
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [howTo, setHowTo] = useState(null)        // move number whose how-to is open
  const busy = useRef(false)

  useEffect(() => {
    let cancelled = false
    async function go() {
      try {
        const s = await loadOrCreateSession()
        if (cancelled) return
        if (!s.map?.moves?.length) { navigate(`${WAYOUT_BASE}/plan`, { replace: true }); return }
        setSession(s)
        if (s.path && !pathIsStale(s.path, s.map)) {
          setPath(s.path)
          setState(s.path_state ?? {})
          return
        }
        // Same guard as the plan page: in dev the effect runs twice, and
        // without this both runs reach the model.
        if (busy.current) return
        busy.current = true
        setWorking(true)
        const written = await generatePath(s)
        if (cancelled) return
        if (!written?.crisis) await savePath(s.id, written)
        setPath(written)
        setState({})
      } catch (err) {
        if (!cancelled) setError(humanError(err) || 'That did not come through. Try again in a moment.')
      } finally {
        if (!cancelled) setWorking(false)
      }
    }
    go()
    return () => { cancelled = true }
  }, [navigate])

  const onState = useCallback(async (next, finishedMove) => {
    setState(next)
    try {
      await savePathState(session.id, next)
      // ⭐ A finished part ticks its move, so the plan page, the "how did it
      // go" page and the check-in emails all see it.
      if (finishedMove) await markMoveDone(session.id, finishedMove, true)
    } catch (err) {
      setError(humanError(err) || 'That did not save. Check your connection and try again.')
    }
  }, [session])

  if (error && !path) {
    return (
      <WayoutShell title="Your path">
        <p className="wayout__lead">{error}</p>
        <Link className="wayout__btn wayout__btn--sun" to={`${WAYOUT_BASE}/plan`}>Back to the plan</Link>
      </WayoutShell>
    )
  }

  if (working || !path) {
    return (
      <WayoutShell title="Your path">
        <Working lines={[
          'Reading your plan',
          'Breaking each move into small steps',
          'Working out what can be done today',
          'Laying out your path',
        ]} />
      </WayoutShell>
    )
  }

  if (path.crisis) {
    return (
      <WayoutShell title="Read this first">
        <div className="wayout__crisis">
          {String(path.message).replace(/\*\*/g, '').split(/\n{2,}/).filter(Boolean).map((p, i) => (
            <p key={i} className={i === 0 ? 'wayout__q' : 'wayout__lead'}>{p.trim()}</p>
          ))}
        </div>
        <CrisisHelp region={session?.answers?.region} />
      </WayoutShell>
    )
  }

  return (
    <WayoutShell title="Your path" wide>
      <PathView
        path={path}
        state={state}
        headline={session?.map?.headline}
        gap={monthlyGap(session?.map)}
        onState={onState}
        onHowTo={move => setHowTo(move)}
        doneLink={`${WAYOUT_BASE}/done`}
      />
      {howTo && <HowToSheet session={session} order={howTo} onClose={() => setHowTo(null)} />}
      {error && <p className="wayout__path-err" role="alert">{error}</p>}
    </WayoutShell>
  )
}

// ── The path itself ─────────────────────────────────────────────────────────

const DONE_STATES = new Set(['done', 'tried'])
// ⚠️ An even swing either side of the centre line, like a path up a hill. The
// first version leaned right (50, 68, 74, 60…) and drifted off the part signs,
// which sit in the middle (Daniel: "this needs alignment").
const X = [50, 62, 68, 62, 50, 38, 32, 38]
const PART_COLOURS = ['amber', 'coral', 'sky']
const money = n => `$${Number(n).toLocaleString('en-US')}`

const Check = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
)
const Arrow = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6" /></svg>
)
const Clock = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>
)
const Star = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.8l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 16.8l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" /></svg>
)
const Coin = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5" /><path d="M14.6 9.2c-.5-.8-1.5-1.2-2.6-1.2-1.5 0-2.6.8-2.6 2s1.1 1.6 2.6 2 2.7.8 2.7 2-1.2 2-2.7 2c-1.2 0-2.2-.5-2.7-1.3M12 6.5V8M12 16v1.5" /></svg>
)
// The badge on the win changes each time, with the words.
const BADGES = [
  { kind: 'check', tone: 'green' }, { kind: 'star', tone: 'amber' }, { kind: 'coin', tone: 'sky' }, { kind: 'check', tone: 'coral' },
]
const Badge = ({ kind }) => (kind === 'star' ? <Star /> : kind === 'coin' ? <Coin /> : <Check />)

/**
 * The path, drawn from `path` and `state`. Reports every change through
 * `onState(nextState, finishedMove)`; owns nothing that has to persist, so the
 * dev preview can drive it with sample data and no database.
 */
export function PathView({ path, state, headline = '', gap = null, onState, moveLink = null, onHowTo = null, doneLink = null, now: nowProp = null }) {
  const [sheet, setSheet] = useState(null)        // { step, view, ... }
  const [lastUsed, setLastUsed] = useState({})
  const trail = useRef(null)
  const [segs, setSegs] = useState([])
  const now = nowProp ?? new Date()

  const steps = allSteps(path)
  const today = currentStep(path, state, now)
  const saved = savedPerMonth(state)
  const left = gap ? Math.max(0, gap - saved) : null
  const doneCount = steps.filter(s => ['done', 'tried'].includes(state[s.id]?.s)).length
  const waitingCount = steps.filter(s => stepStatus(path, state, s, now) === 'parked').length
  const allDone = steps.length > 0 && doneCount === steps.length

  // Draw the trail between the node centres once they are laid out.
  const measure = useCallback(() => {
    const box = trail.current?.getBoundingClientRect()
    if (!box) return
    const pts = [...trail.current.querySelectorAll('.wayout__pnode')].map(n => {
      const r = n.getBoundingClientRect()
      return [r.left + r.width / 2 - box.left, r.top + r.height / 2 - box.top]
    })
    setSegs(pts.slice(1).map((p, k) => ({ a: pts[k], b: p, id: steps[k + 1]?.id })))
  }, [steps.length]) // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => { measure() }, [measure, state])
  useEffect(() => {
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [measure])

  const close = () => setSheet(null)
  const open = (step, view = null) => {
    const status = stepStatus(path, state, step, now)
    setSheet({ step, view: view ?? (status === 'blocked' ? 'blocked' : status === 'parked' ? 'parked'
      : ['done', 'tried'].includes(status) ? 'past' : step.wait && !state[step.id]?.s ? 'wait' : 'do') })
  }
  const update = (step, entry) => {
    const next = { ...state, [step.id]: { ...entry, at: new Date().toISOString() } }
    const part = path.parts.find(p => p.steps.some(s => s.id === step.id))
    const finished = DONE_STATES.has(entry.s) && part && !partIsFinished(part, state) && partIsFinished(part, next)
    onState(next, finished ? part.move : null)
    return next
  }

  function finish(step, amount) {
    const next = update(step, { s: 'done', ...(amount ? { saved: amount } : {}) })
    const c = cheer({ path, state: next, step, saved: amount || 0, gap, now, last: lastUsed })
    if (c.from) setLastUsed(l => ({ ...l, [c.from]: c.head }))
    const line = amount ? null : step.money ? 'Nothing changed this time, and now you know. That one is off the list.'
      : currentStep(path, next, now) ? pickFresh(DONE_LINES, lastUsed.line) : 'Every step is behind you.'
    if (line && !step.money) setLastUsed(l => ({ ...l, line }))
    celebrate()
    setSheet({ step, view: 'win', head: c.head, amount, line, total: savedPerMonth(next), badge: BADGES[doneCount % BADGES.length], next: currentStep(path, next, now) })
  }

  return (
    <div className="wayout__path">
      {/* ⭐ Desktop: the money and where you are on the left, sticky; the path
          on the right (Daniel: "layout isn't right for desktop"). On a phone
          both wrappers are display: contents, one column as before. */}
      <aside className="wayout__pside">
      {/* ⭐ ONLY WHEN MONEY IS PART OF IT (Daniel: "the money thing doesn't
          necessarily apply to every type of person"). A plan about land, a
          visa or a move has no monthly gap, and a "$0/mo" box there is noise.
          It appears when the plan names a monthly gap, or the first time they
          record money back. */}
      {(gap || saved > 0) && <div className="wayout__pgap" aria-live="polite">
        {gap ? (
          <>
            <div className="wayout__pgap-top">
              <span>Still short each month</span>
              <b className={left ? '' : 'is-closed'}>{left ? <>{money(left)}<small>/mo</small></> : 'Closed'}</b>
            </div>
            <div className="wayout__pbar"><i style={{ width: `${Math.min(100, (saved / gap) * 100)}%` }} /></div>
            <p>{left ? `Found so far: ${money(saved)} of ${money(gap)}` : `You found ${money(saved)} a month. The gap is closed.`}</p>
          </>
        ) : (
          <div className="wayout__pgap-top">
            <span>Back each month so far</span>
            <b className={saved ? 'is-closed' : ''}>{money(saved)}<small>/mo</small></b>
          </div>
        )}
      </div>}

      <h1 className="wayout__ptitle">Your path</h1>
      <p className="wayout__plede">
        Start with the glowing step, or tap any coloured one and do them in any order.
        Grey ones need another step first.
      </p>
      <p className="wayout__precord is-side">
        <b>What you have done:</b> {doneCount} of {steps.length} steps.
        {waitingCount ? ` ${waitingCount} set for later.` : ''}
        {saved ? <> <b>{money(saved)} a month</b> back, {money(saved * 12)} a year.</> : ''}
      </p>
      </aside>

      <div className="wayout__pmain">

      <div className="wayout__ptrail" ref={trail}>
        <svg className="wayout__ptrail-svg" aria-hidden="true">
          {segs.map(({ a, b, id }) => {
            const st = state[id]?.s
            const lit = st === 'done' || st === 'tried' || (id && stepStatus(path, state, steps.find(s => s.id === id), now) === 'parked')
            const my = (a[1] + b[1]) / 2
            return <path key={id} className={lit ? 'is-lit' : ''} d={`M${a[0]} ${a[1]} C ${a[0]} ${my}, ${b[0]} ${my}, ${b[0]} ${b[1]}`} />
          })}
        </svg>
        {(() => {
          let i = 0
          return path.parts.map((part, pi) => (
            <div key={part.move} className={`wayout__ppart is-${PART_COLOURS[pi % 3]}`}>
              <div className="wayout__psign">
                <b>Part {part.move}</b>
                <span>{part.title}</span>
                {/* ⭐ Opens over the path, never away from it (Daniel: "this
                    section doesn't pop up"). */}
                {onHowTo
                  ? <button type="button" className="wayout__psign-link" onClick={() => onHowTo(part.move)}>How to do this part</button>
                  : moveLink && <Link to={moveLink(part.move)}>How to do this part</Link>}
              </div>
              {part.steps.map(step => {
                const x = X[i % X.length]
                const n = ++i
                const status = stepStatus(path, state, step, now)
                const right = x > 50
                return (
                  <div key={step.id} className="wayout__prow">
                    {status === 'now' && <span className="wayout__ptoday" style={{ left: `${x}%` }}>Today</span>}
                    <button
                      type="button"
                      className={`wayout__pnode is-${status}`}
                      style={{ left: `${x}%` }}
                      onClick={() => open(step)}
                      aria-label={`Step ${n}: ${step.title}`}
                    >
                      {status === 'done' ? <Check /> : status === 'tried' ? <Arrow /> : status === 'parked' ? <Clock /> : n}
                    </button>
                    <span
                      className={`wayout__pstep is-${status}`}
                      style={right ? { right: `${100 - x + 13}%`, textAlign: 'right' } : { left: `${x + 13}%` }}
                    >
                      {step.title}
                    </span>
                  </div>
                )
              })}
            </div>
          ))
        })()}
      </div>

      {/* ⭐ THE END SAYS WHAT HAPPENS NEXT (Daniel, 31 Oct 2026: "what next
          here", on a finished path that just stopped). Straight words: did
          the money land or not, and the one thing to do now. The "how did it
          go" page is where the next plan starts from what actually happened. */}
      {allDone ? (
        <div className="wayout__pend is-finished">
          <b>You did every step</b>
          <h2>
            {gap && left
              ? `You found ${money(saved)} a month. You are still ${money(left)} a month short.`
              : gap ? `You found ${money(saved)} a month. The ${money(gap)} gap is closed.` : 'The path is done.'}
          </h2>
          <p>
            {gap && left
              ? `That is worth knowing, not a failure. Tell us what happened, and your next plan goes after the ${money(left)} from a different direction.`
              : 'Tell us how it went. Your next plan starts from where you are now, not where you started.'}
          </p>
          {doneLink && <Link className="wayout__pbtn is-go" to={doneLink}>Tell us how it went</Link>}
        </div>
      ) : headline && (
        <div className="wayout__pend">
          <b>What you are working toward</b>
          <h2>{headline}</h2>
        </div>
      )}

      <p className="wayout__precord is-main">
        <b>What you have done:</b> {doneCount} of {steps.length} steps.
        {waitingCount ? ` ${waitingCount} set for later.` : ''}
        {saved ? <> <b>{money(saved)} a month</b> back, {money(saved * 12)} a year.</> : ''}
      </p>
      </div>

      {sheet && (
        <Sheet onClose={close}>
          <SheetBody
            sheet={sheet} path={path} state={state} now={now}
            onClose={close} onOpen={open} setSheet={setSheet}
            onFinish={finish} onUpdate={update}
          />
        </Sheet>
      )}
      <Confetti />
    </div>
  )
}


function Sheet({ children, onClose }) {
  const [on, setOn] = useState(false)
  useEffect(() => { const id = requestAnimationFrame(() => setOn(true)); return () => cancelAnimationFrame(id) }, [])
  useEffect(() => {
    const esc = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])
  // 🔴 PORTALLED TO <body>. Inside the page, an ancestor with a transform (the
  // reveal animations) makes `position: fixed` relative to IT, so the sheet sat
  // at the bottom of the whole tall page, off screen, behind a dimmed scrim.
  return createPortal(
    <div className="wayout__pportal">
      <div className={`wayout__pscrim${on ? ' is-on' : ''}`} onClick={onClose} />
      <div className={`wayout__psheet${on ? ' is-on' : ''}`} role="dialog" aria-modal="true">
        <div className="wayout__pgrab" />
        {children}
      </div>
    </div>,
    document.body,
  )
}

function SheetBody({ sheet, path, state, now, onClose, onOpen, setSheet, onFinish, onUpdate }) {
  const { step, view } = sheet
  const [amount, setAmount] = useState('')
  const [bad, setBad] = useState(false)
  const back = <button type="button" className="wayout__pbtn is-soft" onClick={onClose}>Back to the path</button>
  const mins = <div className="wayout__pmeta"><span>About {step.minutes} minutes</span></div>

  if (view === 'blocked') {
    const first = blockedBy(path, state, step)
    return (
      <>
        <p className="wayout__peyebrow">One thing first</p>
        <h3>{step.title}</h3>
        {step.why && <p className="wayout__pwhy">{step.why}</p>}
        <div className="wayout__pnote"><b>This opens after</b>{first?.title}</div>
        <div className="wayout__pacts">
          {first && <button type="button" className="wayout__pbtn is-go" onClick={() => onOpen(first)}>Go to that step</button>}
          {back}
        </div>
      </>
    )
  }

  if (view === 'parked') {
    return (
      <>
        <p className="wayout__peyebrow">Comes back {step.wait?.label}</p>
        <h3>{step.title}</h3>
        {step.why && <p className="wayout__pwhy">{step.why}</p>}
        <p>Your check-in email will bring this back {step.wait?.label}. Nothing to do until then.</p>
        <div className="wayout__pacts">
          {back}
          <button type="button" className="wayout__pbtn is-soft" onClick={() => setSheet({ step, view: 'do' })}>I'm ready to do it now</button>
        </div>
      </>
    )
  }

  if (view === 'wait') {
    return (
      <>
        <p className="wayout__peyebrow">Later · {step.wait.label}</p>
        <h3>{step.title}</h3>
        {step.why && <p className="wayout__pwhy">{step.why}</p>}
        <div className="wayout__pnote"><b>Nothing to do today</b>This one comes back {step.wait.label}. Your check-in email will remind you, and the path keeps going.</div>
        <div className="wayout__pacts">
          <button type="button" className="wayout__pbtn is-go" onClick={() => { onUpdate(step, { s: 'parked', until: untilFor(step, now) }); onClose() }}>Got it, keep going</button>
        </div>
      </>
    )
  }

  if (view === 'past') {
    const st = state[step.id]
    return (
      <>
        <p className="wayout__peyebrow">{st?.s === 'tried' ? "Tried. This one couldn't change" : 'Done'}</p>
        <h3>{step.title}</h3>
        {step.why && <p className="wayout__pwhy">{step.why}</p>}
        {st?.saved ? <p><b>{money(st.saved)} a month</b> back from this one.</p> : null}
        <div className="wayout__pacts">{back}</div>
      </>
    )
  }

  if (view === 'amount') {
    const submit = e => {
      e.preventDefault()
      const n = parseAmount(amount)
      if (!n) { setBad(true); return }
      onFinish(step, n)
    }
    return (
      <>
        <p className="wayout__peyebrow">Nice. One question</p>
        <h3>What does it change each month?</h3>
        <form className="wayout__pown" onSubmit={submit} noValidate>
          <label htmlFor="wayout-path-amount">Type the amount</label>
          <div className="wayout__pown-row">
            <span>$</span>
            <input id="wayout-path-amount" inputMode="decimal" autoComplete="off" placeholder="0" value={amount}
              onChange={e => { setAmount(e.target.value); setBad(false) }} autoFocus />
            <em>a month</em>
            <button type="submit" className="wayout__pbtn is-go">Save</button>
          </div>
          {bad && <p className="wayout__perr">Type the amount in dollars, like 35.</p>}
        </form>
        <div className="wayout__ppicks">
          <button type="button" className="wayout__ppick" onClick={() => onFinish(step, 0)}>Nothing changed</button>
          <button type="button" className="wayout__ppick" onClick={() => onFinish(step, 0)}>I'm not sure yet</button>
        </div>
      </>
    )
  }

  if (view === 'later') {
    const pick = when => {
      const next = onUpdate(step, { s: 'later' })
      const other = currentStep(path, next, now)
      setSheet({ step, view: 'laterSet', when, other: other && other.id !== step.id ? other : null })
    }
    return (
      <>
        <p className="wayout__peyebrow">That's fine</p>
        <h3>When is a better time?</h3>
        <div className="wayout__ppicks">
          <button type="button" className="wayout__ppick" onClick={() => pick('tonight')}>Tonight</button>
          <button type="button" className="wayout__ppick" onClick={() => pick('this weekend')}>This weekend</button>
          <button type="button" className="wayout__ppick is-wide" onClick={() => pick('in a few days')}>In a few days</button>
        </div>
      </>
    )
  }

  if (view === 'laterSet') {
    return (
      <>
        <h3>It will be here {sheet.when}</h3>
        <p className="wayout__pwhy">
          It stays on your path, nothing lost.{sheet.other ? ' Meanwhile, here is something you can do now.' : ''}
        </p>
        <div className="wayout__pacts">
          {sheet.other && <button type="button" className="wayout__pbtn is-go" onClick={() => onOpen(sheet.other)}>Show me</button>}
          {back}
        </div>
      </>
    )
  }

  if (view === 'nope') {
    return (
      <>
        <p className="wayout__peyebrow">That's useful to know</p>
        <h3>What do you want to do?</h3>
        <p className="wayout__pwhy">Some things just can't budge. That's normal, and it isn't a step backwards.</p>
        <div className="wayout__pacts">
          {step.alt && !sheet.altShown && (
            <button type="button" className="wayout__pbtn is-go" onClick={() => setSheet({ step, view: 'alt' })}>Try another way</button>
          )}
          <button type="button" className={`wayout__pbtn ${step.alt && !sheet.altShown ? 'is-soft' : 'is-go'}`} onClick={() => {
            const next = onUpdate(step, { s: 'tried' })
            setSheet({ step, view: 'moved', next: currentStep(path, next, now) })
          }}>This can't change. Move on</button>
          <button type="button" className="wayout__pbtn is-soft" onClick={onClose}>Not now</button>
        </div>
      </>
    )
  }

  if (view === 'alt') {
    // ⚠️ The other way is shown on the same step rather than added as a new
    // one: a step id never changes, so their taps always line up with it.
    return (
      <>
        <div className="wayout__pnote"><b>The plan changed</b>Here's another way to the same result.</div>
        <h3>{step.alt.title}</h3>
        {step.alt.why && <p className="wayout__pwhy">{step.alt.why}</p>}
        <div className="wayout__pmeta"><span>About {step.alt.minutes} minutes</span></div>
        <div className="wayout__pacts">
          <button type="button" className="wayout__pbtn is-go" onClick={() => (step.money ? setSheet({ step, view: 'amount' }) : onFinish(step, 0))}>I did it</button>
          <div className="wayout__ptwo">
            <button type="button" className="wayout__pbtn is-soft" onClick={() => setSheet({ step, view: 'later' })}>Not yet</button>
            <button type="button" className="wayout__pbtn is-soft" onClick={() => setSheet({ step, view: 'nope', altShown: true })}>It didn't work</button>
          </div>
        </div>
      </>
    )
  }

  if (view === 'moved') {
    return (
      <>
        <div className="wayout__pwin">
          <div className="wayout__pburst is-sky"><Arrow /></div>
          <h3>Off the list. Moving on</h3>
          <p className="wayout__pwhy">Now you know this one is fixed. The path keeps going.</p>
        </div>
        <div className="wayout__pacts">
          {sheet.next
            ? <button type="button" className="wayout__pbtn is-go" onClick={() => onOpen(sheet.next)}>Next step</button>
            : back}
        </div>
      </>
    )
  }

  if (view === 'win') {
    const { kind, tone } = sheet.badge
    return (
      <>
        <div className="wayout__pwin">
          <div className={`wayout__pburst is-${tone}`}><Badge kind={kind} /></div>
          <h3 className="wayout__pcheer">{sheet.head}</h3>
          {sheet.amount
            ? <><div className="wayout__pbig">{money(sheet.amount)} a month</div><p>That's <b>{money(sheet.amount * 12)} a year</b> back.</p></>
            : <p className="wayout__pwhy">{sheet.line}</p>}
        </div>
        <div className="wayout__pacts">
          {sheet.next
            ? <button type="button" className="wayout__pbtn is-go" onClick={() => onOpen(sheet.next)}>Next step</button>
            : back}
        </div>
      </>
    )
  }

  // 'do': the step itself.
  const isToday = currentStep(path, state, now)?.id === step.id
  return (
    <>
      <p className="wayout__peyebrow">
        {state[step.id]?.s === 'later' ? 'You put this one off. Ready now?' : isToday ? "Today's step" : 'You can do this one any time'}
      </p>
      <h3>{step.title}</h3>
      {step.why && <p className="wayout__pwhy">{step.why}</p>}
      {mins}
      <div className="wayout__pacts">
        <button type="button" className="wayout__pbtn is-go" onClick={() => (step.money ? setSheet({ step, view: 'amount' }) : onFinish(step, 0))}>I did it</button>
        <div className="wayout__ptwo">
          <button type="button" className="wayout__pbtn is-soft" onClick={() => setSheet({ step, view: 'later' })}>Not yet</button>
          <button type="button" className="wayout__pbtn is-soft" onClick={() => setSheet({ step, view: 'nope' })}>It didn't work</button>
        </div>
      </div>
    </>
  )
}

// ── How to do a part, over the path ─────────────────────────────────────────

/**
 * ⭐⭐ THE WALKTHROUGH, AS A POP-UP OVER THE PATH (Daniel, 31 Oct 2026: "this
 * section doesn't pop up, it just keeps going through the questions, also it's
 * not on brand now"). Same model calls, same stored row as /play/:move, so a
 * how-to written here is the one the full page shows and the other way round.
 *   · questions one at a time, like the steps, then
 *   · the how-to in the path's bright style.
 * The full page stays, for the question box under a move.
 */
export function HowToSheet({ session, order, onClose, sample = null }) {
  const move = session?.map?.moves?.[order - 1]
  const [view, setView] = useState('loading')       // loading · asking · writing · play · error
  const [questions, setQuestions] = useState([])
  const [at, setAt] = useState(0)
  const [answers, setAnswers] = useState({})
  const [play, setPlay] = useState(null)
  const [stale, setStale] = useState(false)
  const [error, setError] = useState('')
  const started = useRef(false)

  useEffect(() => {
    if (started.current || !session || !move) return
    started.current = true
    // Dev preview: sample questions and how-to, no model, nothing saved.
    if (sample) { setQuestions(sample.questions); setView('asking'); return }
    wantPlaybook(session.id).catch(() => {})
    ;(async () => {
      try {
        const stored = await loadPlaybook(session.id, order)
        if (stored?.play) {
          setStale(playbookIsStale(stored, move))
          setPlay(stored.play); setView('play'); return
        }
        const qs = await generateMoveQuestions({ answers: session.answers, map: session.map, move })
        if (qs.length) { setQuestions(qs); setView('asking'); return }
        await write(null)
      } catch (err) {
        setError(humanError(err) || 'That did not come through. Try again in a moment.'); setView('error')
      }
    })()
  }, [session, order]) // eslint-disable-line react-hooks/exhaustive-deps

  async function write(asked) {
    setView('writing')
    if (sample) { setTimeout(() => { setPlay(sample.play); setView('play') }, 900); return }
    try {
      const written = await generatePlaybook({ answers: session.answers, map: session.map, move, asked })
      // ⚠️ A crisis answer is never stored, same as the full page.
      if (!written?.crisis) await savePlaybook({ sessionId: session.id, moveOrder: order, move, play: written, asked })
      setPlay(written); setView('play')
    } catch (err) {
      setError(humanError(err) || 'That did not come through. Try again in a moment.'); setView('error')
    }
  }

  let body
  if (view === 'loading' || view === 'writing') {
    body = (
      <div className="wayout__pworking">
        <div className="wayout__pspinner" aria-hidden="true" />
        <h3>{view === 'writing' ? 'Writing how to do this part' : 'One moment'}</h3>
        <p className="wayout__pwhy">{view === 'writing' ? 'What to do first, the words to use, and what usually goes wrong. Up to a minute.' : ''}</p>
      </div>
    )
  } else if (view === 'error') {
    body = (<><h3>That did not come through</h3><p className="wayout__pwhy">{error}</p>
      <div className="wayout__pacts"><button type="button" className="wayout__pbtn is-soft" onClick={onClose}>Back to the path</button></div></>)
  } else if (view === 'asking') {
    const q = questions[at]
    const last = at === questions.length - 1
    const next = () => (last ? write({ questions, answers }) : setAt(at + 1))
    body = (
      <>
        <p className="wayout__peyebrow">Part {order} · question {at + 1} of {questions.length}</p>
        <div className="wayout__pdots" aria-hidden="true">{questions.map((_, i) => <i key={i} className={i <= at ? 'is-on' : ''} />)}</div>
        <h3>{q.q}</h3>
        {q.why && <p className="wayout__pwhy">{q.why}</p>}
        {q.options?.length > 0 && (
          <div className="wayout__ppicks">
            {q.options.map(opt => (
              <button key={opt} type="button" className={`wayout__ppick is-wide${answers[at] === opt ? ' is-picked' : ''}`}
                onClick={() => setAnswers(a => ({ ...a, [at]: opt }))}>{opt}</button>
            ))}
          </div>
        )}
        <label className="wayout__pown-label" htmlFor={`wayout-howto-${at}`}>{q.options?.length ? 'Or say it in your own words' : 'Your answer'}</label>
        <textarea id={`wayout-howto-${at}`} className="wayout__ptext" rows={3} placeholder="A sentence is enough."
          value={answers[`${at}:note`] ?? ''} onChange={e => setAnswers(a => ({ ...a, [`${at}:note`]: e.target.value }))} />
        <div className="wayout__pacts">
          <button type="button" className="wayout__pbtn is-go" onClick={next}>{last ? 'Show me how' : 'Next'}</button>
          <button type="button" className="wayout__pbtn is-soft" onClick={next}>Skip this one</button>
        </div>
      </>
    )
  } else if (play?.crisis) {
    body = (
      <div className="wayout__crisis">
        {String(play.message).replace(/\*\*/g, '').split(/\n{2,}/).filter(Boolean).map((p, i) => <p key={i}>{p.trim()}</p>)}
        <CrisisHelp region={session?.answers?.region} />
      </div>
    )
  } else {
    body = <PlayView play={play} order={order} stale={stale} onClose={onClose} />
  }
  return <Sheet onClose={onClose}>{body}</Sheet>
}

function PlayView({ play, order, stale, onClose }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try { await navigator.clipboard.writeText(play.words.script); setCopied(true) } catch { /* select it by hand */ }
  }
  return (
    <div className="wayout__pplay">
      <p className="wayout__peyebrow">Part {order} · how to do it</p>
      <h3>{play.title}</h3>
      {stale && <div className="wayout__pnote"><b>Your plan changed</b>This was written before your last change. The full walkthrough page can write it again.</div>}

      {play.thisWeek?.action && (
        <div className="wayout__pfirst">
          <b>Do this first{play.thisWeek.when ? ` · ${play.thisWeek.when}` : ''}</b>
          <p>{play.thisWeek.action}</p>
          {play.thisWeek.why_first && <span>{play.thisWeek.why_first}</span>}
        </div>
      )}

      {play.words?.script && (
        <section>
          <h4>{play.words.context || 'What to say'}</h4>
          <blockquote className="wayout__pscript">{play.words.script}</blockquote>
          <button type="button" className="wayout__pcopy" onClick={copy}>{copied ? 'Copied' : 'Copy the words'}</button>
        </section>
      )}

      {play.money && (play.money.what_to_charge || play.money.how_you_know || play.money.getting_paid) && (
        <section>
          <h4>The money</h4>
          <dl className="wayout__pfacts">
            {play.money.what_to_charge && <><dt>What to charge</dt><dd>{play.money.what_to_charge}</dd></>}
            {play.money.how_you_know && <><dt>How you know</dt><dd>{play.money.how_you_know}</dd></>}
            {play.money.getting_paid && <><dt>Getting paid</dt><dd>{play.money.getting_paid}</dd></>}
          </dl>
        </section>
      )}

      {play.need_first?.length > 0 && (
        <section><h4>You need</h4><ul className="wayout__plist">{play.need_first.map((t, i) => <li key={i}>{t}</li>)}</ul></section>
      )}
      {play.dont_need_yet?.length > 0 && (
        <section><h4>Not needed yet</h4><ul className="wayout__plist is-skip">{play.dont_need_yet.map((t, i) => <li key={i}>{t}</li>)}</ul></section>
      )}

      {play.goes_wrong?.length > 0 && (
        <section>
          <h4>If something goes wrong</h4>
          {play.goes_wrong.map((g, i) => <div key={i} className="wayout__prisk"><b>{g.what}</b><span>{g.do}</span></div>)}
        </section>
      )}
      {play.check_first?.length > 0 && (
        <section>
          <h4>Check before you start</h4>
          {play.check_first.map((c, i) => <div key={i} className="wayout__prisk"><b>{c.thing}</b><span>Ask: {c.who_knows}</span></div>)}
        </section>
      )}

      {play.done_when && <div className="wayout__pdonewhen"><b>You are done when</b>{play.done_when}</div>}
      {play.opens && <section><h4>What happens next</h4><p>{play.opens}</p></section>}
      {play.disclaimer && <p className="wayout__pfine">{play.disclaimer}</p>}

      <div className="wayout__pacts">
        <button type="button" className="wayout__pbtn is-go" onClick={onClose}>Back to the path</button>
        <Link className="wayout__pbtn is-soft" to={`${WAYOUT_BASE}/play/${order}`}>Ask a question about this part</Link>
      </div>
    </div>
  )
}

// ── The celebration ─────────────────────────────────────────────────────────

let fire = null

/** Chime, haptic and a short burst of colour. Only ever from a tap. */
function celebrate() {
  tick()
  buzz()
  chime()
  fire?.()
}

let ac = null
function chime() {
  try {
    ac = ac || new (window.AudioContext || window.webkitAudioContext)()
    if (ac.state === 'suspended') ac.resume().catch(() => {})
    ;[660, 990].forEach((f, k) => {
      const o = ac.createOscillator()
      const g = ac.createGain()
      const t = ac.currentTime + 0.08 + k * 0.11
      o.type = 'sine'
      o.frequency.value = f
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(0.09, t + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35)
      o.connect(g).connect(ac.destination)
      o.start(t)
      o.stop(t + 0.4)
    })
  } catch {
    // Decoration. Never let it reach the caller.
  }
}

function Confetti() {
  const ref = useRef(null)
  useEffect(() => {
    fire = () => {
      const c = ref.current
      if (!c || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
      const x = c.getContext('2d')
      const dpr = window.devicePixelRatio || 1
      const w = window.innerWidth, h = window.innerHeight
      c.width = w * dpr; c.height = h * dpr
      x.setTransform(dpr, 0, 0, dpr, 0, 0)
      const cols = ['#1DB45A', '#FFB020', '#FF6B4A', '#2E9BF0', '#FFD84D']
      const bits = Array.from({ length: 90 }, () => ({
        x: w / 2, y: h * 0.55, vx: (Math.random() - 0.5) * 13, vy: -Math.random() * 15 - 5,
        r: Math.random() * 6, w: 6 + Math.random() * 6, h: 9 + Math.random() * 7,
        col: cols[Math.floor(Math.random() * cols.length)], spin: (Math.random() - 0.5) * 0.4,
      }))
      let t = 0
      const frame = () => {
        x.clearRect(0, 0, w, h)
        for (const b of bits) {
          b.x += b.vx; b.y += b.vy; b.vy += 0.45; b.vx *= 0.99; b.r += b.spin
          x.save(); x.translate(b.x, b.y); x.rotate(b.r); x.fillStyle = b.col
          x.fillRect(-b.w / 2, -b.h / 2, b.w, b.h); x.restore()
        }
        if (++t < 110) requestAnimationFrame(frame)
        else x.clearRect(0, 0, w, h)
      }
      frame()
    }
    return () => { fire = null }
  }, [])
  if (typeof document === 'undefined') return null   // rendered outside a browser
  return createPortal(<canvas ref={ref} className="wayout__pconfetti" aria-hidden="true" />, document.body)
}
