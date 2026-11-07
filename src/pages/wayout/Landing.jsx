import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { captureSource } from '../../lib/wayout/source'
import { captureInvite } from '../../lib/wayout/invites'
import { Helmet } from 'react-helmet-async'
import { WAYOUT_NAME, WAYOUT_NAME_TITLE, WAYOUT_TAGLINE, WAYOUT_BASE, WAYOUT_SITE_URL, canonicalUrl } from '../../lib/wayout/brand'
import { priceLine, WAYOUT_PRICE_FULL, WAYOUT_PAYMENTS_LIVE, walksWithYouLine } from '../../lib/wayout/pricing'
import { SITUATIONS } from '../../content/unstuckSituations'
import { WayoutFooter, InvitedNote } from './WayoutShell'
import './wayout.css'

/**
 * The way out — the front door.
 *
 * ⭐⭐ THE PRODUCT IS THE HERO, not copy about the product. Daniel's reference
 * (omen.trade) puts a phone showing a real balance and a real chart at the
 * centre of the screen; every mockup I made before that had no product on it at
 * all, just type on a card, which is exactly why two "different directions"
 * read to him as no change. The plan itself is the most persuasive object this
 * product owns and it was nowhere near the front door.
 *
 * ⭐ MOTION LIVES BEHIND THE CONTENT AND NEVER ON IT. The light drifts on a
 * nineteen-second loop; the type does not move at all. That restraint is what
 * makes a page read as expensive rather than busy, and it is the half I had
 * been missing while arguing that restraint meant having no motion.
 *
 * ⚠️ WHAT IS DELIBERATELY NOT TAKEN FROM THE REFERENCE: near-black with a neon
 * accent and gradient text is the visual language of crypto and trading, and
 * this audience has been marketed at by exactly that. Same composition, our
 * materials. `--wo-dark` on the wrapper flips the ground if that judgement
 * turns out to be wrong — it is tokens, not a rebuild.
 *
 * 🔴 THE PLAN ON SCREEN IS MARCUS'S, AND IT HAS TO STAY A REAL ONE. The whole
 * trick is that it is an actual answer with actual arithmetic. A blurred or
 * invented plan here would be the page lying in precisely the way the product
 * refuses to — and it would be the first thing anyone saw.
 */
/**
 * ⭐⭐ TWO PEOPLE WHOSE PLANS SHARE NOTHING. That is the point of having two: the
 * claim on this page is that the plan is built from YOUR answers, and a single
 * example quietly argues the opposite.
 *
 * ⚠️ They are deliberately opposite in SHAPE, not just in detail. Marcus already
 * has the money and is short of permission; Dee is short of the money and needs
 * the order. One is told he can afford it today, the other is given a date. If
 * both cards said the same kind of thing, two would be worse than one.
 *
 * 🔴 EVERY FIGURE HERE IS ARITHMETIC ON THE FIGURES IN THE SAME CARD, and no
 * move claims what anybody will qualify for or what a named body provides. These
 * are illustrations of a real plan's shape, and the moment one of them says
 * something the actual product would refuse to say, the front door is lying
 * about what is behind it.
 */
const HERO_PLANS = [
  {
    who: 'Marcus, 52. Two kids. Wants more time at home.',
    headline: 'Four days a week by March.',
    mark: 'You can already afford it.',
    stats: [['Bills each month', '$4,100'], ['Pay on a four-day week', '$5,600']],
    moves: [
      ['Add up your monthly bills', 'One evening.', true],
      ['Show the number to Jen', 'Next week.', false],
      ['Ask your boss for a four-day week', 'March.', false],
    ],
    cut: [
      ['A side business', 'you want time, not more work.'],
      ['Selling the house', 'you don’t need to.'],
    ],
  },
  {
    who: 'Dee, 38. Rents. Two kids. Wants more money.',
    headline: 'Out of debt by June,',
    mark: 'without a second job.',
    stats: [['Left over each month', '$240'], ['What you owe', '$3,100']],
    moves: [
      ['Cancel the bills you don’t use', 'This week.', true],
      ['Pay off the $900 card before the $2,200 one', 'By March. It costs you more.', false],
      ['Ask for a raise, with your numbers on paper', 'April.', false],
    ],
    cut: [
      ['A second job', 'no time for it, and childcare would cost more than you’d make.'],
      ['A loan to pay off your cards', 'it would cost you more than it saves.'],
    ],
  },
]

/**
 * The hero shows the poster with a play button; pressing it opens the video
 * nearly full screen. 🔴 Why: the app inside the video is a 1280px-wide page,
 * and at hero size its body text came out about 8px tall, which Daniel read as
 * blur. Large, it is legible. Esc, the close button or a click outside closes.
 */
function HeroVideo() {
  const [open, setOpen] = useState(false)
  const closeRef = useRef(null)
  useEffect(() => {
    if (!open) return
    const onKey = e => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [open])
  return (
    <>
      <button type="button" className="wayout__vidbtn" onClick={() => setOpen(true)} aria-label="Play the video">
        <img src="/video/unstuck-map-plan.jpg" alt="" width="1280" height="720" />
        <span className="wayout__vidplay" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z" fill="currentColor" /></svg>
        </span>
      </button>
      {open && (
        <div className="wayout__vidmodal" role="dialog" aria-modal="true" aria-label={`${WAYOUT_NAME} video`} onClick={() => setOpen(false)}>
          <button type="button" ref={closeRef} className="wayout__vidclose" onClick={() => setOpen(false)} aria-label="Close the video">×</button>
          {/* autoPlay is fine here: it only ever starts from their own press. */}
          <video src="/video/unstuck-map-plan.mp4" controls autoPlay playsInline onClick={e => e.stopPropagation()} />
        </div>
      )}
    </>
  )
}

const HOME_LD = {
  '@context': 'https://schema.org',
  '@graph': [
    { '@type': 'WebSite', '@id': `${WAYOUT_SITE_URL}/#website`, url: WAYOUT_SITE_URL, name: WAYOUT_NAME, description: WAYOUT_TAGLINE, inLanguage: 'en' },
    {
      '@type': 'WebApplication',
      '@id': `${WAYOUT_SITE_URL}/#app`,
      name: WAYOUT_NAME,
      url: WAYOUT_SITE_URL,
      applicationCategory: 'LifestyleApplication',
      operatingSystem: 'Web',
      isAccessibleForFree: true,
      description: 'A free plan for someone who feels stuck, with money, with time, or both. Answer plain questions about your own situation and get three moves in the order they work.',
      disambiguatingDescription: 'A personal planning tool for money and time. Not the product design framework called The Unstuck Map.',
    },
  ],
}

export default function Landing() {
  // ⭐ The landing is where most first visits arrive — record where from.
  useEffect(() => { captureSource(); captureInvite() }, [])
  return (
    <div className="wayout wayout--hero">
      <Helmet>
        <title>{`${WAYOUT_NAME_TITLE} · ${WAYOUT_TAGLINE}`}</title>
        <meta name="description" content={WAYOUT_TAGLINE} />
        {/* ⭐⭐ Indexable as of 26 Sep — see the note in Diagnostic.jsx. This is
            the page that should rank: it says what the product is. */}
        {/* Same inherited-canonical problem as WayoutShell — this page does not
            use it, so it needs its own or it claims to be the Eliv8 homepage. */}
        <link rel="canonical" href={canonicalUrl('/')} />
        {/* ⭐ 18 Oct: what the product IS, for search and assistants. The home
            page had none. ⚠️ No price: the plan is free and the paid half is
            not live. disambiguatingDescription because "The Unstuck Map" is
            also an unrelated product design framework (unstuckmap.com). */}
        <script type="application/ld+json">{JSON.stringify(HOME_LD)}</script>
        {/* ⚠️ Same reason as WayoutShell — index.html's Open Graph tags are
            Eliv8 OS's, and Helmet only manages what it declares. This page does
            not use WayoutShell, so it needs its own set or it inherits them. */}
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content={WAYOUT_NAME_TITLE} />
        <meta property="og:url" content={WAYOUT_SITE_URL} />
        <meta property="og:title" content={`${WAYOUT_NAME_TITLE} · ${WAYOUT_TAGLINE}`} />
        <meta property="og:description" content={WAYOUT_TAGLINE} />
        <meta property="og:image" content={`${WAYOUT_SITE_URL}/unstuckmap-og.png`} />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:url" content={WAYOUT_SITE_URL} />
        <meta name="twitter:title" content={`${WAYOUT_NAME_TITLE} · ${WAYOUT_TAGLINE}`} />
        <meta name="twitter:description" content={WAYOUT_TAGLINE} />
        <meta name="twitter:image" content={`${WAYOUT_SITE_URL}/unstuckmap-og.png`} />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700;800&family=Caveat:wght@700&display=swap"
        />
      </Helmet>

      {/* Behind everything. Two slow warm sources, drifting past each other. */}
      <div className="wayout__aura" aria-hidden="true" />
      <div className="wayout__grain" aria-hidden="true" />

      {/* ⚠️ The page's main landmark (Lighthouse, 3 Oct). */}
      <div className="wayout__hero" role="main">
        <div className="wayout__herocopy">
          <div className="wayout__brand">
            <i />{WAYOUT_NAME}
            {/* 🔴 The only route back for somebody who already has an account.
                /wayout/enter existed all along and nothing public linked to it. */}
            {/* ⚠️ `?in=1` — a link that says "Sign in" has to arrive on sign-in. */}
            <Link className="wayout__signin" to={`${WAYOUT_BASE}/enter?in=1`}>Already started? Sign in</Link>
          </div>
          {/* ⭐ "Danny invited you", for a visitor from an invite link. */}
          <InvitedNote />

          <h1 className="wayout__heroline">
            Three<br />moves.<br /><span>In order.</span>
          </h1>

          {/* ⭐ The tagline carries the proposition now, so the lead does the
              job under it rather than repeating it: what it costs them, and
              what they get that nobody else gives. */}
          {/* 🔴 THE HERO SAID "Six honest questions, then which of your moves is
              first" — six questions do NOT give you your moves, they name which of
              four ways out is yours. Third instance of this claim found after I
              reported the pass complete; the first two greps missed it because
              they looked for "six questions" and the page says "Six HONEST
              questions". The durable fix is in brand.js: the promise about time
              now lives in one place, like the price. */}
          {/* 🔴 ONE PLACE PER IDEA. Daniel: "it's still all over this page." He
              was right and it was no longer a truth problem — "three minutes"
              appeared FIVE times on one page and three times inside this hero
              alone: the lead, the button and the fine print all said it. Said
              once it is an offer; said five times it reads as insisting, which is
              the same fault as the offer card saying "free" three times.
              ⚠️ So the division is: the LEAD carries the proposition, the BUTTON
              carries the ask, the FINE PRINT carries the arrangement. None of
              them repeats another. */}
          {/* 🔴🔴 THE PAGE NEVER SAID WHAT IT WAS ABOUT. Daniel: "it doesn't
              anywhere really depict what it does." Measured on the rendered
              page, the words money, debt, job and house appeared NOWHERE above
              the fold — the headline says "Three moves", the lead says "sort
              out the order", the button says "show me which way" and the fine
              print says twenty minutes. Every one true, not one of them naming
              the subject. A stranger could not tell budgeting from therapy from
              a productivity app, and on a phone the sample plan that carries
              the whole meaning sits below the fold.
              ⚠️ The nouns are the fix, not a new headline. "Three moves. In
              order." is the mark and stays; this line is where the page is
              allowed to be plain.
              ⚠️ They are also the SAME four this page already uses further down
              ("a house with debt against it… a job that pays more than the next
              one would… a year of night shifts"). Recognition works when a
              person meets their own situation twice, not two different lists. */}
          <p className="wayout__herolead">
            {WAYOUT_TAGLINE} Your house, your debt, your job, your hours. Find
            out what to do first and what can wait.
          </p>

          <div className="wayout__herocta">
            <Link className="wayout__btn" to={`${WAYOUT_BASE}/start`}>Show me which way</Link>
            {/* 🔴 THIS CONTRADICTED ITSELF INSIDE ONE PARAGRAPH. It read "The
                FIRST three minutes are free and need no account" immediately
                before priceLine() says "Your plan is free. Nothing to pay, at the
                end or anywhere else." "First" implies a later part that is not
                free — in the hero, which is the most-read line on the site, and
                the exact sentence somebody braced for a bait-and-switch is
                scanning for.
                ⚠️ It also still sold the product as a three-minute thing. Both
                times are stated now, because the honest version is also the
                better funnel: a small first step with the real one named. */}
            <p className="wayout__fine">
              {/* 🔴 1 Oct audit: "No account" four times on this page, then "Your plan
                  needs an account" at the end of the questions. Said plainly now. */}
              No card. You make an account at the end, to keep your plan. About twenty minutes, start to finish. {priceLine()}
            </p>
          </div>
        </div>

        {/* ⭐⭐ 17 OCT: THE VIDEO IS THE HERO'S PRODUCT NOW. Daniel: "maybe video
            goes where cards are and cards go below." Same idea as the cards it
            replaces (the product, not copy about it), but it shows the whole
            thing working, tap to new version, in under a minute.
            ⚠️ Never autoplay: the voice carries the explanation and a muted
            loop would play it without the words. preload="none" keeps 11 MB off
            the first page load; the poster is the opening card.
            ⚠️ Luis is a sample person and the caption says so.
            🔴 It PLAYS LARGE, not in the hero (17 Oct, Daniel: "looks a bit
            blurry"). The file is sharp; in a ~800px hero box the app's text
            inside it renders a few pixels tall. See HeroVideo. */}
        <figure className="wayout__herovideo">
          <HeroVideo />
          <figcaption>
            Luis is an example. Two jobs, $300 short each month, wants to be home
            for supper. Under a minute, sound on.
          </figcaption>
        </figure>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          ⭐⭐ BELOW THE FOLD, AND UNTIL 26 Sep THERE WAS NOTHING HERE AT ALL —
          the wrapper carried `overflow: hidden`, so the page could only ever be
          one screen tall. Daniel: "there is nothing interesting or intriguing."

          🔴 THE ORDER IS THE ARGUMENT, and it is not the usual one. A landing
          page normally opens by naming a pain. This one cannot: somebody who is
          stuck already knows the pain in more detail than we ever will, and
          describing it back to them is the "vague" failure in a different
          costume. So the hero shows THE ANSWER — a real plan with real
          arithmetic — and everything below earns the right to it.
          ══════════════════════════════════════════════════════════════════════ */}
      <div className="wayout__pitch">

        {/* ⭐⭐ THE PAGE SHOWED THE OUTPUT AND NEVER THE PROCESS. Two finished
            plans sit in the hero, beautifully, and nothing told anybody how one
            comes to exist — the first mention that questions are involved was
            the offer block, four sections down. So the most common unspoken
            objection ("what is actually going to happen if I press that?") went
            unanswered on the page whose only job is to get the button pressed.
            ⚠️ Three steps because there are three, not because three is the
            number these sections come in. The middle one is where the work is
            and it says so. */}
        <section>
          <h2 className="wayout__pitchh">What happens when you press the button.</h2>
          <p className="wayout__pitchlead">
            You answer questions about your life. You get a plan back. Nothing
            to install.
          </p>
          {/* ⚠️ NOT THE PILLAR CARDS. Rendered side by side these two sections
              were the same object twice — three bordered cards, then three
              bordered cards — and a reader scanning sees one idea, not two.
              ⭐ These are a SEQUENCE and the pillars are a set, so the eyebrow
              carries the order in words rather than a box carrying nothing.
              ⚠️ Words and not 01/02/03: digits are what made the walkthrough
              read as a form to fill in, and Daniel threw that out today. Here
              the order is real information, so it is said, not numbered. */}
          <div className="wayout__steps">
            <div>
              <span>First</span>
              <h3>Six quick taps</h3>
              <p>
                Tell us what you want and what you have. We show you the way out
                that fits you best.
              </p>
            </div>
            <div>
              <span>Then</span>
              {/* ⚠️ NO TIME FIGURE HERE. The hero's fine print owns that promise
                  — the page once said "three minutes" five times and Daniel:
                  "it's still all over this page." Said once it is an offer. */}
              <h3>A few more questions</h3>
              <p>
                Your bills, your debt, your hours, your family, and where you want
                to be in a year. Your own words and your own numbers.
              </p>
            </div>
            <div>
              <span>And then</span>
              <h3>Your plan, the same day</h3>
              <p>
                Three things to do, in order. What each one is worth, using your
                numbers. And what to skip for now. Your plan is yours to keep.
              </p>
            </div>
            {/* ⭐⭐ 10 OCT: THE PART THE PAGE NEVER SAID. A friend finished a plan
                and then described, as the thing he would actually want,
                something that "keeps them on task" — which is what happens
                after the plan, and the steps stopped at the plan. Daniel: "maybe
                we should explain when marketing better."
                ⚠️ Every clause is a thing the plan page does today: moves are
                ticked off, all three ticked asks how it went and builds the
                next plan, and "Something changed?" rewrites it.
                🔴 Nothing here may imply a person on the other end. The plan is
                the subject of every sentence, never a coach or an adviser. */}
            <div>
              <span>After that</span>
              <h3>Your plan changes when your life does</h3>
              <p>
                Check off each move when you finish. When all three are done, you
                get your next three. If something changes, say so and your plan is
                updated.
              </p>
            </div>
          </div>
        </section>

        {/* ⭐⭐ 17 OCT: THE TWO SAMPLE PLANS MOVED HERE FROM THE HERO, where the
            video now is. Right after "what happens when you press the button",
            so the page reads: watch one, what you do, what you get back.
            🔴 THE REASON THERE ARE TWO STILL HOLDS: ONE EXAMPLE MAKES THE PRODUCT
            LOOK LIKE IT DOES ONE THING. Marcus already has the money and needs
            permission; Dee is $3,100 in a hole and needs the order. Their
            headlines, their numbers and all six moves share nothing, which IS
            the claim this page is making.
            ⚠️ No stack and no hover swap any more: side by side is the contrast,
            and the lead says they are examples. Readable now, so no aria-hidden. */}
        <section>
          <h2 className="wayout__pitchh">Two people. Two different plans.</h2>
          <p className="wayout__pitchlead">
            Marcus and Dee are examples. They answered the same questions and got
            different plans.
          </p>
          <div className="wayout__heroplans">
            {HERO_PLANS.map(pl => (
              <div className="wayout__heroplan" key={pl.who}>
                <div className="wayout__brand"><i />your plan</div>
                <p className="wayout__who">{pl.who}</p>
                {/* 🔴 NOT A HEADING. These were <h2>, which made "Four days a week
                    by March" and "Out of the hole by June" the FIRST TWO SECTION
                    HEADINGS on the page — an invented person's plan sitting above
                    every real section in the document outline. It is a picture of
                    the product, so it is a div that happens to be big. */}
                <div className="wayout__heroplanline">
                  {pl.headline} <mark>{pl.mark}</mark>
                </div>

                {/* ⭐ 9 Oct: mirrors the real plan, where the first thing under the
                    headline is the next step, then the numbers as a starting line. */}
                {(() => { const m = pl.moves.find(([, , now]) => now) ?? pl.moves[0]; return (
                  <p className="wayout__starthere"><b>Start here</b><span>{m[0]}<em>{m[1]}</em></span></p>
                ) })()}
                <p className="wayout__label wayout__herostarting">Where you are now</p>
                <div className="wayout__stats">
                  {pl.stats.map(st => (
                    <div className="wayout__stat" key={st[0]}>
                      <span>{st[0]}</span><b>{st[1]}</b>
                    </div>
                  ))}
                </div>

                <p className="wayout__label">Your three moves, in order</p>
                {pl.moves.map(([title, when, now]) => (
                  <div className={`wayout__move${now ? ' wayout__move--now' : ''}`} key={title}>
                    <span className="wayout__chk">
                      <svg viewBox="0 0 16 16" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 8.5l3 3 7-7" />
                      </svg>
                    </span>
                    <span>
                      <p>{title}</p>
                      <small><b>{when}</b></small>
                    </span>
                  </div>
                ))}

                {/* ⭐⭐ THE CUT LIST IS THE DIFFERENTIATOR AND IT BELONGS ON THE
                    FRONT DOOR. Everything else adds to somebody's list; this is
                    the one that takes things off it, with the reason. */}
                <p className="wayout__herocut">
                  <b>What we left out</b>
                  {pl.cut.map(([what, why]) => (
                    <span key={what}><s>{what}</s>: {why}</span>
                  ))}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* ⭐⭐ THE DIFFERENCE, STATED AS THINGS IT REFUSES TO DO. Every one of
            these is a guard that actually exists in the code — the figure check,
            the cut list, the gates. Claims a competitor could copy into their
            copy but not into their product. */}
        <section>
          <h2 className="wayout__pitchh">You don’t need more advice. You need to know what to do first.</h2>
          <p className="wayout__pitchlead">
            You’ve been told to budget, work harder and wait. None of that tells
            you what to do this week.
          </p>
          <div className="wayout__three">
            <div>
              <h3>Your numbers. Not averages.</h3>
              <p>
                Every number in your plan comes from what you told us. If we
                don’t know something, we say so and tell you who would know. We
                never guess.
              </p>
            </div>
            <div>
              <h3>Your plan crosses things off.</h3>
              <p>
                Your plan tells you what <b>not</b> to do right now, and why.
                Most advice only adds to your list.
              </p>
            </div>
            <div>
              <h3>One thing at a time.</h3>
              <p>
                Each move tells you when you are ready for the next one. So you
                finish one before you start another.
              </p>
            </div>
          </div>
        </section>

        {/* ⚠️ THE OFFER, PLAINLY. It was a 30-word sentence in small grey type
            under the button, explaining a pricing model before anyone knew what
            the product was.

            🔴 AND IT MUST DERIVE FROM `WAYOUT_PAYMENTS_LIVE` LIKE EVERYTHING
            ELSE. My first version hardcoded the price, so the hero said "nothing
            to pay, at the end or anywhere else" and this block advertised $29 a
            month — two offers on one page, 900px apart. That is exactly the
            failure caught on Eliv8's /pricing, where a "14-day free trial" badge
            sat above "free while in private pilot" and a button read "Start
            14-day free trial — free". One flag, one offer. */}
        {/* ⚠️ MOVED BELOW THE ARGUMENT. Sixteen links to other pages is a
            directory, and a directory placed between the hero and the first
            claim interrupts a pitch to offer sixteen ways to leave it. It earns
            its place — nobody types "I am stuck", they type the specific thing,
            and these are the pages written for exactly that — but it reads as
            "here is more to read" AFTER the case is made and as "this is not
            for you specifically" before. */}
        {/* ⭐ RECOGNITION BEFORE PERSUASION. Nobody types "I am stuck" — they
            type the specific thing. These are the pages written for exactly that,
            so this section doubles as the internal linking those pages need.

            🔴 THE OLD COPY STOPPED WORKING THE MOMENT THIS SECTION MOVED. It
            opened "It's never just 'stuck'. It's a house with debt against it.
            A job that pays more than the next one would." — which was fine as
            the page's FIRST claim and became two faults once it sat after the
            argument: it restarts the case from nothing, and it lists the same
            four things the hero lead now names, in the same order, 1,500px
            below. Daniel: "i don't like the write up."
            ⭐⭐ The section's job here is different from its job up top. Up top
            it was recognition — "this is about you". Down here the reader has
            already had the argument, so what they need is a way IN that is not
            the button: something to read while they decide. So the heading
            invites rather than diagnoses, and the lead says what these pages
            actually do.
            ⚠️ "Whether or not you ever make a plan" is their own standard, not
            a flourish: the test written into unstuckSituations.js is whether
            somebody who never pays a cent is genuinely better off, and a page
            that withholds the useful part to drive a signup reads as
            withholding. Saying it out loud is what makes it worth trusting. */}
        <section>
          {/* 🔴🔴 NAMING THE COUNT TURNED A LIBRARY INTO A MENU, AND A MENU
              INVITES "MINE IS NOT ON IT". Daniel, reading his own page as a
              user: "this makes me as a user feel like there are only 16
              scenarios, maybe mine is too unique."
              ⭐⭐ And it quietly contradicted the product. Nothing here is
              matched to a list — the plan is GENERATED from their answers, so a
              number implying a finite set of covered cases argues against the
              one thing that makes this worth doing. The most specific situation
              is the one this serves best, and the copy was telling that person
              to check whether they qualify.
              ⚠️ The count is gone from the link below for the same reason. A
              figure that is useful navigation on a directory page is a ceiling
              on a landing page. */}
          <h2 className="wayout__pitchh">Read the one that sounds like yours.</h2>
          <p className="wayout__pitchlead">
            Common situations, answered in plain words. Free to read. Nothing
            to fill in.
          </p>
          <div className="wayout__board wayout__board--situations">
            {SITUATIONS.slice(0, 6).map(x => (
              <Link
                key={x.slug}
                to={`${WAYOUT_BASE}/stuck/${x.slug}`}
                className="wayout__card wayout__situationcard"
              >
                <b>{x.intro}</b>
                <h3>{x.question}</h3>
              </Link>
            ))}
          </div>
          {/* ⚠️ .wayout__fine centres by default — correct under a centred CTA,
              wrong here, where it was the only centred thing in the section. */}
          {/* ⭐⭐ AND THE ANSWER FOR THE PERSON WHOSE SITUATION IS NOT HERE — which
              is everybody, and is the point. Daniel: "maybe say here's some
              examples, and put somewhere 'and for the unique ones'."
              ⚠️ Said as what the product DOES, not as reassurance. "Don't worry,
              we cover that too" is a promise; "built from your answers" is how
              it works, and a reader can check it in twenty minutes. */}
          <p className="wayout__unique">
            Yours is probably not on this list. That is fine. Your plan is built
            from your own answers, not picked from a list.
          </p>
          <p className="wayout__fine" style={{ marginTop: 14, textAlign: 'left' }}>
            <Link to={`${WAYOUT_BASE}/stuck`}>More situations →</Link>
          </p>
        </section>

        <section>
          <h2 className="wayout__pitchh">
            {WAYOUT_PAYMENTS_LIVE ? 'The plan is free. Keep it either way.' : 'All of it is free right now.'}
          </h2>

          <div className="wayout__deal">
            <div>
              <span className="wayout__dealtag">Free. No card</span>
              <h3>The questions, then your plan</h3>
              <p>
                Answer the questions and get your plan: three moves in order,
                what each one is worth, and what to skip. Your plan is yours to
                keep. No card needed.
              </p>
            </div>
            <div>
              {/* ⚠️ SAID "FREE" THREE TIMES IN ONE CARD — the section heading, this
                  label, and again in the body. Once is the offer; three times
                  reads as protesting. The label now says what the thing IS. */}
              <span className={`wayout__dealtag${WAYOUT_PAYMENTS_LIVE ? ' wayout__dealtag--paid' : ''}`}>
                {WAYOUT_PAYMENTS_LIVE ? `${WAYOUT_PRICE_FULL}, only if you want it` : 'The paid half, later'}
              </span>
              <h3>The step-by-step guide</h3>
              <p>
                {walksWithYouLine()}{' '}
                {WAYOUT_PAYMENTS_LIVE
                  ? <><b>Stop any month.</b> Nothing is locked behind it that you were promised free.</>
                  /* ⚠️ DELIBERATELY NOT A GRANDFATHERING PROMISE. An earlier
                     draft said "not for anyone using it now", which commits
                     Daniel to free-for-life for every early user — his call to
                     make, not copy's. */
                  /* 🔴 THIS READ "You will know well before that changes", which
                     is a sentence about a pricing event nobody has been told is
                     coming — Daniel could not parse it and neither could I on a
                     cold read. What a reader wants here is what the guide DOES,
                     not a reassurance about a future they have not been shown.
                     ⚠️ Still no figure while WAYOUT_PAYMENTS_LIVE is false. The
                     price appears in the branch above the moment it is real —
                     advertising $29 on a page whose every other line says free
                     is the two-offers failure this block was written to end. */
                  : <><b>Free for now.</b> We will ask you before that
                      changes.</>}
              </p>
            </div>
          </div>
          {/* ⚠️ MOVED. This was the section's LEAD, so the block about the offer
              opened on a legal disclaimer — which reads as though the disclaimer
              is the point. It is fine print, so it sits where fine print sits.
              🔴 And naming the thing accurately is all copy can do: the terms are
              unwritten and Eliv8 Inc. does not exist, so Sarlia is currently the
              only entity between Daniel and a user. docs/wayout-before-launch.md */}
          <p className="wayout__disclaimer" style={{ marginTop: 20 }}>
            Both are general information about how these decisions work. Not
            financial, legal or tax advice, and not a substitute for someone who
            knows your full situation.
          </p>
        </section>

        {/* 🔴 THE CLOSE WAS THE HERO AGAIN. Same opening sentence, same button,
            same fine print, 2,000px lower — so the last thing the page did was
            repeat its first thing, which is the one position where repeating
            reads as having nothing further to say. Daniel: "there has to be a
            sell still and a close."
            ⭐⭐ A CLOSE DOES DIFFERENT WORK FROM A HERO. The hero earns
            attention; the close answers what is still holding somebody on the
            page — what it costs them to try, what they walk away holding, and
            whose the answers are. All three are already true here, and none of
            them had ever been said together.
            ⚠️ "This week" is deliberate: it is the page's own phrase from
            "Advice is cheap", and closing on the promise the argument opened
            with is the difference between a close and a second introduction.
            🔴 It was "Saturday morning" until 9 Oct. Once plans began protecting
            a family's Saturday, using it as the picture of when you get to work
            quietly said hustle. */}
        <section className="wayout__close">
          <h2 className="wayout__pitchh">You only need to know your first move.</h2>
          <p className="wayout__pitchlead">
            {/* 🔴 THIS PROMISED A PLAN IN THREE MINUTES AND THREE MINUTES DOES NOT
                BUY ONE. Six taps name which of four ways out is yours; the plan
                itself is the questions after that. Since the two halves became one
                flow, saying "six questions, three minutes" described the front
                door as though it were the whole house — and the first thing that
                happens to somebody who believes it is that they feel misled at
                minute four, which is the one thing this product cannot afford. */}
            Answer the questions. Make an account to keep your plan. No card,
            and your answers stay yours. Then you will know what to do this week.
          </p>
          <Link className="wayout__btn" to={`${WAYOUT_BASE}/start`}>Show me which way</Link>
          <p className="wayout__fine" style={{ marginTop: 14 }}>{priceLine()}</p>
        </section>
        <WayoutFooter />
      </div>
    </div>
  )
}
