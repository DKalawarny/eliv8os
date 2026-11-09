import { useEffect, useState } from 'react'
import { hasEliv8Business, latestHandoff, saveHandoff, draftFromUnstuck } from '../../lib/handoffs'
import { currencyFor } from '../../lib/wayout/currency'

/**
 * ⭐ The shared summary, Unstuck Map side (6 Oct 2026). Two quiet cards:
 *  - "Share a few lines with Eliv8 OS": only for someone who runs a business
 *    there. A draft from their own answers, which they edit; only the box is
 *    shared, only with them, only when they press the button.
 *  - "From your business": what they shared from Eliv8 OS, with one button that
 *    tells their plan, through the same "something changed" route as anything
 *    else they say. Their words, so provenance holds.
 * ⚠️ No dashes; never "it" for the product; never implies a person reads it.
 */
export default function Handoff({ answers = {}, onTell }) {
  const [owner, setOwner] = useState(false)
  const [text, setText] = useState('')
  const [shared, setShared] = useState(null)
  const [fromBiz, setFromBiz] = useState(null)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    ;(async () => {
      const [isOwner, mine, biz] = await Promise.all([hasEliv8Business(), latestHandoff('unstuck'), latestHandoff('eliv8')])
      if (!live) return
      setOwner(isOwner)
      setShared(mine)
      setText(mine?.body ?? draftFromUnstuck(answers, currencyFor(answers.region).symbol))
      setFromBiz(biz)
    })()
    return () => { live = false }
  }, [answers])

  async function share() {
    setBusy(true); setMsg('')
    try { await saveHandoff('unstuck', text); setShared({ body: text }); setMsg('Shared. Only these lines were sent. You can change them any time.') }
    catch (e) { setMsg(e.message) }
    finally { setBusy(false) }
  }

  if (!owner && !fromBiz) return null
  return (
    <>
      {fromBiz && onTell && (
        <aside className="wayout__bridge wayout__r">
          <span className="wayout__offerkick">From your business on Eliv8 OS</span>
          <p>“{fromBiz.body}”</p>
          <button type="button" className="wayout__again" onClick={() => onTell(fromBiz.body)}>Add this to my plan</button>
        </aside>
      )}
      {owner && (
        // ⭐ CLOSED UNTIL THEY WANT IT (Daniel, 9 Nov 2026: "this should be a
        // drop down and it should say if you have a business"). The heading
        // says who it is for; the box only opens when they ask.
        <details className="wayout__bridge wayout__handofffold wayout__r">
          <summary>Have a business on Eliv8 OS? Share a few lines from this plan with it</summary>
          <p>Only what is in this box goes across, and only to you on Eliv8 OS. Nothing else from your plan is shared, and nobody else on your business account can see it.</p>
          <textarea className="wayout__handoffbox" rows={3} value={text} maxLength={1200} onChange={e => setText(e.target.value)} />
          <button type="button" className="wayout__again" disabled={busy || text.trim().length < 3} onClick={share}>
            {shared ? 'Update what is shared' : 'Share these lines'}
          </button>
          {msg && <p role="status">{msg}</p>}
        </details>
      )}
    </>
  )
}
