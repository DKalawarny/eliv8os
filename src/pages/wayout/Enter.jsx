import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import WayoutShell from './WayoutShell'
import RouteMap from './RouteMap'
import { supabase, setRemember } from '../../lib/supabase'
import { parkPendingAcceptance } from '../../lib/terms'
import { clearDraft, hasHandoff } from '../../lib/wayout/draft'
import { WAYOUT_BASE, WAYOUT_INTAKE, WAYOUT_NAME_TITLE, WAYOUT_TOTAL_TIME} from '../../lib/wayout/brand'
import { humanError } from '../../lib/wayout/humanError'

/**
 * The way out — its own front door.
 *
 * 🔴 WHY THIS EXISTS. Until now every route here leaned on Eliv8's `/login`, so
 * someone halfway through writing about their marriage and their money got
 * bounced to a page headed "ELIV8 OS — someone in your corner who reads the
 * numbers", and after signing in landed in a business dashboard with a sidebar
 * of P&Ls and succession scores. Two products, two completely different people,
 * one front door belonging to the wrong one.
 *
 * ⭐ THE DOMAIN IS NOT THE BLOCKER, AND I HAD BEEN TREATING IT AS ONE. A
 * separate hostname is worth doing and waits on the name — but the thing that
 * actually made this feel attached to Eliv8 was borrowing its sign-in and its
 * landing page, and neither needed a domain to fix. When the name lands, the
 * hostname simply maps `/` here and nothing below changes.
 *
 * ⚠️ Same auth, same Supabase, same account — deliberately, for now. The spec's
 * rule is one auth layer, and an Eliv8 owner who opens this keeps the account
 * they have. What differs is only what a person sees and where they land.
 *
 * 🔴 FLAGGED TO CHANGE (Daniel, 13 Sep). One Supabase project means ONE USER
 * TABLE across both products, which is why his own email collided here with
 * "User already registered" — he is an Eliv8 owner. For a real way-out user
 * that is invisible today, and their data is already scoped to the PERSON and
 * never the company (migration 046), so nothing of theirs is reachable from the
 * other product.
 *
 * ⚠️ BUT THE COST OF SEPARATING ONLY GOES UP. Splitting means a second Supabase
 * project — its own auth, its own database, and either a duplicated `claude`
 * edge function or a shared gateway in front of both. Do it before real people
 * have accounts and it is configuration. Do it after and it is an account
 * migration with password resets for strangers who are mid-plan, which is the
 * worst possible moment to email somebody asking them to log in again.
 *
 * ⭐ So the decision point is BEFORE THE FIRST REAL USER, and it lands at the
 * same time as the domain and the name — all three are "what is this product
 * on its own" questions.
 */
/**
 * ⚠️ What this screen says depends on where the person was going. Bounced here
 * on the way to the first question, they have nothing saved yet; bounced here
 * on the way to the plan, they do.
 */
function headingFor(next) {
  if (next.endsWith('/plan')) return 'Your plan needs an account.'
  return 'First, make a free account.'
}

function leadFor(next) {
  if (next.endsWith('/plan')) {
    return 'An account keeps your plan safe, so you can open it tomorrow or on your phone.'
  }
  // ⚠️ "Six questions" meant something different here than on the landing page —
  // there it is the six taps, here it was the six intake screens. Two different
  // sixes in one flow is the kind of small wrongness that makes somebody wonder
  // what else does not line up.
  // ⚠️ One number, from brand.js, so this cannot drift from what the landing says.
  return `${WAYOUT_TOTAL_TIME.replace(/^about/i, 'About')} in all. The account is so your answers are still here if you stop halfway.`
}

export default function Enter() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  // Where they were headed before they were asked to sign in.
  const next = params.get('next') || WAYOUT_INTAKE

  // 🔴 DEFAULTS TO CREATING AN ACCOUNT, not signing in. The door used to open on
  // "Welcome back — your answers and your plan are where you left them" for
  // someone who had never made one. On a product with no users, first-time IS
  // the common case, and greeting a stranger as a returning customer is the
  // kind of small dishonesty people notice immediately.
  /**
   * 🔴🔴 THE LINK SAID "SIGN IN" AND OPENED A CREATE-ACCOUNT FORM. Daniel:
   * "brings you to sign up not sign in." Every header in the product links here
   * with the words "Already started? Sign in" — and this screen defaults to
   * `new`, so it answered with "Before the questions." and a terms checkbox.
   *
   * ⭐⭐ THE DEFAULT IS STILL RIGHT; WHAT WAS MISSING IS THAT THE LINK COULD NOT
   * SAY WHAT IT WANTED. On a product with almost no users, first-time IS the
   * common case — so an unqualified /enter still opens on Create. A link that
   * promises sign-in now asks for it: /enter?in=1.
   */
  const [mode, setMode]         = useState(params.get('in') === '1' ? 'in' : 'new')  // 'new' | 'in'
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [agreed, setAgreed]     = useState(false)
  const [show, setShow]         = useState(false)
  // ⭐ "Keep me signed in" (Daniel, 2 Nov: "we need a remember me at the
  // password login"). Same switch as Eliv8's login (lib/supabase.js): ticked
  // keeps the session after the browser closes, unticked ends it with the
  // browser, for a shared or library computer.
  const [remember, setRemember_] = useState(true)
  const [busy, setBusy]         = useState(false)
  const [error, setError]       = useState('')
  // ⚠️ Guidance is not an error. Rendering "you already have an account" in
  // alarm red tells somebody they have done something wrong when they have not.
  const [notice, setNotice]     = useState('')
  const [sent, setSent]         = useState(false)
  // 🔴 THE DEAD END BEHIND THE DEAD END. Recovering from "already registered"
  // by flipping to sign-in only helps somebody who knows the password. Daniel
  // did not — his is an Eliv8 account from months ago — so the screen bounced
  // him between "you already have an account" and "invalid credentials" with no
  // exit. Eliv8's own login has a reset; this one never did.
  const [resetSent, setResetSent] = useState(false)
  /**
   * 🔴🔴 STICKY, AND THAT IS THE WHOLE POINT. Daniel, at the end of the
   * questions: "it needs to be set up account not log in." This screen DOES open
   * on Create an account — but he has an Eliv8 account, so his signup came back
   * "already registered", the mode flipped to sign-in, and the notice explaining
   * why was then WIPED by `clearMessages()` on his very next submit.
   *
   * What was left was a bare "Welcome back." over a password error, on a product
   * he had never signed into. The screen looked like a login wall that had been
   * there all along.
   *
   * ⚠️ A notice cleared on the next action is a notice that vanishes exactly
   * when it is finally needed. This one is a FACT about the account, not a
   * message about the last attempt, so it outlives both.
   */
  const [known, setKnown] = useState(false)

  const [linkSent, setLinkSent] = useState(false)

  async function sendLink() {
    clearMessages()
    if (!email.trim()) { setError('Type your email above first.'); return }
    setBusy(true)
    setRemember(remember)   // the link signs them in later, in this browser
    try {
      const { error: e } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: `${window.location.origin}${next}`, shouldCreateUser: false },
      })
      // ⚠️ Same answer whether or not the email has an account — telling a
      // stranger which emails are registered is a leak.
      if (e && !/signups not allowed|user not found/i.test(e.message)) throw e
      setLinkSent(true)
    } catch (err) {
      setError(err.message || 'That did not go through.')
    } finally {
      setBusy(false)
    }
  }

  /** One place, so nothing can be left showing from a previous attempt. */
  function clearMessages() {
    setError('')
    setNotice('')
    setResetSent(false)
  }

  async function sendReset() {
    if (!email) { setError('Put your email in first and I’ll send the link.'); return }
    setBusy(true)
    clearMessages()
    const { error: e3 } = await supabase.auth.resetPasswordForEmail(email, {
      // 🔴 ITS OWN PAGE. This used to land on Eliv8's /reset-password —
      // sending somebody mid-recovery into another product's branding at the
      // least confident moment they will ever have with us.
      redirectTo: `${window.location.origin}${WAYOUT_BASE}/reset`,
    })
    setBusy(false)
    if (e3) setError(e3.message)
    else setResetSent(true)
  }

  async function submit(e) {
    e.preventDefault()
    if (mode === 'new' && !agreed) return
    setBusy(true)
    // 🔴 THE NOTICE WAS ONLY EVER SET, NEVER CLEARED. So "you already have an
    // account" stayed on screen through every retry and every mode switch,
    // still telling somebody about a problem they had already dealt with. A
    // message about a past state, left up, becomes a message about the current
    // one — and on this screen it reads as "it still isn't working".
    clearMessages()

    try {
      if (mode === 'new') {
        // ⚠️ Parked BEFORE the network call, exactly as Eliv8's signup does:
        // with email confirmation on, signUp returns a user with NO session, so
        // the acceptance row cannot be written here — RLS would reject it with
        // auth.uid() null. TermsGate flushes it on the first authenticated load
        // and keeps this timestamp, which is when they actually agreed.
        parkPendingAcceptance()
        const { data, error: e1 } = await supabase.auth.signUp({ email, password })
        if (e1) throw e1
        if (data.session) navigate(next, { replace: true })
        else setSent(true)                  // confirmation email path
      } else {
        setRemember(remember)   // before sign-in, so the session is written to the right place
        const { error: e2 } = await supabase.auth.signInWithPassword({ email, password })
        if (e2) throw e2
        /**
         * 🔴🔴 A DRAFT BELONGS TO A SIGN-UP, NEVER TO A SIGN-IN. Daniel, logging
         * in on a fresh account: "I log in fresh, now this shows up — not my
         * account." He landed halfway through the questions, on somebody else's
         * answers.
         *
         * `wayout:draft` is localStorage and is NOT user-scoped — it cannot be,
         * because it exists before anybody has an account. `adoptDraftInto`
         * refuses to overwrite real answers, but a FRESH account has none, so it
         * took the draft left in the browser.
         *
         * ⭐⭐ THE RULE THAT MAKES IT SAFE IS ABOUT INTENT, NOT IDENTITY: the only
         * legitimate path from an anonymous draft to an account is SIGNING UP at
         * the end of the questions you just answered. Somebody signing IN already
         * has their answers on the server — a draft in the browser is by
         * definition not theirs.
         *
         * ⚠️ Sign-in is also the one moment we can be certain a different person
         * may be at the keyboard, which is exactly when a shared laptop leaks.
         */
        // ⭐⭐ EXCEPT the answers this tab just finished. The hand-off proves the
        // draft was written here, moments ago, by the person now signing in —
        // see draft.markHandoff. Without it, a returning person who answered
        // every question and then signed in lost all of it.
        if (!hasHandoff()) clearDraft()
        navigate(next, { replace: true })
      }
    } catch (err) {
      // 🔴 THIS WAS A DEAD END DRESSED AS AN ERROR. Supabase says "User already
      // registered" and the screen just showed it — no way forward, on the
      // screen standing between somebody and the plan they have just spent
      // fifteen minutes on. They have an account; the only useful response is
      // to sign them in, not to report a database constraint at them.
      const already = /already registered|already exists/i.test(err?.message ?? '')
      if (already) {
        setMode('in')
        setKnown(true)
        setNotice('You already have an account with that email. Sign in and your answers come with you, or reset the password below if you don’t have it.')
      } else if (/invalid login credentials/i.test(err?.message ?? '')) {
        // ⚠️ Never "wrong password" — it might be the wrong email, and telling
        // somebody which one is wrong is also telling a stranger which emails
        // have accounts.
        setError('That email and password don’t match. Reset it below if you’re not sure.')
      } else {
        setError(err.message || 'That did not work.')
      }
    } finally {
      setBusy(false)
    }
  }

  if (sent) {
    return (
      <WayoutShell title="Check your email">
        <p className="wayout__q">Check your email.</p>
        <p className="wayout__lead">
          There is a link waiting. Open it and you will come straight back here. Your answers are saved.
        </p>
      </WayoutShell>
    )
  }

  return (
    <WayoutShell wide title={mode === 'new' ? 'Create your account' : 'Sign in'}>
      <div className="wayout__spread">
        <div className="wayout__col">
          {/* ⚠️ The copy follows where they were HEADED. Someone bounced here on
              the way to the questions has not answered any yet, so telling them
              their answers are safe is a sentence about nothing. Someone headed
              for the plan has one. */}
          {/* ⚠️ THREE STATES, NOT TWO. "Welcome back" is only honest for somebody
              who CHOSE to sign in. Somebody who just tried to create an account
              and turned out to have one is neither new nor returning, and telling
              them either is wrong. */}
          <h1>
            {known ? 'You already have an account.'
              : mode === 'in' ? 'Welcome back.'
              : headingFor(next)}
          </h1>
          <p className="wayout__lead">
            {known
              ? 'That email is already registered. Sign in and everything you just answered comes with you, or send yourself a reset link below.'
              : mode === 'in'
                ? 'Your answers and your plan are where you left them.'
                : leadFor(next)}
          </p>
          {/* ⭐ 11 Oct. Daniel, on the sign-in page: "its super boring", then
              "can we make a map looking picture on the side". The left half was
              a heading and 400px of nothing. This is a drawing, not anybody's
              real plan: three stops between where they are and where they want
              to be, which is the product's name made visible.
              ⚠️ Wide screens only. On a phone it would sit between the heading
              and the form, and the form is what they came for. */}
          <RouteMap firstDone={mode === 'in' && !known} />
        </div>

        <div className="wayout__col">
          <form className="wayout__enterform" onSubmit={submit}>
            <label className="wayout__label" htmlFor="wayout-email">Email</label>
            <input
              id="wayout-email"
              className="wayout__input"
              type="email"
              name="email"
              autoComplete="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
            />

            <label className="wayout__label" htmlFor="wayout-password">Password</label>
            <div className="wayout__pw">
              <input
                id="wayout-password"
                className="wayout__input"
                name="password"
                type={show ? 'text' : 'password'}
                autoComplete={mode === 'new' ? 'new-password' : 'current-password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
              />
              {/* ⚠️ Eliv8's sign-in has this and ours did not. On a phone, with a
                  password someone is inventing on the spot, a hidden field is
                  the commonest reason a first attempt fails. */}
              <button
                type="button"
                className="wayout__pwtoggle"
                onClick={() => setShow(v => !v)}
                aria-pressed={show}
              >
                {show ? 'Hide' : 'Show'}
              </button>
            </div>

            {mode === 'in' && (
              <label className="wayout__consent">
                <input
                  id="wayout-remember"
                  type="checkbox"
                  checked={remember}
                  onChange={e => setRemember_(e.target.checked)}
                />
                <span>Keep me signed in. Untick this on a shared computer.</span>
              </label>
            )}

            {/* ⚠️ Consent is required to create an account and the submit stays
                disabled until it is ticked — the same rule Eliv8 signup follows,
                because it is the same operator and the same terms. */}
            {mode === 'new' && (
              <label className="wayout__consent">
                <input
                  id="wayout-agree"
                  type="checkbox"
                  checked={agreed}
                  onChange={e => setAgreed(e.target.checked)}
                />
                {/* 🔴🔴 THIS SAID "I agree to the terms" AND LINKED TO
                    NOTHING. Somebody ticked a box consenting to a document
                    they were never shown and had no way to find — which is
                    worse than no checkbox, because it looks like consent was
                    obtained. Daniel raised liability from the product side;
                    this was the hole on the legal side, three words away.

                    ⚠️ /terms IS ELIV8 OS's, WRITTEN FOR BUSINESS OWNERS about
                    an AI business advisor. It is the same operator so it is
                    not wrong to point at it, and it is not written for a
                    person being handed a plan about their house and their
                    marriage. That document is a lawyer's job and it is on the
                    list before the first real user — this link is the stopgap
                    that at least makes the consent real. */}
                <span>
                  I’m over 18 and I agree to the{' '}
                  <a href={`${WAYOUT_BASE}/terms`} target="_blank" rel="noopener noreferrer">terms</a>{' '}
                  including that this is not legal or financial advice and every choice is mine.
                </span>
              </label>
            )}

            {notice && <p className="wayout__notice">{notice}</p>}
            {error && <p className="wayout__error">{humanError(error)}</p>}
            {resetSent && (
              <p className="wayout__notice">
                Sent. Open the link in that email and you’ll come straight back here.
              </p>
            )}

            <button
              className="wayout__btn"
              type="submit"
              disabled={busy || (mode === 'new' && !agreed)}
            >
              {busy ? 'One moment…' : mode === 'new' ? 'Create my account' : 'Sign in'}
            </button>
          </form>

          {/* ⭐ NO PASSWORD NEEDED, IF THEY WOULD RATHER. Daniel, 3 Oct: passwords
              stay — this is an option beside them. The link proves the email is
              theirs and signs them straight in; it never creates an account. */}
          {mode === 'in' && !resetSent && !linkSent && (
            <p className="wayout__hint">
              <button type="button" className="wayout__linkbtn" onClick={sendLink} disabled={busy}>
                Email me a sign-in link instead
              </button>
              <br />
              <button type="button" className="wayout__linkbtn" onClick={sendReset} disabled={busy}>
                Forgot your password? Email me a reset link
              </button>
            </p>
          )}
          {linkSent && (
            <p className="wayout__notice">
              Check your email. The link signs you in. You can use it once, within an hour.
            </p>
          )}

          {/* ⚠️ "at minimum it should be clearer on the log-in screen, it's small."
              This is the only way between the two states and it was set as a
              hint — the smallest, quietest type on the page, under the fold on a
              phone. It is the escape hatch for anybody who arrived at the wrong
              one of the two, which on this screen is half the people. */}
          <p className="wayout__switch">
            {mode === 'new' ? 'Already started? ' : 'First time? '}
            <button
              type="button"
              className="wayout__linkbtn"
              onClick={() => { setMode(mode === 'new' ? 'in' : 'new'); setKnown(false); clearMessages() }}
            >
              {mode === 'new' ? 'Sign in' : 'Create an account'}
            </button>
          </p>

          <p className="wayout__fine" style={{ textAlign: 'left', marginBottom: 28 }}>
            {WAYOUT_NAME_TITLE} keeps what you write to itself. Nobody else sees it.
          </p>
        </div>
      </div>
    </WayoutShell>
  )
}
