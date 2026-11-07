import { useEffect, useRef, useState } from 'react'
import { Helmet } from 'react-helmet-async'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { clearDraft } from '../../lib/wayout/draft'
import { OPERATOR_CONTACT } from '../../lib/terms'
import { WAYOUT_NAME, WAYOUT_NAME_TITLE, WAYOUT_TAGLINE, WAYOUT_SITE_URL, WAYOUT_BASE, WAYOUT_HOME, canonicalUrl } from '../../lib/wayout/brand'
import { captureSource } from '../../lib/wayout/source'
import { captureInvite, invitedBy } from '../../lib/wayout/invites'
import { WAYOUT_REFERRAL_LIVE, WAYOUT_REFERRAL_ANNOUNCED } from '../../lib/wayout/pricing'
import './wayout.css'

/**
 * The frame every way-out screen sits in.
 *
 * ⭐ THE FONTS LOAD HERE, NOT IN index.html.
 * Figtree and Caveat belong to this product alone. Putting them in the global
 * <head> would add two font families to the first paint of every Eliv8 OS
 * marketing page — the pages the entire findability strategy depends on — for
 * visitors who will never see this product. Loading them from the route means
 * the cost lands only on the people looking at it.
 *
 * ⚠️ `display=swap` is deliberate: text renders immediately in the fallback and
 * reflows when Figtree arrives. The alternative is a blank screen on a slow
 * connection, and the first thing this product says is "you're not stuck" —
 * showing that late is worse than showing it in the wrong typeface.
 *
 * ⚠️ `noindex` while the name is unsettled. These URLs use the internal slug
 * and the product has no name; letting Google index /wayout now means the
 * rename later orphans whatever it learned, and a half-built paid product in
 * search results is worse than none. Remove the tag deliberately at launch —
 * and add the routes to scripts/sitemap.mjs in the same commit, or they will
 * be orphaned the way the answer pages were.
 */
export default function WayoutShell({
  children, count, title, noindex = true, wide = false, canonicalPath = '', signIn = false,
  home = false, share = null,
}) {
  // A page with its own link preview (a /stuck question) passes `share`:
  // { path, description, image }. Everything else previews as the product.
  const shareUrl   = share ? `${WAYOUT_SITE_URL}${share.path}` : WAYOUT_SITE_URL
  const shareDesc  = share?.description ?? WAYOUT_TAGLINE
  const shareImage = share?.image ?? `${WAYOUT_SITE_URL}/unstuckmap-og.png`
  /**
   * ⚠️ READ ONCE, NOT SUBSCRIBED. This is only deciding whether to draw a link,
   * so it does not need to follow every auth event — and `useAuth` is Eliv8's
   * context, which this product deliberately does not mount.
   */
  const [signedIn, setSignedIn] = useState(false)
  useUnstuckHead()
  // ⭐ First-visit source (utm tags + referring domain only) — see source.js.
  useEffect(() => { captureSource(); captureInvite() }, [])
  useEffect(() => {
    let cancelled = false
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) setSignedIn(Boolean(data?.session))
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  return (
    <div className="wayout">
      <Helmet>
        <title>{title ? `${title} · ${WAYOUT_NAME_TITLE}` : `${WAYOUT_NAME_TITLE} · ${WAYOUT_TAGLINE}`}</title>
        <meta name="description" content={WAYOUT_TAGLINE} />
        {noindex && <meta name="robots" content="noindex, nofollow" />}
        {/* 🔴 THE INHERITED CANONICAL POINTED AT THE ELIV8 HOMEPAGE. index.html
            carries `<link rel="canonical" href="https://eliv8os.com/">`, so
            every Unstuck Map page was telling search engines it was a duplicate
            of a B2B contractor advisor's front page. Nothing was indexed yet —
            noindex was still on — so it cost nothing, but it would have sent
            every scrap of authority to the wrong product the moment it came
            off.
            ⚠️ And the SAME page serves from both eliv8os.com/wayout/* and
            getunstuckmap.com/wayout/*, which is the duplicate-content shape
            that cost leadeos.com. The canonical names ONE of them. */}
        <link rel="canonical" href={canonicalUrl(canonicalPath)} />
        {/* ⭐⭐ THE LINK PREVIEW MUST NOT SAY ELIV8 OS. index.html carries a full
            set of Open Graph tags for the other product, and Helmet only
            manages what it DECLARES — so without these, texting somebody
            getunstuckmap.com previews as "Eliv8 OS — an advisor for owners who
            care how it's run", with Eliv8's description and Eliv8's image.
            That is the exact confusion a separate name exists to prevent, and
            it lands before anybody has clicked anything.
            ⚠️ og:url is the OWN domain, not the path this happens to be served
            from today. A preview that links back to eliv8os.com undoes the
            rest of it. */}
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content={WAYOUT_NAME_TITLE} />
        <meta property="og:url" content={shareUrl} />
        <meta property="og:title" content={title ? `${title} · ${WAYOUT_NAME_TITLE}` : `${WAYOUT_NAME_TITLE} · ${WAYOUT_TAGLINE}`} />
        <meta property="og:description" content={shareDesc} />
        <meta property="og:image" content={shareImage} />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:url" content={shareUrl} />
        <meta name="twitter:title" content={title ? `${title} · ${WAYOUT_NAME_TITLE}` : `${WAYOUT_NAME_TITLE} · ${WAYOUT_TAGLINE}`} />
        <meta name="twitter:description" content={shareDesc} />
        <meta name="twitter:image" content={shareImage} />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;700;800&family=Caveat:wght@700&display=swap"
        />
      </Helmet>

      {/* `wide` is for the MAP only. An intake screen asks one question and the
          narrow column is the point — widening it would put a second question
          in the corner of someone's eye while they answer the first. The map
          is a deliverable, not a question, so it earns the width. */}
      <div className={`wayout__frame${wide ? ' wayout__frame--wide' : ''}`}>
        <div className="wayout__brand">
          {/* 🔴 THE WORDMARK WAS NOT A LINK ON ANY SCREEN IN THIS PRODUCT, so a
              public page had no route back to the front door at all. Daniel,
              on a /stuck page: "there is no back button on any of these to the
              homepage." Somebody arriving from an assistant — which is the only
              channel that has ever brought this product a stranger — reads the
              answer and then has nowhere to go but the back button.

              ⚠️ ONLY WHERE LEAVING IS A REASONABLE THING TO OFFER. On the
              intake, the plan or a play, a link out of the flow is an exit sign
              beside the work, which is the same reason `signIn` is not drawn
              there either. Those screens carry their own crumb to the plan.
              ⭐ WAYOUT_HOME, not a literal: it is `/` on this product's own
              domain and `/wayout/hello` under the Eliv8 prefix. */}
          <i />
          {/* ⚠️ The name comes from brand.js and nowhere else. */}
          {home
            ? <Link className="wayout__brandhome" to={WAYOUT_HOME}>{WAYOUT_NAME}</Link>
            : WAYOUT_NAME}
          {count && <span className="wayout__count">{count}</span>}
          {/* 🔴 THERE WAS NO WAY BACK IN. Daniel: "do we have a log in section yet
              for once people sign up?" /wayout/enter has existed the whole time —
              it is where RequireWayout sends anybody without a session — but NOT
              ONE PUBLIC PAGE LINKED TO IT. Somebody who made an account, closed
              the tab and came back to the domain had no route to their own plan
              except guessing a URL.
              ⚠️ Deliberately quiet, and never on the plan itself: on the pages
              where somebody is mid-flow it would be an exit sign beside the work,
              and anyone already signed in does not need it. */}
          {signIn && !signedIn && (
            <Link className="wayout__signin" to={`${WAYOUT_BASE}/enter?in=1`}>
              Already started? Sign in
            </Link>
          )}

          {/* 🔴🔴 THERE WAS NO WAY OUT OF THIS PRODUCT AT ALL. Daniel, about to
              hand it to people: "so if i ask someone tests this out they will see
              what i wrote down?"

              The database answer is no — `wayout_sessions` is RLS-scoped to
              `auth.uid() = user_id`, so another account cannot read a word of
              his. ⭐⭐ THE BROWSER ANSWER WAS YES, AND THAT IS THE ONE THAT
              MATTERS ON A SHARED LAPTOP: the session persists, the local draft
              (`wayout:draft`) is not user-scoped, and this product had NO sign
              out anywhere — the only ones in the codebase are Eliv8's sidebar,
              which nobody here ever sees. Handing somebody your laptop meant
              handing them your plan.

              ⚠️ It clears the DRAFT as well as the session. Signing out while
              leaving an anonymous draft in localStorage would leave the next
              person answering into your half-finished form. */}
          {/* ⭐⭐ A MENU, LIKE ANY OTHER PLATFORM. Daniel, 2 Oct: "there should be
              a setting button or something that shows how to nav, terms etc."
              The only control here was Sign out. */}
          {signedIn && <AccountMenu />}
        </div>
        {/* ⚠️ A main landmark for screen readers (Lighthouse, 3 Oct). display:
            contents keeps the frame's flex layout exactly as it was. */}
        <main className="wayout__main">
          {!signedIn && <InvitedNote />}
          {children}
        </main>
        {/* ⭐⭐ ON EVERY PAGE, SAID ONCE AND PLAINLY. Daniel, 1 Oct: "making sure
            that it is clear this isn't legal or financial advice, this is the
            user's choice." Not a wall of small print — one true sentence and
            the two documents behind it. */}
        <WayoutFooter />
      </div>
    </div>
  )
}

/**
 * 🔴 THE HEAD HELMET DOES NOT OWN STILL SAID ELIV8 OS. index.html is shared with
 * the other product, and Helmet only manages the tags it declares — so on every
 * client-rendered page (/enter, /plan, /history…) the FIRST description in the
 * head was Eliv8's, the iOS home-screen title and author were "Eliv8 OS", the
 * browser bar was tinted near-black over a paper page, and an Organization
 * JSON-LD named the wrong company. This swaps those static tags for the time a
 * person is in this product and puts them back on the way out, so Eliv8's own
 * pages are untouched. The prerendered pages get the same swap at build time
 * (scripts/lib/unstuckHead.mjs).
 */
const STATIC_SWAPS = [
  ['meta[name="description"]:not([data-rh])', 'content', WAYOUT_TAGLINE],
  ['meta[name="author"]', 'content', 'Unstuck Map'],
  ['meta[name="apple-mobile-web-app-title"]', 'content', 'Unstuck Map'],
  ['meta[name="apple-mobile-web-app-status-bar-style"]', 'content', 'default'],
  ['meta[name="theme-color"]', 'content', '#F5F1E6'],
  ['link[rel="apple-touch-icon"]', 'href', '/apple-touch-icon-unstuckmap.png'],
]
function useUnstuckHead() {
  useEffect(() => {
    if (typeof document === 'undefined') return undefined
    const undo = []
    for (const [sel, attr, value] of STATIC_SWAPS) {
      for (const el of document.head.querySelectorAll(sel)) {
        undo.push([el, attr, el.getAttribute(attr)])
        el.setAttribute(attr, value)
      }
    }
    const hidden = [...document.head.querySelectorAll('script[type="application/ld+json"]')]
      .filter(el => /Eliv8/i.test(el.textContent))
    for (const el of hidden) el.setAttribute('type', 'application/x-eliv8-ld+json')
    return () => {
      for (const [el, attr, was] of undo) {
        if (was == null) el.removeAttribute(attr); else el.setAttribute(attr, was)
      }
      for (const el of hidden) el.setAttribute('type', 'application/ld+json')
    }
  }, [])
}

/** The footer on every Unstuck Map page — the shell's, and the landing's. */
export function WayoutFooter() {
  return (
    <footer className="wayout__footer">
      <p>{WAYOUT_NAME} is a planning tool, not legal, financial or tax advice. Every choice is yours.</p>
      <nav aria-label="Legal">
        <Link to={`${WAYOUT_BASE}/why`}>Why we built this</Link>
        <Link to={`${WAYOUT_BASE}/terms`}>Terms</Link>
        <Link to={`${WAYOUT_BASE}/privacy`}>Privacy</Link>
      </nav>
    </footer>
  )
}

/**
 * The signed-in menu: where everything is, in one place. Closes on a choice,
 * on Escape, or on a tap outside.
 * ⚠️ Sign out still clears the anonymous DRAFT as well as the session — see the
 * note this replaced in the shell: a shared laptop must not hand the next
 * person a half-finished form.
 */
function AccountMenu() {
  const [open, setOpen] = useState(false)
  const box = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const away = e => { if (box.current && !box.current.contains(e.target)) setOpen(false) }
    const key = e => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', key) }
  }, [open])
  const close = () => setOpen(false)
  return (
    <div className="wayout__menu" ref={box}>
      <button type="button" className="wayout__menubtn" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen(o => !o)}>
        <span aria-hidden="true">☰</span> Menu
      </button>
      {open && (
        <nav className="wayout__menupanel" aria-label="Account">
          <p className="wayout__menuhead">Your plan</p>
          <Link to={`${WAYOUT_BASE}/plan`} onClick={close}>Your plan</Link>
          <Link to={`${WAYOUT_BASE}/history`} onClick={close}>Your progress</Link>
          <Link to={`${WAYOUT_BASE}/invite`} onClick={close}>People you invited</Link>
          <Link to={`${WAYOUT_BASE}/plan#correct`} onClick={close}>Correct an answer</Link>
          <p className="wayout__menuhead">Help</p>
          <Link to={`${WAYOUT_BASE}/why`} onClick={close}>Why we built this</Link>
          <Link to={`${WAYOUT_BASE}/terms`} onClick={close}>Terms of use</Link>
          <Link to={`${WAYOUT_BASE}/privacy`} onClick={close}>Privacy</Link>
          <a href={`mailto:${OPERATOR_CONTACT}`} onClick={close}>Contact us</a>
          <Link to={`${WAYOUT_BASE}/account`} onClick={close}>Your data &amp; account</Link>
          <button
            type="button"
            className="wayout__menusignout"
            onClick={async () => {
              clearDraft()
              await supabase.auth.signOut()
              window.location.assign(WAYOUT_BASE || '/')
            }}
          >
            Sign out
          </button>
        </nav>
      )}
    </div>
  )
}

/**
 * ⭐ "DANNY INVITED YOU" (Daniel, 7 Nov 2026: the link "would need some
 * explaining on the other end so the person knows to use that specific one").
 * For a signed-out visitor who arrived from an invite link: who sent them, if
 * the sender lets their name show, and that signing up from here counts.
 * ⚠️ Money is named only once WAYOUT_REFERRAL_LIVE is on (pricing.js).
 */
export function InvitedNote() {
  const [from, setFrom] = useState(() => invitedBy())
  useEffect(() => {
    const again = () => setFrom(invitedBy())
    window.addEventListener('wayout:invited', again)
    return () => window.removeEventListener('wayout:invited', again)
  }, [])
  if (!from) return null
  const who = from.name || 'Someone you know'
  return (
    <aside className="wayout__i2welcome">
      <span className="wayout__i2av" aria-hidden="true">{(from.name || '?').slice(0, 1).toUpperCase()}</span>
      <span>
        <b>{WAYOUT_REFERRAL_LIVE ? `${who} gave you half off` : `${who} invited you`}</b>
        <span>{WAYOUT_REFERRAL_LIVE
          ? `Your plan is free. Your first month of step by step help is half price, applied when you sign up from here. Your answers stay private to you.`
          : `Make your free plan from here${from.name ? `, and ${from.name} will see that you joined` : ''}.${WAYOUT_REFERRAL_ANNOUNCED ? ' When paid plans open, you get half off your first month.' : ''} Your answers and your plan stay private to you.`}</span>
      </span>
    </aside>
  )
}
