import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import WayoutShell from './WayoutShell'
import { WAYOUT_OPENING, WAYOUT_SCREENS, WAYOUT_OPEN } from '../../content/wayoutIntake'
import { plainField } from '../../content/wayoutIntakePlain'
import { isAnswered, isThin } from '../../lib/wayout/validate'
import { currencyFor } from '../../lib/wayout/currency'
import { tick, buzz } from '../../lib/wayout/feedback'

/**
 * ⭐ TEST PAGE for the redesigned questions (/questions-test), Daniel, 2 Nov
 * 2026: "the intake is super messy", "let's audit this whole section and do a
 * redesign again maybe taking a bit from Duolingo", then "let's see in test
 * page".
 *
 * The REAL questions (wayoutIntake.js: every field, option key, condition and
 * required rule) with the plain wording laid over them (wayoutIntakePlain.js),
 * shown one question per screen like the path:
 *   · a tap on a single choice moves on by itself
 *   · the 1 to 10 scores come one item at a time
 *   · "Your answers" is a small button, not a third of the screen
 *
 * 🔴 NOTHING IS SAVED. No session, no draft, no plan. It is safe to try with a
 * real account. When he approves, this becomes /questions and saves as the old
 * page does.
 */
const FIELDS = [WAYOUT_OPENING.field, ...WAYOUT_SCREENS.flatMap(s => s.fields), WAYOUT_OPEN.field].map(plainField)

/** The screens for these answers: hidden questions left out, each score item its own screen. */
function screensFor(answers) {
  return FIELDS
    .filter(f => !f.showIf || f.showIf(answers))
    .flatMap(f => (f.kind === 'score' ? f.options.map((_, i) => ({ field: f, item: i })) : [{ field: f }]))
}

const optionLabel = (field, v) => {
  const all = [...(field.options ?? []), ...(field.groups ?? []).flatMap(g => g.options)]
  return all.find(o => o.key === v)?.label ?? v
}
function answerText(field, v, region) {
  if (v == null || v === '' || (Array.isArray(v) && !v.length)) return ''
  if (field.kind === 'chips') return v.map(x => x.label ?? optionLabel(field, x.key ?? x)).join(', ')
  if (field.kind === 'choice') return optionLabel(field, v)
  if (field.kind === 'score') return Object.entries(v).map(([k, n]) => `${optionLabel(field, k)}: ${n}`).join(' · ')
  if (field.kind === 'number') return `${currencyFor(region).symbol}${Number(v).toLocaleString('en-US')}`
  return String(v)
}

export default function IntakeTest() {
  const [answers, setAnswers] = useState({})
  const [at, setAt] = useState(0)
  const [err, setErr] = useState('')
  const [nudge, setNudge] = useState('')
  const [drawer, setDrawer] = useState(null)        // 'answers' · 'all'
  const [done, setDone] = useState(false)
  const nudged = useRef(new Set())

  const screens = useMemo(() => screensFor(answers), [answers])
  const screen = screens[Math.min(at, screens.length - 1)]
  const { field, item } = screen
  const value = answers[field.key]
  const set = v => { setAnswers(a => ({ ...a, [field.key]: v })); setErr(''); setNudge('') }

  useEffect(() => { window.scrollTo({ top: 0 }) }, [at, done])

  function go(next = at + 1) {
    setErr(''); setNudge('')
    if (next >= screens.length) { setDone(true); return }
    setAt(next)
  }
  function onNext() {
    if (!isAnswered(field, value)) {
      setErr(field.emptyMessage || (field.kind === 'chips' ? 'Tap at least one.' : 'A few words is enough.'))
      return
    }
    // The same one-time nudge as the real page: a very short answer gets one
    // "a bit more?", and pressing Next again goes on.
    if (isThin(field, value) && !nudged.current.has(field.key)) {
      nudged.current.add(field.key)
      setNudge(field.nudgeMessage || 'A little more here makes the plan fit you better. Press Next again if that is everything.')
      return
    }
    tick(); go()
  }
  const back = () => { setDone(false); if (at > 0) go(at - 1) }

  const answered = FIELDS.filter(f => (!f.showIf || f.showIf(answers)) && answerText(f, answers[f.key], answers.region))
  const pct = done ? 100 : Math.round((at / screens.length) * 100)

  let body
  if (done) {
    body = (
      <div className="wayout__q2screen wayout__q2end">
        <div className="wayout__q2burst" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
        </div>
        <h1>That’s everything{answers.name ? `, ${answers.name}` : ''}.</h1>
        <p className="wayout__q2hint">On the real page, this is where your plan gets built. This is the test page, so nothing was saved.</p>
        <div className="wayout__q2acts">
          <button type="button" className="wayout__q2go" onClick={() => setDrawer('answers')}>See your answers</button>
          <button type="button" className="wayout__q2skip" onClick={() => { setAnswers({}); setAt(0); setDone(false); nudged.current = new Set() }}>Start again</button>
        </div>
      </div>
    )
  } else {
    body = (
      <div className="wayout__q2screen" key={`${field.key}:${item ?? ''}`}>
        <p className="wayout__q2kicker">{field.kicker}</p>
        <h1>{field.label}</h1>
        {field.hint && <p className="wayout__q2hint">{field.hint}</p>}
        <Answer field={field} item={item} value={value} set={set} region={answers.region}
          onPick={() => { tick(); buzz(); setTimeout(() => go(), 260) }} onEnter={onNext} />
        {err && <p className="wayout__q2err" role="alert">{err}</p>}
        {nudge && <p className="wayout__q2nudge" role="status">{nudge}</p>}
      </div>
    )
  }

  const autoMoves = field.kind === 'choice' || field.kind === 'score'
  return (
    <WayoutShell title="Questions (test)" wide>
      <div className="wayout__q2">
        <p className="wayout__q2test">Test page · nothing is saved · <button type="button" onClick={() => setDrawer('all')}>All questions</button></p>
        <div className="wayout__q2top">
          <button type="button" className="wayout__q2back" onClick={back} disabled={at === 0 && !done} aria-label="Back">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M15 5l-7 7 7 7" /></svg>
          </button>
          <div className="wayout__q2bar" aria-hidden="true"><i style={{ width: `${pct}%` }} /></div>
          <button type="button" className="wayout__q2pill" onClick={() => setDrawer('answers')}>Your answers <b>{answered.length}</b></button>
        </div>

        {body}

        {!done && (
          <div className="wayout__q2acts">
            {!autoMoves && (
              <button type="button" className="wayout__q2go" onClick={onNext}>
                {field.key === 'story' ? 'See my plan' : 'Next'}
              </button>
            )}
            {(!field.required || field.kind === 'score') && (
              <button type="button" className="wayout__q2skip" onClick={() => go()}>{field.kind === 'score' ? 'Skip this one' : 'Skip'}</button>
            )}
          </div>
        )}
      </div>

      {drawer && createPortal(
        <div className="wayout__pportal wayout__q2portal">
          <div className="wayout__q2scrim" onClick={() => setDrawer(null)} />
          <aside className="wayout__q2drawer" aria-label={drawer === 'all' ? 'All questions' : 'Your answers'}>
            <button type="button" className="wayout__q2close" onClick={() => setDrawer(null)}>Close</button>
            {drawer === 'answers' ? (
              <>
                <h2>Your answers</h2>
                <p className="wayout__q2hint">What your plan would be built from. It fills in as you go.</p>
                {answered.length ? answered.map(f => (
                  <div key={f.key} className="wayout__q2row"><b>{f.label}</b><p>{answerText(f, answers[f.key], answers.region)}</p></div>
                )) : <p className="wayout__q2hint">Nothing yet.</p>}
              </>
            ) : (
              <>
                <h2>All questions</h2>
                <p className="wayout__q2hint">{screens.length} screens for your answers so far. Some only appear when they apply. Tap one to go to it.</p>
                {screens.map((s, i) => (s.item ? null : (
                  <div key={s.field.key} className="wayout__q2row">
                    <b>{i + 1} · {s.field.kicker}</b>
                    <button type="button" onClick={() => { setDrawer(null); setDone(false); go(i) }}>{s.field.label}</button>
                  </div>
                )))}
              </>
            )}
          </aside>
        </div>,
        document.body,
      )}
    </WayoutShell>
  )
}

// Savings is a pot, not a monthly amount; only these get "a month".
const MONTHLY = new Set(['takeHome', 'mustPay', 'householdTakeHome', 'housingCost'])

function Answer({ field, item, value, set, region, onPick, onEnter }) {
  const [custom, setCustom] = useState('')
  const [adding, setAdding] = useState(false)

  if (field.kind === 'choice') {
    return (
      <div className="wayout__q2opts">
        {field.options.map(o => (
          <button key={o.key} type="button" className={`wayout__q2opt${value === o.key ? ' is-on' : ''}`}
            onClick={() => { set(o.key); onPick() }}>{o.label}</button>
        ))}
      </div>
    )
  }

  if (field.kind === 'score') {
    const opt = field.options[item]
    const scores = value ?? {}
    return (
      <div className="wayout__q2score">
        <p className="wayout__q2of">{item + 1} of {field.options.length}</p>
        <p className="wayout__q2item">{opt.label}</p>
        <div className="wayout__q2scale">
          {Array.from({ length: 10 }, (_, i) => i + 1).map(n => (
            <button key={n} type="button" className={scores[opt.key] === n ? 'is-on' : ''}
              onClick={() => { set({ ...scores, [opt.key]: n }); onPick() }}>{n}</button>
          ))}
        </div>
        <div className="wayout__q2ends"><span>Not important</span><span>Very important</span></div>
      </div>
    )
  }

  if (field.kind === 'chips') {
    const picked = Array.isArray(value) ? value : []
    const on = k => picked.some(x => (x.key ?? x) === k)
    const exclusive = new Set([...(field.options ?? []), ...(field.groups ?? []).flatMap(g => g.options)].filter(o => o.exclusive).map(o => o.key))
    const toggle = o => {
      if (on(o.key)) return set(picked.filter(x => (x.key ?? x) !== o.key))
      if (o.exclusive) return set([{ key: o.key, label: o.label }])
      set([...picked.filter(x => !exclusive.has(x.key ?? x)), { key: o.key, label: o.label }])
    }
    const chips = opts => (
      <div className="wayout__q2chips">
        {opts.map(o => <button key={o.key} type="button" className={`wayout__q2chip${on(o.key) ? ' is-on' : ''}`} onClick={() => toggle(o)}>{o.label}</button>)}
      </div>
    )
    const mine = picked.filter(x => x.custom)
    return (
      <>
        {field.groups
          ? field.groups.map(g => <div key={g.label} className="wayout__q2group"><h3>{g.label}</h3>{chips(g.options)}</div>)
          : chips(field.options)}
        {mine.length > 0 && (
          <div className="wayout__q2chips" style={{ marginTop: 10 }}>
            {mine.map(x => <button key={x.key} type="button" className="wayout__q2chip is-on" onClick={() => set(picked.filter(y => y.key !== x.key))}>{x.label} ×</button>)}
          </div>
        )}
        {field.allowCustom && (adding ? (
          <form className="wayout__q2add" onSubmit={e => {
            e.preventDefault()
            const label = custom.trim()
            if (label) set([...picked.filter(x => !exclusive.has(x.key ?? x)), { key: `custom-${label.toLowerCase()}`, label, custom: true }])
            setCustom(''); setAdding(false)
          }}>
            <input className="wayout__q2field" autoFocus value={custom} onChange={e => setCustom(e.target.value)} placeholder="Type it here" />
            <button type="submit" className="wayout__q2go">Add</button>
          </form>
        ) : <button type="button" className="wayout__q2chip is-add" onClick={() => setAdding(true)}>+ Add your own</button>)}
      </>
    )
  }

  if (field.kind === 'number') {
    return (
      <div className="wayout__q2money">
        <span>{currencyFor(region).symbol}</span>
        <input inputMode="decimal" placeholder="0" value={value ?? ''} autoFocus
          onChange={e => set(e.target.value.replace(/[^0-9.]/g, ''))}
          onKeyDown={e => { if (e.key === 'Enter') onEnter() }} />
        {MONTHLY.has(field.key) && <em>a month</em>}
      </div>
    )
  }

  if (field.kind === 'shorttext') {
    return (
      <input className="wayout__q2field" value={value ?? ''} placeholder={field.placeholder ?? ''} autoFocus
        onChange={e => set(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') onEnter() }} />
    )
  }

  return (
    <textarea className="wayout__q2field is-long" value={value ?? ''} placeholder={field.placeholder ?? 'A sentence is enough.'}
      onChange={e => set(e.target.value)} />
  )
}
