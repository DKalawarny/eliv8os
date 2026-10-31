import { supabase } from '../supabase'
import { callClaude, SONNET, HAIKU } from '../anthropic'
import { movesLibraryForPrompt } from '../../content/wayoutMoves'
import { readingForPrompt } from '../../content/wayoutReading'
import { enforceMapContract, enforcePlaybookContract, scrubFigures, mapProblems, mapStyleNotes, forReaders } from './mapContract'
import { parseModelJson } from './parseModelJson'
import { enforcePathContract } from './path'
import { readReplyJson, soundsLikeCrisis } from './replyJson'
import { loadDraft, clearDraft, stampDraft, draftBelongsToSomeoneElse, takeHandoff } from './draft'
import { historyForPrompt, chapterAnswers } from './chapterHistory'
import { readSource } from './source'
import { claimInvite } from './invites'

export { enforceMapContract, mapProblems } from './mapContract'

/**
 * The way out — session persistence and the two Solomon calls.
 *
 * ⚠️ `wayout_sessions` is user-scoped, not company-scoped — the one
 * customer-facing table in this schema that is. The reasoning is written into
 * migration 046 and it is a privacy decision, not a style one: this table holds
 * a person's custody arrangement and what they are running from, and a company
 * is a shared scope.
 *
 * The user still has a company row (profiles.company_id is NOT NULL, and
 * bootstrap_company provisions one). That is what lets the existing `claude`
 * edge function serve this product with no edit at all — its spend cap, tool
 * cap and usage_events write are company-scoped and keep working.
 */

const TOOL_ID = 'wayout'

/**
 * 🔴 THE WHOLE PRODUCT DEPENDS ON THIS AND IT IS EASY TO MISS.
 *
 * The `claude` edge function's `authedUser()` looks up `profiles` and THROWS
 * "auth: no profile for user" when there isn't one. Every Eliv8 OS user has a
 * profile because business onboarding calls `bootstrap_company` on its first
 * screen — but a person who arrives here signs up and goes straight to the
 * questions, and never touches that flow.
 *
 * Without this, the intake looks like it works: rows save (RLS only needs
 * auth.uid()), reflections fail silently because reflect() swallows errors by
 * design, and then the MAP fails — after the person has paid. The failure lands
 * at the only point in the product where it is indefensible, and it would look
 * like a model problem rather than a missing row.
 *
 * ⚠️ `bootstrap_company` is idempotent and SECURITY DEFINER — it returns the
 * existing company_id if there is one, so an Eliv8 OS owner who wanders in here
 * keeps their real company and nothing is overwritten.
 *
 * ⚠️ The company name is deliberately generic. This person does not have a
 * business, the row is a billing container, and it is never shown to them —
 * inventing "Jake's Company" would put a business they don't own into a product
 * about not having one.
 */
async function ensureProfile(user) {
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', user.id)
    .maybeSingle()

  // A read error is not proof of absence — calling bootstrap on a transient
  // failure is harmless (it is idempotent), so fall through and let it decide.
  if (!error && profile) return

  // ⭐ bootstrap_personal_account, NOT bootstrap_company — it does the same
  // provisioning and then marks the company `is_personal` (migration 047), so
  // the row is excluded from every company count and its owner is never routed
  // into business onboarding. It is guarded so an existing Eliv8 OS customer
  // who opens this intake keeps their real company unflagged.
  const { error: rpcErr } = await supabase.rpc('bootstrap_personal_account', {
    p_full_name: user.user_metadata?.full_name ?? null,
  })
  if (rpcErr) throw new Error(`Could not set up your account: ${rpcErr.message}`)
}

// ── Persistence ─────────────────────────────────────────────────────────────

/**
 * The person's current session, or a new draft.
 *
 * Deliberately returns the most recent rather than enforcing one per user: the
 * v2 check-in product re-runs the intake as life changes, and a unique
 * constraint now would be a migration then.
 */
export async function loadOrCreateSession() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('wayout: not signed in')

  await ensureProfile(user)
  // ⭐ Credit the friend's link, once. Never throws; the database refuses an
  // account that existed before the link (migration 101).
  await claimInvite()

  const { data: existing, error: readErr } = await supabase
    .from('wayout_sessions')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (readErr) throw new Error(`Could not load your answers: ${readErr.message}`)

  // A paid session is finished. Starting a new draft on top of it would hide
  // the map they bought behind an empty form.
  if (existing && existing.status !== 'paid') return existing
  if (existing?.status === 'paid') return existing

  // ⭐ ADOPT WHATEVER THEY ANSWERED BEFORE THEY HAD AN ACCOUNT. They filled in
  // six screens as a stranger; this is the moment that becomes theirs.
  const draft = loadDraft()
  const answers = draft?.answers ?? {}

  const { data: created, error: insErr } = await supabase
    .from('wayout_sessions')
    .insert({ user_id: user.id, answers, source: readSource() })
    .select()
    .single()
  if (insErr) throw new Error(`Could not start: ${insErr.message}`)

  // 🔴 CLEARED THE MOMENT IT IS SAVED, not eventually. It holds a custody
  // arrangement, their pay, their debts and whatever they wrote at the end, and
  // the machine may not be theirs alone.
  if (draft) clearDraft()
  return created
}

/**
 * Carry a draft into a session that already exists but is still empty — the
 * case where someone made an account earlier, came back, answered as a guest in
 * another tab, and then signed in.
 */
/**
 * ⭐⭐ ONE SPECIFIC SESSION, FOR READING A CHAPTER YOU HAVE FINISHED.
 *
 * 🔴 `loadOrCreateSession` always returns the NEWEST row, so once chapter two
 * existed there was no way back to chapter one's plan at all — Daniel: "how do I
 * get back to my first plan from the second?" `/history` showed a summary; the
 * board itself was gone. That is a thing somebody paid attention to and worked
 * for, and it should not become unreachable because they carried on.
 *
 * ⚠️ NO USER FILTER HERE AND THAT IS CORRECT, NOT AN OVERSIGHT. RLS on
 * wayout_sessions is `auth.uid() = user_id` (migration 046), so this can only
 * ever return a row belonging to whoever is asking. Adding a client-side filter
 * would imply the database was not already enforcing it.
 */
export async function loadSessionById(id) {
  if (!id) return null
  const { data, error } = await supabase
    .from('wayout_sessions')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(`Could not open that plan: ${error.message}`)
  return data ?? null
}

export async function adoptDraftInto(session) {
  const draft = loadDraft()
  if (!draft || !Object.keys(draft.answers ?? {}).length) return session
  // 🔴 NEVER ACROSS ACCOUNTS. A draft stamped with a different user is somebody
  // else's half-finished form left in this browser — see draft.js.
  if (draftBelongsToSomeoneElse(session.user_id)) { clearDraft(); return session }
  const existing = Object.keys(session.answers ?? {}).length
  // ⚠️ Never overwrite real answers with a stray draft. Theirs wins — UNLESS
  // they just finished the questions in this tab (the hand-off) and the answers
  // on the server are an unfinished draft: then the complete set they just gave
  // is the newer truth. A session that already has a plan is never overwritten.
  const handoff = takeHandoff()
  if (existing > 0 && !(handoff && session.status === 'draft' && !session.map)) { clearDraft(); return session }

  const { data, error } = await supabase
    .from('wayout_sessions')
    .update({ answers: draft.answers })
    .eq('id', session.id)
    .select()
    .single()
  if (error) {
    // ⚠️ Stamp it even on failure — it is now associated with this account, and
    // leaving it unstamped is what lets the next person inherit it.
    stampDraft(session.user_id)
    return session
  }
  clearDraft()
  return data
}

/**
 * Save the whole answers document.
 *
 * ⚠️ Whole-document write, on purpose. The answers are read and reasoned about
 * as one thing, a person can go back and change screen two after screen five,
 * and a per-field patch would need a merge strategy for a form nobody else is
 * editing concurrently.
 */
/**
 * ⭐⭐ ONE. Daniel's call, and it is better than the three I argued for.
 *
 * Three was me hedging — leaving room for somebody to be wrong twice. But a
 * person who knows they get ONE go back reads their answers properly and fixes
 * everything they can see, which is a better use of the same rebuild. Three
 * invites exactly the drift he was worried about: change one thing, look,
 * change another, look again, and never start.
 *
 * ⚠️ It also has to be one for the go-back to be worth walking. Somebody with
 * three cheap rewrites tweaks; somebody with one thinks first.
 */
export const WAYOUT_MAX_REBUILDS = 1

/**
 * ⭐⭐ THEY WANT THE ONE WE CROSSED OFF.
 *
 * ⚠️ This is a real change of input, not a re-roll, so it is NOT capped like a
 * rebuild. The cap exists to stop somebody fishing for a different answer to
 * the same question; this is a different question.
 */
/**
 * Their own words against one move.
 *
 * ⚠️ `order` is 1-BASED, like move_order everywhere else in this product. The
 * one place it is 0-based is the render index in Plan.jsx, and that conversion
 * has already cost a day once.
 */
export async function saveMoveNote(sessionId, order, text, current = {}) {
  const n = Number(order)
  if (!Number.isInteger(n) || n < 1 || n > 3) throw new Error('not a move')
  const next = { ...(current ?? {}) }
  const body = String(text ?? '').trim().slice(0, 600)
  if (body) next[n] = body; else delete next[n]

  const { error } = await supabase
    .from('wayout_sessions')
    .update({ move_notes: next })
    .eq('id', sessionId)
  if (error) throw new Error(error.message)
  return next
}

/**
 * ⭐⭐ WHAT THEY'D HAVE PAID, AND WHETHER WE MAY QUOTE THEM.
 *
 * ⚠️ Deliberately NOT a tip button. A tip jar would sit beside the subscription
 * ask at the highest-intent moment in the product and let somebody discharge
 * the gratitude for $5 instead of subscribing. This asks the question the tip
 * button was really for, without competing with the CTA and without taking
 * money before the entity question is settled.
 *
 * ⚠️ `cents` may be null — plenty of people will answer the review question and
 * skip the money one, and forcing a number would cost us the review, which is
 * the more valuable half at this stage.
 */
export async function saveWorth(sessionId, userId, { cents = null, note = '', canQuote = false } = {}) {
  const { error } = await supabase
    .from('wayout_worth')
    .upsert({
      session_id: sessionId,
      user_id: userId,
      would_pay_cents: Number.isFinite(Number(cents)) && Number(cents) >= 0 ? Math.round(Number(cents)) : null,
      note: String(note ?? '').trim().slice(0, 1000) || null,
      can_quote: !!canQuote,
    }, { onConflict: 'session_id' })
  if (error) throw new Error(error.message)
}

export async function insistOn(sessionId, label, current = []) {
  const next = [...new Set([...(current ?? []), String(label).trim()])].filter(Boolean).slice(0, 3)
  const { error } = await supabase
    .from('wayout_sessions')
    .update({ insisted: next })
    .eq('id', sessionId)
  if (error) throw new Error(error.message)
  return next
}

/** Count a regeneration. Returns what the count now is. */
export async function countRebuild(sessionId, current = 0) {
  const next = (current ?? 0) + 1
  const { error } = await supabase
    .from('wayout_sessions')
    .update({ rebuilds: next })
    .eq('id', sessionId)
  // ⚠️ Not fatal. Failing to COUNT a rebuild must never stop the rebuild — the
  // person asked for a plan and the bookkeeping is ours, not theirs.
  if (error) console.warn('[wayout] rebuild not counted:', error.message)
  return next
}

/** They asked to be told when the play-by-play is ready. */
export async function wantPlaybook(sessionId) {
  const { error } = await supabase
    .from('wayout_sessions')
    .update({ wants_playbook: new Date().toISOString() })
    .eq('id', sessionId)
  if (error) throw new Error(error.message)
}

/**
 * ⚠️ Stamped as soon as there IS an owner, so a draft written by somebody who is
 * signed in can never be adopted by the next account in this browser.
 */
export async function saveAnswers(sessionId, answers) {
  const { error } = await supabase
    .from('wayout_sessions')
    .update({ answers })
    .eq('id', sessionId)
  if (error) throw new Error(`Could not save: ${error.message}`)
}

export async function markComplete(sessionId, answers) {
  const { error } = await supabase
    .from('wayout_sessions')
    .update({ answers, status: 'complete', completed_at: new Date().toISOString() })
    .eq('id', sessionId)
  if (error) throw new Error(`Could not save: ${error.message}`)
}

// ── Reflection (between screens) ────────────────────────────────────────────

/**
 * Two sentences shown at the top of the NEXT screen.
 *
 * Runs on Haiku: it sees one screen's answers, has to restate them and name one
 * consequence, and the whole output is two sentences. Sonnet costs ~12x for a
 * job this shaped. ⚠️ If reflections start reading generic, check the model
 * before the prompt — that was the lesson from extractImage, where Haiku misread
 * the same date twice and Sonnet read it right.
 *
 * ⭐ NEVER BLOCKS. A reflection is a grace note; the next screen must render
 * whether or not it arrives. Every failure path here returns null and the card
 * simply does not appear.
 */
export async function reflect(screenAnswers) {
  try {
    // ⚠️ callClaude returns the text directly (or the parsed object when
    // json:true) — not a wrapper with .text on it.
    const raw = await callClaude({
      promptKey: 'WAYOUT_REFLECTION_PROMPT',
      messages: [{ role: 'user', content: JSON.stringify(screenAnswers) }],
      maxTokens: 150,
      model: HAIKU,
      temperature: 0,
      toolId: TOOL_ID,
      kind: 'reflection',
    })
    const text = forReaders(String(raw ?? '').trim())
    if (!text) return null

    // A model that ignores "two sentences" usually does so by adding a third
    // that praises or asks something. Cutting to two is a better failure than
    // showing it — and this is exactly the tic the repo keeps hitting, where an
    // instruction about behaviour surfaces as text.
    const sentences = text.match(/[^.!?]+[.!?]+/g)
    if (sentences && sentences.length > 2) return sentences.slice(0, 2).join('').trim()
    return text
  } catch (err) {
    console.warn('[wayout] reflection unavailable (non-fatal):', err)
    return null
  }
}

// ── The map ─────────────────────────────────────────────────────────────────

/**
 * Generate the map from a completed intake.
 *
 * The moves library rides in `stableContext` so it sits inside the cached
 * prefix — it is byte-identical on every call in the product's life, and paying
 * to write it per request rather than per person is the difference between this
 * costing cents and dollars.
 */
/**
 * ⚠️ NINETY SECONDS, AND THE NUMBER IS MEASURED RATHER THAN CHOSEN.
 *
 * Driving the real page repeatedly: the same generation came back in 27s, then
 * 28s, then over 60s. A 28k-character system prompt with a 3,000-token answer
 * is simply not a fast request, and the variance is wide — a cold prompt cache
 * costs most of it. My first guess at 60s killed a call that was still working,
 * which turns "slow" into "broken" and is the worse of the two.
 *
 * ⭐ The timeout exists to end a HANG, not to enforce a speed. Past ninety
 * seconds something is genuinely wrong; before it, the honest thing is to wait
 * and say so.
 */
const MAP_TIMEOUT_MS = 90_000

/**
 * Prose where JSON was asked for, when the prose is deliberate.
 *
 * ⚠️ The test has to separate a CRISIS ANSWER from BROKEN JSON, and it does it
 * by looking for the shape we asked for rather than for distress words. A
 * truncated or malformed map still starts with a brace or carries "headline";
 * an answer that never tried to be a map has neither. Sniffing for the word
 * "safety" instead would make the check wrong in both directions — it would
 * swallow a genuinely broken response that happened to mention it, and miss a
 * crisis answer phrased any other way.
 */
export function crisisFrom(raw) {
  const text = String(raw ?? '').trim()
  if (!text) return null

  /**
   * 🔴🔴 THIS USED TO BAIL IF "headline" APPEARED ANYWHERE IN THE REPLY, WHICH
   * THREW A REAL CRISIS MESSAGE AWAY.
   *
   * Found 26 Sep by running crisis-shaped answers through the live function and
   * KEEPING the replies. Given a woman widowed three weeks earlier, the model
   * did what it was told — said plainly that this was not a planning moment —
   * and then appended the JSON map anyway. The word "headline" appears in that
   * JSON, so this returned null, the crisis message was discarded, and the app
   * rendered a plan. The exact failure the crisis path exists to prevent,
   * living in the CLIENT where no amount of prompt testing would ever find it.
   *
   * ⚠️ THE TEST IS POSITIONAL, NOT KEYWORD-BASED. What matters is whether the
   * reply LEADS with prose. A crisis message followed by JSON is still a crisis
   * message, and the JSON is the part to discard — not the reverse.
   */
  const fence = text.indexOf('```')
  const brace = text.search(/\{\s*"/)
  const cut = [fence, brace].filter(i => i > -1).sort((a, b) => a - b)[0]
  const lead = (cut === undefined ? text : text.slice(0, cut)).trim()
  if (!lead) return null

  /**
   * ⚠️ TWO BARS, AND THE DIFFERENCE IS DELIBERATE.
   *
   * A reply that is ALL prose has broken format entirely, which only happens
   * when the model decided something mattered more than the schema — 150 chars
   * keeps that bar where it was.
   *
   * A reply that leads with prose and THEN produces JSON is a different signal:
   * the model kept its contract and still insisted on saying something first.
   * The real one measured 82 characters ("Joan lost her husband three weeks
   * ago. This is a crisis window, not a plan window."), so the bar has to be
   * below that — and above a formatting preamble like "Here is the plan:",
   * which is 17. Fifty separates them with room on both sides.
   */
  const min = cut === undefined ? 150 : 50
  if (lead.length < min) return null

  /**
   * 🔴🔴 ONE CARVE-OUT, AND IT IS NARROW ON PURPOSE.
   *
   * Found 26 Sep. After the crisis rules were taught where their boundary is, a
   * man working full time and sleeping in his car correctly got a PLAN — and the
   * model narrated its own reasoning first: "The rules fire clearly here: Mitch
   * has income, a gap, and a solvable problem. $2,600 in, $900 out, $1,700 of
   * slack every month. This is a planning case." 190 characters, over the bar,
   * so he would have been shown the model's working and never the plan.
   *
   * 🔴 THE OBVIOUS FIX WAS WRONG AND WOULD HAVE CAUSED A SAFETY REGRESSION. The
   * first attempt suppressed any lead followed by a real map — but that is the
   * SHAPE OF THE ORIGINAL BUG: a genuine crisis message with the JSON appended
   * anyway, which is exactly what the widow's reply did. Prose-then-map cannot
   * distinguish them, and getting it wrong that way hides a crisis instead of a
   * plan. When the two errors are not equal, the test has to fail toward the
   * expensive one.
   *
   * ⭐⭐ SO WHAT IS CHECKED IS THE VERDICT THE LEAD ITSELF DECLARES. "This is a
   * planning case" is the model reporting that the crisis rules did NOT fire —
   * the meta-narration tic, where an instruction about behaviour surfaces as
   * text. Anything that does not say so stays a crisis, including anything
   * ambiguous. The tic is also fixed in the prompt, which is the real cure; this
   * is only the floor under it, because a prompt rule holds most of the time and
   * a man living in his car deserves better odds than most of the time.
   */
  // ⚠️ AND ONLY WHEN A MAP ACTUALLY FOLLOWS. The tic always precedes one, so
  // requiring it costs nothing — and it makes an all-prose crisis reply
  // impossible to suppress by wording alone, which is the failure that matters.
  // Without this, "this is not a crisis of money, it is something heavier" would
  // have been thrown away.
  // ⚠️ SAFE, AND THE DISTINCTION IS THE WHOLE POINT OF THE RULE: this is a
  // module constant read inside a FUNCTION BODY, so it is initialised long
  // before this line ever runs. The fatal version is the same-scope one that
  // took down /plan on 28 Sep — a const read earlier in the SAME function.
  // eslint-disable-next-line no-use-before-define
  if (cut !== undefined && NARRATES_A_PLANNING_VERDICT.test(lead)) return null

  return { crisis: true, message: lead }
}

/**
 * The model announcing that the crisis rules did not fire. Deliberately only
 * phrasings that state the VERDICT — never words that merely appear near one,
 * because every guard in this product that tested for vocabulary instead of
 * structure has been wrong.
 */
const NARRATES_A_PLANNING_VERDICT = new RegExp([
  'this is (a|clearly a) planning (case|moment|question)',
  'not a crisis(?! of)\\b',
  'the (crisis )?rules (fire|apply|are clear|do not fire|don.t fire)',
  'crisis (rules?|path|check) (does not|do not|doesn.t|don.t) (fire|apply)',
  'no crisis (signals?|markers?|indicators?)',
  'safe to (plan|proceed with a plan)',
].join('|'), 'i')


/**
 * ⭐⭐ CHAPTER TWO GOES THROUGH HERE, NOT BESIDE IT. `history` switches the prompt
 * and adds the previous round to the user turn; everything else — three attempts
 * with the rejection fed back, the crisis escape, the contract — is identical and
 * must stay identical. A second generateMap would drift from this one inside a
 * week, which is the exact failure the prompts themselves were just restructured
 * to avoid.
 *
 * @param history null for a first plan, or
 *   { previousAnswers, previousMap, ticked, outcome, outcomeNote, chapter }
 */
/**
 * ⭐⭐ THE ANSWERS A PLAN IS CHECKED AGAINST — one definition, used when it is
 * generated AND when it is shown.
 * 🔴 The load path used to check a stored plan against the bare answers, while
 * generation checked it against the answers PLUS what they said in the thread,
 * their move notes and a previous chapter's answers. A plan citing "$85,000"
 * from "I got offered a job at $85,000" passed at generation, then failed on
 * reload as an invented figure — so every reload silently regenerated it,
 * spent a call, and replaced the version they had picked.
 * ⚠️ The previous MAP never goes in here — see the note below.
 */
export function enrichAnswers(answers, moveNotes = null, history = null) {
  let out = moveNotes && Object.keys(moveNotes).length
    ? { ...answers, theirNotesOnMoves: moveNotes }
    : answers
  if (history) {
    out = {
      ...out,
      theirPreviousAnswers: history.previousAnswers ?? null,
      whatTheySaidHappened: history.outcomeNote || null,
    }
  }
  return out
}

export async function generateMap(answers, onProgress = () => {}, moveNotes = null, history = null) {
  // ⭐⭐ THEIR NOTES ON MOVES RIDE IN AS FREE TEXT, AND THAT IS DELIBERATE.
  // A figure someone types into "what did we get wrong about move 2" is a
  // figure THEY gave us, so it must count as theirs for the invention guards.
  // Putting it in the answers payload makes `freeText(answers)` find it, which
  // means provenance works with no new rule — the alternative was a second
  // channel the guards did not know about, which is how the playbook ended up
  // with no figure checks at all.
  answers = enrichAnswers(answers, moveNotes, null)

  /**
   * 🔴🔴 THE PREVIOUS ANSWERS COUNT AS THEIRS. THE PREVIOUS PLAN DOES NOT.
   *
   * This is the single most dangerous line in chapter two. Provenance is decided
   * by freeText(answers) — anything inside this object is treated as a figure the
   * person gave us. Their old answers and their own notes belong there: they said
   * them. ⚠️ THE OLD MAP MUST NEVER GO IN, because it contains figures the MODEL
   * wrote, and the first real map in this product's life invented "$120,000 cash
   * in hand at sale" out of six words about a house. Merging last round's map into
   * the guard payload would launder every invention it ever made into an
   * established fact, and it would do it silently, forever, one chapter at a time.
   *
   * ⚠️ So the old plan rides in the USER TURN below as context to read, and is
   * never merged here. The guards stay exactly as strict as they were on a first
   * plan.
   */
  if (history) answers = enrichAnswers(answers, null, history)
  // ⭐⭐ IT GETS TWO GOES, AND THE SECOND ONE IS TOLD WHAT IT DID WRONG.
  //
  // 🔴 Daniel's first real map invented "$120,000 cash in hand at sale" from a
  // person who had written six words about a house and no figure at all. The
  // contract now catches that (see inventedFigures) — but catching it and
  // showing an error screen to someone who answered thirty questions is not a
  // product, it is a complaint. So a rejected map is written again with the
  // rejection in front of it, and only a second failure is ever seen.
  //
  // ⚠️ The correction rides in the USER turn, not the system prompt. The system
  // prefix is byte-identical on every call in this product's life and that is
  // what makes the moves library affordable to send — a per-request line in it
  // would bust the cache for everybody.
  let problems = []

  // 🔴 TWO GOES WAS NOT ENOUGH AND DANIEL HIT THE WALL — three rewrites, no
  // plan, "That didn't come through" over and over. A guard that can refuse
  // forever is a guard that ships nothing.
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    // ⚠️ The previous round is prepended to the user turn, never to
    // stableContext — that prefix is byte-identical for every person in this
    // product's life, which is what makes the moves library affordable. One
    // per-person line in it busts the cache for everybody.
    const past = history ? historyForPrompt(history) : ''
    // ⚠️ `_carried` is the intake's own bookkeeping ("answered in the free
    // taps"), not something they told us. Never sent.
    const said = JSON.stringify(answers, (k, v) => (k === '_carried' ? undefined : v), 2)
    const content = attempt === 1
      ? past + said
      : `${past}${said}\n\n`
        + `REJECTED, ATTEMPT ${attempt - 1}. They have not seen it. What was wrong:\n`
        + `${problems.map(p => `  - ${p}`).join('\n')}\n\n`
        // ⚠️ SAY WHAT TO DO, NOT ONLY WHAT WAS WRONG. The first version of this
        // handed back "$120,000 put on something they never priced" and the
        // model produced the same figure again — being told a sentence is wrong
        // does not tell you what the right sentence looks like.
        + 'Write the whole plan again, and this time:\n'
        + '  - Delete every figure listed above. Do not replace it with a different one.\n'
        + '  - The sentence survives without it. "That would clear roughly $120,000" '
        + 'becomes "Find out what it would actually clear" — which is true, and is '
        + 'something they can do this week.\n'
        + '  - A gate may be a COUNT instead of a sum: three paying customers, '
        + 'two months in a row, one signed contract.\n'
        + '  - If you genuinely had to take something as given, it goes in '
        + '"assumptions" and nowhere else.'

    // ⭐ SAY WHICH GO THIS IS. The screen promises twenty seconds; three
    // attempts is three minutes, and a person watching an unchanging spinner
    // has no way to tell working from broken. Telling them it is being written
    // again is also the honest reason — something in the first one was not
    // theirs.
    onProgress(attempt)

    // ⚠️ One controller per attempt. Reusing an aborted signal makes every
    // later attempt fail instantly with the same error, which would turn one
    // slow call into three and look identical to a three-attempt failure.
    const controller = new AbortController()
    const bell = setTimeout(() => controller.abort(), MAP_TIMEOUT_MS)

    let map
    try {
      // ⚠️ json:true returns a STRING — unwrapJson strips fences and slices to
      // the outer braces but does not parse. See parseModelJson.
      const raw = await callClaude({
        signal: controller.signal,
        // ⭐ The chapter-two prompt IS the map prompt plus what differs, so this
        // swap changes nothing about the rules that apply.
        promptKey: history ? 'WAYOUT_NEXT_MAP_PROMPT' : 'WAYOUT_MAP_PROMPT',
        // ⚠️ Both libraries ride in the CACHED prefix — byte-identical on
        // every call in this product's life, so they are paid for once rather
        // than per person.
        stableContext:
          `\n\nMOVES LIBRARY\n\n${movesLibraryForPrompt()}\n`
          + `\n\nTHE SHELF — the only books you may name\n\n${readingForPrompt()}\n`,
        messages: [{ role: 'user', content }],
        maxTokens: 3000,
        json: true,
        model: SONNET,
        // ⭐⭐ STABLE. The same answers should produce the same plan — that is
        // what "this is what your answers produce" means, and it is the whole
        // basis for believing any single plan.
        temperature: 0,
        toolId: TOOL_ID,
        kind: 'map',
      })
      // ⭐⭐ A CRISIS ANSWER IS ALLOWED TO BREAK THE JSON, AND THE PRODUCT HAS
      // TO CATCH IT. Found by testing: given somebody describing violence at
      // home, the model correctly abandoned the three-move shape and wrote
      // prose — 211 for a transition house, 911 for immediate danger, 988 to
      // talk. It was a better answer than any JSON could have been.
      //
      // 🔴 And the client threw "The plan came back unreadable." The single
      // most vulnerable person this product will ever meet got a parser error.
      //
      // ⚠️ The fix is NOT to force a crisis into the plan shape. It is to let
      // the safety rule outrank the format, exactly as written, and render what
      // comes back. See crisisFrom().
      const crisis = crisisFrom(raw)
      if (crisis) return crisis
      map = enforceMapContract(parseModelJson(raw, 'The plan'), answers)
    } catch (err) {
      if (err?.name === 'AbortError') {
        throw new Error('That took longer than it should have — something is wrong at our end, not yours. Try again.')
      }
      // ⚠️ A CAP IS OUR LIMIT, NOT THEIR MISTAKE, AND IT MUST NOT READ AS ONE.
      // The edge function's wording is written for a business owner watching a
      // budget ("get in touch if you need it raised"). Somebody who has just
      // written down what they are running from should not be handed an
      // accounting message — they should be told it is us, and that their
      // answers are safe.
      if (err?.code === 'daily_limit_exceeded' || err?.code === 'spend_cap_exceeded' || err?.status === 429) {
        throw new Error('We\u2019ve hit our own limit for today — this one is on us, not you. Everything you wrote is saved. Try again tomorrow, or sooner if you can.')
      }
      throw err
    } finally {
      clearTimeout(bell)
    }

    problems = mapProblems(map, answers, { fresh: true })

    // ⭐⭐ STYLE NEVER CAUSES A REWRITE. IT ONLY RIDES ONE THAT IS HAPPENING.
    //
    // 🔴 It used to force one, and that is what Daniel was sitting through.
    // Driving the real page in a browser showed two and three full generations
    // at ~25 seconds each — a minute and a half of "Reading it back" — and some
    // of those rounds were bought for nothing more than a gate running to 150
    // characters. Twenty-five seconds and a Sonnet call to shorten a sentence
    // is a terrible trade, and the person paying for it is the one waiting.
    //
    // ⚠️ Truth still refuses outright. A figure that is not theirs is worth any
    // number of seconds; prose is not.
    if (!problems.length) return map
    const notes = attempt < 3 ? mapStyleNotes(map) : []
    problems = [...problems, ...notes]

    // ⭐ The map itself, not just the verdict. While Daniel is the only person
    // running this, being able to read what it tried is worth more than any
    // error copy — and it costs nothing.
    console.warn(`[wayout] map attempt ${attempt} rejected:`, problems, map)
  }

  throw new Error(`The plan came back with something in it that isn’t yours (${problems.join(', ')}). Try again.`)
}

// ── The play-by-play ────────────────────────────────────────────────────────

/**
 * How to actually do one move.
 *
 * ⭐ The separate, recurring half of the product. The map is bought once and
 * says what to do and in what order; this says how, for the move they are
 * standing on — because if they knew how, they would have done it already.
 *
 * ⚠️ It is generated for ONE move at a time and only when they reach it. Not as
 * a paywall trick: move two's play-by-play written in January would be written
 * against a situation that has changed by the time they get there, and a
 * confident answer built on stale facts is worse than no answer.
 */
/**
 * The two or three things worth asking before writing a week of instructions.
 *
 * ⭐⭐ THIS IS WHAT MAKES THE PAID HALF WORTH PAYING FOR. Anybody can generate
 * advice from a form. Asking the questions that change the answer, and then
 * answering THAT, is what somebody who knows the work does — and it is the
 * only version of a paywall this product can defend, because the person gets
 * something on the way in rather than merely past a gate.
 *
 * ⚠️ Haiku, not Sonnet. Three questions is a small job and the cost of the
 * paid half is already one Sonnet call; doubling it to ask would make the
 * asking something to economise on, which is the wrong incentive to build in.
 */
export async function generateMoveQuestions({ answers, map, move }) {
  try {
    const raw = await callClaude({
      promptKey: 'WAYOUT_MOVE_QUESTIONS_PROMPT',
      messages: [{
        role: 'user',
        content: JSON.stringify({
          answers,
          the_plan: { headline: map?.headline, moves: map?.moves },
          the_move: move,
        }, null, 2),
      }],
      maxTokens: 700,
      json: true,
      model: HAIKU,
      temperature: 0,
      toolId: TOOL_ID,
      kind: 'move-questions',
    })
    const parsed = parseModelJson(raw, 'The questions')
    const questions = (parsed?.questions ?? [])
      .filter(q => String(q?.q ?? '').trim())
      .slice(0, 3)
      // 🔴 "a step toward your Tuesday" reached a person from here on 1 Oct.
      .map(q => ({
        q: forReaders(String(q.q).trim()),
        why: forReaders(String(q.why ?? '').trim()),
        options: Array.isArray(q.options) ? q.options.map(o => forReaders(String(o))).slice(0, 4) : [],
      }))
    return questions
  } catch (err) {
    // ⚠️ NON-FATAL, ALWAYS. If the questions cannot be written, the person
    // still gets their play-by-play — slightly less accurate and entirely
    // usable. Blocking the thing they came for on the step that improves it
    // would be the tail wagging the dog.
    console.warn('[wayout] move questions unavailable (non-fatal):', err)
    return []
  }
}

export async function generatePlaybook({ answers, map, move, asked = null }) {
  const raw = await callClaude({
    promptKey: 'WAYOUT_PLAYBOOK_PROMPT',
    stableContext: `\n\nMOVES LIBRARY\n\n${movesLibraryForPrompt()}\n`,
    messages: [{
      role: 'user',
      content: JSON.stringify({
        // The whole picture, because the value is entirely in it being theirs.
        answers,
        the_move: move,
        the_plan: { headline: map?.headline, moves: map?.moves, cut: map?.cut },
        // ⭐ What they said thirty seconds ago, about this exact week, knowing
        // what it was for. The freshest and most targeted thing in the call.
        asked: asked ?? undefined,
      }, null, 2),
    }],
    // ⚠️ The schema is large — a script, three arrays and nine fields. 2500 was
    // tight enough that a wordy answer would truncate, and truncated JSON fails
    // in a way that reads like a model problem rather than a budget one.
    maxTokens: 4000,
    json: true,
    model: SONNET,
    temperature: 0,
    toolId: TOOL_ID,
    kind: 'playbook',
  })

  // ⚠️ THE SAME CRISIS PATH AS THE MAP. Somebody reaches the play-by-play
  // AFTER the plan, which means they have been living with it for a while and
  // things may have changed since they answered. The safety rule outranks the
  // JSON here for exactly the same reason it does there.
  const crisis = crisisFrom(raw)
  if (crisis) return crisis

  // ⭐⭐ AND THE SAME FIGURES GUARD. This is where money actually gets used —
  // what to charge, what it costs to start — so it is the likeliest place in
  // the whole product for a number that is not theirs to do damage. The map
  // has been checked since the day it invented $120,000; the play-by-play was
  // never checked at all, which made it the bigger hole of the two.
  return enforcePlaybookContract(parseModelJson(raw, 'The play-by-play'), answers)
}

/**
 * Answer a question about the move somebody is on.
 *
 * ⚠️ THE THREAD IS CAPPED, AND THE CAP IS NOT ONLY ABOUT COST. Twenty questions
 * deep on one move is somebody using this instead of doing the thing — and
 * every turn also re-sends the whole context, so a long thread gets slower and
 * worse at the same time as it gets more expensive.
 */
export const WAYOUT_MAX_ASKS = 12

/**
 * ⭐⭐ THE RUNNING THREAD ON THE PLAN. One per chapter, never per move.
 *
 * 🔴 `askAboutMove` dies when the move is ticked. This one persists, and it has
 * a different job: not "answer a question about this week" but "has anything
 * changed, and does the plan still stand". See WAYOUT_THREAD_PROMPT for why a
 * general chat was the wrong build.
 *
 * ⚠️ THE CONTEXT IS HEADLINES ONLY, AND THAT IS A COST DECISION AS MUCH AS A
 * DESIGN ONE. Sending every playbook on every turn would be the most expensive
 * request in the product, repeated all month, on a $19 subscription. It gets
 * their answers, the move titles, what is ticked, and one line per earlier
 * chapter — which is what the job actually needs.
 *
 * ⚠️ HISTORY IS THEIR ANSWERS, NEVER AN OLD MAP'S FIGURES. Same provenance rule
 * as startNextChapter: merging generated numbers into context launders them into
 * facts one turn at a time.
 */
export const WAYOUT_MAX_PLAN_ASKS = 40

export async function askAboutPlan({ session, progress, history = [], thread = [], question }) {
  const asked = String(question ?? '').trim()
  if (!asked) throw new Error('Say it and I will read it.')

  const answers = session?.answers ?? {}
  const map = session?.map ?? {}
  const ticked = [...(progress?.done ?? [])]

  const raw = await callClaude({
    promptKey: 'WAYOUT_THREAD_PROMPT',
    messages: [{
      role: 'user',
      content: JSON.stringify({
        answers,
        the_plan: {
          headline: map?.headline,
          moves: (map?.moves ?? []).map((m, i) => ({
            order: i + 1, title: m.title, when: m.when, gate: m.gate, done: ticked.includes(i + 1),
          })),
        },
        // ⚠️ Their words only. No map, no figures — see the note above.
        earlier_chapters: history
          .filter(h => h.id !== session?.id)
          .map(h => ({ chapter: h.chapter, they_wanted: h.answers?.out ?? null, outcome: h.outcome })),
        // ⚠️ Entries with no words (a version holder) are not turns.
        so_far: thread.filter(m => m?.content).slice(-8).map(m => ({ role: m.role, content: m.content })),
        they_said: asked,
      }, null, 2),
    }],
    maxTokens: 600,
    model: SONNET,
    temperature: 0.4,
    toolId: TOOL_ID,
    kind: 'thread',
  })

  // 🔴 2 Oct, live: the model sometimes writes prose AND THEN the JSON. The old
  // reader showed the person the raw text with every flag false — so a crisis
  // reply lost its help lines. readReplyJson finds the JSON wherever it is.
  const out = readReplyJson(raw)
  const reply = scrubFigures(String(out.reply ?? '').trim(), answers)
  if (!reply) throw new Error('That did not come back. Say it again.')
  return {
    reply,
    changesPlan: out.changes_plan === true,
    whatChanged: out.what_changed ? String(out.what_changed).trim() : null,
    stalling: out.stalling === true,
    // ⭐⭐ The model's judgement OR their own words — either one shows the help.
    crisis: out.crisis === true || soundsLikeCrisis(asked),
  }
}

/**
 * ⭐⭐ HELP ME CHOOSE. Compares every live version of the plan against what the
 * person told us, and says which fits most closely and what each costs.
 * Twice a day, enforced in the edge function (`wayout:choose`), not here.
 * See WAYOUT_CHOOSE_PROMPT for the liability lines it is held to.
 *
 * ⚠️ The versions go in by DISPLAY NUMBER and come back by it; the caller maps
 * them back to thread keys, because the numbers close up after a delete.
 * ⚠️ Every sentence is scrubbed against their own figures, the same guard the
 * thread reply gets — a comparison is exactly where an invented number would
 * be believed.
 */
export async function chooseBetween({ session, versions }) {
  const answers = session?.answers ?? {}
  // 🔴 THE NAME WAS THE INVITATION. A comparison is the most report-shaped thing
  // this product writes, and with "name": "Danny" in front of it the model wrote
  // "Danny said he wanted…" — about him, to him. It does not need the name to
  // compare plans, so it does not get it. Structural, not just a rule.
  const { name: _name, ...unnamed } = answers
  const raw = await callClaude({
    promptKey: 'WAYOUT_CHOOSE_PROMPT',
    messages: [{
      role: 'user',
      content: JSON.stringify({
        answers: unnamed,
        versions: versions.map(v => ({
          n: v.n,
          name: v.label,
          built_around: v.about ?? null,
          headline: v.map?.headline ?? null,
          numbers: (v.map?.stats ?? []).map(st => ({ label: st.label, value: st.value, caption: st.caption })),
          moves: (v.map?.moves ?? []).map((m, i) => ({ order: i + 1, title: m.title, when: m.when, gate: m.gate })),
        })),
      }, null, 2),
    }],
    maxTokens: 900,
    model: SONNET,
    temperature: 0.3,
    toolId: TOOL_ID,
    kind: 'choose',
    json: true,
  })
  const out = parseModelJson(raw, 'That comparison')
  const known = new Set(versions.map(v => v.n))
  const pick = Number(out?.pick)
  if (!out || !known.has(pick)) throw new Error('That comparison did not come back. Try again.')
  const clean = t => (t ? scrubFigures(String(t).trim(), answers) : null)
  return {
    pick,
    why: clean(out.why),
    versions: (Array.isArray(out.versions) ? out.versions : [])
      .filter(v => known.has(Number(v?.n)))
      .map(v => ({ n: Number(v.n), fits: clean(v.fits), costs: clean(v.costs) })),
    checkWith: clean(out.check_with),
  }
}

/** The thread lives on the session, so it is per chapter and dies with it. */
/**
 * ⭐⭐ WRITE THE NEW PLAN AND KEEP THE OLD ONE, IN ONE STATEMENT.
 *
 * A rebuild used to be irreversible, which is what makes people hesitate over a
 * button — Daniel: "i cant bring back the plan to the kissemme plan." The first
 * version of this parked the outgoing map on a thread entry and he lost it by
 * using the thread's own undo. A safety net inside the thing it protects
 * against is not a safety net; it belongs on the session.
 *
 * ⚠️ ONE UPDATE, not two. Written separately, a failure between them leaves a
 * new plan with the old one recorded as still current, or an unreachable
 * history entry — and both are worse than no undo at all.
 * ⭐ Three deep: this is an undo, not an archive.
 */
export const WAYOUT_MAP_HISTORY = 3

export async function saveMapKeepingLast(sessionId, nextMap, previousMap, history = [], why = 'rebuild') {
  const kept = previousMap
    ? [{ map: previousMap, at: new Date().toISOString(), why }, ...(history ?? [])]
      .slice(0, WAYOUT_MAP_HISTORY)
    : (history ?? []).slice(0, WAYOUT_MAP_HISTORY)

  const { error } = await supabase
    .from('wayout_sessions')
    .update({ map: nextMap, map_history: kept })
    .eq('id', sessionId)
  if (error) throw new Error(error.message)
  return kept
}

/**
 * Put the previous plan back. Pops the newest entry and writes it as the map.
 *
 * ⚠️ The entry is SPENT, not kept — otherwise the same click flips a plan
 * between two versions forever and "previous" stops meaning anything.
 */
export async function restorePreviousMap(sessionId, history = []) {
  const [head, ...rest] = history ?? []
  if (!head?.map) return null
  const { error } = await supabase
    .from('wayout_sessions')
    .update({ map: head.map, map_history: rest })
    .eq('id', sessionId)
  if (error) throw new Error(error.message)
  return { map: head.map, history: rest }
}

export async function savePlanThread(sessionId, thread) {
  const { error } = await supabase
    .from('wayout_sessions')
    // ⚠️ VERSIONS ARE NEVER TRIMMED. They hold the plans — the first one holds
    // the original — so cutting the oldest turns must not cut a way back.
    .update({ plan_thread: thread.filter((m, i) => m?.rebuilt || i >= thread.length - WAYOUT_MAX_PLAN_ASKS * 2) })
    .eq('id', sessionId)
  if (error) throw new Error(error.message)
}

export async function askAboutMove({ answers, map, move, play, thread = [], question }) {
  const asked = String(question ?? '').trim()
  if (!asked) throw new Error('Ask it and I will answer.')

  const raw = await callClaude({
    promptKey: 'WAYOUT_ASK_PROMPT',
    messages: [{
      role: 'user',
      content: JSON.stringify({
        answers,
        the_plan: { headline: map?.headline, moves: map?.moves },
        the_move: move,
        the_play: play,
        // ⚠️ Only the last few turns. The play-by-play is the context that
        // matters; the back-and-forth is there so they are not repeating
        // themselves, not so every word is remembered forever.
        so_far: thread.slice(-6).map(m => ({ role: m.role, content: m.content })),
        their_question: asked,
      }, null, 2),
    }],
    maxTokens: 500,
    model: SONNET,
    // ⚠️ Not zero. A reply to a question is allowed some air — and unlike the
    // plan, nobody re-asks the same question expecting the same words back.
    temperature: 0.4,
    toolId: TOOL_ID,
    kind: 'ask',
  })

  const text = String(raw ?? '').trim()
  if (!text) throw new Error('That did not come back. Ask again.')

  // 🔴 THE CONVERSATION WAS COMPLETELY UNGUARDED. An answer went from the model
  // to the screen unread — no figure check, no named-quantity check, nothing —
  // on the newest surface in the product and the one where somebody is most
  // likely to ask about money. Every other output has been checked since the
  // day the map invented $120,000; this one never was.
  //
  // ⚠️ Sentence-level, same as everywhere else. A reply that loses its worst
  // sentence is still an answer; a reply that quietly states a number they
  // never gave is the thing that ends trust in all of it.
  const clean = scrubFigures(text, answers)
  if (clean !== text) console.warn('[wayout] a sentence was dropped from an answer — figure not theirs')
  return clean
}

/** Keep the conversation. */
export async function saveThread(sessionId, moveOrder, thread) {
  const { error } = await supabase
    .from('wayout_playbooks')
    .update({ thread })
    .eq('session_id', sessionId)
    .eq('move_order', moveOrder)
  if (error) throw new Error(error.message)
}

// ── Storing a play-by-play ──────────────────────────────────────────────────

/**
 * The play-by-play for one move, written once and kept.
 *
 * ⚠️ IT IS NOT REGENERATED ON EVERY VISIT, AND THAT IS NOT ONLY ABOUT COST.
 * Somebody comes back to this page mid-week, having half-done the thing. A
 * different answer waiting for them — different words to send, a different
 * first step — would mean the instructions changed underneath them while they
 * were following them. The plan may be re-planned; the play they are working
 * from stays put.
 */
/**
 * ⭐⭐ WHICH GENERATION OF THE PLAYBOOK RULES A STORED PLAY WAS WRITTEN UNDER.
 *
 * 🔴🔴 BUMP THIS WHENEVER WAYOUT_PLAYBOOK_PROMPT CHANGES MATERIALLY. Without it
 * a prompt improvement reaches new readers only, and everybody who already has a
 * walkthrough keeps the old one forever — which is exactly what happened on
 * 28 Sep: the rule requiring a walkthrough to cover the WHOLE move went live at
 * 14:15 UTC and Daniel was still reading a play written at 14:04. "Still no apps
 * updated here."
 *
 * ⚠️ 1 = the rules as of 28 Sep (whole-move coverage · `opens` · conditional
 * goes_wrong · cross-border currency · never name a structure). Everything
 * written before carries 0 by column default, so the entire existing set
 * refreshes itself the first time somebody opens it.
 *
 * ⚠️ IT IS A JUDGEMENT CALL AND IT SHOULD BE. Bumping regenerates on next open,
 * which costs a model call per reader — worth it for a rule that changes what
 * the walkthrough SAYS, not for a comma.
 */
export const WAYOUT_PLAYBOOK_RULES = 2

export async function loadPlaybook(sessionId, moveOrder) {
  const { data, error } = await supabase
    .from('wayout_playbooks')
    .select('id, move_order, move, play, asked, thread, rules_version')
    .eq('session_id', sessionId)
    .eq('move_order', moveOrder)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data ?? null
}

/**
 * ⚠️ The MOVE is stored beside the play, as it was when the play was written.
 * A plan can be rebuilt, and a play-by-play for a move that no longer exists is
 * worse than none — it is confident instructions for somebody else's week. The
 * snapshot is what lets the page notice and say so.
 */
export async function savePlaybook({ sessionId, moveOrder, move, play, asked }) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Signed out.')

  const { error } = await supabase
    .from('wayout_playbooks')
    .upsert({
      user_id: user.id,
      session_id: sessionId,
      move_order: moveOrder,
      move,
      play,
      // ⚠️ Stamped on every write, so a play can always say which rules wrote it.
      rules_version: WAYOUT_PLAYBOOK_RULES,
      ...(asked !== undefined ? { asked } : {}),
    }, { onConflict: 'session_id,move_order' })
  if (error) throw new Error(error.message)
}

/**
 * Everything written so far for this session, so the plan can show what is
 * done and what is reachable.
 *
 * ⚠️ One query, not three. The plan page renders three moves and a naive
 * implementation asks per move — which is fine at this size and becomes the
 * `useAuth` mistake at any other: the same row fetched N times because nobody
 * looked at the shape of the page.
 */
export async function loadProgress(sessionId) {
  const { data, error } = await supabase
    .from('wayout_playbooks')
    .select('move_order, done_at')
    .eq('session_id', sessionId)
  if (error) throw new Error(error.message)
  const done = new Set()
  const started = new Set()
  // ⭐ The dates are kept: the plan shows WHEN each move was done (evidence,
  // never a streak or a score).
  const doneAt = {}
  ;(data ?? []).forEach(r => {
    started.add(r.move_order)
    if (r.done_at) { done.add(r.move_order); doneAt[r.move_order] = r.done_at }
  })
  return { done, started, doneAt }
}

/**
 * ⚠️ THEIR CLAIM, NOT A VERIFICATION, AND NOTHING ASKS FOR PROOF.
 *
 * Requiring evidence — a number, a receipt, three named customers — turns this
 * into something that audits people, and being audited is what they are
 * already avoiding. Somebody who ticks a move they have not done has misled
 * themselves, and the play-by-play it unlocks will plainly not fit. The product
 * does not have to be the one to say so.
 */
export async function markMoveDone(sessionId, moveOrder, done = true) {
  const { data, error } = await supabase
    .from('wayout_playbooks')
    .update({ done_at: done ? new Date().toISOString() : null })
    .eq('session_id', sessionId)
    .eq('move_order', moveOrder)
    .select('id')
  if (error) throw new Error(error.message)
  if (data?.length || !done) return

  // 🔴 FOUND 31 Oct 2026: a move ticked on the plan before its walkthrough was
  // ever opened has no playbook row yet, so the update above changed nothing,
  // raised nothing, and the tick was gone on the next load. The row is made
  // here instead, with the move as it stands (the same snapshot savePlaybook
  // keeps), and no play.
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Signed out.')
  const { data: s, error: e2 } = await supabase
    .from('wayout_sessions').select('map').eq('id', sessionId).maybeSingle()
  if (e2) throw new Error(e2.message)
  const move = s?.map?.moves?.[moveOrder - 1]
  if (!move) return
  const { error: e3 } = await supabase
    .from('wayout_playbooks')
    .insert({ user_id: user.id, session_id: sessionId, move_order: moveOrder, move, done_at: new Date().toISOString() })
  if (e3) throw new Error(e3.message)
}

/**
 * Can they open the play-by-play for this move yet?
 *
 * ⭐⭐ YES, ALWAYS (Daniel, 31 Oct 2026): "I don't think we should ever block
 * someone unless it has to be done before they can go on." This used to open
 * move N only once move N-1 was ticked (056: "the gate is the product"). He
 * chose otherwise: every move is open, the plan's order stays as the suggested
 * order ("You are here"), and the path (lib/wayout/path.js) blocks a single
 * STEP only when it truly needs another one first. Kept as a function so the
 * one rule has one home if it ever changes again.
 */
export function moveIsOpen(_order, _done) {
  return true
}

/** Did the plan change under a play we already wrote? */

/**
 * ⚠️ TWO WAYS TO BE STALE, AND ONLY ONE OF THEM USED TO COUNT.
 *   · The MOVE changed — the plan was rebuilt under them, so the play is about
 *     something that is no longer the move.
 *   · The RULES changed — the play is fine about the right move and was written
 *     before we knew better.
 *
 * 🔴 AND NEVER REACH FOR `updated_at` HERE. `saveThread` writes to the same row,
 * so asking a question bumps it without regenerating a word. A row-touch
 * timestamp is not a generation timestamp — that is what made this invisible.
 */
export function playbookIsStale(stored, currentMove) {
  if (!stored) return false
  if ((stored.rules_version ?? 0) < WAYOUT_PLAYBOOK_RULES) return true
  if (!stored.move || !currentMove) return false
  return String(stored.move.title ?? '').trim() !== String(currentMove.title ?? '').trim()
}

// ── The path ────────────────────────────────────────────────────────────────

/**
 * ⭐ The whole plan as small steps, written in one call (see lib/wayout/path.js
 * for what a step is and why nothing blocks). Sonnet, like the walkthrough: it
 * is the paid half and the steps are what somebody actually does.
 *
 * ⚠️ Their move notes ride in with their answers, so a figure they typed about
 * a move counts as theirs for the figure guard, same as generateMap.
 */
export async function generatePath(session) {
  const answers = enrichAnswers(session.answers ?? {}, session.move_notes ?? null)
  const raw = await callClaude({
    promptKey: 'WAYOUT_PLAYBOOK_PATH_PROMPT',
    messages: [{
      role: 'user',
      content: JSON.stringify({
        answers,
        the_plan: { headline: session.map?.headline, moves: session.map?.moves, cut: session.map?.cut },
      }, null, 2),
    }],
    maxTokens: 4000,
    json: true,
    model: SONNET,
    temperature: 0,
    toolId: TOOL_ID,
    kind: 'path',
  })
  const crisis = crisisFrom(raw)
  if (crisis) return crisis
  return enforcePathContract(parseModelJson(raw, 'The path'), session.map, answers)
}

export async function savePath(sessionId, path) {
  // ⚠️ A new path starts with no taps: the old ones were for steps that no
  // longer exist, and step ids are reused ("1.2"), so keeping them would tick
  // the wrong things.
  const { error } = await supabase
    .from('wayout_sessions')
    .update({ path, path_state: {} })
    .eq('id', sessionId)
  if (error) throw new Error(error.message)
}

export async function savePathState(sessionId, state) {
  const { error } = await supabase
    .from('wayout_sessions')
    .update({ path_state: state })
    .eq('id', sessionId)
  if (error) throw new Error(error.message)
}

// ── What happened ───────────────────────────────────────────────────────────

/**
 * ⭐⭐ THE ONLY HONEST MEASURE THIS PRODUCT HAS.
 *
 * Everything else counted so far is interest — intakes finished, plans
 * generated, play-by-plays opened. All of it is people BELIEVING it might work.
 * This is the first thing that says whether it did.
 *
 * ⚠️ The negative answers are the valuable ones. A plan that got followed and
 * did not land is a fixable problem, and until now there has been no way to
 * see one.
 */
/**
 * ⭐⭐ THE SECOND PLAN. Daniel: "once they hit their plan there could be an
 * advanced section", and "what to do next to make this live longer."
 *
 * 🔴 THE PRODUCT FINISHES, WHICH IS ITS VIRTUE AND ITS COMMERCIAL PROBLEM. Three
 * moves, a gate between each, and then the page that asked what happened offered
 * exactly one thing: "Back to the plan." Somebody who had just said they got where
 * they were going hit a dead end — so a subscription's whole life was one plan
 * long.
 *
 * ⭐⭐ AND THE FOUR OUTCOMES ARE FOUR DIFFERENT PLANS, NOT ONE BUTTON. What they
 * told us decides whether the DESTINATION survives:
 *
 *   partly / no   → the destination STANDS. They have not arrived at it; writing
 *                   them a new ambition would be changing the subject. Their
 *                   Tuesday carries over untouched.
 *   landed        → they got there. A new Tuesday is theirs to give, and this
 *                   product does not get to guess what somebody should want next.
 *   changed       → they said so themselves.
 *
 * ⚠️ WHAT IS RE-ASKED IN EVERY CASE IS THE MONEY. Three months have passed and
 * the figures moved; a plan built on the old ones is confidently wrong, which is
 * worse than a plan that asked. The old values are kept as prefill so confirming
 * is fast — see firstUnansweredStep, which lands them on the first cleared screen
 * and walks forward through everything already filled in.
 *
 * ⚠️ AND WHAT IS NEVER RE-ASKED: their name, age, town, immovables, the kind of
 * work they do, or what they refuse to do. Those do not change in a quarter, and
 * asking again says the first conversation was not kept.
 */
export async function startNextChapter(session, outcome) {
  if (!session) throw new Error('wayout: no session to continue')
  if (!['landed', 'partly', 'no', 'changed'].includes(outcome)) {
    throw new Error(`wayout: cannot continue from outcome "${outcome}"`)
  }
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('wayout: not signed in')

  // ⚠️ ONE CHAPTER PER PLAN. Two taps on a slow connection would otherwise make
  // two sessions and the newest wins — silently discarding the one they then
  // filled in. Checked by the link rather than by disabling a button, because a
  // limit enforced in the UI is a suggestion.
  const { data: already } = await supabase
    .from('wayout_sessions')
    .select('id')
    .eq('previous_session_id', session.id)
    .maybeSingle()
  if (already) return already

  // ⚠️ Pure, and unit-tested in chapterHistory.test.js.
  const keep = chapterAnswers(session.answers, outcome)

  // 🔴 NOT COPIED FORWARD, EVER: anything the model wrote or the last round
  // accumulated. The map, their notes on those moves, the outcome and the
  // check-in state all belong to the plan they were about. A new session
  // inheriting the old map would render last quarter's plan as this quarter's.
  const { data: created, error } = await supabase
    .from('wayout_sessions')
    .insert({
      user_id: user.id,
      answers: keep,
      previous_session_id: session.id,
      chapter: (session.chapter ?? 1) + 1,
      continues_from_outcome: outcome,
    })
    .select()
    .single()
  if (error) throw new Error(`Could not start the next one: ${error.message}`)
  return created
}

/**
 * The previous round, assembled for generateMap's `history` argument.
 *
 * ⚠️ Reads the PARENT session, so it works on a page reload with nothing but the
 * current session in hand — the chapter link is the source of truth, not state
 * carried through the router.
 */
/**
 * ⭐⭐ THE WHOLE ARC, OLDEST FIRST — every chapter this person has had.
 *
 * Daniel, 28 Sep: "maybe it's a whole set of new goals, but there is a whole
 * history of where the person started and what their original vision was."
 *
 * 🔴 THE CHAIN HAS EXISTED SINCE MIGRATION 066 AND NO SCREEN HAS EVER RENDERED
 * IT. `historyFor` walks exactly ONE hop back, and it exists to feed the next
 * PROMPT — so the product has always known where somebody started and has never
 * once shown them.
 *
 * ⭐⭐ WHY IT IS THE COMMERCIAL SPINE, NOT A NICETY. This product FINISHES. A
 * second plan, on its own, looks like starting over — and nobody pays to start
 * over. What makes it a continuation is the record of where they began: their
 * chapter-one answer, in their own words, beside where they are now. That is the
 * motivating-tone rule made structural — credit as an observation they cannot
 * argue with, never "you have come so far".
 *
 * ⚠️ BOUNDED. A malformed chain (or a cycle, which the schema should prevent and
 * a bug could not) must not spin forever on somebody's plan page.
 *
 * ⚠️ RETURNS THEIR ANSWERS AND THE HEADLINE OF EACH MAP, AND NOTHING ELSE FROM
 * IT. A previous map's figures are OURS, not theirs — see the provenance note on
 * startNextChapter. A history screen may quote what they wrote; it may never
 * hand an old plan's invented number forward as an established fact.
 */
const MAX_CHAPTERS = 24

export async function chapterChain(session) {
  if (!session) return []
  const out = []
  let node = session
  for (let hops = 0; node && hops < MAX_CHAPTERS; hops++) {
    out.unshift({
      id: node.id,
      chapter: node.chapter ?? 1,
      answers: node.answers ?? {},
      // Headline only. Never the moves' detail, and never the stats.
      destination: node.map?.destination ?? node.map?.headline ?? null,
      moves: Array.isArray(node.map?.moves)
        ? node.map.moves.map(m => ({ title: m.title, when: m.when }))
        : [],
      /**
       * ⭐⭐ WHAT THEY WERE TOLD TO LEAVE ALONE, which nothing else in this
       * product's category records. The road not taken is the thing people stay
       * anxious about for months, and a plan that crossed it off with a reason
       * is the only place that anxiety has an answer.
       * ⚠️ DISPLAY ONLY, and that is the whole distinction. A map's own words
       * may be SHOWN back to the person they were written for; they may never
       * be fed into the next generation as fact, which is the laundering path
       * guarded against since 16 Sep. This rides to a screen, never to a prompt.
       */
      cut: Array.isArray(node.map?.cut)
        ? node.map.cut.map(c => ({ label: c.label, why: c.why }))
        : [],
      outcome: node.outcome ?? null,
      outcomeNote: node.outcome_note ?? null,
      startedFrom: node.continues_from_outcome ?? null,
      createdAt: node.created_at ?? null,
    })
    if (!node.previous_session_id) break
    const { data, error } = await supabase
      .from('wayout_sessions')
      .select('id, chapter, answers, map, outcome, outcome_note, continues_from_outcome, previous_session_id, created_at')
      .eq('id', node.previous_session_id)
      .maybeSingle()
    if (error || !data) break
    node = data
  }

  /**
   * ⭐⭐ WHEN EACH MOVE WAS ACTUALLY DONE — the one fact in this product that is
   * a record of what a PERSON did rather than what the plan said.
   *
   * `done_at` has been written on every tick since the gates were built and
   * nothing has ever read it back except the gate itself, which only asks
   * whether the previous move is done. So the product has always known the date
   * somebody had the conversation they had been dreading for a year, and has
   * never once told them.
   *
   * ⚠️ ONE QUERY FOR THE WHOLE CHAIN, not one per chapter. Fetching inside the
   * loop above is the `useAuth` mistake in miniature — the same table hit N
   * times because nobody looked at the shape of the page.
   */
  const ids = out.map(c => c.id).filter(Boolean)
  if (ids.length) {
    const { data: pbs } = await supabase
      .from('wayout_playbooks')
      .select('session_id, move_order, done_at')
      .in('session_id', ids)
    const bySession = new Map()
    ;(pbs ?? []).forEach(r => {
      if (!r.done_at) return
      if (!bySession.has(r.session_id)) bySession.set(r.session_id, new Map())
      bySession.get(r.session_id).set(r.move_order, r.done_at)
    })
    out.forEach(c => {
      const done = bySession.get(c.id)
      // ⚠️ move_order is 1-based and matches the map's move index.
      c.moves = c.moves.map((m, i) => ({ ...m, doneAt: done?.get(i + 1) ?? null }))
    })
  }

  return out
}

export async function historyFor(session) {
  if (!session?.previous_session_id) return null
  const { data: prev, error } = await supabase
    .from('wayout_sessions')
    .select('answers, map, outcome, outcome_note')
    .eq('id', session.previous_session_id)
    .maybeSingle()
  if (error || !prev) return null

  const progress = await loadProgress(session.previous_session_id)
  return {
    chapter: session.chapter ?? 2,
    previousAnswers: prev.answers ?? null,
    previousMap: prev.map ?? null,
    ticked: progress?.done ?? new Set(),
    outcome: session.continues_from_outcome ?? prev.outcome ?? null,
    outcomeNote: prev.outcome_note ?? null,
  }
}

export async function recordOutcome(sessionId, outcome, note = '') {
  const { error } = await supabase
    .from('wayout_sessions')
    .update({
      outcome,
      outcome_at: new Date().toISOString(),
      outcome_note: note.trim() || null,
    })
    .eq('id', sessionId)
  if (error) throw new Error(error.message)
}
