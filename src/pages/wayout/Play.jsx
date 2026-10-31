import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import WayoutShell from './WayoutShell'
import Playbook from './Playbook'
import Working from './Working'
import { WAYOUT_BASE } from '../../lib/wayout/brand'
import {
  loadOrCreateSession, generatePlaybook, generateMoveQuestions, loadPlaybook, savePlaybook,
  playbookIsStale, loadProgress, markMoveDone, moveIsOpen,
  askAboutMove, saveThread, saveMoveNote, WAYOUT_MAX_ASKS,
} from '../../lib/wayout/session'
import { humanError } from '../../lib/wayout/humanError'
import CrisisHelp from './CrisisHelp'
import { soundsLikeCrisis } from '../../lib/wayout/replyJson'

/**
 * The way out — the play-by-play for one move.
 *
 * ⭐⭐ THIS IS THE PAID HALF, AND TODAY IT IS FREE. `WAYOUT_PAYMENTS_LIVE` is
 * off and migration 055 makes finishing the intake the entitlement, so the
 * database agrees with what the plan page already promises: free while this is
 * being built. When payments go live, 055 reverts in the same commit that
 * flips the flag — a paywall appearing while the button still says free is
 * worse than either state alone.
 *
 * ⚠️ Written ONCE and kept. A person comes back mid-week having half-done the
 * thing; finding different words to send would mean the instructions changed
 * underneath them while they were following them.
 */
/**
 * ⭐⭐ KEYED BY THE MOVE, AND THAT IS THE WHOLE FIX.
 *
 * 🔴 Daniel: "i moved ahead to move two and its the same as one". It was — for
 * the twenty-seven seconds move two took to write. Going from /play/1 to
 * /play/2 is a PARAM CHANGE, not a remount, so React kept every piece of state:
 * the previous move's play stayed on screen, `loading` was false because
 * nothing had set it true again, and the page confidently rendered move one's
 * instructions under move two's heading until the new one landed.
 *
 * ⚠️ The stored data was correct the entire time — each move had its own play.
 * That is what makes this class of bug expensive: nothing is wrong anywhere a
 * query can find it, and the person is simply reading the wrong week.
 *
 * ⚠️ Resetting each piece of state by hand in the effect works and is fragile
 * — it is a list that has to be kept in step with the useState calls above it,
 * and the failure mode of forgetting one is exactly this bug again, quieter.
 * A key means the state CANNOT leak between moves, because there is none to
 * leak: React unmounts and builds a fresh one.
 */
/**
 * ⭐⭐ ASKING. Daniel: "there is no area here to get more details or ask
 * questions — this seems like just a gated answer platform."
 *
 * The moment anybody starts a move they have a question, and it is always the
 * one no prompt could have anticipated: what do I say if he asks why, what if
 * the agent will not give me a number, is it worth it if only two say yes.
 * Answering those is what the paid half is for — a play-by-play that cannot be
 * asked about is a document, and one that can is worth keeping.
 *
 * ⚠️ IT SITS AFTER THE PLAY, NOT BESIDE IT. A chat box at the top invites
 * somebody to ask instead of read, and the answer to most first questions is
 * three paragraphs above.
 */
/**
 * ⭐⭐ WHAT MAKES THE PAID HALF WORTH PAYING FOR.
 *
 * Daniel: "this is where we need to start asking more detail. This is value
 * added to make this as accurate as possible, not just unlocking the answers."
 * A paid thing that only unlocks is a paywall; a paid thing that ASKS is a
 * different product, and the person gets something on the way in.
 *
 * ⚠️ EVERY QUESTION IS SKIPPABLE. They are here for the week's instructions,
 * not to fill in a form, and a question they do not want to answer is itself
 * an answer — the play gets written either way.
 */
function Asking({ move, questions, busy, onSubmit }) {
  const [answers, setAnswers] = useState({})

  if (busy) {
    return (
      <WayoutShell title="This week" wide>
        {/* ⚠️ THE WAIT SOMEBODY REACHES EVERY TIME THEY OPEN A MOVE, which is
            why it was the one Daniel kept landing on. The first line
            acknowledges what they just typed — this is the only wait that
            FOLLOWS their input — and the rest name the sections of the week
            about to arrive. */}
        <Working foot="Up to a minute." lines={[
          'Reading what you told us.',
          'Working out the week.',
          'Finding what usually goes wrong.',
          'Writing it down.',
        ]} />
      </WayoutShell>
    )
  }

  return (
    <WayoutShell title="A few questions first">
      {/* ⚠️ Same reason as the playbook's crumb — this screen asks two questions
          and then commits to writing a week, and until now the only exit was the
          browser's back button. */}
      <p className="wayout__crumb">
        <Link to={`${WAYOUT_BASE}/plan`}>← The whole plan</Link>
      </p>
      <p className="wayout__q">
        {questions.length > 1 ? `${questions.length} quick questions first.` : 'One quick question first.'}
      </p>
      <p className="wayout__lead">
        {/* 🔴 "the week I write — weird again." It read "what you say here changes
            the week I write, not just the wording of it." Two faults in one
            sentence: "the week I write" is the product narrating its own
            production schedule, which is machinery nobody asked about, and it
            promises a WEEK to somebody who is looking at a plan measured in
            months. What the answers actually change is the content of the plan.
            ⚠️ Counted, not "two" — the heading above says how many there are and
            a fixed number beneath a variable one is the kind of small wrongness
            that makes a reader check everything else. */}
        {move?.title ? `You are starting: ${move.title}. ` : ''}
        {questions.length === 1
          ? 'Your answer changes what the steps say.'
          : 'Your answers change what the steps say.'}
      </p>

      {questions.map((q, i) => (
        <div key={i} className="wayout__askq">
          <p className="wayout__label">{q.q}</p>
          {q.why && <p className="wayout__hint">{q.why}</p>}

          {q.options?.length > 0 && (
            <div className="wayout__chips">
              {q.options.map(opt => (
                <button
                  key={opt}
                  type="button"
                  className={`wayout__chip${answers[i] === opt ? ' wayout__chip--on' : ''}`}
                  aria-pressed={answers[i] === opt}
                  onClick={() => setAnswers(a => ({ ...a, [i]: opt }))}
                >
                  {opt}
                </button>
              ))}
            </div>
          )}

          {/* ⚠️ The box is there even when there are chips. The chips are the
              fast answer; the box is where the true one goes when it does not
              fit in four words, and this product is built on people being able
              to say the thing that was not on the list. */}
          <textarea
            className="wayout__textarea"
            value={answers[`${i}:note`] ?? ''}
            onChange={e => setAnswers(a => ({ ...a, [`${i}:note`]: e.target.value }))}
            placeholder={q.options?.length ? 'Anything that does not fit the buttons.' : 'A sentence is enough.'}
          />
        </div>
      ))}

      <button className="wayout__btn wayout__btn--sun" onClick={() => onSubmit(answers)}>
        Write it
      </button>
      <p className="wayout__hint">
        Skip anything you would rather not answer. We will write your steps either way.
      </p>
    </WayoutShell>
  )
}

function AskBox({ thread, onAsk, onPin, pinned, seed, region = null }) {
  const [q, setQ] = useState('')

  // ⚠️ ADJUSTED DURING RENDER, NOT IN AN EFFECT. React's own pattern for "reset
  // some state when a prop changes": keep the last value and compare. An effect
  // here would run after paint and cascade a second render, which is what the
  // linter objects to and it is right — this way the box is correct on the
  // first paint and never flickers the old text.
  //
  // ⚠️ It only fires when the SEED changes, so somebody mid-sentence does not
  // lose what they were typing because a parent re-rendered. Clicking a second
  // "change this" while typing is a deliberate act and is allowed to win.
  const [lastSeed, setLastSeed] = useState(seed)
  if (seed !== lastSeed) {
    setLastSeed(seed)
    if (seed) setQ(seed)
  }
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const spent = thread.filter(m => m.role === 'user').length >= WAYOUT_MAX_ASKS

  async function send() {
    const question = q.trim()
    if (!question || busy) return
    setBusy(true); setErr(''); setQ('')
    try { await onAsk(question) } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  return (
    <div className="wayout__ask">
      <h3 className="wayout__label">Questions about this move? Ask here.</h3>

      {/* 🔴 THE BEST ANSWERS IN THE PRODUCT WERE TRAPPED IN A THREAD. Daniel, on
          a reply about FIRPTA and flip holding periods: "this should have a pin
          button that goes to the main page."

          He is right and it is the difference between a chat and a plan. Asking
          a question produces the most specific writing this thing ever does —
          and it lived at the bottom of a move page, below the fold, gone the
          moment he navigated away. The plan board already renders their own
          notes beside each move; this is the same shelf.

          ⚠️ Replies only. Pinning your own question pins the thing you already
          know. */}
      {thread.map((m, i) => (
        <div key={i} className={m.role === 'user' ? 'wayout__askmine' : 'wayout__askreply'}>
          <p>{m.content}</p>
          {/* ⭐⭐ The same safety net as the plan's thread: if what they asked
              reads as danger, the help lines for their country sit under the
              answer, whatever the answer said. */}
          {m.role !== 'user' && i > 0 && soundsLikeCrisis(thread[i - 1]?.content) && <CrisisHelp region={region} />}
          {m.role !== 'user' && onPin && (
            <button
              type="button"
              className="wayout__pinreply"
              onClick={() => onPin(m.content)}
              disabled={pinned === m.content}
            >
              {pinned === m.content ? '✓ Saved to your plan' : 'Save this to my plan'}
            </button>
          )}
        </div>
      ))}

      {busy && <p className="wayout__askreply wayout__askwait">Thinking.</p>}

      {spent ? (
        // ⚠️ Not a paywall and not a telling-off. Twelve questions deep on one
        // move is somebody using this instead of doing the thing, and saying so
        // plainly is more useful than another answer would be.
        <p className="wayout__hint">
          You have asked a lot about this move. The best next step is to try it. Then come back and tell us what happened.
        </p>
      ) : (
        <>
          <textarea
            id="wayout-ask"
            className="wayout__textarea"
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="What do I say if he asks why? What if they won't give me a number?"
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send() }}
          />
          <button className="wayout__btn" onClick={send} disabled={busy || !q.trim()}>
            {busy ? 'Thinking…' : 'Ask'}
          </button>
          {err && <p className="wayout__hint">{humanError(err)}</p>}
        </>
      )}
    </div>
  )
}

export default function Play() {
  const { move: moveParam } = useParams()
  // ⚠️ A URL segment is a string from anywhere — a typo, a stale link, or a
  // handler that passed an event object. NaN must not fall through as a move.
  const order = Number.parseInt(moveParam, 10)
  return <PlayMove key={order} order={order} />
}

function PlayMove({ order }) {
  const navigate = useNavigate()

  const [play, setPlay]       = useState(null)
  const [move, setMove]       = useState(null)
  const [stale, setStale]     = useState(false)
  // ⚠️ The title their plan carries NOW. The notice used to say only that the
  // plan had changed, which leaves them to work out whether the change matters.
  // Naming the current move lets them judge it in a glance.
  const [moveNow, setMoveNow] = useState(null)
  const [sessionId, setSessionId] = useState(null)
  const [isDone, setIsDone]   = useState(false)
  const [locked, setLocked]   = useState(false)
  // ⭐ The questions asked before the play is written. See Asking below.
  const [ask, setAsk]         = useState(null)
  const [session, setSession] = useState(null)
  const [thread, setThread]   = useState([])
  // What is already on the plan, so the button can say so instead of re-pinning.
  const [pinned, setPinned]   = useState('')
  // ⭐ What a "change this" link put in the box, waiting to be finished.
  const [seed, setSeed]       = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  // Same guard as the plan page: in dev the effect runs twice, and without this
  // both runs reach the model. See Plan.jsx for what that cost when it did.
  const busy = useRef(false)

  useEffect(() => {
    let cancelled = false

    async function go() {
      try {
        const s = await loadOrCreateSession()
        if (cancelled) return

        // No plan, no play. The order is the product and it applies here too.
        if (!s.map?.moves?.length) { navigate(`${WAYOUT_BASE}/plan`, { replace: true }); return }
        if (!(order >= 1 && order <= s.map.moves.length)) {
          navigate(`${WAYOUT_BASE}/plan`, { replace: true }); return
        }

        setSessionId(s.id)
        const current = s.map.moves[order - 1]
        setMove(current)

        // ⚠️ moveIsOpen is always true since 31 Oct 2026 (Daniel: never block
        // unless a thing truly has to come first). The check stays so the rule
        // keeps one home in session.js if it ever changes again.
        const prog = await loadProgress(s.id)
        if (cancelled) return
        setIsDone(prog.done.has(order))
        if (!moveIsOpen(order, prog.done)) {
          setLocked(true)
          setLoading(false)
          return
        }

        const stored = await loadPlaybook(s.id, order)
        if (cancelled) return

        if (stored?.play) {
          const isStale = playbookIsStale(stored, current)
          setStale(isStale)
          setMoveNow(isStale ? (current?.title ?? null) : null)
          setThread(Array.isArray(stored.thread) ? stored.thread : [])
          setSession(s)
          setPlay(stored.play)
          return
        }

        if (busy.current) return
        busy.current = true
        setSession(s)

        // ⭐⭐ ASK BEFORE ANSWERING. The intake asked about a LIFE; this is
        // about one MOVE, and the questions that decide whether the advice is
        // right could not have been asked earlier — they depend on which move
        // the plan chose. Cheap, fast, and the reason this is worth paying for
        // rather than a gate with a price on it.
        const qs = await generateMoveQuestions({ answers: s.answers, map: s.map, move: current })
        if (cancelled) return
        if (qs.length) { setAsk({ questions: qs }); setLoading(false); busy.current = false; return }

        // ⚠️ No questions is a valid outcome, not a failure. Some moves have
        // nothing whose answer would change the week, and inventing one to
        // have a gate would be a form.
        //
        // ⚠️ Inlined rather than calling `write` — the effect runs once per
        // move and adding a function to its dependencies re-runs it on every
        // render, which on this page means regenerating a play-by-play.
        const written = await generatePlaybook({ answers: s.answers, map: s.map, move: current })
        if (cancelled) return
        if (!written?.crisis) {
          await savePlaybook({ sessionId: s.id, moveOrder: order, move: current, play: written, asked: null })
        }
        if (!cancelled) setPlay(written)
      } catch (err) {
        if (!cancelled) setError(err.message)
      } finally {
        busy.current = false
        if (!cancelled) setLoading(false)
      }
    }

    go()
    return () => { cancelled = true }
  }, [navigate, order])

  /**
   * Write the play, with whatever they told us about this move.
   *
   * ⚠️ A crisis answer is never stored. It is about right now, not about this
   * move, and keeping it would hand it back weeks later as though it were
   * still true.
   */
  async function write(s, current, asked) {
    setLoading(true)
    busy.current = true
    try {
      const written = await generatePlaybook({ answers: s.answers, map: s.map, move: current, asked })
      if (!written?.crisis) {
        await savePlaybook({ sessionId: s.id, moveOrder: order, move: current, play: written, asked })
      }
      setAsk(null)
      setThread([])
      setPlay(written)
    } catch (err) {
      setError(err.message)
    } finally {
      busy.current = false
      setLoading(false)
    }
  }

  /**
   * ⭐ Ask again and rewrite this move's play-by-play.
   *
   * 🔴 Daniel changed the prompt, reloaded /play/1, and saw the old advice —
   * "CORRECTION ISNT SHOWING". It was not: a stored play is loaded and the
   * questions step never runs, which is correct for a person mid-week and
   * useless for the person writing the thing. Exactly the same trap as the
   * plan's rebuild cap locking the author out of his own product.
   *
   * ⚠️ DEV ONLY. For a real person the play is written once ON PURPOSE —
   * coming back mid-week to different words to send would mean the
   * instructions changed underneath them while they were following them. The
   * product answer to "this does not fit" is the stale path and the questions,
   * not a re-roll button.
   */
  async function rewrite() {
    const s = await loadOrCreateSession()
    const current = s.map.moves[order - 1]
    setPlay(null)
    setAsk(null)
    setLoading(true)
    setSession(s)
    setMove(current)
    const qs = await generateMoveQuestions({ answers: s.answers, map: s.map, move: current })
    if (qs.length) { setAsk({ questions: qs }); setLoading(false); return }
    await write(s, current, null)
  }

  async function toggleDone(next) {
    setIsDone(next)
    try {
      await markMoveDone(sessionId, order, next)
      // ⭐ Straight on. They said the gate is true, which is precisely the
      // moment the next move becomes worth wanting — making them find their
      // own way there is how a product loses somebody who was ready.
      if (next) navigate(order < 3 ? `${WAYOUT_BASE}/play/${order + 1}` : `${WAYOUT_BASE}/done`)
    } catch (err) { setError(err.message) }
  }

  if (error) {
    return (
      <WayoutShell title="This week">
        <p className="wayout__q">That didn’t come through.</p>
        <p className="wayout__lead">{humanError(error)}</p>
        <button className="wayout__btn" onClick={() => navigate(0)}>Try again</button>
      </WayoutShell>
    )
  }

  // ⚠️ Not an error, and not a wall with a price on it. They are early, which
  // is the plan working — so it says which move they are on and sends them
  // back to it rather than making them feel refused.
  if (locked) {
    return (
      <WayoutShell title="Finish the move before this one">
        <p className="wayout__q">Move {order - 1} comes first.</p>
        <p className="wayout__lead">
          {move?.title
            ? `This one starts once that is done. It is written for where you will be then, not where you are now.`
            : 'This one starts once the move before it is done.'}
        </p>
        <button className="wayout__btn" onClick={() => navigate(`${WAYOUT_BASE}/play/${order - 1}`)}>
          Open move {order - 1}
        </button>
        <p className="wayout__rebuild">
          <button type="button" className="wayout__again" onClick={() => navigate(`${WAYOUT_BASE}/plan`)}>
            Back to the plan
          </button>
        </p>
      </WayoutShell>
    )
  }

  // ⚠️ Before the loading check: the questions ARE the page at this point, and
  // there is nothing to wait for.
  if (ask && !play) {
    return (
      <Asking
        move={move}
        questions={ask.questions}
        busy={loading}
        onSubmit={answers => write(session, move, { questions: ask.questions, answers })}
      />
    )
  }

  if (loading || !play) {
    return (
      <WayoutShell title="This week" wide>
        {/* ⚠️ The lines are the SECTIONS OF THE WALKTHROUGH, in the order they
            will appear — which is why this screen is allowed to exist at all.
            See the top of Working.jsx for the rule it obeys. */}
        <Working foot="Up to a minute." lines={[
          'What to do first.',
          'The words to use.',
          'What you need before you start.',
          'What usually goes wrong.',
        ]} />
      </WayoutShell>
    )
  }

  // ⚠️ A crisis answer replaces the whole page, and nothing is offered on it.
  if (play.crisis) {
    return (
      <WayoutShell title="Read this first">
        <div className="wayout__crisis">
          {String(play.message).replace(/\*\*/g, '').split(/\n{2,}/).filter(Boolean).map((p, i) => (
            <p key={i} className={i === 0 ? 'wayout__q' : 'wayout__lead'}>{p.trim()}</p>
          ))}
        </div>
        <CrisisHelp region={session?.answers?.region} />
      </WayoutShell>
    )
  }

  return (
    <>
      {/* ⚠️ The plan was rebuilt after this was written, so the move it
          describes is not the move they are on. Said plainly rather than
          silently regenerating — the week they have already spent on it is
          theirs, and we do not get to decide it was wasted. */}
      {/* ⚠️ Everything below now renders INSIDE the playbook's own shell. As
          siblings they fell outside the card — invisible button, unstyled
          block. See the note on Playbook. */}
      {/* ⚠️ MARKED, NOT JUST ANNOUNCED. The notice above sat over a play that
          rendered at full strength — same weight, same authority — so somebody
          could read the whole thing and act on it without registering that it
          describes a move their plan no longer contains. Daniel: "shouldn't it
          auto update?" Auto-regenerating would spend a generation every time
          the page is opened and rewrite instructions somebody may be halfway
          through following. Making the state visible costs neither. */}
      <Playbook play={play} index={order} superseded={stale} notice={stale ? (
        <div className="wayout__stale">
          <p>
            Your plan has changed since this walkthrough was written, so these are
            the steps for your old move {order}.
            {moveNow ? <> Your move {order} is now <b>{moveNow}</b>.</> : null}
          </p>
          <p>
            <button
              type="button"
              className="wayout__btn"
              onClick={async () => { setPlay(null); setStale(false); setMoveNow(null); busy.current = false
                try {
                  const s = await loadOrCreateSession()
                  const current = s.map.moves[order - 1]
                  const written = await generatePlaybook({ answers: s.answers, map: s.map, move: current })
                  if (!written?.crisis) await savePlaybook({ sessionId: s.id, moveOrder: order, move: current, play: written })
                  setPlay(written)
                } catch (err) { setError(err.message) }
              }}
            >
              Write the walkthrough for this move
            </button>
          </p>
        </div>
      ) : null} onSection={label => {
        // ⚠️ A space on the end so the cursor lands after the colon, and a
        // unique suffix is not needed — clicking the SAME section twice should
        // not wipe what they have started typing about it.
        setSeed(`About "${label}": `)
        requestAnimationFrame(() => document.getElementById('wayout-ask')?.focus())
      }}>

      {/* ⭐⭐ THE THING THAT STOPS THIS BEING A GATED ANSWER PLATFORM. */}
      <AskBox
        region={session?.answers?.region}
        seed={seed}
        thread={thread}
        onAsk={async question => {
          const mine = { role: 'user', content: question, at: new Date().toISOString() }
          const next = [...thread, mine]
          setThread(next)
          const reply = await askAboutMove({
            answers: session.answers, map: session.map, move, play, thread, question,
          })
          const full = [...next, { role: 'assistant', content: reply, at: new Date().toISOString() }]
          setThread(full)
          saveThread(session.id, order, full).catch(err => console.warn('[wayout] thread not saved:', err))
        }}
        pinned={pinned}
        onPin={async text => {
          // ⚠️ The plan board renders move_notes beside each move, so this is
          // the shelf that already exists rather than a new place to look.
          try {
            await saveMoveNote(session.id, order, text, session.move_notes ?? {})
            setPinned(text)
          } catch (err) { console.warn('[wayout] pin failed:', err.message) }
        }}
      />

      {/* ⭐⭐ THE ONE ACTION THAT MOVES THE PRODUCT FORWARD. Ticking this is
          what opens the next move — it is not a progress bar, it is the gate
          the plan has been promising under every move since the first screen.

          ⚠️ Their claim, and nothing asks for proof. Requiring evidence turns
          this into something that audits people, and being audited is what
          they are already avoiding. */}
      <div className="wayout__doneit">
        {isDone ? (
          <p>
            <b>Done.</b>{' '}
            {order < 3
              ? <button type="button" className="wayout__again" onClick={() => navigate(`${WAYOUT_BASE}/play/${order + 1}`)}>Open move {order + 1}</button>
              : <button type="button" className="wayout__again" onClick={() => navigate(`${WAYOUT_BASE}/done`)}>I have finished all three</button>}
            {' · '}
            <button type="button" className="wayout__again" onClick={() => toggleDone(false)}>Undo, not done yet</button>
          </p>
        ) : (
          <>
            {/* 🔴 "That is done" read as a HEADING, not a button — Daniel:
                "this doesnt really show you how to go to the next thing". The
                gate text sat under it as grey hint, so the one action that
                moves the product forward looked like a caption. Now the
                condition comes FIRST, as the thing to check, and the button
                says what happens rather than what state you are in. */}
            <p className="wayout__gatecheck">{play.done_when}</p>
            <button className="wayout__btn wayout__btn--sun" onClick={() => toggleDone(true)}>
              {order < 3 ? `Yes, I have done this. Open move ${order + 1}` : 'Yes, I have done all three'}
            </button>
            <p className="wayout__hint">
              Only when it is actually true. Move {order < 3 ? order + 1 : 3} is written for where you
              are after this one, so ticking it early gets you a plan for somebody else.
            </p>
          </>
        )}
        <p className="wayout__rebuild">
          <button type="button" className="wayout__again" onClick={() => navigate(`${WAYOUT_BASE}/plan`)}>
            Back to the plan
          </button>
          {/* Dev only — see rewrite(). The guard is inline so Vite can drop the
              branch at build time; on the prop it would ship the markup. */}
          {import.meta.env.DEV && (
            <>
              {' · '}
              <button type="button" className="wayout__again" onClick={rewrite}>
                Ask again and rewrite
              </button>
              {'dev only'}
            </>
          )}
        </p>
      </div>
      </Playbook>
    </>
  )
}
