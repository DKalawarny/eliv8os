import { useEffect, useState } from 'react'
import { shareDraft, movesBlock, SHARE_URL } from '../../lib/wayout/shareText'
import { mainInviteCode, inviteUrl } from '../../lib/wayout/invites'

/**
 * ⭐ "Send this to someone" (17 Oct 2026). A draft from their three move
 * titles with every money figure already out, in a box they edit. Nothing is
 * published and nothing leaves until they press the button. See shareText.js.
 * ⚠️ No dashes; never "it" for the product; no talk of earning money here.
 */
export default function ShareCard({ map, movesDone = 0 }) {
  const [text, setText] = useState(() => shareDraft(map))
  const [edited, setEdited] = useState(false)
  const [url, setUrl] = useState(SHARE_URL)
  const [withMoves, setWithMoves] = useState(false)

  // ⭐ Their own link, so a friend who joins shows up on /invite. Swapped in
  // only if they have not started editing; the plain link works either way.
  useEffect(() => {
    let live = true
    mainInviteCode().then(code => {
      if (!live || !code) return
      setUrl(inviteUrl(code))
      if (!edited) setText(shareDraft(map, inviteUrl(code)))
    })
    return () => { live = false }
  }, [map]) // eslint-disable-line react-hooks/exhaustive-deps
  const [msg, setMsg] = useState('')

  async function send() {
    setMsg('')
    try {
      if (navigator.share) { await navigator.share({ text }); return }
      await navigator.clipboard.writeText(text)
      setMsg('Copied. Paste it into a text or a message.')
    } catch (e) {
      // Closing the phone's share sheet is a choice, not a failure.
      if (e?.name !== 'AbortError') setMsg('That did not copy. You can select the text above and copy it yourself.')
    }
  }

  // Their moves go in only when they ask. Edits they made are kept: the moves
  // are added to what is there, not written over it.
  function addMoves() {
    setWithMoves(true)
    setText(t => (edited ? `${t.trim()}\n\n${movesBlock(map)}` : shareDraft(map, url, { withMoves: true })))
  }
  if (!map?.moves?.length) return null
  return (
    <aside className="wayout__bridge wayout__r">
      {/* ⭐ The best moment to ask is right after something worked: a ticked
          move is the closest thing this product has to proof. */}
      <span className="wayout__offerkick">{movesDone > 0 ? 'You got a move done. Know someone stuck where you were?' : 'Know someone who feels stuck too?'}</span>
      <p>
        {withMoves
          ? 'Only what is in this box goes. Your move titles are in it now, with every number taken out. Change anything you like first.'
          : 'Send them a link to make their own plan. Only what is in this box goes, and nothing from your plan is in it. Change anything you like first.'}
      </p>
      <textarea className="wayout__handoffbox" rows={5} value={text} maxLength={1200} onChange={e => { setEdited(true); setText(e.target.value) }} />
      <p className="wayout__planactions">
        <button type="button" className="wayout__again" disabled={text.trim().length < 3} onClick={send}>Send to someone</button>
        {!withMoves && <button type="button" className="wayout__again" onClick={addMoves}>Add my three moves</button>}
      </p>
      {msg && <p role="status">{msg}</p>}
    </aside>
  )
}
