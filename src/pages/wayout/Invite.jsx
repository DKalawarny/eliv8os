import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import WayoutShell from './WayoutShell'
import { Confirm } from './PlanThread'
import { WAYOUT_BASE } from '../../lib/wayout/brand'
import { WAYOUT_REFERRAL_LIVE, WAYOUT_FRIEND_DISCOUNT_LABEL, WAYOUT_FRIEND_DISCOUNT_THEIR, WAYOUT_CODE_DAYS, WAYOUT_REFERRAL_SHARE_LABEL, WAYOUT_REFERRAL_ANNOUNCED, referralLine } from '../../lib/wayout/pricing'
import { inviteParts, joinInvite } from '../../lib/wayout/shareText'
import {
  myInvites, myInvite, setShowName, createInvite, deleteInvite, inviteUrl, inviteTotals, friendStage,
  myReferral, answerReferral, claimInvite,
} from '../../lib/wayout/invites'

/**
 * ⭐⭐ GIVE A FRIEND A HEAD START (7 Nov 2026; mock-up
 * https://claude.ai/artifact/PeiGpPZDz9yq9B5LrwNMjU).
 *
 * Daniel: "we need to make it sell itself when anyone signs up, it's a feature
 * like oh I can do this", then "it gives me a bit of a pyramid feel", so the
 * friend's discount leads and the inviter's share is a quiet thank you.
 *
 * ⚠️ Every line that names money waits for WAYOUT_REFERRAL_LIVE (pricing.js):
 * until payments are live there is nothing to discount and nothing to share,
 * so the page is about inviting and seeing who joined. Once live, the share
 * is shown as the number, 20% (Daniel, 7 Nov: "ya show the 20%").
 * 🔴 A friend's name shows only when that friend said yes (InviteConsent.jsx).
 * ⚠️ No "one level", "not a job" or other scheme-talk here: those rules live
 * in the terms. No dashes in copy.
 */
export default function Invite() {
  const [invites, setInvites] = useState(null)
  const [mine, setMine] = useState(null)
  const [error, setError] = useState('')
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [copied, setCopied] = useState('')
  const [ref, setRef] = useState(null)
  const [doomed, setDoomed] = useState(null)
  // Their own words for the top of the message, kept in this browser.
  const [intro, setIntro] = useState(() => { try { return localStorage.getItem('wayout:invite-intro-text') } catch { return null } })

  const load = useCallback(async () => {
    try {
      // A friend can land here before ever opening their plan; credit them now.
      await claimInvite()
      const m = await myInvite()
      const [list, r] = await Promise.all([myInvites(), myReferral()])
      setMine(m); setInvites(list); setRef(r)
    } catch (e) { setError(e.message) }
  }, [])
  useEffect(() => { const t = setTimeout(load, 0); return () => clearTimeout(t) }, [load])

  async function copy(text, what) {
    try { await navigator.clipboard.writeText(text); setCopied(what) }
    catch { setNote(`Copy this: ${text}`) }
  }
  async function share(text) {
    try {
      if (navigator.share) { await navigator.share({ text }); return }
      await copy(text, 'message')
    } catch (e) { if (e?.name !== 'AbortError') setNote('That did not open. Copy the message instead.') }
  }
  async function toggleName(show) {
    try { await setShowName(show); setMine(m => ({ ...m, show_name: show })) } catch (e) { setNote(e.message) }
  }
  async function changeShow(show) {
    try { await answerReferral(show); setRef({ ...ref, show, answered: true }) } catch (e) { setNote(e.message) }
  }

  if (error) return <WayoutShell><p className="wayout__lead">{error}</p></WayoutShell>
  if (!invites) return <WayoutShell wide><p className="wayout__lead">One moment.</p></WayoutShell>

  const totals = inviteTotals(invites)
  const mainUrl = mine?.code ? inviteUrl(mine.code) : ''
  const parts = mainUrl ? inviteParts(mainUrl, mine?.short) : { intro: '', locked: '' }
  const introText = intro ?? parts.intro
  const saveIntro = t => { setIntro(t); try { localStorage.setItem('wayout:invite-intro-text', t) } catch { /* private mode */ } }
  // ⭐ ONE PLACE TO SEND FROM (Daniel, 7 Nov: two kinds of link were "confusing").
  // A name in the box gets that person their own link, so you see when they
  // join; no name uses your main link.
  async function sendTo(how) {
    setBusy(true); setNote('')
    try {
      const who = label.trim()
      const url = who ? inviteUrl(await createInvite(who)) : mainUrl
      const text = joinInvite(introText, inviteParts(url, mine?.short).locked)
      if (how === 'copy') await copy(text, 'message'); else await share(text)
      if (who) { setLabel(''); setNote(`${who} has their own link in that message. You will see here when they join.`); await load() }
    } catch (err) { setNote(err.message) }
    finally { setBusy(false) }
  }
  const people = invites.flatMap(i => {
    const joined = (i.friends ?? []).map(f => ({ ...f, from: i.label, stage: friendStage(f) }))
    if (!i.is_main && !joined.length) return [{ waiting: true, label: i.label, code: i.code, opened: i.opened, at: i.created_at }]
    return joined.map(f => ({ ...f, code: i.is_main ? null : i.code }))
  })

  return (
    <WayoutShell title={WAYOUT_REFERRAL_LIVE ? 'Give a friend a head start' : 'Invite people'} wide>
      <div className="wayout__inv2">
        <p className="wayout__crumb"><Link to={`${WAYOUT_BASE}/plan`}>← Back to your plan</Link></p>

        <header className="wayout__i2hero">
          <span className="wayout__i2kick">{WAYOUT_REFERRAL_LIVE ? 'Give a friend a head start' : 'Invite people'}</span>
          <h1>
            {WAYOUT_REFERRAL_LIVE
              ? <>Give someone who feels stuck <span className="wayout__i2hl">half off</span></>
              : WAYOUT_REFERRAL_ANNOUNCED
                ? <>Invite a friend. They get half off, <span className="wayout__i2hl">you get {WAYOUT_REFERRAL_SHARE_LABEL}</span></>
                : <>Know someone who feels <span className="wayout__i2hl">stuck</span>?</>}
          </h1>
          <p>
            {WAYOUT_REFERRAL_LIVE
              ? `Their plan is free. Your link or code gives them ${WAYOUT_FRIEND_DISCOUNT_THEIR} of the step by step help. When they stay, you get ${WAYOUT_REFERRAL_SHARE_LABEL} of what they pay.`
              : WAYOUT_REFERRAL_ANNOUNCED
                ? `Send them your link. Their plan is free. ${referralLine(false)}`
                : 'Send them your link. Their plan is free, and you will see here when they join.'}
          </p>
        </header>

        <ol className="wayout__i2steps">
          <li className="is-1"><i>1</i><b>Send your link or code</b><span>Text it, post it, or tell them your code out loud.</span></li>
          {WAYOUT_REFERRAL_LIVE || WAYOUT_REFERRAL_ANNOUNCED ? (
            <>
              <li className="is-2"><i>2</i><b>They get half off</b><span>Their plan is free, and their first month of step by step help is half price.</span></li>
              <li className="is-3"><i>3</i><b>You get {WAYOUT_REFERRAL_SHARE_LABEL}</b><span>Of what they pay, from their second month, for as long as they stay.</span></li>
            </>
          ) : (
            <>
              <li className="is-2"><i>2</i><b>They make their free plan</b><span>Their answers and their plan stay private to them.</span></li>
              <li className="is-3"><i>3</i><b>You see they joined</b><span>And, if they say yes, their first name.</span></li>
            </>
          )}
        </ol>
        {!WAYOUT_REFERRAL_LIVE && WAYOUT_REFERRAL_ANNOUNCED && (
          <p className="wayout__i2soon">The discount and your {WAYOUT_REFERRAL_SHARE_LABEL} start when paid plans open. Friends who join before then still count.</p>
        )}

        {mine?.code && (
          <section className="wayout__i2card is-sky">
            <h2>Send it to someone</h2>
            <label className="wayout__i2label" htmlFor="wayout-invite-label">Who is it for? Optional, only you see it</label>
            <input id="wayout-invite-label" className="wayout__input" value={label} maxLength={40} placeholder="For example: Mike from church" onChange={e => setLabel(e.target.value)} />
            <p className="wayout__i2fine" style={{ marginTop: 4 }}>Add a name and they get their own link, so you can see when they join.</p>
            <label className="wayout__i2label" htmlFor="wayout-invite-intro">Your message</label>
            <textarea id="wayout-invite-intro" className="wayout__i2edit" rows={3} maxLength={600} value={introText} onChange={e => saveIntro(e.target.value)} />
            {intro != null && intro !== parts.intro && (
              <button type="button" className="wayout__i2quiet" onClick={() => { setIntro(null); try { localStorage.removeItem('wayout:invite-intro-text') } catch { /* private mode */ } }}>Go back to our wording</button>
            )}
            <p className="wayout__i2lockedhead">Added underneath, so it counts and they know you get something</p>
            <blockquote className="wayout__i2locked">{label.trim() ? parts.locked.replace(mainUrl, `(${label.trim()}’s own link)`) : parts.locked}</blockquote>
            <div className="wayout__i2row">
              <button type="button" className="wayout__i2btn" disabled={busy} onClick={() => sendTo('share')}>{label.trim() ? `Send to ${label.trim()}` : 'Send the message'}</button>
              <button type="button" className="wayout__i2quiet" disabled={busy} onClick={() => sendTo('copy')}>{copied === 'message' ? 'Copied' : 'Copy it'}</button>
            </div>
            {note && <p role="status" className="wayout__i2fine">{note}</p>}

            <div className="wayout__i2or">
              <p>Or share your link anywhere, like a post or a group chat:</p>
              <div className="wayout__i2link">
                <code>{mainUrl.replace(/^https?:\/\//, '').replace(/&utm_source=invite$/, '')}</code>
                <button type="button" onClick={() => copy(mainUrl, 'link')}>{copied === 'link' ? 'Copied' : 'Copy'}</button>
              </div>
              {mine.short && (
                <p className="wayout__i2code">
                  Your code: <b>{mine.short}</b>{' '}
                  {WAYOUT_REFERRAL_LIVE ? 'They type it when they sign up to get their discount.' : `If they forgot the link, they can type it in their first ${WAYOUT_CODE_DAYS} days.`}
                </p>
              )}
            </div>
            <label className="wayout__i2toggle">
              <input id="wayout-show-name" type="checkbox" checked={mine.show_name !== false} onChange={e => toggleName(e.target.checked)} />
              Show my first name to people who open my link
            </label>
            <p className="wayout__i2fine">Opened {totals.opened} {totals.opened === 1 ? 'time' : 'times'} so far.</p>
          </section>
        )}


        {people.length > 0 && (
          <section className="wayout__i2people">
            <h2>People you invited</h2>
            <ul>
              {people.map((p, n) => {
                const stage = p.waiting ? (p.opened ? 'Opened' : 'Sent') : p.stage
                const lit = p.waiting ? (p.opened ? 1 : 0) : stage === 'Joined' ? 2 : 3
                return (
                  <li key={`${p.code ?? 'main'}-${n}`}>
                    <div>
                      <b>{p.waiting ? p.label : (p.name || (p.from ? p.from : 'Someone'))}</b>
                      <small>
                        {p.waiting
                          ? (p.opened ? 'Opened your link, not joined yet' : 'Has not opened the link yet')
                          : p.name ? `Shared their name with you${p.from ? ` · your link “${p.from}”` : ''}` : (p.from ? 'Joined from their link' : 'Joined from your link, kept their name private')}
                      </small>
                    </div>
                    <span className="wayout__i2trail" aria-hidden="true"><i className={lit > 0 ? 'on' : ''} /><i className={lit > 1 ? 'on' : ''} /><i className={lit > 2 ? 'on' : ''} /></span>
                    <span className={`wayout__i2pill is-${stage.toLowerCase().replace(/\s+/g, '-')}`}>{stage}</span>
                    {p.waiting && <button type="button" className="wayout__i2quiet" onClick={() => setDoomed(p)}>Delete</button>}
                  </li>
                )
              })}
            </ul>
          </section>
        )}

        <div className="wayout__i2thanks">
          <div>
            <b>Your thank you</b>
            <span>{WAYOUT_REFERRAL_LIVE
              ? `$0 so far. ${WAYOUT_REFERRAL_SHARE_LABEL} of what each friend pays, from their second month, for as long as they stay.`
              : `Nothing to pay or earn yet. When paid plans open, you will get ${WAYOUT_REFERRAL_SHARE_LABEL} of what the people you invited pay, from their second month. The details will be here first.`}</span>
          </div>
        </div>

        {ref && (
          <section className="wayout__i2card">
            <h2>{ref.from ? `${ref.from} sent you here` : 'Someone sent you here'}</h2>
            <p>{ref.show ? `${ref.from || 'They'} can see your first name and whether you have made a plan.` : 'They cannot see that you joined.'}</p>
            <button type="button" className="wayout__i2quiet" onClick={() => changeShow(!ref.show)}>
              {ref.show ? 'Keep it private instead' : 'Let them see'}
            </button>
          </section>
        )}
      </div>

      <Confirm
        open={Boolean(doomed)}
        title={doomed ? `Delete the link for ${doomed.label}?` : ''}
        body="Anyone who joins from it later will not show here."
        yes="Delete it"
        onYes={async () => { const d = doomed; setDoomed(null); try { await deleteInvite(d.code); await load() } catch (e) { setNote(e.message) } }}
        onNo={() => setDoomed(null)}
      />
    </WayoutShell>
  )
}
