import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { WAYOUT_MAX_PLAN_ASKS } from '../../lib/wayout/session'
import { versionList, liveVersions, currentChoice, showingKey, openFrom } from '../../lib/wayout/planVersions'
import { correctableAnswers, showAnswer } from '../../lib/wayout/correctable'
import { humanError } from '../../lib/wayout/humanError'
import CrisisHelp from './CrisisHelp'
import { forReaders } from '../../lib/wayout/mapContract'

/**
 * Their own words are never rewritten, with one exception: corrections saved
 * before 5 Oct carry OUR old wording, "Correction to my answers — ", with a
 * dash Daniel asked to be gone. Only that prefix changes.
 */
const theirWords = t => String(t ?? '').replace(/^Correction to my answers [—–] /, 'Correction to my answers. ')

/**
 * ⭐⭐ THE RUNNING THREAD — "tell it what changed".
 *
 * Daniel: "a chat part of it — thought is to have people keep it as a guide, a
 * way to retain people." He is right about the need and I pushed back on the
 * shape, which he accepted: a general chat is another place to ask questions
 * instead of acting, and this product exists to end that state.
 *
 * ⭐⭐ SO THE BOX IS NOT LABELLED "ASK ME ANYTHING". It is labelled with the one
 * thing it is for. The placeholder is three real events, because a blank box
 * with an open invitation gets small talk and a blank box with examples gets
 * the sale falling through.
 *
 * ⭐⭐ AND THE PAYOFF IS A BUTTON, NOT A PARAGRAPH. When something genuinely
 * moves the plan, the reply says what it moved and the REDO appears — the plan
 * gets rewritten on the plan, where it can be found tomorrow. A plan rewritten
 * inside a chat message is a plan nobody can find again.
 *
 * ⚠️ IT STOPS INVITING WHEN IT IS BEING USED AS A SUBSTITUTE FOR DOING THE MOVE.
 * `stalling` comes back from the model under an explicit rule — three replies
 * that neither changed the plan nor sent them to do something, and the fourth
 * says so. Same spine as the twelve-ask cap on a move: the next real answer is
 * on the other side of trying it.
 */
export default function PlanThread({
  thread = [], onSay, onRedo, onDropDraft, onBringBack, onCorrect, answers = {}, onSwitch, busy = false, rebuilding = false, locked = false,
  pending = null, error = '', liveMap = null,
}) {
  const [text, setText] = useState('')
  const [err, setErr]   = useState('')
  const [dropping, setDropping] = useState(false)
  // ⭐ "Correct an answer" in the menu lands here (#correct) with the panel open
  // — read from the ROUTE, because the menu is used on this page too, where the
  // component is already mounted and an initial-state check would never re-run.
  const location = useLocation()
  const routerNav = useNavigate()
  const viaMenu = location.hash === '#correct'
  const [fixingOwn, setFixing] = useState(false)
  const fixing = fixingOwn || viaMenu
  useEffect(() => {
    if (viaMenu) requestAnimationFrame(() => document.querySelector('.wayout__fix')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }, [viaMenu])

  const mine  = thread.filter(m => m.role === 'user').length
  const spent = mine >= WAYOUT_MAX_PLAN_ASKS
  const last  = [...thread].reverse().find(m => m.role === 'assistant')

  /**
   * 🔴🔴 THE OFFER WAS TIED TO THE LAST REPLY, SO A LATER REPLY COULD WITHDRAW
   * IT. Daniel said the same thing twice; the second reply was "you already
   * said that" — correctly `changesPlan: false` — and the rebuild button
   * vanished. The plan still needed rewriting, he had been told so, and the
   * only control that could do it had been taken off the screen by an answer
   * that was not about whether the plan had moved. "i even tried it again and
   * it didnt work and no way to delete it or go back."
   *
   * ⭐⭐ A PLAN THAT NEEDS REWRITING DOES NOT STOP NEEDING IT BECAUSE THE NEXT
   * SENTENCE WAS ABOUT SOMETHING ELSE. So the offer stands on the most recent
   * reply that said the plan moved, and is withdrawn only by the rebuild
   * actually happening — which writes its own entry below.
   */
  const lastMine  = thread.map(m => m.role === 'user').lastIndexOf(true)
  const rebuiltAt = thread.map(m => m.rebuilt === true).lastIndexOf(true)
  const movedAt   = thread.map(m => m.role === 'assistant' && m.changesPlan === true).lastIndexOf(true)
  const moved     = movedAt > -1 && movedAt > rebuiltAt ? thread[movedAt] : null
  // ⚠️ Memoised: showingKey serialises every version's plan, and this
  // component re-renders on every keystroke in the box below.
  const plans     = useMemo(() => versionList(thread), [thread])
  const showing   = useMemo(() => showingKey(thread, liveMap), [thread, liveMap])
  const open      = openFrom(thread)
  const draft     = thread.slice(open)
  const drafting  = draft.some(m => m.role === 'user') || Boolean(pending)
  const nextN     = pending?.n ?? (plans.length || 1) + 1
  const lastReply = [...draft].reverse().find(m => m.role === 'assistant')
  // ⚠️ A correction is complete on its own — it gets no reply, and it must still
  // be possible to build a version from it.
  const corrected = draft.some(m => m.correction)
  // ⚠️ "Answer that" is only true when the reply ASKED something. It was
  // printed under every reply, including ones with no question in them.
  const asked     = /\?/.test(lastReply?.content ?? '')
  const quiet     = busy || rebuilding || locked

  async function send() {
    const said = text.trim()
    if (!said || quiet) return
    setErr(''); setText('')
    // ⚠️ On failure their words go back in the box rather than vanishing.
    try { await onSay(said) } catch (e) { setErr(e.message); setText(said) }
  }

  return (
    <section className="wayout__card wayout__thread">
      <h3 className="wayout__label">Something changed?</h3>
      <p className="wayout__threadlead">
        Tell us what changed and we will show you how it changes your plan.
      </p>

      {/* ⭐⭐ THE VERSIONS, NOT THE TRANSCRIPT. Daniel: "this should just show
          v1 v2 v3 and below an option for a new one." Once an idea has been
          built into a version, its back-and-forth has done its job — it folds
          into the one line that says what the version was built around.
          ⚠️ Deleting lives on the × above the moves, not here: two places to
          delete the same thing is how "Drop this idea" came to sit under a
          sentence and read as deleting the original plan. */}
      {/* ⭐ FOLDED (Daniel, 6 Nov 2026: the plan page was "messy"). The same
          versions are a tap away at the top, so here they wait behind one link
          instead of filling the box people come to type in. */}
      {plans.length > 0 && (
      <details className="wayout__threadhist">
        <summary>See your earlier versions <small>{plans.length}</small></summary>
      {plans.length > 0 && (
        <ol className="wayout__versionlist">
          {plans.filter(v => !v.crossed).map(v => (
            <li key={v.key}>
              <button
                type="button"
                className={`wayout__versionrow${showing === v.key ? ' is-on' : ''}`}
                aria-pressed={showing === v.key}
                disabled={!onSwitch || quiet || showing === v.key}
                onClick={() => { onSwitch(v.key); toPlan() }}
              >
                <b>V{v.n}</b>
                <span>
                  {v.key === -1 ? 'Original, from your answers' : `“${v.about ?? 'Rewritten'}”`}
                  {/* ⭐ Two versions built from the same sentence read
                      identically — the first move is what tells them apart. */}
                  {v.map?.moves?.[0]?.title && <small>Move 1: {v.map.moves[0].title}</small>}
                </span>
                {showing === v.key && <em>Showing</em>}
              </button>
            </li>
          ))}
        </ol>
      )}
      {/* ⭐ CROSSED OFF, ON PURPOSE — the versions not chosen, with why, the
          same idiom as the plan's own cut list. Not deleted: they can come back. */}
      {plans.some(v => v.crossed) && (
        <div className="wayout__versioncut">
          {/* ⚠️ Not "Crossed off" — the plan's own list a scroll below has that
              name, and two lists with one name read as one. */}
          <p className="wayout__versionshead">Versions you did not pick</p>
          {plans.filter(v => v.crossed).map(v => (
            <div key={v.key} className="wayout__versioncutrow">
              <s>V{v.n} “{v.about ?? 'Rewritten'}”</s>
              <span>{forReaders(v.crossed.why)}</span>
              {onBringBack && !quiet && (
                <button type="button" className="wayout__threadundo" onClick={() => onBringBack(v.key)}>Bring it back</button>
              )}
            </div>
          ))}
        </div>
      )}
      </details>
      )}

      {/* ⭐⭐ THE IDEA IN PROGRESS IS ONE THING, SHAPED LIKE THE VERSIONS IT IS
          ABOUT TO JOIN. Daniel: "half is good half is still messy." The good
          half was the version list; the messy half was this — a bubble, a
          floating "Take that back", a quoted reply, and "Answer that and it will
          tell you what moves" printed under a reply that had asked nothing.
          Now: one box, labelled with the version it will become, an × to drop
          it (the same idiom as the version chips), the reply, and one button
          that says exactly what it does — "Make it V4".
          ⭐ THE MODEL'S JUDGEMENT DECIDES WHAT IS OFFERED, NOT WHAT IS ALLOWED:
          when the reply says the plan moved, the button is the loud one; when
          it did not, the same button is quiet — still there, because "no button
          to make this the new plan" was the original complaint. */}
      {drafting && (
        <div className={`wayout__draft${pending ? ' is-building' : ''}`} role={pending ? 'status' : undefined}>
          <div className="wayout__drafthead">
            <p className="wayout__versionhead">New idea · will become version {nextN}</p>
            {onDropDraft && !quiet && (
              <button type="button" className="wayout__versionx" aria-label="Delete this idea" onClick={() => setDropping(true)}>
                ×
              </button>
            )}
          </div>
          {draft.map((m, i) => (
            m.role === 'user'
              ? <p key={i} className="wayout__draftsaid">“{theirWords(m.content)}”</p>
              : !m.rebuilt && (
                <div key={i}>
                  <p className="wayout__draftreply">{forReaders(m.content)}</p>
                  {/* ⭐⭐ The right lines for their country, from a fixed table,
                      under any reply that read danger in what they wrote. */}
                  {m.crisis && <CrisisHelp region={answers?.region} />}
                </div>
              )
          ))}
          {busy && (
            <div className="wayout__draftwait"><div className="wayout__working" aria-hidden="true"><i /><i /><i /></div><span>Reading that.</span></div>
          )}
          {pending ? (
            <div className="wayout__draftwait">
              <div className="wayout__working" aria-hidden="true"><i /><i /><i /></div>
              <span>Making version {nextN}. This takes up to a minute. Your plan stays the same until then.</span>
            </div>
          ) : !quiet && onRedo && (lastReply || corrected) && !lastReply?.crisis && (
            <div className="wayout__draftact">
              {moved && <p className="wayout__draftmoved">{moved.whatChanged ?? 'That changes the order of your moves.'}</p>}
              {!moved && asked && (
                <p className="wayout__draftnote">There is a question for you above. Answer it below for a better result, or make the new version now.</p>
              )}
              <button
                type="button"
                className={`wayout__btn ${moved ? 'wayout__btn--sun' : 'wayout__btn--quiet'}`}
                onClick={onRedo}
              >
                Make version {nextN}
              </button>
            </div>
          )}
        </div>
      )}
      {error && !pending && <p className="wayout__error">{humanError(error)}</p>}
      {busy && !drafting && <p className="wayout__threadreply wayout__askwait">Reading that.</p>}

      {onDropDraft && (
        <Confirm
          open={dropping}
          title="Delete this idea?"
          body="What you wrote and our reply will be deleted. Your plan stays the same."
          yes="Delete it"
          onYes={() => { setDropping(false); onDropDraft() }}
          onNo={() => setDropping(false)}
        />
      )}

      {spent ? (
        <p className="wayout__hint">
          You have changed this plan a lot. The best next step now is to start move 1.
        </p>
      ) : last?.stalling ? (
        // ⚠️ Not a lock. They can still type — the screen simply stops asking
        // for more, which is the difference between a limit and a telling-off.
        <p className="wayout__hint">
          Your plan has not changed in a while. The best way forward now is to try your next move.
        </p>
      ) : null}

      {/* ⚠️ THE BOX HAD NO LABEL AND NO SEPARATION. Three different actions sat
          on one card with nothing saying which belonged to what: take a message
          back, overrule the answer, and say something new. The divider and the
          label are what make the last of those obviously a new turn rather than
          a continuation of the exchange above it. */}
      {/* ⭐⭐ CORRECT AN ANSWER. Daniel: "no way of going back in here and change
          things that could be wrong." One fact at a time, in place. */}
      {onCorrect && !quiet && (
        <Corrections
          answers={answers}
          open={fixing}
          onOpen={() => {
            if (fixing) { setFixing(false); if (viaMenu) routerNav({ hash: '' }, { replace: true }) } else setFixing(true)
          }}
          onCorrect={onCorrect}
        />
      )}

      {!spent && (
        <div className="wayout__threadsay">
          <label className="wayout__label" htmlFor="wayout-thread">
            {drafting ? 'Add to this idea' : plans.length || lastMine > -1 ? 'Has something else changed?' : 'What changed?'}
          </label>
          <textarea
            id="wayout-thread"
            className="wayout__textarea"
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="The buyer pulled out. I got offered a job. The rental has been empty two months."
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send() }}
          />
          <button className="wayout__btn" onClick={send} disabled={quiet || !text.trim()}>
            {busy ? 'Reading…' : 'Send'}
          </button>
          {err && <p className="wayout__error">{humanError(err)}</p>}
        </div>
      )}
    </section>
  )
}

/** After switching from down here, take them to where the plan changed. */
function toPlan() {
  // ⚠️ The switcher only exists with two or more versions in play.
  const el = document.getElementById('wayout-versions') ?? document.getElementById('wayout-moves')
  el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

/**
 * ⭐⭐ WHICH PLAN IS SHOWING, ON THE PLAN. Daniel: "the switching between them
 * should switch it up top here" — it lived at the foot of the thread, so the
 * moves changed somewhere off-screen above the button that changed them.
 * It sits over the moves now, so the click and its effect are in one view.
 * ⚠️ Read from the plan itself (`showingVersion`), so it cannot claim a version
 * is showing when it is not. Switching regenerates nothing.
 */
export function VersionSwitch({
  thread = [], liveMap = null, onSwitch, onRemove, onChoose, onGoWith, choosing = false, chooseErr = '', disabled = false,
  compact = false,
}) {
  const [asking, setAsking] = useState(null)
  // ⭐ `compact` (Daniel, 6 Nov 2026: the top of the plan was "messy and
  // daunting"): one quiet line, "Version 6 of your plan ▾", that opens the
  // switch. The versions are a thing you look at sometimes, not every visit.
  const [shown, setShown] = useState(false)
  const plans = liveVersions(thread)
  if (plans.length < 2) return null
  const choice = currentChoice(thread)
  const showing = showingKey(thread, liveMap)
  const on = plans.find(v => v.key === showing)
  const doomed = plans.find(v => v.key === asking)
  if (compact && !shown) {
    return (
      <button type="button" className="wayout__versopen" id="wayout-versions" aria-expanded="false" onClick={() => setShown(true)}>
        <u>{on ? (on.key === -1 ? 'Your original plan' : `${on.label} of your plan`) : 'Your versions'}</u> <span aria-hidden="true">▾</span>
      </button>
    )
  }
  return (
    <div className={`wayout__versions${compact ? ' is-compact' : ''}`} id="wayout-versions" role="group" aria-label="Which version of your plan is showing">
      {compact && (
        <button type="button" className="wayout__versopen" aria-expanded="true" onClick={() => setShown(false)}>
          <u>Hide versions</u> <span aria-hidden="true">▴</span>
        </button>
      )}
      <p className="wayout__versionshead">The version you are looking at</p>
      <div className="wayout__versionsrow">
        {plans.map(v => (
          <span key={v.key} className={`wayout__versionchip${showing === v.key ? ' is-on' : ''}`}>
            <button
              type="button"
              aria-pressed={showing === v.key}
              disabled={!onSwitch || disabled || showing === v.key}
              onClick={() => { setAsking(null); onSwitch(v.key) }}
            >
              {v.label}
            </button>
            {/* ⭐⭐ THE ×. Daniel: "to get rid of the original plan doesnt make
                sense i was thinking to get rid of new ideas maybe just having an
                x on the top." So there is none on the original. */}
            {onRemove && v.key !== -1 && (
              <button
                type="button"
                className="wayout__versionx"
                aria-label={`Delete ${v.label}`}
                disabled={disabled}
                onClick={() => setAsking(v.key)}
              >
                ×
              </button>
            )}
          </span>
        ))}
      </div>
      {onRemove && (
        <Confirm
          open={Boolean(doomed)}
          title={doomed ? `Delete ${doomed.label}?` : ''}
          quote={doomed?.about ? `Rewritten around “${doomed.about}”` : null}
          body={doomed && showing === doomed.key
            ? 'This version will be deleted for good. You will see the version before it.'
            : 'This version will be deleted for good.'}
          yes="Delete it"
          onYes={() => { const k = doomed.key; setAsking(null); onRemove(k) }}
          onNo={() => setAsking(null)}
        />
      )}
      <p className="wayout__versionnote">
          {showing == null
            ? 'You answered the questions again after these, so none of these versions is showing now.'
            : showing === -1
              ? 'Your first plan, made from your answers.'
              : on?.about ? `Rewritten around “${on.about.replace(/[.!?]+$/, '')}”.` : null}
      </p>

      {/* ⭐⭐ HELP ME CHOOSE. Not a score — a score invites re-rolling and makes
          us the judge. It says which version fits what THEY told us, what each
          one costs, and the ones not chosen are crossed off on purpose. */}
      {choice ? (
        <Choice plans={plans} choice={choice} onGoWith={onGoWith} disabled={disabled} />
      ) : onChoose && (
        <div className="wayout__choose">
          {choosing ? (
            <div className="wayout__draftwait" role="status">
              <div className="wayout__working" aria-hidden="true"><i /><i /><i /></div>
              <span>Comparing your versions with your answers.</span>
            </div>
          ) : (
            <>
              <button type="button" className="wayout__btn wayout__btn--quiet" disabled={disabled} onClick={onChoose}>
                Help me choose
              </button>
              <span className="wayout__choosenote">We compare your versions with your answers. You can do this twice a day.</span>
            </>
          )}
          {chooseErr && <p className="wayout__error">{humanError(chooseErr)}</p>}
        </div>
      )}
    </div>
  )
}

/**
 * ⭐ THE ONE CONFIRMATION, used by every destructive control on the plan.
 * Daniel: "can we make sure the x has a pop up to confirm delete." A native
 * <dialog> opened with showModal(): the page behind is inert, Escape and a
 * backdrop click cancel, and focus is held inside. ⚠️ Never window.confirm —
 * it blocks the page and cannot say what will happen in this product's words.
 * 🔴 showModal focuses the FIRST button, which is the destructive one — Enter
 * by reflex would delete. Focus is moved to the safe answer.
 */
export function Confirm({ open, title, quote = null, body, yes, onYes, onNo }) {
  const ref = useRef(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) {
      d.showModal?.()
      d.querySelector('[data-keep]')?.focus()
    }
    if (!open && d.open) d.close()
  }, [open])
  return (
    <dialog
      ref={ref}
      className="wayout__dialog"
      aria-label={title}
      onClose={() => { if (open) onNo() }}
      onClick={e => { if (e.target === e.currentTarget) onNo() }}
    >
      {open && (
        <div className="wayout__dialogbody">
          <h3>{title}</h3>
          {quote && <p className="wayout__dialogabout">{quote}</p>}
          <p>{body}</p>
          <div className="wayout__dialogactions">
            <button type="button" className="wayout__btn wayout__btn--danger" onClick={onYes}>{yes}</button>
            <button type="button" className="wayout__threadundo" data-keep onClick={onNo}>Keep it</button>
          </div>
        </div>
      )}
    </dialog>
  )
}

/**
 * The comparison, and the way to act on it.
 * 🔴 LIABILITY, AS DANIEL ASKED — "make sure it is safe from getting sued". The
 * prompt carries the real lines (no named products, no predicted returns,
 * never "safe", a named kind of professional when money, tax or law is in
 * play). This says the rest plainly where it will be read: it is a comparison
 * against what they told us, not advice, and the choice is theirs — which is
 * also simply true, since nothing happens until they press a button.
 */
function Choice({ plans, choice, onGoWith, disabled }) {
  const byKey = Object.fromEntries(plans.map(v => [v.key, v]))
  const picked = byKey[choice.pick]
  const reasons = Object.fromEntries((choice.versions ?? []).map(v => [v.key, v.costs]))
  return (
    <div className="wayout__choice">
      <p className="wayout__versionshead">Which version fits you best</p>
      {picked && <p className="wayout__choicepick">Closest fit: <b>{picked.label}</b></p>}
      {choice.why && <p className="wayout__choicewhy">{choice.why}</p>}
      <ul className="wayout__choicelist">
        {(choice.versions ?? []).filter(v => byKey[v.key]).map(v => (
          <li key={v.key} className={v.key === choice.pick ? 'is-pick' : ''}>
            <b>{byKey[v.key].label}</b>
            {v.fits && <span>{v.fits}</span>}
            {v.costs && <span className="wayout__choicecost">{v.costs}</span>}
            {onGoWith && (
              <button
                type="button"
                className={`wayout__btn ${v.key === choice.pick ? 'wayout__btn--sun' : 'wayout__btn--quiet'}`}
                disabled={disabled}
                onClick={() => onGoWith(v.key, reasons)}
              >
                Go with {byKey[v.key].label === 'Original' ? 'the original' : byKey[v.key].label}
              </button>
            )}
          </li>
        ))}
      </ul>
      {choice.checkWith && (
        <p className="wayout__choicecheck"><b>Before you act on it:</b> {choice.checkWith}</p>
      )}
      <p className="wayout__choicefine">
        This compares your versions against what you told us. It is not financial,
        legal or tax advice, and the choice is yours. The ones you do not go with are
        crossed off, not deleted.
      </p>
    </div>
  )
}

/**
 * The answers the plan is built on, each one correctable where it stands.
 * Saving one adds it to the idea in progress, so the change is visible and the
 * plan is only rewritten when they say "Make it".
 */
function Corrections({ answers, open, onOpen, onCorrect }) {
  const [editing, setEditing] = useState(null)
  const [value, setValue] = useState('')
  const fields = correctableAnswers(answers)
  return (
    <div className="wayout__fix">
      <button type="button" className="wayout__threadundo" aria-expanded={open} onClick={onOpen}>
        {open ? 'Hide your answers' : 'Is one of your answers wrong? Correct it'}
      </button>
      {open && (
        <ul className="wayout__fixlist">
          {fields.map(f => (
            <li key={f.key}>
              <span className="wayout__fixlabel">{f.label}</span>
              {editing === f.key ? (
                <form
                  className="wayout__fixedit"
                  onSubmit={e => { e.preventDefault(); setEditing(null); onCorrect(f.key, value) }}
                >
                  {f.options ? (
                    <select className="wayout__fixinput" autoFocus value={value} onChange={e => setValue(e.target.value)} aria-label={f.label}>
                      <option value="" disabled>Choose…</option>
                      {f.options.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
                    </select>
                  ) : (
                    <input
                      className="wayout__fixinput"
                      autoFocus
                      inputMode={f.kind === 'number' ? 'numeric' : undefined}
                      value={value}
                      onChange={e => setValue(e.target.value)}
                      aria-label={f.label}
                    />
                  )}
                  <button type="submit" className="wayout__btn" disabled={!value.trim() || value.trim() === f.value.trim()}>Save</button>
                  <button type="button" className="wayout__threadundo" onClick={() => setEditing(null)}>Cancel</button>
                </form>
              ) : (
                <span className="wayout__fixrow">
                  <b>{showAnswer(f.kind, f.value, f.options, f.symbol)}</b>
                  <button type="button" className="wayout__threadundo" onClick={() => { setEditing(f.key); setValue(f.value) }}>
                    Change
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
