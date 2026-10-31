import { Fragment, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import WayoutShell from './WayoutShell'
import {
  loadOrCreateSession, loadSessionById, generateMap, countRebuild, insistOn, wantPlaybook, loadProgress,
  askAboutPlan, chooseBetween, savePlanThread, saveAnswers, chapterChain, saveMapKeepingLast, restorePreviousMap,
  markMoveDone, moveIsOpen, saveMoveNote, WAYOUT_MAX_REBUILDS, enforceMapContract, mapProblems, historyFor, enrichAnswers,
} from '../../lib/wayout/session'
import { WAYOUT_MAP_LABEL, WAYOUT_BASE, WAYOUT_INTAKE } from '../../lib/wayout/brand'
import { editDestination } from '../../lib/wayout/sessionHome'
import { tidyQuote } from '../../lib/wayout/tidyQuote'
import Working from './Working'
import PlanThread, { VersionSwitch } from './PlanThread'
import { humanError } from '../../lib/wayout/humanError'
import { correctableAnswers, correctionSentence } from '../../lib/wayout/correctable'
import { versionList, liveVersions, removeVersion, dropDraft, openFrom, samePlan, crossOffOthers, bringBack, storeChoice, rebuildTurns } from '../../lib/wayout/planVersions'
import { WAYOUT_PRICE_FULL, WAYOUT_PAYMENTS_LIVE, guaranteeLine } from '../../lib/wayout/pricing'
import { tick, buzz } from '../../lib/wayout/feedback'
import { bookOnShelf } from '../../content/wayoutReading'
import { Marked } from '../../lib/wayout/marked.jsx'
import CrisisHelp from './CrisisHelp'
import { bridgeToEliv8 } from '../../lib/bridges'
import Bridge from './Bridge'
import Handoff from './Handoff'
import ShareCard from './ShareCard'
import InviteConsent from './InviteConsent'

/**
 * The way out — S7, the reveal.
 *
 * Three states, in order of what the person has done:
 *   intake not finished  → back to the questions
 *   finished, not paid   → the one thing we ask for
 *   paid                 → the map
 */

const REDUCED = typeof window !== 'undefined'
  && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export default function Plan() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [session, setSession]   = useState(null)
  const [map, setMap]           = useState(null)
  const [loading, setLoading]   = useState(true)
  const [building, setBuilding] = useState(false)
  const [threadBuild, setThreadBuild] = useState(null)
  const [threadErr, setThreadErr] = useState('')
  const [choosing, setChoosing] = useState(false)
  const [chooseErr, setChooseErr] = useState('')
  const [switching, setSwitching] = useState(false)
  // 🔴 A crisis answer from the model used to be SAVED AS THE PLAN — an empty
  // board with no help on it, regenerated on every reload. It is shown, never
  // stored. See build().
  const [crisis, setCrisis] = useState(null)
  const [chapterHistory, setChapterHistory] = useState(null)
  // Which go this is. 1 is the first; anything higher means the first one had
  // something in it that was not theirs and is being written again.
  const [pass, setPass] = useState(1)
  const [progress, setProgress] = useState(null)
  // ⭐⭐ The running thread and the arc behind it. Loaded once with the session;
  // the thread is per chapter (migration 067) and the chain feeds context.
  const [thread, setThread]   = useState([])
  const [chain, setChain]     = useState([])
  const [asking, setAsking]   = useState(false)
  // 🔴 NOTHING STOPPED TWO GENERATIONS RUNNING AT ONCE, AND IN DEV TWO ALWAYS
  // DID. StrictMode mounts every effect twice; both calls reached the model,
  // both took ~25 seconds, and both wrote a map — so every plan Daniel built
  // today cost two Sonnet calls and the page waited for the slower one. Any
  // re-run of the effect (a param change, a navigation) does the same thing in
  // production, where it is not a dev artefact but a race: two maps written to
  // one row, and whichever lands last wins for no reason anybody chose.
  //
  // ⚠️ A ref, not state — state would not have settled before the second call
  // went out, which is precisely the window this has to close.
  const buildingRef = useRef(false)
  /**
   * 🔴🔴 EVERY HANDLER WROTE BACK A STALE COPY OF THE THREAD. Each one took
   * `thread` from the render it started in and, after an await, saved
   * `[...thatThread, …]` — so "Help me choose" landing after a reply erased the
   * reply and their sentence, from the screen AND the database. The thread now
   * lives in a ref that is always current, every change is a function of the
   * latest copy, and saves go out one at a time in order.
   */
  const threadRef = useRef([])
  const crisisShown = useRef(false)
  const sessionRef = useRef(null)
  const saveQueue = useRef(Promise.resolve())
  useEffect(() => { sessionRef.current = session }, [session])
  function localThread(fn) {
    const next = fn(threadRef.current)
    threadRef.current = next
    setThread(next)
    return next
  }
  function commitThread(fn) {
    const next = localThread(fn)
    const id = sessionRef.current?.id
    if (id) {
      saveQueue.current = saveQueue.current
        .then(() => savePlanThread(id, next))
        .catch(err => {
          console.warn('[wayout] thread not saved:', err.message)
          setThreadErr('That change did not save. Check your connection and try it again.')
        })
    }
    return next
  }
  // ⭐ ONE LOCK FOR EVERYTHING THAT CHANGES THE PLAN OR THE THREAD. Choosing,
  // switching, replying and building each used to lock only themselves, so any
  // two could interleave and the last write won.
  const locked = building || asking || choosing || switching

  function patchSession(patch) {
    sessionRef.current = sessionRef.current ? { ...sessionRef.current, ...patch } : sessionRef.current
    setSession(c => (c ? { ...c, ...patch } : c))
  }
  const [refused, setRefused] = useState(false)
  const [error, setError]       = useState('')
  /**
   * ⭐⭐ READING A CHAPTER YOU HAVE FINISHED. `?was=<id>` opens that plan instead
   * of the current one — the only way back to a board you worked, now that a
   * second chapter exists.
   * ⚠️ READ-ONLY, AND THAT IS THE POINT. Ticking a box, rebuilding or talking to
   * an old plan would rewrite history rather than read it, and history is the
   * thing this product is starting to be worth something for.
   */
  const past = params.get('was')

  useEffect(() => {
    let cancelled = false
    ;(past ? loadSessionById(past) : loadOrCreateSession())
      .then(async s => {
        if (cancelled) return
        if (!s) { setError('That plan is not there any more.'); return }
        sessionRef.current = s
        setSession(s)
        // ⚠️ A past chapter is shown exactly as it was left: its stored map, its
        // ticks, and nothing that could change either.
        if (past) {
          loadProgress(s.id).then(pr => { if (!cancelled) setProgress(pr) }).catch(() => {})
          if (s.map?.crisis) setCrisis(s.map.message)
          else if (s.map) setMap(enforceMapContract(s.map, guardFor(s, s.plan_thread, null)))
          else setError('That chapter never got a plan.')
          return
        }
        if (s.status === 'draft') {
          // ⚠️ Same pairing as the intake: an unfinished CHAPTER goes to its own
          // door, not back through the six screens it was built to replace.
          navigate((s.chapter ?? 1) > 1 ? `${WAYOUT_BASE}/chapter` : WAYOUT_INTAKE, { replace: true })
          return
        }
        // 🔴 A STORED MAP WAS NEVER RE-CHECKED. Daniel was still looking at
        // "$120k" the day after the figures guard shipped, because the map in
        // the database was written before it existed and this line handed it
        // straight to the screen. A contract that only runs at generation time
        // protects the next person and nobody who already has a plan.
        // ⚠️ They just came back through the questions. The stored map was
        // written about the answers they had BEFORE, so it is stale by
        // definition — passing the contract does not make it theirs any more.
        //
        // 🔴🔴 `?rebuild=1` IS AN INSTRUCTION, NOT A STATE, AND IT WAS NEITHER
        // CONSUMED NOR CAPPED. It sat in the address bar, so every reload of
        // that URL regenerated the entire plan — and with retries that is two
        // or three model calls a time. 82 map generations in one day, $4.53,
        // almost all of it a tab being refreshed. It also walked straight past
        // the one-rebuild limit: `countRebuild` incremented and nothing on this
        // path ever read it back.
        //
        // ⭐ Stripped from the URL the moment it is acted on, so a reload,
        // a bookmark or a back button cannot spend money again. And the cap is
        // checked HERE, where the spending happens, not only on the links that
        // offer it — a limit enforced in the UI is a suggestion.
        /**
         * 🔴🔴 THE BUTTON RAN, HIT A CAP, AND SAID NOTHING. Daniel: "when i click
         * the button to regenerate it does nothing." It was doing exactly this —
         * stripping the instruction, finding `rebuilds` already at the limit of
         * one, re-rendering the identical map and returning. A refusal that
         * looks like a no-op is indistinguishable from a broken button, and he
         * reported it as one.
         *
         * ⭐⭐ AND THE CAP WAS THE WRONG CAP FOR THIS PATH. One rebuild is a good
         * rule for GOING BACK TO THE ANSWERS — "somebody with one thinks first",
         * and that reasoning is untouched below. But the thread is not tweaking:
         * it is "my life changed", and a life changes more than once. Locking
         * somebody out of an accurate plan for the rest of a chapter because
         * they corrected something in week two is the opposite of what this
         * product is for.
         *
         * ⚠️ IT IS STILL BOUNDED, just by the right thing. A thread rebuild
         * cannot happen unless they typed something AND the model judged that it
         * moves the plan, and the thread carries its own ask limit. The cost
         * floor is a written answer either way — which is the same price the
         * questions charge.
         */
        // ⚠️ The chapter history is part of what a plan is checked against, so
        // it is read BEFORE the stored plan is judged.
        const hist = await historyFor(s).catch(() => null)
        if (cancelled) return
        setChapterHistory(hist)
        const guard = guardFor(s, s.plan_thread, hist)
        const rebuildAsked = params.get('rebuild')
        if (s.map && rebuildAsked) {
          navigate(`${WAYOUT_BASE}/plan`, { replace: true })
          if (!import.meta.env.DEV && (s.rebuilds ?? 0) >= WAYOUT_MAX_REBUILDS) {
            setMap(enforceMapContract(s.map, guard))
            setRefused(true)
            return
          }
          countRebuild(s.id, s.rebuilds)
            .then(n => setSession(c => ({ ...c, rebuilds: n })))
            .catch(() => {})
          build(s)
          return
        }
        loadProgress(s.id).then(p => { if (!cancelled) setProgress(p) }).catch(() => {})
        threadRef.current = Array.isArray(s.plan_thread) ? s.plan_thread : []
        setThread(threadRef.current)
        chapterChain(s).then(c => { if (!cancelled) setChain(c) }).catch(() => {})
        if (s.map?.crisis) {
          // A crisis answer stored before this was fixed: show it, never rebuild over it.
          setCrisis(s.map.message)
        } else if (s.map) {
          const clean = enforceMapContract(s.map, guard)
          const problems = mapProblems(clean, guard)
          if (problems.length) {
            console.warn('[wayout] stored map fails the contract, rewriting:', problems)
            build(s)
          } else {
            setMap(clean)
          }
        }
        // ⭐ Straight in. They asked for it by finishing the questions.
        else build(s)
      })
      .catch(err => { if (!cancelled) setError(err.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [navigate, params, past])

  /**
   * Generate and store the map.
   *
   * ⚠️ Only ever called for a session the database already says is `paid`.
   * Migration 046 refuses a client-written `map` column, so this write goes
   * through the same guard — which means a map generated for an unpaid session
   * cannot be saved even if this code were wrong. That is deliberate: the
   * paywall is a database constraint, not a branch in a component.
   */
  async function build(s, why = 'rebuild') {
    if (buildingRef.current) return null
    buildingRef.current = true
    setBuilding(true)
    setPass(1)
    setError('')
    try {
      // ⭐ generateMap now validates and rewrites once itself — a map that
      // comes back from it has passed mapProblems, including the check that
      // every figure in it is one this person actually gave us. It throws
      // rather than returning a plan with somebody else's numbers in it.
      // ⚠️ `insisted` lives on the SESSION, not in answers, and generateMap
      // takes answers — so without this the person's choice was recorded in
      // the database, echoed back in the UI, and never once shown to the model
      // that writes the plan. The feature would have looked like it worked.
      // ⭐⭐ A SECOND PLAN READS THE FIRST ONE. historyFor returns null for a
      // first plan, so this call is unchanged for almost everybody — and for a
      // chapter it is the whole difference between a plan that remembers and one
      // that asks the same questions again. ⚠️ Read from the CHAPTER LINK rather
      // than from router state, so a reload mid-generation still knows.
      const history = await historyFor(s)
      /**
       * ⭐⭐ WHAT THEY SAID IN THE THREAD IS AN ANSWER, AND REBUILDING WITHOUT IT
       * THREW AWAY THE ONLY NEW INFORMATION THERE WAS. Somebody types "going to
       * renovate a flip instead now", the reply agrees it moves the whole plan,
       * and the rebuild then regenerated from answers written weeks earlier —
       * so the new plan could not possibly mention the flip.
       *
       * ⚠️ THEIR TURNS ONLY. The assistant's replies are OURS, and the rule that
       * has held since 16 Sep is that their answers count as theirs while
       * anything the model wrote does not. Feeding the replies back in would
       * launder our own figures into established fact — exactly what the old map
       * is kept out of this payload to prevent.
       * ⭐ Riding in as free text is what makes provenance work with no new rule:
       * `freeText(answers)` finds it, so a figure they typed in the thread counts
       * as theirs to the invention guards. Same mechanism as theirNotesOnMoves.
       */
      // ⚠️ Not every sentence ever said: an idea whose versions were all
      // crossed off stops steering the plan (planVersions.rebuildTurns).
      const saidSince = rebuildTurns(Array.isArray(s.plan_thread) ? s.plan_thread : [])
      const generated = await generateMap(
        {
          ...s.answers,
          insisted: s.insisted ?? [],
          ...(saidSince.length ? { theyAlsoSaidSince: saidSince } : {}),
        }, setPass, s.move_notes, history,
      )
      /**
       * ⭐⭐ THE PLAN BEING REPLACED IS KEPT, so the rebuild can be undone. One
       * statement writes both — separately, a failure between them leaves a new
       * plan with the old one recorded as current, which is worse than no undo.
       * ⚠️ Only when there WAS a plan. A first generation has nothing to keep,
       * and an empty entry would offer a control that restores nothing.
       */
      // 🔴🔴 A CRISIS ANSWER IS NOT A PLAN. generateMap returns { crisis, message }
      // when somebody is in danger, and this used to save it as the map — an
      // empty board with no help on it, rebuilt on every reload. It is shown,
      // never stored; the plan they had stays exactly as it was.
      if (generated?.crisis) {
        crisisShown.current = true
        setCrisis(generated.message)
        return null
      }
      const kept = await saveMapKeepingLast(s.id, generated, s.map ?? null, s.map_history ?? [], why)
      patchSession({ map: generated, map_history: kept })
      setMap(generated)
      return generated
    } catch (err) {
      setError(err.message)
      return null
    } finally {
      buildingRef.current = false
      setBuilding(false)
    }
  }

  /**
   * ⭐⭐ "MAKE IT V#" — rebuild the plan around what they said in the thread.
   * ⚠️ A plan changes when the life changes, never on a bare button: this
   * path costs a written sentence (or a correction), the same price the
   * questions charge. Going back through the questions is `rebuild()` below.
   */
  async function redoFromThread() {
    if (!session || locked || threadBuild) return
    /**
     * 🔴🔴 THE MARKER WAS WRITTEN BEFORE THE PLAN. "Rewritten around that." went
     * into the thread the instant the button was pressed and the rebuild ran
     * afterwards — so a failure, or a refresh mid-build, left a thread saying
     * the plan had been rewritten over a plan that never was. It is written
     * now from the result, and only when there is one.
     */
    const t = threadRef.current
    const s = sessionRef.current
    const lastMine = t.map(m => m.role === 'user').lastIndexOf(true)
    const about = lastMine > -1 ? t[lastMine].content : null
    setThreadBuild({ about, n: (versionList(t).length || 1) + 1 })
    setThreadErr('')
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
    const before = s.map
    const after = await build({ ...s, plan_thread: t }, `thread:${id}`)
    setThreadBuild(null)
    if (!after) {
      if (!crisisShown.current) setThreadErr('That did not rewrite. Your plan has not changed. Try it again.')
      return
    }
    // ⚠️ The same plan twice is not a new version — two identical chips made
    // switching and deleting ambiguous.
    const same = versionList(threadRef.current).find(v => samePlan(v.map, after))
    if (same) {
      setThreadErr(`That came out the same as ${same.label === 'Original' ? 'your original plan' : same.label}.`)
      return
    }
    /**
     * ⭐⭐ THE VERSION CARRIES ITS OWN PLAN, and the first one carries the
     * original as `base` — so any of them can be put back later, in any order,
     * without a model call. See planVersions.js for why a map on a thread entry
     * can never reach a prompt.
     */
    commitThread(prev => [...prev, {
      role: 'assistant', rebuilt: true, id, at: new Date().toISOString(),
      about,
      map: after,
      ...(!versionList(prev).length && before ? { base: before } : {}),
      content: 'Rewritten around that.',
    }])
  }

  /**
   * ⭐⭐ PUT ANY VERSION ON THE PLAN — the original included. Daniel: "you cant
   * switch between the options or go back to original idea." The previous
   * design undid one step at a time and then forgot; every version now holds
   * its own plan, so switching is a write of something already stored: no
   * model call, no cost, nothing regenerated, and it can be switched back.
   * ⚠️ Through saveMapKeepingLast, so the "put the previous plan back" control
   * under the plan still undoes the switch like any other change.
   */
  async function switchVersion(key) {
    if (!session || locked) return
    const target = versionList(threadRef.current).find(v => v.key === key)
    if (!target || samePlan(target.map, sessionRef.current?.map)) return
    setThreadErr('')
    setSwitching(true)
    try {
      await putOnPlan(target.map, `switch:${target.n}`)
    } catch (err) {
      setThreadErr(err.message)
    } finally {
      setSwitching(false)
    }
  }

  /**
   * 🔴 A CORRECTION THAT IS TAKEN AWAY IS UNDONE. Saving a correction writes the
   * answer at once, so dropping the idea or deleting its version used to remove
   * the sentence and leave the changed answer feeding every later plan.
   * ⚠️ Only reverted if the answer is still what the correction set — a later
   * correction to the same answer wins.
   */
  async function revertCorrections(removed) {
    const fixes = removed.filter(m => m?.correction)
    if (!fixes.length) return
    const s = sessionRef.current
    const answers = { ...(s.answers ?? {}) }
    let changed = false
    for (const { correction: c } of fixes) {
      if (String(answers[c.key] ?? '') === String(c.to ?? '')) { answers[c.key] = c.from ?? ''; changed = true }
    }
    if (!changed) return
    await saveAnswers(s.id, answers)
    patchSession({ answers })
  }

  /**
   * ⭐⭐ THE × ON A VERSION. Daniel: "to get rid of the original plan doesnt
   * make sense i was thinking to get rid of new ideas … just having an x".
   * Deletes that version — never the original — and the idea with its last
   * version. The rules are in planVersions.removeVersion.
   * ⚠️ Its plan is also taken out of the undo history — the dialog promised it
   * "cannot be brought back", and the undo used to bring it back.
   */
  async function removeVersionAt(key) {
    if (!session || locked) return
    const before = threadRef.current
    const doomed = before[key]?.map
    const out = removeVersion(before, key, sessionRef.current?.map)
    if (!out) return
    setThreadErr('')
    setSwitching(true)
    try {
      await putOnPlan(out.restore ?? sessionRef.current.map, 'remove-version', doomed, !out.restore)
      const kept = new Set(out.thread)
      await revertCorrections(before.filter(m => !kept.has(m)))
      commitThread(() => out.thread)
    } catch (err) {
      setThreadErr(err.message)
    } finally {
      setSwitching(false)
    }
  }

  /**
   * ⭐⭐ HELP ME CHOOSE — see chooseBetween and WAYOUT_CHOOSE_PROMPT. Twice a
   * day, counted on the server; the server's refusal is shown as it is.
   * The answer is kept on the thread so a reload does not spend another.
   */
  async function chooseNow() {
    if (!session || locked) return
    const versions = liveVersions(threadRef.current)
    if (versions.length < 2) return
    setChoosing(true)
    setChooseErr('')
    try {
      const out = await chooseBetween({ session: sessionRef.current, versions })
      const byN = Object.fromEntries(versions.map(v => [v.n, v.key]))
      commitThread(prev => storeChoice(prev, {
        pick: byN[out.pick],
        why: out.why,
        checkWith: out.checkWith,
        versions: out.versions.map(v => ({ key: byN[v.n], fits: v.fits, costs: v.costs })),
      }))
    } catch (err) {
      setChooseErr(err.message)
    } finally {
      setChoosing(false)
    }
  }

  /**
   * Go with one version: it goes on the plan, and the others are crossed off
   * with the reason the comparison gave for each — or a plain one.
   */
  async function goWith(key, reasons = {}) {
    if (!session || locked) return
    const target = versionList(threadRef.current).find(v => v.key === key)
    if (!target) return
    setThreadErr('')
    setSwitching(true)
    try {
      if (!samePlan(target.map, sessionRef.current.map)) await putOnPlan(target.map, `choose:${target.n}`)
      commitThread(prev => crossOffOthers(prev, key, reasons))
    } catch (err) {
      setThreadErr(err.message)
    } finally {
      setSwitching(false)
    }
  }

  function bringBackAt(key) {
    if (!session || locked) return
    commitThread(prev => bringBack(prev, key))
  }

  /**
   * ⭐⭐ CORRECT ONE ANSWER. Daniel: "no way of going back in here and change
   * things that could be wrong." The answer is saved, and a sentence saying so
   * goes into the thread as THEIR turn — so it shows as the idea in progress,
   * "Make it V5" rebuilds around it, and dropping it undoes it.
   * ⚠️ Not counted against the one trip back through the questions: that
   * limit is about re-rolling a whole form, and this is one fact.
   * 🔴 A figure is cleaned the way the intake cleans it — "$5,000" stored as
   * typed made every derived stat silently disappear.
   */
  async function correctAnswer(key, value) {
    if (!session || locked) return
    const s = sessionRef.current
    const field = correctableAnswers(s.answers).find(f => f.key === key)
    let to = String(value ?? '').trim()
    if (field?.kind === 'number') to = to.replace(/[^0-9.]/g, '')
    if (!field || !to || to === field.value.trim()) return
    setThreadErr('')
    try {
      const answers = { ...(s.answers ?? {}), [key]: to }
      await saveAnswers(s.id, answers)
      patchSession({ answers })
      // ⚠️ The country only decides which help lines are shown — it does not
      // move the plan, so it is saved quietly rather than becoming an idea to
      // rebuild around.
      if (key === 'region') return
      commitThread(prev => [...prev, {
        role: 'user', at: new Date().toISOString(),
        correction: { key, from: field.value, to },
        content: correctionSentence(field, field.value, to),
      }])
    } catch (err) {
      setThreadErr(err.message)
    }
  }

  /** Drop the idea in progress — everything said since the newest version. The plan never moved. */
  async function dropDraftNow() {
    if (!session || locked) return
    const removed = threadRef.current.slice(openFrom(threadRef.current))
    try {
      await revertCorrections(removed)
      commitThread(prev => dropDraft(prev))
    } catch (err) {
      setThreadErr(err.message)
    }
  }

  /**
   * ⚠️ Through saveMapKeepingLast, so the "put the previous plan back" control
   * under the plan still undoes a change. 🔴 But switching between VERSIONS no
   * longer pushes onto that three-deep history: every version is already kept,
   * and three switches used to push out the only copy of a plan that was not a
   * version. `drop` takes a deleted version's plan out of the history too.
   */
  async function putOnPlan(next, why, drop = null, unchanged = false) {
    const s = sessionRef.current
    const outgoingKept = unchanged || versionList(threadRef.current).some(v => samePlan(v.map, s.map))
    const history = (s.map_history ?? []).filter(h => !drop || !samePlan(h.map, drop))
    const kept = await saveMapKeepingLast(s.id, next, outgoingKept ? null : (s.map ?? null), history, why)
    patchSession({ map: next, map_history: kept })
    setMap(enforceMapContract(next, guardFor(sessionRef.current, threadRef.current, chapterHistory)))
  }

  function rebuild() {
    navigate(editDestination(session) === 'chapter'
      ? `${WAYOUT_BASE}/chapter?edit=1`
      : `${WAYOUT_INTAKE}?edit=1`)
  }

  /**
   * ⭐ DEV ONLY: regenerate this session's map from the answers already stored,
   * without walking the questions again.
   *
   * ⚠️ It exists because testing a PROMPT and changing a LIFE are different
   * jobs and the product only supports the second. For a person, going back
   * through their answers is the point — a plan should change when something
   * about them changed, not on a button. For whoever is writing the prompt,
   * thirty questions between every edit and its result is how you stop
   * checking, and not checking is how the seen card shipped with no
   * checkboxes and the map shipped inventing numbers.
   *
   * 🔴 Never reachable in production, and the check that proves it is a grep
   * of the built chunk rather than an argument. See the note on the JSX — the
   * first version of this left the markup in the bundle because the guard was
   * on the prop instead of inside the branch.
   */
  function regenerateNow() {
    if (session) { setMap(null); build(session) }
  }

  /**
   * ⭐⭐ Their note against one move. Saved either way; only `redo` rebuilds.
   *
   * ⚠️ The note is saved BEFORE the rebuild, not after, because `build()` sends
   * the session's notes to the model — saving afterwards would rebuild without
   * the very thing they asked for and look like it had been ignored.
   */
  async function noteOnMove(order, text, redo) {
    if (!session || building) return
    try {
      const next = await saveMoveNote(session.id, order, text, session.move_notes)
      const updated = { ...session, move_notes: next }
      setSession(updated)
      if (!redo) return

      // 🔴🔴 THE CAP IS CHECKED HERE, WHERE THE SPENDING HAPPENS. This function
      // called build() directly and checked nothing, which made "Redo this move
      // with it" an UNLIMITED free rebuild — a second spending site that walked
      // straight past the one-rebuild limit enforced on the rebuild link.
      //
      // ⚠️ The comment on that other site already said why: "a limit enforced in
      // the UI is a suggestion". I added the exact thing it warns about.
      //
      // ⚠️ Daniel spotted it from the product side: "doing this basically gave
      // them a step... I think this section I just changed should be under
      // paid." He is right on both counts — a regenerated plan IS the paid
      // work, and his own earlier note says it: "you could almost just keep
      // changing things until you get the answer you are looking for."
      //
      // ⭐ The note is still SAVED when the redo is refused. They wrote it, it
      // is theirs, and it sits on the move — only the rewrite is withheld.
      if (!import.meta.env.DEV && (updated.rebuilds ?? 0) >= WAYOUT_MAX_REBUILDS) return
      countRebuild(updated.id, updated.rebuilds)
        .then(n => setSession(c => ({ ...c, rebuilds: n })))
        .catch(() => {})
      setMap(null)
      await build(updated)
    } catch (err) { setError(err.message) }
  }

  async function insist(label) {
    if (!session || building) return
    try {
      const next = await insistOn(session.id, label, session.insisted)
      const updated = { ...session, insisted: next }
      setSession(updated)
      setMap(null)
      await build(updated)
    } catch (err) { setError(err.message) }
  }

  async function openPlaybook(order = 1) {
    // ⚠️ Coerced as well as defaulted. The default above is right and was still
    // not enough — see the note on the button. Anything that is not a real move
    // number means move one, because that is what a person clicking a button
    // that says "show me how" is asking for.
    const n = Number(order)
    const move = Number.isInteger(n) && n >= 1 && n <= 3 ? n : 1
    if (session) wantPlaybook(session.id).catch(() => {})
    navigate(`${WAYOUT_BASE}/play/${move}`)
  }

  /**
   * ⚠️ Optimistic, and it has to be. A tick that waits on a round trip before
   * it moves feels broken, and this one also unlocks the next move — so the
   * door has to appear in the same gesture that opened it.
   */
  async function setMoveDone(order, isDone) {
    setProgress(p => {
      const next = new Set(p?.done ?? [])
      const doneAt = { ...(p?.doneAt ?? {}) }
      if (isDone) { next.add(order); doneAt[order] = new Date().toISOString() } else { next.delete(order); delete doneAt[order] }
      return { ...(p ?? { started: new Set() }), done: next, doneAt }
    })
    try { await markMoveDone(session.id, order, isDone) } catch (err) { setError(err.message) }
  }

  if (loading) return <WayoutShell><p className="wayout__lead">One moment.</p></WayoutShell>

  if (crisis) {
    return <CrisisNote message={crisis} region={session?.answers?.region} onBack={map ? () => { crisisShown.current = false; setCrisis(null) } : null} />
  }

  if (error && !map) {
    return (
      <WayoutShell title="Your plan">
        <p className="wayout__q">That didn’t come through.</p>
        {/* 🔴 The raw error read "Failed to fetch (…supabase.co)" to a person.
            It goes to the console; they get a sentence they can act on. */}
        <p className="wayout__lead">{humanError(error)}</p>
        {/* 🔴 Not on a finished chapter — "Try again" there wrote a new plan
            onto a chapter that is meant to be read-only. */}
        {!past && session && (
          <button className="wayout__btn" onClick={() => build(session)} disabled={building}>
            {building ? 'Building…' : 'Try again'}
          </button>
        )}
      </WayoutShell>
    )
  }

  // ── Finished the questions, no map yet ────────────────────────────────────
  // ⭐ NO PAYWALL HERE ANY MORE. The assessment is free: finish the questions
  // and it is written. The money is for the play-by-play, after they have read
  // it and know whether it was any good.
  if (!map) {
    // 🔴 THERE WAS A "BUILD IT" BUTTON HERE AND IT ASKED NOTHING. Daniel: "it's
    // like an extra button for no reason." He had just answered thirty-odd
    // questions and pressed See the plan; a second confirmation adds a decision
    // where there is no decision to make, and the only thing it communicates is
    // that the product is not sure he meant it.
    // ⭐⭐ SAY WHICH GO THIS IS. 🔴 Daniel sat on "About twenty seconds" watching
    // three dots, with no way to tell working from broken — and he was probably
    // right both times: three attempts genuinely IS three minutes, and the
    // screen promised twenty seconds and then went silent about it.
    //
    // ⚠️ The second screen tells the truth about WHY, which is the better thing
    // to say anyway: the first one had something in it that was not his. That
    // is the guard doing its job, and a person who is told that is being
    // reassured rather than kept waiting.
    return (
      <WayoutShell title="Your plan">
        {/* 🔴 THIS SCREEN HAD FOUR THINGS ON IT AND THE DESIGN ALLOWS ONE. A
            headline, two leads and then the wait itself — which is exactly the
            pile treatment A was chosen to replace. The lines ARE the headline
            now; the only survivor is the honest duration, because promising
            twenty seconds and taking sixty is how a working page comes to look
            broken. */}
        {pass === 1 ? (
          <Working
            foot="Up to a minute. Nothing to pay."
            lines={[
              'Reading what you wrote.',
              'Working out the order.',
              'Crossing off what will not work.',
              'Writing it down.',
            ]}
          />
        ) : (
          /* ⚠️ ITS OWN LINES. This branch only runs because the first version
             contained a figure they never gave us — a different situation, and
             one worth naming plainly rather than dressing as an ordinary wait. */
          <Working
            foot={`Another minute at most${pass > 2 ? ', last try' : ''}.`}
            lines={[
              'That version had a number you never gave us.',
              'We do not guess about your life.',
              'Writing it again.',
            ]}
          />
        )}
      </WayoutShell>
    )
  }

  if (!map) return null
  // ⭐ When the allowance is gone the doors close, and what is behind them is
  // not a wall — it is the only honest thing left to say. See `Spent`.
  // ⚠️ THE CAP IS OFF IN DEV, AND IT HAS TO BE. One rebuild is right for a
  // person — it stops them fishing for a plan they like, which is the behaviour
  // this product exists to end. It is wrong for the person BUILDING it: Daniel
  // changed the prompt six times today and could not see a single change,
  // because his one rebuild was spent and the page correctly kept handing back
  // the map he already had. A limit that blocks the author from ever seeing
  // their own work is a limit that stops the work.
  //
  // ⭐ Safe now in a way it was not this morning: `?rebuild=1` is stripped the
  // moment it is used, so this opens the deliberate links and nothing else. It
  // cannot become the refresh loop that spent 82 generations in a day.
  const spent = !import.meta.env.DEV && (session?.rebuilds ?? 0) >= WAYOUT_MAX_REBUILDS

  /**
   * ⭐ PUT THE PREVIOUS PLAN BACK — from `map_history`, so it is a write of
   * something already held: no model call, byte-identical to what they had.
   */
  async function restorePlan() {
    if (!session || locked) return
    const s = sessionRef.current
    const history = s.map_history ?? []
    if (!history.length) return
    try {
      const out = await restorePreviousMap(s.id, history)
      if (!out) return
      setMap(enforceMapContract(out.map, guardFor(s, threadRef.current, chapterHistory)))
      patchSession({ map: out.map, map_history: out.history })
      commitThread(prev => [...prev, {
        role: 'assistant', at: new Date().toISOString(),
        content: 'Put back the way it was.',
      }])
    } catch (err) {
      setError(err.message)
    }
  }

  /**
   * ⭐⭐ ONE TURN OF THE RUNNING THREAD. The reply is stored with its flags, so a
   * reload still knows whether the last thing said moved the plan.
   * 🔴 It had no catch: a failed reply left their sentence on screen, unsaved,
   * to be persisted later as an orphan turn with no answer. Now it comes back
   * off the screen and the failure is said.
   */
  async function sayToPlan(said) {
    if (!session || locked) return
    setAsking(true)
    setThreadErr('')
    const before = threadRef.current
    const mine = { role: 'user', content: said, at: new Date().toISOString() }
    localThread(prev => [...prev, mine])
    try {
      const out = await askAboutPlan({ session: sessionRef.current, progress, history: chain, thread: before, question: said })
      commitThread(prev => [...prev, {
        role: 'assistant', content: out.reply, at: new Date().toISOString(),
        changesPlan: out.crisis ? false : out.changesPlan, whatChanged: out.whatChanged,
        stalling: out.stalling, crisis: out.crisis,
      }])
    } catch (err) {
      localThread(prev => prev.filter(m => m !== mine))
      throw err  // shown beside the box, with their words put back in it
    } finally {
      setAsking(false)
    }
  }

  return (
    <Map
      map={map}
      /* ⚠️ EVERY WRITE IS WITHHELD ON A PAST CHAPTER. Not disabled in the UI —
         not passed at all, so there is nothing to enable by accident. */
      thread={past ? [] : thread}
      onSay={past ? null : sayToPlan}
      earlier={past ? [] : chain.filter(c => c.id !== session?.id)}
      asking={asking}
      past={Boolean(past)}
      onRebuild={past || spent ? null : rebuild}
      /**
       * 🔴🔴 `spent` IS THE ANSWERS COUNTER, AND GATING THIS ON IT PUT THE BUG
       * BACK. I moved the cap check inside the effect this afternoon and left
       * this line alone — so with `rebuilds >= 1` the handler was nulled here,
       * at the prop, before the fixed code could run. The button rendered,
       * enabled, and did nothing. Daniel, for the fourth time: "when i click
       * the button to regenerate it does nothing." Measured this time rather
       * than reasoned about: clicked in a real browser, URL never changed, no
       * request left the page.
       * ⚠️ Only `past` belongs here. A finished chapter is read-only; a spent
       * answers-rebuild has nothing to do with whether their life changed.
       */
      onRedoFromThread={past ? null : redoFromThread}
      onDropDraft={past ? null : dropDraftNow}
      onRemoveVersion={past ? null : removeVersionAt}
      onChoose={past ? null : chooseNow}
      onGoWith={past ? null : goWith}
      onBringBack={past ? null : bringBackAt}
      onCorrect={past ? null : correctAnswer}
      answers={session?.answers ?? {}}
      choosing={choosing}
      chooseErr={chooseErr}
      onSwitchVersion={past ? null : switchVersion}
      liveMap={session?.map ?? null}
      threadBuild={threadBuild}
      threadErr={threadErr}
      onRestore={past || !(session?.map_history ?? []).length ? null : restorePlan}
      refused={refused}
      onOpenPlaybook={past ? null : openPlaybook}
      onOpenPath={past ? null : () => navigate(`${WAYOUT_BASE}/path`)}
      onRegenerate={!past && import.meta.env.DEV ? regenerateNow : null}
      onMove={past ? null : setMoveDone}
      onInsist={past ? null : insist}
      onNote={past ? null : noteOnMove}
      moveNotes={session?.move_notes ?? {}}
      chapter={session?.chapter ?? 1}
      progress={progress}
      rebuilding={building}
      locked={locked}
      error={error}
      onDismissError={() => setError('')}
      spent={spent}
    />
  )
}

/**
 * ⭐⭐ THE TIP BUTTON, DONE PROPERLY — it asks instead of collecting.
 *
 * 🔴 A tip jar here would have competed with the subscription ask at the single
 * highest-intent moment in the product, and let somebody discharge the
 * gratitude for $5 instead of subscribing. It also reads as hobby project right
 * before a recurring-payment ask, and at a 1-3% response rate it would teach us
 * nothing. What Daniel wanted from it was proof the map is worth something —
 * so we ask that, and we ask for the review, which is worth more today than the
 * money. His words: "REVIEW IS MORE IMPORTANT and easier to get the ball
 * rolling."
 *
 * ⚠️ The money question is SKIPPABLE. Forcing a number would cost us the
 * review, and the review is the more valuable half.
 */
function WorthAsk({ onSave }) {
  const [sent, setSent] = useState(false)
  const [cents, setCents] = useState(null)
  const [note, setNote] = useState('')
  const [canQuote, setCanQuote] = useState(false)

  if (sent) {
    return (
      <div className="wayout__worth wayout__worth--done">
        <b>Thank you, that genuinely helps.</b>
        <p>We read every reply, and it changes what we build next.</p>
      </div>
    )
  }

  const OPTIONS = [0, 900, 1900, 2900, 4900]
  return (
    <div className="wayout__worth">
      <b>One quick question</b>
      <p>Your plan is free and will stay free. If you had to pay, how much would it be worth to you?</p>
      <div className="wayout__worthrow">
        {OPTIONS.map(c => (
          <button
            key={c}
            type="button"
            className={`wayout__worthbtn${cents === c ? ' wayout__worthbtn--on' : ''}`}
            onClick={() => setCents(cents === c ? null : c)}
          >
            {c === 0 ? 'Nothing' : `$${c / 100}`}
          </button>
        ))}
      </div>
      <textarea
        className="wayout__worthnote"
        value={note}
        maxLength={1000}
        onChange={e => setNote(e.target.value)}
        placeholder="Anything you would tell a friend about it, good or bad."
      />
      <label className="wayout__worthquote">
        <input type="checkbox" checked={canQuote} onChange={e => setCanQuote(e.target.checked)} />
        <span>You can quote me on that. First name only.</span>
      </label>
      <button
        type="button"
        className="wayout__btn"
        onClick={async () => { await onSave({ cents, note, canQuote }); setSent(true) }}
        disabled={cents === null && !note.trim()}
      >
        Send it
      </button>
    </div>
  )
}

/* 🔴 CHECKOUT USED TO LIVE HERE AND IT NO LONGER BELONGS ON THIS PAGE. The map
   is free, so nothing on the way IN is ever paid for. When the subscription is
   wired it goes on the play-by-play, which is the thing being sold — and it
   needs a live Stripe RECURRING price plus a `wayout` branch in stripe-webhook
   setting status='paid', the only thing migration 046 accepts as proof of
   payment. See lib/wayout/pricing.js. */

// ── The map ─────────────────────────────────────────────────────────────────

/**
 * ⚠️ `onRebuild` IS OPTIONAL AND THE CONTROLS ARE GATED ON IT. Preview.jsx
 * renders this same component with a hand-written map to check the design;
 * there is no session behind it and nothing to rebuild, so offering a button
 * that cannot work would be worse than not offering one.
 */
export function Map({
  map, onRebuild, onRedoFromThread, onDropDraft, onRemoveVersion, onChoose, onGoWith, onBringBack, onCorrect, answers = {}, choosing = false, chooseErr = '', onRestore, onSwitchVersion, liveMap = null, threadBuild = null, threadErr = '', refused = false, onOpenPlaybook, onOpenPath = null, onRegenerate, onMove, onInsist, onNote,
  moveNotes = {}, progress, rebuilding = false, locked = false, error = '', onDismissError = null, spent = false, chapter = 1,
  thread = [], onSay = null, asking = false, past = false, earlier = [],
}) {
  // 🔴 THIS USED TO BE LOCAL STATE AND IT WAS A LIE. A tick vanished on reload,
  // nothing read it, and the gate under every move — "move 2 starts when…" —
  // enforced nothing at all. A gate nothing enforces is a suggestion, and a
  // plan whose order is a suggestion is the pile of ideas this exists not to
  // be. Progress now comes from the database; Preview passes none and falls
  // back to ticking locally so the design can still be checked.
  const done = progress?.done ?? null
  // ⭐ Has any walkthrough actually been opened? That is the line between
  // somebody being sold the paid half and somebody already inside it.
  const hasOpened = (progress?.started?.size ?? 0) > 0
  const [openCut, setOpenCut] = useState(null)

  // ⭐⭐ Their own words on one move. `openNote` is which box is open, `draft` is
  // what is in it. One draft, not one per move — only one box is ever open, and
  // a map of drafts would be state nobody clears.
  const [openNote, setOpenNote] = useState(null)
  const [draft, setDraft] = useState('')

  /**
   * ⚠️ TWO OUTCOMES, ONE BOX, AND THE DIFFERENCE IS THE POINT.
   * `redo` false — the note sits beside ours and the plan is untouched.
   * `redo` true  — it goes into the next generation and the plan changes.
   * Both save. Without a save on the redo path the note would vanish the moment
   * the rebuild replaced the map, and they would watch their own words go.
   */
  async function saveNote(order, redo) {
    const text = draft.trim()
    setOpenNote(null)
    await onNote?.(order, text, redo)
  }

  // Stagger, in seconds, matching the design reference. With reduced motion
  // every delay collapses to zero and the animation is off in CSS — the build
  // is four seconds long, and to someone who asked the OS to stop moving things
  // that is four seconds of a page that looks broken.
  const at = s => (REDUCED ? { } : { animationDelay: `${s}s` })

  const [localDone, setLocalDone] = useState(() => new Set())
  const ticked = done ?? localDone
  const nextMove = (map?.moves ?? []).find((m, i) => !ticked.has(i + 1)) ?? null

  /**
   * ⭐ THE BRIDGE TO ELIV8 OS — only when they are READY for it (bridges.js).
   * They told us they work for themselves, they have already acted on this plan
   * (a move ticked), it is their live plan, and nothing in the thread is a
   * crisis. Closed once, gone for good.
   */
  const [bridgeShut, setBridgeShut] = useState(() => {
    try { return localStorage.getItem('wayout:bridge-eliv8') === 'closed' } catch { return false }
  })
  const showBridge = !bridgeShut && !past && answers?.workType === 'self'
    && ticked.size > 0 && !thread.some(e => e?.crisis)
  function shutBridge() {
    setBridgeShut(true)
    try { localStorage.setItem('wayout:bridge-eliv8', 'closed') } catch { /* private mode */ }
  }

  /**
   * ⭐⭐ THE EVENT, NOT THE STATE. Rendering the card is not the same as marking
   * the moment: a card that is simply present when the page loads is a fact,
   * and a card that ARRIVES when the third box is ticked is a moment. This
   * watches for the transition and nothing else.
   *
   * ⚠️ And it scrolls the card into view, because the third tick usually happens
   * at the top of the board and the card sits below the notes. A celebration
   * below the fold is the afterthought Daniel saw.
   *
   * 🔴🔴 AND IT MUST STAY BELOW `ticked`. I first wrote this block fifty lines
   * higher, where `allTicked` read `ticked` before its `const` existed — and
   * `const` is not hoisted, so the whole plan page died on load with
   * "Cannot access 'J' before initialization" in the minified build. It shipped.
   *
   * ⚠️ NOTHING CAUGHT IT: the tests never render this component with a map, the
   * build only type-free-compiles, and the prerender cannot reach /plan because
   * it needs a session. ⭐ Same TDZ trap that is documented for prompts.ts — it
   * simply moved from the prompt layer to the component layer, where there was
   * no guard. ⚠️ There is still no test that renders Map with a plan — keep
   * every derived value declared above its first use.
   */
  const finishRef = useRef(null)
  const [justFinished, setJustFinished] = useState(false)
  const wasAll = useRef(null)
  const allTicked = (map?.moves?.length ?? 0) > 0 && ticked.size >= (map?.moves?.length ?? 0)
  useEffect(() => {
    // ⚠️ The first render establishes the baseline rather than firing. Somebody
    // returning to a finished plan has not just finished it.
    if (wasAll.current === null) { wasAll.current = allTicked; return }
    if (allTicked && !wasAll.current) {
      setJustFinished(true)
      finishRef.current?.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'center' })
    }
    wasAll.current = allTicked
  }, [allTicked])

  function toggle(i) {
    // ⚠️ i is a zero-based index here and move_order is 1-based everywhere
    // else. Converting at the boundary rather than carrying two conventions
    // through the component, which is how off-by-ones get written.
    const order = i + 1
    const isDone = ticked.has(order)
    if (!isDone) tick()
    buzz()
    if (done && onMove) { onMove(order, !isDone); return }
    setLocalDone(d => {
      const next = new Set(d)
      if (next.has(order)) next.delete(order); else next.add(order)
      return next
    })
  }

  return (
    <WayoutShell title="Your plan" wide>
      {/* 🔴 ERRORS WERE INVISIBLE WHENEVER A PLAN WAS ON SCREEN. Only the empty
          state rendered them, so a failed tick, note, restore or "I want this
          one anyway" did nothing visible and quietly reverted on reload. */}
      {error && (
        <div className="wayout__alert" role="alert">
          <p>{humanError(error)}</p>
          {onDismissError && (
            <button type="button" className="wayout__threadundo" onClick={onDismissError}>Dismiss</button>
          )}
        </div>
      )}
      {/* The brand mark on this screen reads "your plan", not the product name.
          The map belongs to them. */}
      {/* ⭐ Two halves, and only on a wide screen. The left is what the plan SAYS
          about them — the goal, the thing they missed, the numbers. The right
          is what they DO about it. On a phone `display: contents` collapses
          this back to the single column it was, so there is still only one
          design and nothing reflows into a second one nobody drew. */}
      {/* ⭐⭐ THE MOVES ARE NOT IN A COLUMN. They sit above the two-column spread
          and use the full width of the page.

          🔴 Built inside the right-hand column first, and a headless check
          measured the result: the route had 377px of a 1080px page, five grid
          columns in it, and 12px of overflow. The shape NEEDS width — three
          pinned notes and two gate tags across a narrow strip is not the design
          Daniel picked, it is a squashed version of it. The supporting detail
          still splits 7:5 underneath; the plan itself does not. */}
      {/* ⭐ The headline is the first thing on the page and it leads the whole
          width, because the moves below it do too. It was inside the left
          column when the moves moved out, which put "Three moves. This order."
          above the title of the plan those moves belong to. */}
      {/* ⭐⭐ THE HEADLINE AND THE NUMBERS SHARE A ROW.
          🔴 Daniel: "lets get rid of that blank space move things around". The
          headline sat in a 26ch column with ~700px of empty page beside it, and
          a long one — "The house sale funds the BnB. The BnB funds the road…" —
          wrapped to five lines of display type against all that white. Narrow
          measure is right for a headline and wrong for a page: the fix is to
          put something IN the space, not to stretch the sentence across it.
          The numbers are what belongs there — they are the claim's evidence. */}
      <div className="wayout__head">
      <div className="wayout__top">
        <p className="wayout__who wayout__r" style={at(0.1)}>{WAYOUT_MAP_LABEL}</p>
        {/* 🔴 THE PLAN'S HEADLINE WAS LOSING ITS YELLOW MARK SILENTLY. The
            contract drops `highlight` whenever the model's phrase is not an
            exact substring of the headline it wrote — correct, because a mark
            that matches nothing renders as a design fault rather than a data
            one — but the result was a headline with no highlight at all, on the
            one page the whole product is for. Caught in a console warning
            during an unrelated run: "[wayout] highlight not found in headline
            — dropping the mark".
            ⭐ `derive` is the fallback the walkthrough already uses: mark the
            instruction and leave the qualifier, from a closed list of joining
            words, and mark NOTHING when the sentence cannot be read
            confidently. So a dropped highlight degrades to a derived one and
            only then to none. */}
        <h2 className="wayout__r" style={at(0.3)}>
          <Marked text={map.headline} highlight={map.highlight} derive />
        </h2>
        {/* ⭐⭐ THE FIRST THING THEY CAN DO, BEFORE ANY NUMBER. 9 Oct, Daniel's
            brother read his numbers at night, "almost had a heart attack", and
            went to bed before he reached the moves. The way out has to arrive
            before the hole does, so the next open move sits under the headline. */}
        {!past && nextMove && (
          <p className="wayout__starthere wayout__r" style={at(0.5)}>
            <b>{ticked.size ? 'Next' : 'Start here'}</b>
            <span>{nextMove.title}{nextMove.when ? <em>{nextMove.when}</em> : null}</span>
          </p>
        )}
      </div>

      {/* ⭐ The quote and the two numbers are the SETUP — what they said and
          where they stand. They belong before the plan that answers them, not
          in a column beside it. They were below the moves for one build and it
          read backwards: the answer, then the question. */}
      <div className="wayout__setup">
      {/* ⭐ Rendered only when the contract check passed — session.js drops the
          card if the quote is not verbatim in what the person actually typed.
          A fabricated one takes every other claim on the page down with it. */}
      {map.seen && (
        <div className="wayout__seen wayout__r" style={at(0.9)}>
          {/* ⚠️ <q> inserts its own quotation marks. Typing curly ones as well
              rendered ““no real skills””. */}
          {/* ⚠️ The quote is optional now. An unverifiable one is dropped by the
              contract while the insight survives, so a card can legitimately
              arrive with no quote at all — rendering an empty <q> printed a pair
              of bare quotation marks with nothing between them. */}
          {/* ⚠️ Tidied at RENDER, never in storage — the verbatim guard has already
              passed on the stored string. See tidyQuote.js for why spelling is
              deliberately left alone. */}
          {map.seen.quote && <q>{tidyQuote(map.seen.quote)}</q>}
          <b>{map.seen.insight}</b>
        </div>
      )}

      {Array.isArray(map.stats) && map.stats.length > 0 && (
        <div className="wayout__starting wayout__r" style={at(1.6)}>
        {/* ⭐ A STARTING LINE, NOT A VERDICT. The numbers stay exactly as
            honest; what changes is that they are labelled as where this
            begins, and that something true and hopeful sits right beside
            them. Daniel: "something positive beside it… a few moves can make
            a change to this number". */}
        <p className="wayout__label">Where you’re starting</p>
        {/* ⭐⭐ CREDIT BEFORE THE HOLE. Writing every number down is something
            they DID, and most people never do it. Shown only when the shortfall
            was worked out from figures they actually gave (tone `hard` comes
            only from deriveStats), so it can never be said to someone it is not
            true of; "the debt included" only when they named one. */}
        {map.stats.some(x => x.tone === 'hard') && (
          <p className="wayout__credit">
            You put every number down{String(answers?.debt ?? '').trim() ? ', the debt included' : ''}.
            Most people never get that far, and it is why your plan can be this specific.
          </p>
        )}
        <div className="wayout__stats">
          {map.stats.slice(0, 2).map((s, i) => (
            <div className="wayout__stat" key={i}>
              <span>{s.label}</span>
              {/* ⚠️ Only good news counts up. A shortfall spinning up from zero
                  is a slot machine landing on how far behind you are. */}
              <b>{s.tone === 'good'
                ? <CountUp value={Number(s.value) || 0} prefix={s.prefix} suffix={s.suffix} />
                : <StatNum value={Number(s.value) || 0} prefix={s.prefix} suffix={s.suffix} />}</b>
              {/* ⚠️ Optional. A figure with no "by when" is a slogan, but an
                  invented one is worse than none — so it renders only when the
                  model actually derived it. */}
              {s.caption && <span className="wayout__statwhen">{s.caption}</span>}
            </div>
          ))}
        </div>
        <p className="wayout__hopeful">
          {map.stats.some(x => x.tone === 'good')
            ? 'You already bring in more than you have to pay each month. Your plan is about what you do with the extra.'
            : 'You are starting from here, not staying here. The moves below are built to change these numbers, one at a time.'}
        </p>
        </div>
      )}

      </div>
      </div>

      {/* ⭐⭐ YOUR WAY OUT, IN YOUR WORDS. Daniel, 9 Oct: "planning app isnt
          really the plan, its suppose to give a way out". The headline names
          the first rung; this is the whole ladder, verbatim from what they
          typed, so the moves below read as steps toward something they said.
          ⚠️ Only when a longer rung exists. A session from before the ladder
          has `tuesday` as a three year day, and labelling it "In a year" would
          put words in their mouth. */}
      {(answers?.fiveYears?.trim() || answers?.tenYears?.trim()) && (
        <section className="wayout__ladder wayout__r" style={at(2.1)} aria-label="Your way out">
          <h3 className="wayout__label">Your way out</h3>
          <ol>
            {[['In a year', answers.tuesday], ['In five years', answers.fiveYears], ['In ten years', answers.tenYears]]
              .filter(([, v]) => String(v ?? '').trim())
              .map(([when, v]) => (
                <li key={when}><span>{when}</span><p>{tidyQuote(String(v).trim())}</p></li>
              ))}
          </ol>
        </section>
      )}
      {/* ⭐⭐ THE WAY INTO THE HISTORY, and only once there is a history to see.
          On a first plan this link would point at a page that can only say
          "nothing here yet", which is worse than no link. */}
      {/* ⭐⭐ ONCE YOU ARE IN A NEW CHAPTER, THE PLAN HAS TO SAY SO. Daniel:
          "make sure that this new section looks different by colour or
          something, making it distinguishable."

          The door into a chapter is already the one dark screen in the product —
          but the plan it opens onto looked identical to the first one, so the
          only place the change was visible was the screen you pass through. This
          is the marker that stays.

          ⚠️ SUN, NOT GREEN, AND THAT IS THE WHOLE POINT. Green is the product's
          working colour — every tick, every button, every move. The single
          accent is reserved (the now-marker, the seen card, the final button),
          and a chapter is exactly the kind of thing it is reserved FOR: rare,
          structural, and about where you are rather than what to do.

          ⚠️ It is a BAND, not a badge in a corner. A chapter is a fact about the
          whole page, so it sits across the top of it. */}
      {/* ⭐⭐ THE ONLY THING THAT CHANGES ON A PAST CHAPTER IS THAT IT SAYS SO.
          Everything else is exactly as they left it — the same board, the same
          ticks — because the point of coming back is seeing what you actually
          did, not a summary of it. */}
      {past && (
        <div className="wayout__pastband wayout__r" style={at(2.2)}>
          <b>Finished plan</b>
          <span>This is how you left it. Nothing here can be changed.</span>
          <Link to={`${WAYOUT_BASE}/plan`}>Back to your current plan →</Link>
        </div>
      )}
      {!past && chapter > 1 && (
        <div className="wayout__chapterband wayout__r" style={at(2.3)}>
          <b>Chapter {chapter}</b>
          <span>Built from what actually happened last time.</span>
          <Link to={`${WAYOUT_BASE}/history`}>See all your progress →</Link>
        </div>
      )}
      {/* ⭐⭐ WHERE THEY ARE, AT A GLANCE. Daniel, 2 Oct: "showing the milestones
          on each person's page — something that shows their progress." Evidence,
          never praise: what is done and when, which gate is passed, what is next.
          ⚠️ No percentages, rings, badges or streaks — ever. */}
      {!past && Array.isArray(map.moves) && map.moves.length > 0 && (
        <Progress moves={map.moves} ticked={ticked} doneAt={progress?.doneAt ?? {}} earlier={earlier} style={at(2.3)} />
      )}
      <h3 className="wayout__label wayout__r" style={at(2.4)}>Your three moves, in order</h3>
      {/* ⭐⭐ SAID AT THE TOP, WHERE PEOPLE READ. Daniel: "maybe we market it so
          it shows that this is a suggested plan, up to you to do as you wish,
          not legal advice."
          ⚠️ The disclaimer at the foot is the legal sentence and it stays. This
          is the HONEST one, and it belongs beside the moves rather than under
          them — fine print at the bottom is what somebody scrolls past, and a
          thing you only say where it will not be read is a thing you have not
          said. It is also simply true: the order is our best reading of their
          answers, and every part of it can be changed by them. */}
      <p className="wayout__suggested wayout__r" style={at(2.45)}>
        This is our suggestion, based on your answers. You can change any of it.
      </p>
      {/* ⭐ KEEP IT WHERE YOU WILL SEE IT. A plan on a fridge, or in front of a
          partner, does more than a plan in a browser tab — and a reminder in
          their own calendar brings them back without us emailing anyone. */}
      {!past && (
        <p className="wayout__planactions wayout__r" style={at(2.5)}>
          <button type="button" className="wayout__again" onClick={() => window.print()}>Print or save as PDF</button>
          {Array.isArray(map.moves) && map.moves.length > 0 && (
            <button type="button" className="wayout__again" onClick={() => remindMe(map.moves, ticked)}>Remind me in a week</button>
          )}
        </p>
      )}

      {/* ⭐⭐ THE PINNED ROUTE. Daniel picked it out of four shapes: "i like the
          fun pin board but the checking off of steps and the progress marker".
          Notes keep the board's character; the string keeps the ORDER, which is
          the product. See wayout.css for why the string is a fixed-height svg
          and why the grid gaps are percentages. */}
      {!past && (
        <VersionSwitch
          thread={thread} liveMap={liveMap} disabled={rebuilding || locked}
          onSwitch={onSwitchVersion ?? undefined} onRemove={onRemoveVersion ?? undefined}
          onChoose={onChoose ?? undefined} onGoWith={onGoWith ?? undefined}
          choosing={choosing} chooseErr={chooseErr}
        />
      )}
      <div className="wayout__string wayout__r" style={at(2.6)}>
        <svg className="wayout__twine" viewBox="0 0 900 74" preserveAspectRatio="none" aria-hidden="true">
          <path className="slack" pathLength="100" d="M98 48 Q 274 72 450 48 Q 626 72 802 48" />
          <path
            className="taut"
            pathLength="100"
            d="M98 48 Q 274 72 450 48 Q 626 72 802 48"
            strokeDasharray={`${ticked.size === 0 ? 0 : ticked.size === 1 ? 50 : 100} 100`}
          />
        </svg>

        <div className="wayout__notes" id="wayout-moves">
          {map.moves?.map((m, i) => {
            const order = i + 1
            const isDone = ticked.has(order)
            // ⭐ Every move is open (Daniel, 31 Oct 2026: never block somebody
            // unless it truly has to be done first; see lib/wayout/path.js).
            // "You are here" stays on the first one not done, as a suggestion.
            const isOpen = moveIsOpen(order, ticked)
            const here = map.moves.findIndex((_, k) => !ticked.has(k + 1)) + 1
            const state = isDone ? 'done' : (order === here ? 'now' : 'open')
            const theirs = moveNotes?.[order]

            return (
              <Fragment key={order}>
                <div className={`wayout__note wayout__note--${order} wayout__note--${state}`}>
                  {/* The pin is the MARKER and a second way to tick. It is never
                      the only way — see the note in wayout.css. */}
                  <button
                    type="button"
                    className="wayout__pin"
                    onClick={() => toggle(i)}
                    aria-pressed={isDone}
                    aria-label={`Mark move ${order} done`}
                  >
                    <svg viewBox="0 0 16 16" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 8.5l3 3 7-7" />
                    </svg>
                  </button>
                  {state === 'now' && <span className="wayout__here">You are here</span>}

                  <b>Move {order} · {m.when}</b>
                  <h4>{m.title}</h4>
                  <p>{m.detail}{m.season ? ` ${m.season}` : ''}</p>

                  <div className="wayout__acts">
                    {/* ⭐ "Show me how" is the paywall. When payments go live it
                        carries the price — see the button lower down. A locked
                        move says what WOULD open it rather than just "locked":
                        the move is not hidden, the walkthrough is not open. */}
                    <button
                      type="button"
                      className="wayout__go"
                      disabled={!isOpen}
                      onClick={() => isOpen && onOpenPlaybook?.(order)}
                    >
                      {isOpen
                        ? (WAYOUT_PAYMENTS_LIVE && order === 1 ? `Show me how, ${WAYOUT_PRICE_FULL}` : 'Show me how')
                        : `Opens when move ${order - 1} is done`}
                    </button>
                    {isOpen && (
                      <button type="button" className="wayout__mark" onClick={() => toggle(i)} aria-pressed={isDone}>
                        <i>
                          <svg viewBox="0 0 16 16" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M3 8.5l3 3 7-7" />
                          </svg>
                        </i>
                        {isDone ? 'Done' : 'Mark done'}
                      </button>
                    )}
                  </div>

                  {/* ⭐⭐ THEIR OWN WORDS, ON THIS MOVE. Two outcomes from one box:
                      pin it on (the plan is unchanged, their note sits beside
                      ours) or redo (it goes into the next generation). */}
                  {theirs && openNote !== order && (
                    <div className="wayout__yours">
                      <b>Your note</b>
                      <p>{theirs}</p>
                      <button type="button" onClick={() => { setDraft(theirs); setOpenNote(order) }}>Change it</button>
                    </div>
                  )}
                  {openNote === order ? (
                    <div className="wayout__addbox">
                      <textarea
                        value={draft}
                        onChange={e => setDraft(e.target.value)}
                        maxLength={600}
                        placeholder="What did we get wrong, or what is missing?"
                      />
                      <div className="wayout__addrow">
                        <button type="button" className="keep" onClick={() => saveNote(order, false)}>Save note</button>
                        {/* ⚠️ A button that silently does nothing is worse than one that
                            says why. When the rebuild is spent, the redo is not
                            rendered at all — and the hint below says what it costs. */}
                        {!spent && (
                          <button type="button" className="redo" onClick={() => saveNote(order, true)}>
                            Rewrite this move using my note
                          </button>
                        )}
                        <button type="button" className="drop" onClick={() => setOpenNote(null)}>Cancel</button>
                      </div>
                      <p className="wayout__addhint">
                        {spent ? (
                          <>
                            <b>Save note</b> keeps your note next to this move. You have used
                            your one free rewrite. More rewrites come with the walkthrough.
                          </>
                        ) : (
                          <>
                            <b>Save note</b> keeps your note next to this move. <b>Rewrite</b> changes
                            this move and the ones after it to fit your note. You get one rewrite,
                            so save it for when something important changes.
                          </>
                        )}
                      </p>
                    </div>
                  ) : !theirs && (
                    <button
                      type="button"
                      className="wayout__addstrip"
                      onClick={() => { setDraft(''); setOpenNote(order) }}
                    >
                      + Add a note to this move
                    </button>
                  )}

                  {isDone && <span className="wayout__stamp">Done</span>}
                </div>

                {/* The gate gets its own grid column — see wayout.css. Not after
                    the last move: there is nothing it unlocks. */}
                {m.gate && i < map.moves.length - 1 && (
                  <div className={`wayout__gatetag${isDone ? ' wayout__gatetag--passed' : ''}`}>
                    <b>{isDone ? `\u2713 Move ${order} finished` : `Move ${order} is done when`}</b>
                    <span>{m.gate}</span>
                  </div>
                )}
              </Fragment>
            )
          })}
        </div>
      </div>

      {/* 🔴🔴 THREE MOVES DONE AND THEN NOTHING HAPPENED. Daniel, at the end of
          the whole product: "once done all three there is no next step or
          anything we talked about yet — what are we doing here?"

          He is right and it is the worst possible place to stop. `/done` has
          existed since 26 Sep — it asks whether it actually landed and starts the
          next plan from the answer, which is the entire reason a subscription to
          a product that FINISHES makes any sense. **Not one page linked to it.**

          ⚠️ It appears only when every move is ticked. Offering "how did it go"
          beside an unfinished plan is asking somebody to grade work they are
          still doing. */}
      {map.moves?.length > 0 && ticked.size >= map.moves.length && (
        <div className={`wayout__allthree${justFinished ? ' is-new' : ''}`} ref={finishRef}>
          {/* 🔴🔴 THE MOMENT WAS ON THE WRONG PAGE. Daniel, ticking the third box:
              "this is it? seems very uneventful, no congratulations, nothing —
              it's an afterthought."

              He is right and the diagnosis is precise: the completion beat I
              built was on `/done`, one click away behind a button that reads
              like admin. But **the moment of finishing is the third tick, and it
              happens HERE** — on the board, with all three notes in front of
              them. A celebration on the next screen is a celebration nobody
              walks into.

              ⭐⭐ So the beat moved to where the event is. Same mark, same
              sentence, same rule as `/done`: it is about the WORK — three boxes
              ticked, which most people who write a plan never do — and never
              about the outcome, which nobody has been asked about yet.

              ⚠️ `is-new` only when it happens in front of them. Somebody
              returning to a finished plan gets the card without the fanfare —
              animating an old fact every time the page loads is the thing that
              makes fanfare meaningless. */}
          <span className="wayout__finishedmark" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 12.5l5 5L20 7" />
            </svg>
          </span>
          <p className="wayout__finishedkick">All three</p>
          <b>You finished the plan.</b>
          <p>
            Most people who write one never get to the end of it. You did the
            whole order, in order, which is the hard part and the part nobody
            sees.
          </p>
          {/* ⚠️ A Link, not navigate — this component is also rendered by
              Preview.jsx to check the design, where there is no session to
              navigate for. */}
          <Link className="wayout__btn" to={`${WAYOUT_BASE}/done`}>Tell us how it went</Link>
          <span className="wayout__allthreefine">
            Answer one question and we will build your next plan from it.
          </span>
        </div>
      )}


      {/* ⚠️ Two REAL columns. When the setup moved above the moves this left an
          empty first column and a page-wide hole beside "Crossed off". What was
          ruled out goes left; what happens next goes right. */}
      {/* ⭐⭐ THE REST OF THE PAGE IS THE BOARD TOO.
          🔴 Daniel: "still has half the old half the new". He was right, and a
          full-page screenshot showed why: the pinned notes stopped dead and
          everything under them was flat rows and plain boxes — two design
          languages on one page.
          🔴 WORSE, EVERYTHING FROM "Through the off-season" DOWN TO THE
          DISCLAIMER WAS INSIDE COLUMN TWO, which is 5/12 of the width. That is
          what left ~900px of empty page beside a short "Crossed off" list, and
          why the one dark CTA — the thing being sold — was rendered in a narrow
          strip. The sections are now equal cards that FILL, and everything that
          is not a section runs full width below them. */}
      <div className="wayout__board">
      {/* ⭐⭐ THE RUNNING THREAD, ON THE BOARD WITH EVERYTHING ELSE. Not a widget
          in a corner and not a separate page: the place you tell it something
          changed has to be the place you are looking at the thing that changed.
          ⚠️ Only with a real session behind it — Preview renders this same
          component to check the design and has nothing to talk to. */}
      {!past && onSay && (
        <PlanThread
          thread={thread}
          onSay={onSay}
          busy={asking}
          rebuilding={rebuilding}
          locked={locked}
          pending={threadBuild}
          error={threadErr}
          liveMap={liveMap}
          onRedo={onRedoFromThread ?? undefined}
          onDropDraft={onDropDraft ?? undefined}
          onBringBack={onBringBack ?? undefined}
          onCorrect={onCorrect ?? undefined}
          answers={answers}
          onSwitch={onSwitchVersion ?? undefined}
        />
      )}
      {Array.isArray(map.cut) && map.cut.length > 0 && (
        <section className="wayout__card">
          <h3 className="wayout__label wayout__r" style={at(3.4)}>Ideas we left out, and why</h3>
          <div className="wayout__cut wayout__r" style={at(3.5)}>
            {map.cut.map((c, i) => (
              <button
                type="button"
                key={i}
                className="wayout__cutrow"
                onClick={() => setOpenCut(openCut === i ? null : i)}
                aria-expanded={openCut === i}
              >
                <s>{c.label}</s>
                <em>{openCut === i ? 'Hide' : 'Why'}</em>
                {openCut === i && (
                  <>
                    <span className="wayout__cutwhy">{c.why}</span>
                    {/* ⭐⭐ THE OPTION IS SELECTABLE, NOT JUST READABLE. Daniel
                        wanted the person choosing rather than being instructed.
                        A menu of three equal options would have been the pile
                        of ideas this product exists to replace — so the plan
                        still commits to an order, and the things it ruled out
                        can be ruled back in by the only person entitled to. */}
                    {onInsist && (
                      <span
                        role="button"
                        tabIndex={0}
                        className="wayout__insist"
                        onClick={e => { e.stopPropagation(); onInsist(c.label) }}
                        onKeyDown={e => {
                          if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); e.preventDefault(); onInsist(c.label) }
                        }}
                      >
                        I want this one anyway. Put it in the plan
                      </span>
                    )}
                  </>
                )}
              </button>
            ))}
          </div>
        </section>
      )}

      {Array.isArray(map.seasonPlan) && map.seasonPlan.length > 0 && (
        <section className="wayout__card">
          <h3 className="wayout__label wayout__r" style={at(3.7)}>When work is slow</h3>
          {map.seasonPlan.map((s, i) => (
            <p className="wayout__hint wayout__r" key={i} style={at(3.75)}>
              <b>{s.months}</b>: {s.work}
            </p>
          ))}
        </section>
      )}

      {/* ⭐⭐ WHAT IT TOOK AS GIVEN, SAID OUT LOUD, IMMEDIATELY BEFORE THEY ACT.
          Daniel read his own plan and said "there are so many assumptions here
          not based off any numbers or data" — and none of them were figures.
          They were smuggled in as adjectives: the rental was in "a year-round
          demand market", it would be "under professional management". He never
          said either.

          A plan cannot always avoid assuming. It can always avoid PRETENDING.
          Declared here, an assumption stops being a lie and becomes the most
          useful thing on the page: the one question whose answer changes the
          plan, asked of the only person who knows it. */}
      {/* ⭐ One book, beside the plan rather than instead of it. It is the
          door next to the door — for the part of this that is about how they
          SEE the situation rather than what they do on Saturday. The contract
          has already dropped it if it is not on our shelf. */}
      {map.read?.title && (
        <section className="wayout__card wayout__read wayout__r" style={at(3.8)}>
          <h3 className="wayout__label">A book that could help</h3>
          <p className="wayout__readtitle">
            <b>{map.read.title}</b>{map.read.author ? `, by ${map.read.author}` : ''}
          </p>
          {map.read.why && <p className="wayout__hint">{map.read.why}</p>}
          {/* ⭐⭐ THE CAVEAT IS OURS, RENDERED FROM OUR OWN FILE, ALWAYS. A
              caveat the model composes is one that can be enthusiastic itself
              — and these are books somebody may act on with money. Naming a
              book without saying what to hold lightly is how a shelf becomes
              an endorsement. */}
          {bookOnShelf(map.read.title)?.hold && (
            <p className="wayout__hold">{bookOnShelf(map.read.title).hold}</p>
          )}
        </section>
      )}

      {Array.isArray(map.assumptions) && map.assumptions.length > 0 && (
        <section className="wayout__card wayout__given wayout__r" style={at(3.85)}>
          <h3 className="wayout__label">What your plan assumes</h3>
          <ul>
            {map.assumptions.map((a, i) => <li key={i}>{a}</li>)}
          </ul>
          <p className="wayout__hint">
            If any of these are wrong, tell us. Your plan will change to fit.
          </p>
          {/* ⭐ The sentence above is only true if something can act on it. */}
          {/* 🔴 A REFUSAL THAT LOOKS LIKE A NO-OP IS A BROKEN BUTTON. The one
              rebuild from the answers is spent, and until now that fact was
              never said anywhere — the page simply redrew the same plan.
              ⚠️ It names the route that is still open rather than only the one
              that is closed: saying what changed is not rationed the way going
              back through the questions is. */}
          {refused && (
            <p className="wayout__hint">
              You have already used your one chance to answer all the questions again. If something has changed, tell us under “Something changed?” and we will rewrite your plan.
            </p>
          )}
          {/* ⭐ ONE WAY TO SAY "THAT IS NOT TRUE". This used to send them back
              through every question — rationed to one go, so once spent a wrong
              assumption could not be fixed. Saying what is true under "Something
              changed?" is never rationed and rebuilds around it. */}
          {onSay && (
            <button
              type="button"
              className="wayout__again"
              onClick={() => {
                const box = document.getElementById('wayout-thread')
                box?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                box?.focus({ preventScroll: true })
              }}
            >
              Is one of these wrong? Tell us what is true
            </button>
          )}
        </section>
      )}
      </div>

      {/* ⭐⭐ THE OFFER, AFTER THEY ALREADY HAVE THE ANSWER. Nobody can fear an
          ambush in a flow where the assessment is theirs before anything is
          asked for, and the thing sold is the honest one: not what to do —
          that is above, free — but how to actually do it.

          🔴 IT WAS FLAT. Daniel: "i dont like this sell ... its flat needs to
          be exciting." It was a grey card on a cream page with a generic
          heading and a paragraph, sitting under the most specific thing this
          product has ever written about him. The fix is not louder words — it
          is being SPECIFIC: it names HIS move one, in his plan's own words, and
          lists what is actually inside rather than describing it. And it is the
          one dark block on the page, so it reads as a door rather than another
          section. */}
      {/* 🔴 IT SOLD THEM SOMETHING THEY ALREADY HAD. Daniel: "this is kind of
          redundant once you have paid access." He is right — a dark
          full-width card headed "The next part", pitching the walkthrough with
          "Free while this is being built. Nothing to pay", to somebody who has
          already opened one. A door you have already walked through is a wall.

          ⭐⭐ IT BECOMES A ROUTE INSTEAD OF A PITCH. Once any move's walkthrough
          has been opened, the same card drops the sell and simply carries them
          back to where they were, because at that point the useful thing it can
          do is navigation. The card is gone entirely once all three are done —
          the end-of-plan handoff has that job.
          ⚠️ `started` comes from progress, which is the database, so it survives
          a reload. A pitch that reappears after every refresh is the version of
          this that annoys people most. */}
      <div className={`wayout__offer wayout__r${hasOpened ? ' wayout__offer--known' : ''}`} style={at(4.2)}>
        <span className="wayout__offerkick">{hasOpened ? 'Keep going' : 'Next: how to do it'}</span>
        <h3>{map.moves?.[0]?.title ?? 'Move one'}</h3>
        <p className="wayout__offerlead">
          {hasOpened
            ? 'Where you left off: what to do first, the words to use, and what usually goes wrong.'
            : Array.isArray(map.stuck) && map.stuck.length > 0
              ? 'You know what the move is. These are the questions that turn up the moment you start it.'
              : 'You know what move 1 is. This shows you how to do it, for your town, your hours and the people who have paid you before.'}
        </p>
        {/* ⭐⭐ THE QUESTIONS, NOT THE FEATURES. Daniel: "telling you what is
            inside is weak, not a good sell." He is right, and the reason is
            that a contents list describes a product to somebody who has not
            got a problem yet. These are the snags that arrive within an hour
            of starting HIS move one, in his own situation — the awkward
            wording, the number nobody will volunteer, the bit where the first
            person he asks says "it depends".

            ⚠️ Questions only. The moment one carries its answer it stops being
            a gap and becomes a sample, and the thing being sold is the answer.
            The contract drops any line that is not a question. */}
        {Array.isArray(map.stuck) && map.stuck.length > 0 ? (
          <ul className="wayout__offerlist wayout__offerlist--q">
            {map.stuck.map((q, i) => <li key={i}>{q}</li>)}
          </ul>
        ) : (
          <ul className="wayout__offerlist">
            <li>The first thing to do, and the day to do it</li>
            <li>A message you can copy and send</li>
            <li>What to charge, and where that number comes from</li>
            <li>What you do <b>not</b> need to buy yet</li>
            <li>What goes wrong the first time, and what to do about it</li>
          </ul>
        )}
        {/* ⭐⭐ THE ONE LINE THAT STOPS THIS CARD BACKFIRING.
            Three questions nobody can answer, straight after a plan that just
            made somebody feel capable, can quietly undo it — they leave the
            page feeling less ready than when they arrived. Naming the questions
            as NORMAL turns the same list from a set of holes in them into a set
            of things that have answers, which is also the truth. */}
        {Array.isArray(map.stuck) && map.stuck.length > 0 && (
          <p className="wayout__offerfine wayout__offernote">
            Most people get stuck on these. The walkthrough shows you how to handle each one.
          </p>
        )}
        <PlaybookCta onOpen={onOpenPlaybook} onPath={onOpenPath} hasOpened={hasOpened} />
      </div>

      {/* ⭐ After our own offer, never before it: an addition, not a switch. */}
      {showBridge && <Bridge {...bridgeToEliv8('plan')} onClose={shutBridge} />}

      {/* ⭐ Their three moves, figures out, for a friend (ShareCard.jsx). */}
      {!past && <ShareCard map={map} movesDone={ticked.size} />}
      {!past && <InviteConsent />}

      {/* ⭐ The shared summary with Eliv8 OS (Handoff.jsx). Their words only. */}
      {!past && <Handoff answers={answers} onTell={onSay} />}

      {/* ⭐⭐ THE WORTH ASK IS OFF. Daniel: "dont get why you would ask this. im
          going to trial this with a handfull of people then just put it to
          market." He is right, and it was my reasoning that was wrong: I
          designed it as the honest alternative to a tip button, for LEARNING a
          price. At a handful of trial users he knows personally there is
          nothing to learn from it — he will ask them directly — and it sits
          between the CTA and the end of the page as clutter.

          ⚠️ Kept, not deleted: the component, `wayout_worth` and `saveWorth`
          all still work. It earns its place when strangers arrive who cannot be
          asked in person, and that is one line from here. */}

      {/* ⭐⭐ THE THING THEY REMEMBER AFTERWARDS. It is usually the important
          one — the illness, the debt they did not want to type, the person who
          has already offered them work. The intake asks thirty questions and
          still cannot ask the one that matters to this person, so the product
          has to stay open after the plan rather than closing behind it. */}
      {spent && <Spent />}

      {/* Dev only — see regenerateNow. Deliberately plain and labelled, so it
          can never be mistaken for something a person is meant to see.

          ⚠️ THE `import.meta.env.DEV` HAS TO BE HERE, IN THE JSX, NOT ONLY ON
          THE PROP. Passing `DEV ? fn : null` from the parent leaves this whole
          branch in the shipped chunk — the prop is a runtime value, so nothing
          can statically eliminate it, and the strings ride along into
          production even though they never render. Written inline, Vite
          substitutes `false` at build time and the minifier drops the branch.
          🔴 I wrote a comment claiming it was dropped and then grepped the
          built file, which said otherwise. Check the artifact. */}
      {import.meta.env.DEV && onRegenerate && (
        <p className="wayout__rebuild">
          <button type="button" className="wayout__again" onClick={onRegenerate} disabled={rebuilding}>
            {rebuilding ? 'Building…' : 'Regenerate from the same answers'}
          </button>
          {', '}dev only, not in the build.
        </p>
      )}

      {/* ⭐⭐ THE WAY BACK, WHERE IT CAN BE FOUND. Daniel: "there should be
          something to click to bring it back." There was — but only inside the
          running thread, which is a place he had already emptied, so for him
          there was nothing on the screen at all. A plan can be replaced from
          more than one route, so the control that undoes that belongs beside
          the plan rather than inside the conversation that happened to trigger
          it. The thread keeps its copy; this one is always there.
          ⚠️ Shown only when there is genuinely something to restore — the
          session carries the history, so an empty one draws nothing rather than
          a button that does not work. That was this morning's lesson. */}
      {onRestore && (
        <p className="wayout__rebuild wayout__r" style={at(4.14)}>
          Not what you wanted?{' '}
          <button type="button" className="wayout__again" onClick={onRestore} disabled={rebuilding}>
            Put back your previous plan
          </button>
          {'. '}Nothing else changes.
        </p>
      )}

      {onRebuild && (
        <p className="wayout__rebuild wayout__r" style={at(4.15)}>
          If several things have changed,{' '}
          <button type="button" className="wayout__again" onClick={onRebuild} disabled={rebuilding}>
            answer the questions again
          </button>
          {' '}and we will build a new plan from your answers.
        </p>
      )}

      {/* ⚠️ The not-advice line now lives in the footer of every page; said here
          as well it read twice within a scroll on a phone. */}
    </WayoutShell>
  )
}

/**
 * ⭐⭐ WHAT THE CTA CAN HONESTLY BE WHILE THE THING IT SELLS IS NOT BUILT.
 *
 * Not "buy" — there is nothing to buy. Not a button that goes nowhere, which is
 * the `VideoSection` failure from the other product: an empty shelf reads worse
 * than no shelf. "Tell me when this is ready" is a real answer to a real
 * question, and it is also the number most worth having BEFORE building the
 * paid half — whether people want the how badly enough to ask for it is the
 * entire commercial thesis, and this measures it for the price of one column.
 */
function PlaybookCta({ onOpen, onPath = null, hasOpened = false }) {
  // ⭐⭐ IT EXISTS NOW, SO THE BUTTON DOES THE THING. This was a waiting list
  // for one day, which was the honest CTA while there was nothing behind it —
  // an empty shelf reads worse than no shelf. There is something behind it.
  //
  // ⚠️ The price still is not charged: WAYOUT_PAYMENTS_LIVE is false and
  // migration 055 makes finishing the intake the entitlement. The copy says so
  // plainly rather than implying a trial or a discount, because the one thing
  // this product cannot survive is a promise it does not keep.
  return (
    <>
      {/* 🔴 `onClick={onOpen}` HANDED REACT'S CLICK EVENT TO A DEFAULT
          PARAMETER. `openPlaybook(order = 1)` got a SyntheticEvent instead of
          1, the URL became /wayout/play/[object Object], Number() gave NaN and
          the page bounced straight back to the plan. The default looked like
          it covered the no-argument case and it was never reached.
          ⚠️ A default parameter is not a guard when the caller is a DOM
          handler — the event is always an argument. */}
      {/* ⭐ The path (31 Oct 2026): the three moves as small steps to tap
          through. It leads, because it is where somebody starts DOING; the full
          walkthrough of each move is one tap away from every part of it. */}
      {onPath && (
        <button className="wayout__btn wayout__btn--sun" onClick={() => onPath()}>
          {WAYOUT_PAYMENTS_LIVE ? `Start your path, ${WAYOUT_PRICE_FULL}` : 'Start your path, step by step'}
        </button>
      )}
      <button className={onPath ? 'wayout__btn wayout__btn--quiet' : 'wayout__btn wayout__btn--sun'} onClick={() => onOpen()}>
        {hasOpened
          ? 'Back to the walkthrough'
          : onPath ? 'Read the full walkthrough'
          : WAYOUT_PAYMENTS_LIVE ? `Show me how, ${WAYOUT_PRICE_FULL}` : 'Show me how'}
      </button>
      {/* ⚠️ THE PRICE LINE IS AN ANSWER TO "what will this cost me", and once
          somebody is already inside, nobody is asking. Repeating "nothing to
          pay" to an existing user is the product reassuring itself. */}
      {!hasOpened && (
        <p className="wayout__offerfine">
          {WAYOUT_PAYMENTS_LIVE ? guaranteeLine() : 'Free for now. Nothing to pay.'}
        </p>
      )}
    </>
  )
}

/**
 * ⭐⭐ WHEN THE REBUILDS ARE GONE, THE HONEST THING IS NOT A WALL.
 *
 * Daniel: "you could almost just keep changing things until you get the answer
 * to what you are looking for." Somebody on their fourth rewrite does not have
 * a planning problem any more, and a fifth plan helps them keep avoiding the
 * thing they are afraid of. So the message is the product thesis said plainly,
 * and it is true whether or not they ever pay for anything.
 */
function Spent() {
  return (
    <p className="wayout__rebuild">
      You have already answered the questions again once, and this is the plan they give. Start with move 1. You can begin it today.
    </p>
  )
}

/**
 * What comes back instead of a plan when somebody is in the middle of something.
 *
 * ⚠️ Deliberately bare. No brand mark doing a little animation, no stats, no
 * progress, no "your plan" — every piece of that furniture says this is a
 * product experience, and it is not one. It is one page of plain text with the
 * numbers in it, on the quietest surface this design has.
 *
 * ⚠️ And no wayout__r classes: the reveal animation staggers content in over
 * four seconds. Making somebody watch a message about their safety fade in on
 * a schedule is the kind of detail that tells them a machine wrote it.
 */
/**
 * What a session's plan is checked against: their answers plus everything else
 * that counts as their words — what they insisted on, what they said in the
 * thread, their move notes, a previous chapter's answers. The same object
 * generation checks against (session.enrichAnswers), so a plan that passed
 * when it was written passes when it is shown.
 */
/**
 * The progress strip: each move with its state and, once done, the date. The
 * gate between two moves shows as passed when the move before it is done.
 */
/**
 * A calendar reminder for the move they are on, a week from now at 9am their
 * time — an .ics file their own calendar opens. Nothing is sent anywhere.
 */
function remindMe(moves, ticked) {
  const i = moves.findIndex((_, k) => !ticked.has(k + 1))
  const move = moves[i === -1 ? moves.length - 1 : i]
  const start = new Date(); start.setDate(start.getDate() + 7); start.setHours(9, 0, 0, 0)
  const end = new Date(start.getTime() + 15 * 60 * 1000)
  const fmt = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const esc = t => String(t ?? '').replace(/[\\;,]/g, m => `\\${m}`).replace(/\n/g, '\\n')
  const url = `${window.location.origin}${WAYOUT_BASE}/plan`
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Unstuck Map//Reminder//EN', 'BEGIN:VEVENT',
    `UID:${Date.now()}@getunstuckmap.com`, `DTSTAMP:${fmt(new Date())}`,
    `DTSTART:${fmt(start)}`, `DTEND:${fmt(end)}`,
    `SUMMARY:${esc(`Check in on: ${move?.title ?? 'your plan'}`)}`,
    `DESCRIPTION:${esc(`How is it going? Mark it done, or tell us what changed: ${url}`)}`,
    `URL:${url}`, 'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }))
  a.download = 'unstuck-map-reminder.ics'
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}

const OUTCOME_SAID = {
  landed: 'You got there',
  partly: 'Part of the way',
  no: 'It did not work',
  changed: 'You want something else now',
}

export function Progress({ moves, ticked, doneAt = {}, earlier = [], style }) {
  /**
   * ⭐⭐ WHAT THEY HAVE ALREADY DONE — only that. Daniel, 2 Oct: "I meant what's
   * already completed, like first goals, steps, whatever — not steps coming up;
   * the pin board shows that." So: every finished move, earlier chapters first,
   * with its date and the gate it opened. Nothing upcoming, no counts of what is
   * left, and when nothing is done yet the strip is simply not there (a missing
   * answer shows nothing — the record page's rule).
   */
  const when = iso => {
    try { return new Date(iso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }) } catch { return '' }
  }
  const chapters = earlier
    .map(c => ({ chapter: c.chapter, outcome: c.outcome, done: (c.moves ?? []).filter(m => m.doneAt) }))
    .filter(c => c.done.length)
  const current = moves
    .map((m, i) => ({ title: m.title, order: i + 1, doneAt: doneAt[i + 1] }))
    .filter(m => ticked.has(m.order))
  if (!chapters.length && !current.length) return null
  const total = chapters.reduce((t, c) => t + c.done.length, 0) + current.length
  return (
    <section className="wayout__progress wayout__r" style={style} aria-label="What you have done">
      <p className="wayout__progresshead">
        <span>What you have done</span>
        <span>{total === 1 ? '1 move done' : `${total} moves done`}</span>
      </p>
      {chapters.map(c => (
        <div key={`c${c.chapter}`} className="wayout__progresschapter">
          <p>
            <b>Chapter {c.chapter}</b>
            {c.outcome && OUTCOME_SAID[c.outcome] ? ` · ${OUTCOME_SAID[c.outcome]}` : ''}
          </p>
          <ul>
            {c.done.map((m, i) => <li key={i}><span aria-hidden="true">✓</span> {m.title} <em>{when(m.doneAt)}</em></li>)}
          </ul>
        </div>
      ))}
      {current.length > 0 && (
        <div className="wayout__progresschapter">
          {chapters.length > 0 && <p><b>This plan</b></p>}
          <ul>
            {current.map(m => (
              <li key={m.order}>
                <span aria-hidden="true">✓</span> {m.title}
                <em>{m.doneAt ? when(m.doneAt) : 'done'}{m.order < moves.length ? ` · move ${m.order} finished` : ''}</em>
              </li>
            ))}
          </ul>
        </div>
      )}
      <Link className="wayout__progresslink" to={`${WAYOUT_BASE}/history`}>See all your progress →</Link>
    </section>
  )
}

function guardFor(s, thread, hist) {
  if (!s) return {}
  const said = (Array.isArray(thread) ? thread : [])
    .filter(m => m?.role === 'user' && m.content)
    .map(m => String(m.content))
  return enrichAnswers(
    { ...(s.answers ?? {}), insisted: s.insisted ?? [], ...(said.length ? { theyAlsoSaidSince: said } : {}) },
    s.move_notes, hist,
  )
}

function CrisisNote({ message, region = null, onBack = null }) {
  // The model writes markdown bold around the numbers it wants seen. Rendering
  // the asterisks would be worse than losing the emphasis, so they are stripped
  // and the paragraph breaks kept.
  const paragraphs = String(message ?? '')
    .replace(/\*\*/g, '')
    .split(/\n{2,}/)
    .map(p => p.trim())
    .filter(Boolean)

  return (
    <WayoutShell title="Read this first">
      <div className="wayout__crisis">
        {paragraphs.map((p, i) => (
          <p key={i} className={i === 0 ? 'wayout__q' : 'wayout__lead'}>{p}</p>
        ))}
      </div>
      <CrisisHelp region={region} />
      {/* ⚠️ Only when a plan already exists — and quiet, because this page is
          about right now, not about the plan. */}
      {onBack && (
        <button type="button" className="wayout__again" onClick={onBack}>Back to your plan</button>
      )}
    </WayoutShell>
  )
}


/**
 * Counts up to the figure.
 *
 * ⚠️ With reduced motion it renders the final number immediately. A counter is
 * decoration; the number is the information, and someone who turned motion off
 * should not have to watch it arrive.
 */
/** The same figure as CountUp, standing still. */
function StatNum({ value, prefix = '', suffix = '' }) {
  return <span className="wayout__statnum">{prefix}{value.toLocaleString()}{suffix && <small>{suffix}</small>}</span>
}

function CountUp({ value, prefix = '', suffix = '' }) {
  // The reduced-motion case is handled by the initial state, not by the effect
  // — setting it inside the effect body would be a cascading render for a value
  // that was already correct on first paint.
  const [n, setN] = useState(REDUCED ? value : 0)

  useEffect(() => {
    if (REDUCED) return undefined
    let raf
    const start = performance.now()
    const dur = 900
    const tick = now => {
      const t = Math.min(1, (now - start) / dur)
      // Ease out — fast at first, settles on the number rather than crawling.
      setN(Math.round(value * (1 - Math.pow(1 - t, 3))))
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value])

  // ⚠️ The unit is smaller and kept with the number — "/mo" broke onto its own
  // line on a phone ("$7,400/m" … "o").
  return <span className="wayout__statnum">{prefix}{n.toLocaleString()}{suffix && <small>{suffix}</small>}</span>
}
