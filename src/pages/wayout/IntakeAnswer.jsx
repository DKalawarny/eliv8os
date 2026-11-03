import { useState } from 'react'
import { Dictate } from './fields'
import { currencyFor } from '../../lib/wayout/currency'

/**
 * One question's answer area, in the one-question-per-screen design (2 Nov
 * 2026). Used by the questions page (Intake.jsx) and its test page.
 *   choice     big buttons; a tap answers and moves on (onPick)
 *   chips      tap any, "+ Add your own" where allowed, exclusive options clear the rest
 *   score      ONE item of a 1 to 10 field (`item`); a tap answers and moves on
 *   number     money, in their country's currency
 *   shorttext / text   with the microphone where the field allows it
 */
// Savings is a pot, not a monthly amount; only these get "a month".
const MONTHLY = new Set(['takeHome', 'mustPay', 'householdTakeHome', 'housingCost'])

export function Answer({ field, item, value, set, region, onPick, onEnter }) {
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

  // ⭐ Talk instead of type, where the old page offered it (Daniel: "add a talk
  // to text on the written question parts"). Only on fields marked `dictate`.
  const mic = field.dictate ? <Dictate value={value} onChange={set} label={field.label} /> : null

  if (field.kind === 'shorttext') {
    return (
      <div className="wayout__q2mic">
        <input className="wayout__q2field" value={value ?? ''} placeholder={field.placeholder ?? ''} autoFocus
          onChange={e => set(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') onEnter() }} />
        {mic}
      </div>
    )
  }

  return (
    <div className="wayout__q2mic">
      <textarea className="wayout__q2field is-long" value={value ?? ''} placeholder={field.placeholder ?? 'A sentence is enough.'}
        onChange={e => set(e.target.value)} />
      {mic}
    </div>
  )
}
