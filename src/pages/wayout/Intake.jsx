import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useSearchParams } from 'react-router-dom'
import WayoutShell from './WayoutShell'
import { isAnswered, isThin } from '../../lib/wayout/validate'
import { WAYOUT_OPENING, WAYOUT_OPEN, WAYOUT_SCREENS, WAYOUT_TOTAL_SCREENS } from '../../content/wayoutIntake'
import { loadOrCreateSession, saveAnswers, markComplete, reflect, adoptDraftInto } from '../../lib/wayout/session'
import { saveDraft, loadDraft, draftBelongsToSomeoneElse, markHandoff } from '../../lib/wayout/draft'
import { supabase } from '../../lib/supabase'
import { WAYOUT_BASE, timeLine } from '../../lib/wayout/brand'
import { priceShort } from '../../lib/wayout/pricing'
import { Marked } from '../../lib/wayout/marked.jsx'
import { intakeProgress } from '../../lib/wayout/progress'
import { sheetRows } from '../../lib/wayout/planSheet'
import { Answer } from './IntakeAnswer'
import { plainField } from '../../content/wayoutIntakePlain'
import { tick, buzz } from '../../lib/wayout/feedback'

/**
 * The way out — the opening screen and the six intake screens.
 *
 * ⭐ The order of the questions is the product (see wayoutIntake.js): what
 * can't move, who's affected, what you own, the money, what you'd trade, and
 * only then where you want to end up. Asking the destination first is the
 * pleasant version and it produces a plan nobody can follow.
 */


/**
 * ⚠️ `preview` is DEV ONLY (see Preview routes in App.jsx) and does exactly
 * three things: skips the session load, skips every write, and serves a canned
 * reflection. It changes no rendering at all — the screens, the validation and
 * the field components are the same ones a paying person gets, which is the
 * entire reason it is a prop here rather than a second copy of the intake that
 * would drift from this one within a week.
 */
export default function Intake({ preview = false, previewReflections = null }) {
  const navigate = useNavigate()
  const [params] = useSearchParams()

  // step 0 is the opening screen; 1..6 are the intake screens.
  const [step, setStep]         = useState(0)
  const [answers, setAnswers]   = useState({})
  const [session, setSession]   = useState(null)
  const [errors, setErrors]     = useState({})
  // ⭐ "Say a bit more" notes, shown ONCE per field. Asked keys are remembered
  // so the second press of Next always goes through: a nudge, never a wall.
  const [nudges, setNudges]     = useState({})
  const nudged = useRef(new Set())
  const [loading, setLoading]   = useState(!preview)
  const [saving, setSaving]     = useState(false)
  const [loadError, setLoadError] = useState('')

  // Reflections are keyed by the screen they were generated FROM, and rendered
  // on the screen after it. Held in a ref as well as state so the fetch can
  // check for one already in flight without re-running on every render.
  const [reflections, setReflections] = useState({})
  const inFlight = useRef(new Set())

  useEffect(() => {
    if (preview) return undefined
    let cancelled = false

    // ⭐ NO ACCOUNT NEEDED TO ANSWER. Someone signed out works from a local
    // draft and is not asked for anything until the end — a wall in front of a
    // product that has not done anything yet is the worst place to put one.
    supabase.auth.getUser().then(({ data }) => {
      if (cancelled) return
      if (!data?.user) {
        const d = loadDraft()
        // ⚠️ Signed out, so an owned draft cannot be theirs to resume. Belt to
        // the sign-in braces in Enter.jsx: whichever route somebody took to get
        // here, another account's half-finished answers do not open.
        if (draftBelongsToSomeoneElse(null)) {
          navigate(`${WAYOUT_BASE}/start`, { replace: true })
          return
        }
        // ⭐ A COLD ARRIVAL GOES TO THE FRONT DOOR, NOT THE TILL. This screen
        // is the start of the fifteen-minute paid flow; the diagnostic is three
        // minutes, free, and proves something before asking for anything. A
        // stranger landing straight here is being asked for the big commitment
        // by a product that has not yet done a single thing for them.
        //
        // ⚠️ Only when there is genuinely nothing in progress: a draft means
        // they are mid-flow, and `?start=1` is how the diagnostic's own result
        // screen sends people here deliberately, so neither gets bounced.
        if (!d && !params.get('start')) {
          navigate(`${WAYOUT_BASE}/start`, { replace: true })
          return
        }
        if (d) {
          setAnswers(d.answers ?? {})
          /**
           * 🔴🔴 ARRIVING FROM THE DIAGNOSTIC MUST NOT RE-INTRODUCE THE PRODUCT.
           * Daniel, walking the live journey: "i think it needs to be more
           * streamline, it's confusing — the 3 min thing, all the questions
           * should keep going."
           *
           * He is right and it was worse than untidy. Somebody answered six
           * questions, was told "this was the three-minute version", and landed
           * on a SECOND opening screen — new headline, new promise, another box
           * to type in — which reads as arriving at a different product rather
           * than continuing in this one. Their diagnostic answers were already
           * carried across, so step 0 was asking for a commitment they had
           * already made.
           *
           * ⚠️ Only when something was actually carried. A cold `?start=1` with
           * an empty draft still gets the opening screen, because then it really
           * is the beginning.
           */
          const carried = Object.keys(d.answers ?? {}).length > 0
          setStep(carried ? firstUnansweredStep(d.answers) : (d.step ?? 0))
        }
        setLoading(false)
        return
      }
      loadOrCreateSession()
        .then(adoptDraftInto)
        .then(s => {
          if (cancelled) return
          setSession(s)
          setAnswers(s.answers ?? {})
          // ⭐⭐ ?edit=1 IS HOW YOU CHANGE A PLAN. Daniel: "shouldn't they be
          // able to tweak it once registered?" — and the deeper reason he is
          // right is that rebuilding on the SAME answers hands back a different
          // plan for no reason, which quietly says neither one meant anything.
          // A plan should only change when something about the life changed.
          // So the way back in is through the questions, with their own answers
          // already in the boxes.
          /**
           * 🔴🔴 A CHAPTER-2 SESSION BELONGS ON /chapter, AND THIS SENT IT BACK
           * INTO THE SIX SCREENS. Daniel, signing in: "still land here when I
           * log in" — on "Money, plainly", screen four, with empty boxes.
           *
           * It was not the draft and not a leak. `startNextChapter` clears
           * exactly the money answers, so `firstUnansweredStep` correctly found
           * screen four unanswered and correctly resumed there — in the full
           * intake, which is precisely what /chapter exists to replace.
           *
           * ⭐⭐ Chapter.jsx already refuses a chapter-1 session and sends it here.
           * The mirror was missing, so the two screens did not agree about who
           * owns a session and the intake won by being the default landing.
           * ⚠️ A pair of guards has to be written as a pair.
           */
          if ((s.chapter ?? 1) > 1 && s.status !== 'paid') {
            navigate(`${WAYOUT_BASE}/chapter`, { replace: true })
            return
          }
          if (params.get('edit')) setStep(1)
          // A paid session is finished — send them to the plan they bought
          // rather than showing an empty form on top of it.
          else if (s.status === 'paid') navigate(`${WAYOUT_BASE}/plan`, { replace: true })
          /**
           * 🔴🔴 THE DEAD END AT THE END OF THE WHOLE FLOW. Daniel: "when i went
           * to create an account and did that here is where it brought me" — back
           * into the questions, on a screen he had already answered.
           *
           * Somebody signed out answers everything into a local draft, hits the
           * account wall, signs up, and lands on `/plan`. `markComplete` is only
           * called on the branch that HAS a session, and they never had one while
           * answering — so the session stayed `draft`, `/plan` bounced them to the
           * intake, and the intake put them back on a question.
           *
           * ⭐⭐ THE FIX IS TO ASK THE ANSWERS, NOT THE ROUTE. If there is nothing
           * left to ask, there is nothing to show them here — mark it complete and
           * send them to the plan they just finished earning. That is true however
           * they got here, which the draft's step number was not.
           */
          else if (intakeIsComplete(s.answers ?? {})) {
            markComplete(s.id, s.answers)
              .then(() => { if (!cancelled) navigate(`${WAYOUT_BASE}/plan`, { replace: true }) })
              .catch(err => { if (!cancelled) setLoadError(err.message) })
            return
          }
          // Someone part-way through resumes where they stopped rather than
          // re-reading questions they already answered.
          else if (s.answers && Object.keys(s.answers).length > 0) {
            setStep(firstUnansweredStep(s.answers))
          }
        })
        .catch(err => { if (!cancelled) setLoadError(err.message) })
        .finally(() => { if (!cancelled) setLoading(false) })
    })

    return () => { cancelled = true }
  }, [navigate, preview, params])

  const screen = step === 0 ? null : WAYOUT_SCREENS[step - 1]

  /**
   * ⭐⭐ ONE QUESTION AT A TIME (Daniel, 2 Nov 2026: "the intake is super
   * messy", then on the test page "looks way better, apply it"). A STEP is still
   * a whole screen of the old design, and everything that happens per step is
   * unchanged: validation, the save, the draft, the reflection, sign-up at the
   * end. Inside a step, `sub` walks its questions one by one, and a 1 to 10
   * field one item at a time.
   * ⚠️ `pos` remembers which step it belongs to, so a new step always starts at
   * its first question (or its last, coming back) without a flash of the wrong one.
   */
  const [pos, setPos] = useState({ step: 0, sub: 0 })
  const [drawer, setDrawer] = useState(false)
  const items = itemsFor(step, answers)
  const rawSub = pos.step === step ? pos.sub : 0
  const sub = rawSub === 'end' ? items.length - 1 : Math.max(0, Math.min(rawSub, items.length - 1))
  const advanceRef = useRef(null)

  // 🔴 EVERY ADVANCE LANDED WHEREVER THE LAST ONE ENDED. These screens are long
  // enough to scroll, and React keeps the scroll position across a state
  // change, so pressing Next at the bottom of screen three dropped you at the
  // bottom of screen four — past the question you were being asked. The app
  // shell has ScrollToTopOnNavigate for route changes; this is a step change
  // inside one route, so nothing was watching it.
  //
  // ⚠️ 'instant', not smooth: a half-second scroll animation between every
  // question reads as the page fighting you.
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
  }, [step])

  function setValue(key, value) {
    setAnswers(a => {
      const next = { ...a, [key]: value }
      // 🔴 A hidden answer was still sent. Found 10 Oct on a real plan: somebody
      // tapped two goals, picked "More time" as the one for this year, then
      // untapped it. The follow-up disappeared and its answer stayed, and the
      // plan is told that answer decides its direction.
      if (key === 'goalType' && !(Array.isArray(value) && value.length > 1)) delete next.goalFirst
      return next
    })
    // Clear the inline error the moment they answer, rather than making them
    // press Next again to find out they fixed it.
    setErrors(e => (e[key] ? { ...e, [key]: undefined } : e))
    setNudges(n => (n[key] && !isThin({ nudge: true }, value) ? { ...n, [key]: undefined } : n))
  }

  /** The thin answers on this step not yet nudged. Marks them asked. */
  function nudgeThin(fields) {
    const thin = {}
    for (const f of fields) {
      if (!nudged.current.has(f.key) && isThin(f, answers[f.key])) thin[f.key] = f.nudgeMessage
    }
    for (const k of Object.keys(thin)) nudged.current.add(k)
    setNudges(thin)
    return Object.keys(thin).length > 0
  }

  /**
   * Kick off the reflection for the screen just completed.
   *
   * ⭐ Fire-and-forget, deliberately. It runs while the person is reading the
   * next question, so by the time they look up it is usually there — and if it
   * never arrives, nothing waited on it. Blocking Next on a model call would
   * put a spinner between every screen of a fifteen-minute form.
   */
  function kickOffReflection(fromScreen) {
    if (!fromScreen?.reflectAfter) return
    if (inFlight.current.has(fromScreen.id)) return
    inFlight.current.add(fromScreen.id)

    const screenAnswers = Object.fromEntries(
      fromScreen.fields
        .map(f => [f.key, answers[f.key]])
        .filter(([, v]) => v != null && v !== ''),
    )

    if (preview) {
      // ⚠️ The sample copy is passed IN, not written here. Left inline it ended
      // up in the production Intake chunk — unreachable, since nothing sets
      // `preview` in a prod build, but sample text has no business riding along
      // in the component a paying person loads.
      const text = previewReflections?.[fromScreen.id]
      if (text) setTimeout(() => setReflections(r => ({ ...r, [fromScreen.id]: text })), 600)
      return
    }

    // ⚠️ Reflections need an account — the function refuses an anonymous call,
    // and every screen of the signed-out path was firing one into a 401.
    if (!session) return
    reflect(screenAnswers)
      .then(text => { if (text) setReflections(r => ({ ...r, [fromScreen.id]: text })) })
      .catch(() => { /* reflect() already swallows; nothing to show either way */ })
  }

  async function next() {
    if (step === 0) {
      const f = WAYOUT_OPENING.field
      if (!isAnswered(f, answers[f.key])) {
        setErrors({ [f.key]: f.emptyMessage })
        return
      }
      if (!preview) {
        if (session) {
          setSaving(true)
          try { await saveAnswers(session.id, answers) } catch { /* saved again next step */ }
          setSaving(false)
        } else {
          saveDraft(answers, 1)
        }
      }
      setStep(1)
      return
    }

    // 🔴 `screen` IS UNDEFINED ON THE OPEN-BOX STEP — it is step 7 of a
    // six-screen array. This loop ran unconditionally and threw before reaching
    // the navigation, so "See the plan" never worked for anybody, and the crash
    // was silent: a TypeError in a click handler just does nothing visible.
    if (screen) {
      const missing = {}
      for (const f of visibleFields(screen, answers)) {
        if (!isAnswered(f, answers[f.key])) missing[f.key] = f.emptyMessage ?? 'Add an answer.'
      }
      if (Object.keys(missing).length) { setErrors(missing); return }
      if (nudgeThin(visibleFields(screen, answers))) return
      kickOffReflection(screen)
    } else if (step > WAYOUT_TOTAL_SCREENS) {
      const f = WAYOUT_OPEN.field
      if (!isAnswered(f, answers[f.key])) { setErrors({ [f.key]: f.emptyMessage }); return }
      if (nudgeThin([f])) return
    }

    if (preview) {
      if (step > WAYOUT_TOTAL_SCREENS) { navigate(`${WAYOUT_BASE}/preview`); return }
      setStep(step + 1)
      return
    }

    // ── No account yet ──────────────────────────────────────────────────
    // 🔴 THE WALL MOVED TO THE END. They answer everything as a stranger, and
    // are only asked for an account at the point where they can see what they
    // would be keeping. Nothing is lost by saying no — the draft is still here.
    if (!session) {
      if (step > WAYOUT_TOTAL_SCREENS) {
        saveDraft(answers, step)
        markHandoff()
        navigate(`${WAYOUT_BASE}/enter?next=${encodeURIComponent(`${WAYOUT_BASE}/plan`)}`)
        return
      }
      saveDraft(answers, step + 1)
      setStep(step + 1)
      return
    }

    setSaving(true)
    try {
      if (step > WAYOUT_TOTAL_SCREENS) {
        await markComplete(session.id, answers)
        // ⚠️ `rebuild` is what tells the plan their answers moved. Without it a
        // stored map that still passes the contract renders untouched and they
        // would walk every question to see the same plan — which is exactly
        // what happened to Daniel this morning, one layer up.
        navigate(`${WAYOUT_BASE}/plan${params.get('edit') ? '?rebuild=1' : ''}`)
        return
      }
      await saveAnswers(session.id, answers)
      setStep(step + 1)
    } catch (err) {
      setErrors({ _save: err.message })
    } finally {
      setSaving(false)
    }
  }

  function back() {
    setErrors({})
    setNudges({})
    setStep(s => Math.max(0, s - 1))
  }

  /** Next question in this step, or the step's own Next on its last one. */
  function advance() {
    const cur = items[sub]
    if (!cur) return next()
    const f = cur.field
    const lastOfField = f.kind !== 'score' || cur.item === f.options.length - 1
    if (lastOfField) {
      if (!isAnswered(f, answers[f.key])) { setErrors({ [f.key]: f.emptyMessage ?? 'Add an answer.' }); return }
      if (!nudged.current.has(f.key) && isThin(f, answers[f.key])) {
        nudged.current.add(f.key)
        setNudges({ [f.key]: f.nudgeMessage })
        return
      }
    }
    setErrors({}); setNudges({})
    if (sub < items.length - 1) { setPos({ step, sub: sub + 1 }); return }
    next()
  }
  // A tap on a choice moves on after a beat; by then the answer is in state,
  // so the timer calls the newest advance, not the one from before the tap.
  useEffect(() => { advanceRef.current = advance })

  /** Optional questions and single 1 to 10 items can be passed over. */
  function skip() {
    setErrors({}); setNudges({})
    if (sub < items.length - 1) { setPos({ step, sub: sub + 1 }); return }
    next()
  }

  function goBack() {
    setErrors({}); setNudges({})
    if (sub > 0) { setPos({ step, sub: sub - 1 }); return }
    if (step === 0) return
    setPos({ step: step - 1, sub: 'end' })
    back()
  }

  if (loading) {
    return <WayoutShell><p className="wayout__lead">One moment.</p></WayoutShell>
  }

  if (loadError) {
    return (
      <WayoutShell>
        <p className="wayout__q">That didn’t load.</p>
        <p className="wayout__lead">{loadError}</p>
        <button className="wayout__btn" onClick={() => window.location.reload()}>Try again</button>
      </WayoutShell>
    )
  }

  // ── The question on screen ──────────────────────────────────────────────
  const sheet = sheetRows(answers, step)
  const cur = items[sub]
  const f = cur.field
  const isOpening = step === 0
  const isOpen = step > WAYOUT_TOTAL_SCREENS
  // The reflection written from the PREVIOUS screen, shown on this screen's first question.
  const prev = WAYOUT_SCREENS[step - 2]
  const reflection = !isOpening && sub === 0 && prev ? reflections[prev.id] : null
  const from = parseFloat(intakeProgress(step)), to = parseFloat(intakeProgress(step + 1))
  const progress = `${Math.min(100, from + (to - from) * (sub / Math.max(1, items.length)))}%`
  const autoMoves = f.kind === 'choice' || f.kind === 'score'
  const cta = isOpening ? WAYOUT_OPENING.cta : isOpen ? WAYOUT_OPEN.cta : 'Next'

  return (
    <WayoutShell wide signIn={isOpening}>
      <div className="wayout__q2">
        <div className="wayout__q2top">
          <button type="button" className="wayout__q2back" onClick={goBack} disabled={isOpening} aria-label="Back">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M15 5l-7 7 7 7" /></svg>
          </button>
          <div className="wayout__q2bar" aria-hidden="true"><i style={{ width: progress }} /></div>
          {/* ⭐ The plan being built as they go (Daniel: "so they are enticed to see
              the outcome"), now a button rather than a third of the screen. */}
          <button type="button" className="wayout__q2pill" onClick={() => setDrawer(true)}>Your plan <b>{sheet.length}</b></button>
        </div>

        <div className="wayout__q2screen" key={`${step}:${sub}`}>
          {reflection && <p className="wayout__q2reflect">{reflection}</p>}
          {isOpening ? (
            <>
              <h1><Marked text={WAYOUT_OPENING.headline} highlight={WAYOUT_OPENING.highlight} /></h1>
              <p className="wayout__q2hint">{WAYOUT_OPENING.lead}</p>
              <p className="wayout__q2label">{f.label}</p>
            </>
          ) : (
            <>
              <p className="wayout__q2kicker">{f.kicker}</p>
              <h1>{f.labelFor?.(answers) ?? f.label}</h1>
            </>
          )}
          {f.hint && <p className="wayout__q2hint">{f.hint}</p>}
          {(answers._carried ?? []).includes(f.key) && (
            <p className="wayout__q2carried">From your first answers. Add anything they missed.</p>
          )}
          <Answer field={f} item={cur.item} value={answers[f.key]} set={v => setValue(f.key, v)} region={answers.region}
            onPick={() => { tick(); buzz(); setTimeout(() => advanceRef.current?.(), 260) }} onEnter={advance} />
          {errors[f.key] && <p className="wayout__q2err" role="alert">{errors[f.key]}</p>}
          {nudges[f.key] && <p className="wayout__q2nudge" role="status">{nudges[f.key]}</p>}
          {errors._save && <p className="wayout__q2err" role="alert">{errors._save}</p>}
        </div>

        <div className="wayout__q2acts">
          {!autoMoves && (
            <button type="button" className="wayout__q2go" onClick={() => { if (!isOpening) tick(); advance() }} disabled={saving}>{cta}</button>
          )}
          {(!f.required || f.kind === 'score') && (
            <button type="button" className="wayout__q2skip" onClick={skip} disabled={saving}>{f.kind === 'score' ? 'Skip this one' : 'Skip'}</button>
          )}
          {isOpening && <p className="wayout__q2fine">{timeLine()} {priceShort()}</p>}
        </div>
      </div>

      {drawer && createPortal(
        <div className="wayout__pportal wayout__q2portal">
          <div className="wayout__q2scrim" onClick={() => setDrawer(false)} />
          <aside className="wayout__q2drawer" aria-label="Your plan so far">
            <button type="button" className="wayout__q2close" onClick={() => setDrawer(false)}>Close</button>
            <h2>Your plan so far</h2>
            <p className="wayout__q2hint">Built from your answers. Your three moves are written when you finish.</p>
            {sheet.length ? sheet.map(r => (
              <div key={r.label} className="wayout__q2row">
                <b>{r.label}</b>
                {r.text ? <p className={r.hand ? 'is-hand' : ''}>{r.text}</p> : null}
                {r.items?.length ? <p>{r.items.join(', ')}</p> : null}
              </div>
            )) : <p className="wayout__q2hint">Nothing yet. It fills in as you answer.</p>}
          </aside>
        </div>,
        document.body,
      )}
    </WayoutShell>
  )
}

/** The questions of one step, in order: hidden ones left out, plain wording on,
 *  and each 1 to 10 item its own question. */
function itemsFor(step, answers) {
  const fields = step === 0 ? [WAYOUT_OPENING.field]
    : step > WAYOUT_TOTAL_SCREENS ? [WAYOUT_OPEN.field]
    : visibleFields(WAYOUT_SCREENS[step - 1], answers)
  return fields.map(plainField)
    .flatMap(f => (f.kind === 'score' ? f.options.map((_, i) => ({ field: f, item: i })) : [{ field: f }]))
}

/**
 * Where to drop someone resuming a draft.
 *
 * ⚠️ The first screen with a REQUIRED field unanswered, not the last screen
 * with anything on it. Someone who skipped an optional free text on screen two
 * and filled in screen three should not be sent back to two.
 */
/**
 * 🔴 THE FIELDS ACTUALLY ON SCREEN, WHICH IS NOT THE SAME AS THE FIELDS DEFINED.
 *
 * Every place that walks a screen's fields must walk THIS, not `screen.fields`.
 * A hidden field that is also required would block the form with an error
 * rendered nowhere — the button does nothing, no message appears, and there is
 * no way for the person to find out why. None of today's five conditionals are
 * required, so this is a guard against the next one rather than a live bug.
 */
function visibleFields(screen, answers) {
  return (screen?.fields ?? []).filter(f => !f.showIf || f.showIf(answers))
}

/**
 * 🔴🔴 THIS RETURNED THE LAST SCREEN WHEN EVERY SCREEN WAS ANSWERED, and that
 * off-by-one is half of the worst bug in the product: somebody finished all the
 * questions, was asked to make an account, made one — and was dropped back onto
 * a question they had already answered.
 *
 * ⭐ Past the last screen is `WAYOUT_TOTAL_SCREENS + 1`, which is the open box.
 * Returning `WAYOUT_TOTAL_SCREENS` means "go and read screen six again".
 */
function firstUnansweredStep(answers) {
  for (let i = 0; i < WAYOUT_SCREENS.length; i++) {
    const unanswered = visibleFields(WAYOUT_SCREENS[i], answers)
      .some(f => !isAnswered(f, answers[f.key]))
    if (unanswered) return i + 1
  }
  return WAYOUT_TOTAL_SCREENS + 1
}

/** Every screen answered AND the open box written. Nothing left to ask. */
function intakeIsComplete(answers) {
  return firstUnansweredStep(answers) > WAYOUT_TOTAL_SCREENS
    && isAnswered(WAYOUT_OPEN.field, answers[WAYOUT_OPEN.field.key])
}
