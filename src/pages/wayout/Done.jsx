import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import WayoutShell from './WayoutShell'
import { WAYOUT_BASE, WAYOUT_INTAKE } from '../../lib/wayout/brand'
import { loadOrCreateSession, loadProgress, recordOutcome, startNextChapter } from '../../lib/wayout/session'

/**
 * The way out — after the third move.
 *
 * ⭐⭐ THE ONE PAGE THAT ASKS INSTEAD OF TELLING. Everywhere else this product
 * produces something: a path, a plan, a week of instructions. Here it has
 * nothing left to produce, and the only useful thing it can do is find out
 * whether any of it worked.
 *
 * 🔴🔴 REVISED 28 SEP, AND THE OLD RULE WAS CONFLATING TWO THINGS.
 *
 * It read: "it does not congratulate anybody — three ticked boxes is not the
 * same as being out, and a page that celebrates somebody who is still stuck has
 * stopped listening." The second half of that is still true and still governs.
 * The first half was too wide, and Daniel called it: "finishing is great, there
 * should be a completion congratulations when done, something exciting — but
 * then a page asking you are here now, and questions that lead into the next
 * stage. No one is just done."
 *
 * ⭐⭐ THE DISTINCTION IS BETWEEN THE WORK AND THE OUTCOME.
 *   ✅ "You did all three." — a FACT. They ticked them. Most people who make a
 *      plan never finish one, and saying so costs nothing and assumes nothing.
 *   ❌ "You're out." / "Congratulations, you made it." — a claim about their
 *      LIFE that we cannot see and they have not been asked about yet.
 *
 * So the celebration is real, and it is about the three moves and nothing else.
 * The question that follows is still the honest one, and it is asked before any
 * assumption is made about how it went.
 *
 * ⭐⭐ AND NOBODY IS EVER LEFT AT "DONE". The completion is a beat, not a
 * destination: it hands straight to where-are-you-now, which hands to the next
 * plan. That is also the whole commercial logic — this product FINISHES, so the
 * only version of it that continues is one that starts again from what actually
 * happened.
 *
 * ⚠️ Still no score, no streak, no confetti cannon. The register holds: direct
 * about the situation, never directive about the person.
 */
/**
 * 🔴 "these are not the questions i was thinking — this could be better, more
 * uplifting, exciting."
 *
 * ⭐⭐ THE FAULT WAS THAT THEY READ AS A REPORT CARD. "Yes — that is where I am"
 * / "I did the work and it did not land" are four ways of being marked, and
 * three of them are a fail. Nobody is lifted by grading themselves.
 *
 * ⭐⭐ SO THEY POINT FORWARD INSTEAD. Each one is a POSITION somebody is standing
 * in, and every one of them leads somewhere — which is true, because the next
 * plan is built differently from each. ⚠️ Still four, still honest, and "it did
 * not land" is still sayable in plain words: softening that one would cost the
 * only answer that teaches us anything.
 */
const OPTIONS = [
  { key: 'landed',  label: 'I’m there. That’s my life now',   hint: 'You reached your goal. Next, you decide what you want now.' },
  { key: 'partly',  label: 'Closer. Not there yet.',           hint: 'You made progress. Your next plan starts from where you are now.' },
  { key: 'no',      label: 'I did it all and it didn’t land',  hint: 'That is useful to know. Your next plan will try a different way.' },
  { key: 'changed', label: 'I’m after something else now',     hint: 'Everything you told us about your life carries over. You pick a new goal.' },
]

/**
 * ⭐⭐ WHAT COMES NEXT, AND IT IS FOUR DIFFERENT THINGS. Daniel: "once they hit
 * their plan there could be an advanced section... what to do next to make this
 * live longer."
 *
 * 🔴 ONE "START ANOTHER PLAN" BUTTON WOULD HAVE BEEN THE WRONG PRODUCT. Somebody
 * who just said "I did the work and it did not land" being offered the same
 * cheerful restart as somebody who arrived is the clearest possible proof nobody
 * read the answer. The destination only changes for two of these four.
 *
 * ⚠️ NOTHING HERE CONGRATULATES. Same rule as the rest of the page — the register
 * is "here is what is available", never "well done".
 */
const NEXT = {
  landed: {
    cta: 'Set a new goal',
    line: 'You reached your goal. Your next plan starts with a new question: what now? Only you can answer it.',
  },
  partly: {
    cta: 'Plan the rest from where I am',
    line: 'Same goal. You are closer now, so your next plan starts from where you are.',
  },
  no: {
    cta: 'Try a different way to the same goal',
    line: 'Your goal stays the same. That way did not work, so your next plan will try something different.',
  },
  changed: {
    cta: 'Start my new plan',
    line: 'A new goal. Everything you told us carries over: your town, your hours, what you will not do.',
  },
}

export default function Done() {
  const navigate = useNavigate()
  const [session, setSession] = useState(null)
  const [moves, setMoves]     = useState([])
  const [picked, setPicked]   = useState('')
  const [note, setNote]       = useState('')
  const [saved, setSaved]     = useState(false)
  const [error, setError]     = useState('')
  const [starting, setStarting] = useState(false)
  const [sending, setSending]   = useState(false)

  useEffect(() => {
    let cancelled = false
    loadOrCreateSession()
      .then(async s => {
        if (cancelled) return
        if (!s.map?.moves?.length) { navigate(`${WAYOUT_BASE}/plan`, { replace: true }); return }
        setSession(s)
        setMoves(s.map.moves)
        if (s.outcome) { setPicked(s.outcome); setSaved(true) }
        // ⚠️ Reachable early on purpose — somebody may want to say "this did
        // not land" long before three boxes are ticked, and refusing them the
        // page because they did not finish would collect only the happy
        // answers. Progress is read to say something true, not to gate.
        const p = await loadProgress(s.id)
        if (!cancelled) setMoves(m => m.map((mv, i) => ({ ...mv, done: p.done.has(i + 1) })))
      })
      .catch(err => { if (!cancelled) setError(err.message) })
    return () => { cancelled = true }
  }, [navigate])

  async function submit() {
    if (!picked || !session || sending) return
    setSending(true)
    setError('')
    try {
      await recordOutcome(session.id, picked, note)
      setSaved(true)
    } catch (err) {
      // ⚠️ Surfaced, not swallowed. A silent failure here loses the only
      // evidence this product ever collects about whether it works.
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  const allDone = moves.length > 0 && moves.every(m => m.done)

  /**
   * 🔴🔴 THIS PAGE USED TO END ITSELF HERE, AND THAT IS WHY NOBODY EVER SAW THE
   * CHAPTER. A `if (saved) return …` branch short-circuited the whole render the
   * moment an outcome was submitted — so the forward offer below it, the one
   * that calls startNextChapter and opens `/chapter`, WAS UNREACHABLE CODE. What
   * a person actually got was "Noted, and read." and a button reading "Start a
   * new plan" that dropped them into the full six-screen intake with every box
   * prefilled.
   *
   * Daniel walked exactly that path: "this is not really what I want — I want it
   * to feel like it leads into more, not just a new thing", then the old
   * questions, "which is weird… no direction as I'm going through the pages."
   * Every word of that was about a flow I had already replaced and he could not
   * reach.
   *
   * ⭐⭐ AN EARLY RETURN THAT RENDERS A WHOLE SCREEN IS A ROUTE, NOT A BRANCH.
   * It silently retired the rest of the page, and nothing failed — which is the
   * same shape as the second `<Route path="/">` that never fired.
   */

  /**
   * ⚠️ THE OUTCOME IS SAVED FIRST AND SEPARATELY. If starting the next chapter
   * failed after a combined write, the thing we would lose is the answer to "did
   * this work" — the only evidence this product ever collects about itself, and
   * the one thing nobody else asks them. It is already saved by the time this
   * button exists.
   */
  async function startNext() {
    if (!session || !picked || starting) return
    setStarting(true)
    setError('')
    try {
      await startNextChapter(session, picked)
      // ⚠️ The intake resumes at the first UNANSWERED screen, so this lands them
      // on whatever the new chapter cleared — the money, and the destination too
      // if they arrived or changed their mind. Everything else is prefilled and
      // they walk through it. See firstUnansweredStep.
      /**
       * 🔴🔴 THIS WENT TO `/start` — THE SIX-TAP DIAGNOSTIC — contradicting the
       * comment that used to sit directly above it, which described the intake
       * resuming at the first unanswered screen.
       *
       * ⭐⭐ AND THE INTAKE WAS NOT THE RIGHT DESTINATION EITHER. Daniel: "it
       * needs to be different, like entering a new level — not the same
       * background, different questions. If it's the same, people will stop
       * using it." Dropping somebody into the middle of the six screens with
       * every box prefilled is efficient and feels exactly like starting over.
       * `/chapter` is five questions only a returning person can be asked, on
       * the one dark ground in the product.
       */
      navigate(`${WAYOUT_BASE}/chapter`)
    } catch (err) {
      setError(err.message)
      setStarting(false)
    }
  }

  return (
    <WayoutShell title="What happened" wide>
      {/* ⭐⭐ THE COMPLETION BEAT — only when all three are actually ticked, and
          only ever about the WORK. See the note at the top of this file for why
          that line matters: "you did all three" is a fact we can see, "you're
          out" is a claim about their life we have not asked about yet. */}
      {allDone ? (
        <div className="wayout__finished">
          <span className="wayout__finishedmark" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 12.5l5 5L20 7" />
            </svg>
          </span>
          <p className="wayout__finishedkick">All three</p>
          <h1 className="wayout__finishedh">You finished the plan.</h1>
          {/* ⭐⭐ THE LIFT COMES FROM A REVERSAL AND AN OBSERVATION, NEVER FROM
              ADJECTIVES. Daniel wanted this "Tony Robbins style" — and the thing
              that actually sounds like that is not enthusiasm, it is telling
              somebody the thing they have is not the thing they thought.
              ⚠️ Both sentences are FACTS. "Most plans die at move one" is true of
              plans; "you now know what your own follow-through looks like" is an
              observation about something they demonstrably just did — which is
              the only form of credit WAYOUT_VOICE allows, because it cannot be
              written about somebody you did not read. */}
          <p className="wayout__lead">
            Most plans die at move one. You ran all three, in order, and the
            order was the hard part.
          </p>
          <p className="wayout__lead">
            Those three moves are done. You now know you can follow a plan through to the end. That means your next plan can aim higher.
          </p>
        </div>
      ) : (
        <p className="wayout__q">How far did you get?</p>
      )}

      {/* Their own moves, in their own words. Not a summary of what we did — a
          record of what they did, which is the only thing worth showing here. */}
      <ul className="wayout__ledger">
        {moves.map((m, i) => (
          <li key={i} className={m.done ? 'is-done' : ''}>
            <span>{m.done ? '✓' : '○'}</span> {m.title}
          </li>
        ))}
      </ul>

      {/* ⚠️ THE TURN, AND IT IS THE POINT OF THE PAGE. The celebration above is
          about what they DID; this asks the only thing that matters, which is
          what it CHANGED — and the two are not the same, which is precisely why
          finishing is not allowed to stand in for arriving. */}
      {/* ⚠️ "Where does that leave you" rather than "where are you now" — the
          second reads as a check-up, the first as the hinge into what comes
          next. One answer here decides what the next plan is built from, and
          the question should say so. */}
      <h2 className="wayout__nowh">Where are you now?</h2>
      <p className="wayout__lead">
        Pick the one that fits. Your answer decides what your next plan is about.
      </p>

      <div className="wayout__chips" style={{ marginTop: 22 }}>
        {OPTIONS.map(o => (
          <button
            key={o.key}
            type="button"
            className={`wayout__chip${picked === o.key ? ' wayout__chip--on' : ''}`}
            aria-pressed={picked === o.key}
            onClick={() => setPicked(o.key)}
          >
            {o.label}
          </button>
        ))}
      </div>
      {picked && <p className="wayout__hint">{OPTIONS.find(o => o.key === picked)?.hint}</p>}

      {picked && (
        <>
          <label className="wayout__label" htmlFor="wayout-outcome-note" style={{ marginTop: 20 }}>
            Anything you want to add?
          </label>
          <textarea
            id="wayout-outcome-note"
            className="wayout__textarea"
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder={picked === 'no'
              ? 'Where it stopped, and what got in the way.'
              : 'What actually changed, or what surprised you.'}
          />
          {/* 🔴 IT LOOKED BROKEN BECAUSE NOTHING HAPPENED. Daniel: "send button
              doesn't work." It did work — `recordOutcome` saved, the offer
              appeared below the fold, and the button sat there still reading
              "Send it" as though nothing had. A control that cannot tell you it
              succeeded is indistinguishable from one that failed.
              ⚠️ And it is full-width, directly above a second full-width button,
              so there were two big things to press and no order between them:
              "confusing why this is right below — what one to click, it's not
              straightforward." This one is quieter now, and once it is sent it
              stops being a button at all. */}
          {saved ? (
            <p className="wayout__sent">✓ Saved. We read every reply, and it changes what we build next.</p>
          ) : (
            <button className="wayout__btn wayout__btn--quiet" onClick={submit} disabled={sending}>
              {sending ? 'One moment…' : 'Send it'}
            </button>
          )}
        </>
      )}

      {error && <p className="wayout__hint">{error}</p>}

      {/* ⭐⭐ ONLY ONCE THEY HAVE ANSWERED. Offering the next plan before they have
          said how this one went would make the question look like a formality on
          the way to selling them something, which is exactly what it is not. */}
      {saved && NEXT[picked] && (
        <div className="wayout__offer wayout__nextchapter wayout__r" style={{ marginTop: 34 }}>
          <span className="wayout__offerkick">
            Chapter {(session?.chapter ?? 1) + 1}
          </span>
          <h3>{NEXT[picked].cta}</h3>
          <p className="wayout__offerlead">{NEXT[picked].line}</p>
          <button
            className="wayout__btn wayout__btn--sun"
            onClick={startNext}
            disabled={starting}
          >
            {starting ? 'Setting it up…' : NEXT[picked].cta}
          </button>
          {/* ⚠️ SAY HOW SHORT IT IS, because the thing somebody fears here is
              being asked everything again — and the reason /chapter exists is
              that they are not. */}
          <p className="wayout__offerfine">
            {picked === 'landed' || picked === 'changed'
              ? 'Five questions. Your numbers, what changed, and where you are headed. Everything else you already told us carries over.'
              : 'Three questions. What changed and your numbers, so the next plan starts from where you actually are.'}
          </p>
        </div>
      )}

      <p className="wayout__rebuild">
        <button type="button" className="wayout__again" onClick={() => navigate(`${WAYOUT_BASE}/plan`)}>
          Back to the plan
        </button>
      </p>
    </WayoutShell>
  )
}
