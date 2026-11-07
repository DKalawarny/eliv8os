import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { WAYOUT_BASE } from '../../lib/wayout/brand'
import { WAYOUT_REFERRAL_LIVE, WAYOUT_FRIEND_DISCOUNT_LABEL, WAYOUT_FRIEND_DISCOUNT_THEIR, WAYOUT_CODE_DAYS, WAYOUT_REFERRAL_SHARE_LABEL } from '../../lib/wayout/pricing'
import { claimCode, myReferral } from '../../lib/wayout/invites'

/**
 * ⭐ "OH, I CAN DO THIS" (Daniel, 7 Nov 2026: "we need to make it sell itself
 * when anyone signs up, it's a feature"). Shown on the plan the first time it
 * appears, until they open it or put it away. Not shown on a past plan or
 * after a crisis reply (the caller decides).
 * ⚠️ Money is named only once WAYOUT_REFERRAL_LIVE is on (pricing.js).
 */
const SEEN = 'wayout:invite-intro'
const seen = () => { try { return localStorage.getItem(SEEN) === 'done' } catch { return false } }
const putAway = () => { try { localStorage.setItem(SEEN, 'done') } catch { /* private mode */ } }

export function InviteIntro() {
  const [shown, setShown] = useState(() => !seen())
  if (!shown) return null
  return (
    <aside className="wayout__i2find">
      <button type="button" className="wayout__i2x" aria-label="Put this away" onClick={() => { putAway(); setShown(false) }}>×</button>
      <span className="wayout__i2seal" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="#1F2A1C" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="8" r="3.2" /><path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5" /><path d="M17 8v6M14 11h6" /></svg>
      </span>
      <div>
        <h3>{WAYOUT_REFERRAL_LIVE ? 'Give a friend half off' : 'You can invite people too'}</h3>
        <p>{WAYOUT_REFERRAL_LIVE
          ? `Know someone who feels stuck? Your link gives them ${WAYOUT_FRIEND_DISCOUNT_THEIR} of the step by step help. When they stay, you get ${WAYOUT_REFERRAL_SHARE_LABEL} of what they pay.`
          : 'Know someone who feels stuck? Send them your own link. Their plan is free, and you will see when they join.'}</p>
      </div>
      <Link className="wayout__i2go" to={`${WAYOUT_BASE}/invite`} onClick={putAway}>See how it works</Link>
    </aside>
  )
}

/**
 * ⭐ "WERE YOU INVITED?" For someone who signed up without the link (Daniel:
 * "so they don't lose out on that person financially"). Only in an account's
 * first WAYOUT_CODE_DAYS days, only if nobody is credited yet; migration 103
 * enforces both again on the server.
 */
export function InviteCodeBox() {
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    let live = true
    ;(async () => {
      try {
        const [{ data }, ref] = await Promise.all([supabase.auth.getUser(), myReferral()])
        const made = data?.user?.created_at ? new Date(data.user.created_at) : null
        const young = made && Date.now() - made.getTime() < WAYOUT_CODE_DAYS * 86400000
        if (live) setOpen(Boolean(young && !ref))
      } catch { /* the plan matters more */ }
    })()
    return () => { live = false }
  }, [])

  async function add(e) {
    e.preventDefault()
    if (!code.trim()) return
    setBusy(true); setMsg('')
    try {
      const out = await claimCode(code)
      if (out === 'ok') { setDone(true); setMsg(WAYOUT_REFERRAL_LIVE ? 'Done. Your discount is on your account.' : 'Done. They will see that you joined.') }
      else if (out === 'own') setMsg('That is your own code. Send it to someone else.')
      else if (out === 'already') { setDone(true); setMsg('You are already linked to someone who invited you.') }
      else if (out === 'too_late') setMsg(`A code can only be added in an account’s first ${WAYOUT_CODE_DAYS} days.`)
      else setMsg('That code was not found. Check the letters and try again.')
    } catch (err) { setMsg(err.message) }
    finally { setBusy(false) }
  }

  if (!open) return null
  return (
    <div className="wayout__i2codebox">
      <b>{WAYOUT_REFERRAL_LIVE ? 'Have a friend’s code?' : 'Were you invited?'}</b>
      <p>{WAYOUT_REFERRAL_LIVE
        ? `Enter it for ${WAYOUT_FRIEND_DISCOUNT_LABEL} of the step by step help.`
        : 'If someone sent you here and you signed up another way, enter their code so they know you joined.'}</p>
      {!done && (
        <form className="wayout__i2row" onSubmit={add}>
          <input id="wayout-invite-code" className="wayout__input" value={code} maxLength={20} placeholder="DANNY-4F2" aria-label="Their code" onChange={e => setCode(e.target.value)} />
          <button type="submit" className="wayout__i2btn" disabled={busy || !code.trim()}>Add</button>
        </form>
      )}
      {msg && <p role="status" className="wayout__i2fine">{msg}</p>}
    </div>
  )
}
