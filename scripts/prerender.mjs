/**
 * scripts/prerender.mjs — post-build prerender for the public marketing routes.
 *
 * Why this exists:
 *   Eliv8 OS is a Vite SPA. Per-page <Helmet> meta and JSON-LD schemas only
 *   render after React mounts. Crawlers without JS execution (Slack/iMessage
 *   link previews, some AI training crawlers, legacy SEO audit tools) see
 *   only the fallback head in index.html. Prerendering closes that gap by
 *   producing a static HTML snapshot of each public marketing page after
 *   Helmet has finished writing meta + schemas to <head>.
 *
 * What it does:
 *   1. Spawns `vite preview` against ./dist
 *   2. Drives a real headless Chrome to each route
 *   3. Waits for react-helmet-async to flush its managed tags (data-rh="true")
 *   4. Writes the rendered HTML to dist/<route>/index.html
 *
 * Scope (deliberate):
 *   Only the three public, indexable routes from src/lib/seo.js → PUBLIC_PAGES.
 *   Auth-gated and noindex routes (/dashboard, /tools/*, /admin, /onboarding,
 *   /settings, /login, /signup) are NOT prerendered — they should never appear
 *   in a search index, and prerendering them would also try to talk to Supabase.
 */

import { spawn } from 'node:child_process'
import { writeFile, readFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'
import puppeteer from 'puppeteer'
import { unstuckHead, isUnstuckRoute, UNSTUCK_DESCRIPTION } from './lib/unstuckHead.mjs'

const __dirname  = path.dirname(fileURLToPath(import.meta.url))
const PROJECT    = path.resolve(__dirname, '..')
const DIST       = path.join(PROJECT, 'dist')
// ⚠️ Overridable because two builds at once (two sessions on one Mac) shared
// 4173: the second found the port taken, prerendered against the FIRST one's
// server, and died when that server was shut down (18 Oct 2026).
const PORT       = Number(process.env.PRERENDER_PORT) || 4173 // vite preview default
const HOST       = `http://127.0.0.1:${PORT}`
// Never fetched: answered in-page, see the /wayout/ note below. https because
// Chrome upgrades an http navigation to a .com before any interception sees it.
const UNSTUCK_ORIGIN = 'https://getunstuckmap.com'

// Keep this in sync with PUBLIC_PAGES in src/lib/seo.js.
//
// Signal: every page sets a unique <title> via Helmet. We wait for
// document.title to contain `titleContains` before snapshotting. That's
// the most reliable "Helmet flushed for this page" signal because:
//   - title is a single element (not a list), so dedup ambiguity doesn't apply
//   - react-helmet-async always rewrites it via document.title = …
//   - no schema-shape coupling per route
import { ANSWERS } from '../src/content/answers.js'
import { SITUATIONS } from '../src/content/unstuckSituations.js'

const ROUTES = [
  // ⚠️ These needles must track the real <title> of each page. Change a title
  // in Helmet or index.html without changing it here and the build fails 20
  // seconds later with a bare "Waiting failed" and no clue which route or
  // which string — which is exactly what happened when the landing page was
  // repositioned. The catch below now prints both.
  { path: '/answers',         titleContains: 'Answers for owner-operators' },
  // ⚠️ Generated from the same array the pages render from. An answer page that
  // is not prerendered is invisible to every assistant that does not run
  // JavaScript — which is the entire reason these pages exist.
  ...ANSWERS.map(a => ({ path: `/answers/${a.slug}`, titleContains: a.question.slice(0, 30) })),
  { path: '/',                titleContains: 'advisor for owners who care how' },
  { path: '/pricing',         titleContains: 'Pricing — Eliv8 OS' },
  { path: '/tour',            titleContains: 'See it work' },
  { path: '/about',           titleContains: 'About Eliv8 OS' },
  { path: '/security',        titleContains: 'Security & data handling' },
  { path: '/privacy',         titleContains: 'Privacy policy' },
  { path: '/terms',           titleContains: 'Pilot agreement' },
  { path: '/free-gbp-audit',  titleContains: 'Free Google Business Profile audit' },

  // Comparison pages
  { path: '/vs/knowify',        titleContains: 'Eliv8 OS vs Knowify' },
  { path: '/vs/jobber',         titleContains: 'Eliv8 OS vs Jobber' },
  { path: '/vs/housecall-pro',  titleContains: 'Eliv8 OS vs Housecall Pro' },
  { path: '/vs/buildertrend',   titleContains: 'Eliv8 OS vs Buildertrend' },

  // ⭐⭐ Unstuck Map's two PUBLIC routes. Not for search — both are noindex and
  // stay that way — but for LINK PREVIEWS, which is a different job entirely.
  // index.html carries Eliv8 OS's Open Graph tags, and Helmet only rewrites
  // them after React mounts, so anything that does not run JavaScript sees the
  // wrong product: iMessage, Slack, WhatsApp, and the AI assistants that are
  // the only channel that has ever brought either product a stranger.
  // ⚠️ ONLY these two. /wayout and everything past it talk to Supabase to find
  // a session, which is the same reason /dashboard is not in this list.
  /**
   * 🔴 PRERENDERED AT THE ROOT PATHS, because those are the ones the sitemap and
   * the canonicals name and therefore the ones a crawler will ask for. The
   * prefixed twins still work at runtime — the router registers both — but a
   * crawler hitting /stuck/x must get real HTML, not the SPA shell carrying
   * Eliv8's meta tags.
   * ⚠️ The local preview server has no hostname, so components fall back to the
   * prefixed base while rendering. That is fine and deliberate: every link in the
   * emitted HTML is rewritten by the router on load, and the canonical is
   * computed by canonicalUrl(), which is host-independent on purpose.
   */
  { path: '/start',  titleContains: 'Unstuck Map' },
  { path: '/hello',  titleContains: 'Unstuck Map' },
  { path: '/stuck',  titleContains: 'Being stuck, in specific situations' },
  { path: '/why',    titleContains: 'Why Unstuck Map exists' },
  // ⭐ 2 Nov 2026. Unstuck's privacy and terms were served from the empty
  // noindex shell (the files at /privacy and /terms are Eliv8's), so Google's
  // URL Inspection said "Excluded by noindex" on the privacy page Daniel had
  // just rewritten. Rendered at the prefixed path, because /privacy here is
  // Eliv8's; the worker serves these two files at getunstuckmap.com/privacy
  // and /terms.
  { path: '/wayout/privacy', titleContains: 'Privacy · Unstuck Map' },
  { path: '/wayout/terms',   titleContains: 'Terms of use · Unstuck Map' },
  // ⚠️ Generated from the same array the pages render from, exactly as the
  // answer pages are. A situation page added to the content file and forgotten
  // here would ship invisible to the one channel it was written for.
  ...SITUATIONS.map(x => ({ path: `/stuck/${x.slug}`, titleContains: x.question.slice(0, 28) })),

  // Trade-specific pages
  { path: '/for/plumbers',      titleContains: 'Eliv8 OS for plumbers' },
  { path: '/for/electricians',  titleContains: 'Eliv8 OS for electricians' },
  { path: '/for/hvac',          titleContains: 'Eliv8 OS for HVAC contractors' },
  { path: '/for/roofing',       titleContains: 'Eliv8 OS for roofers' },
  { path: '/for/demolition',    titleContains: 'Eliv8 OS for demolition contractors' },
  { path: '/for/landscaping',   titleContains: 'Eliv8 OS for landscaping contractors' },
]

async function waitForServer(url, maxMs = 30_000) {
  const start = Date.now()
  let lastErr
  while (Date.now() - start < maxMs) {
    try {
      const r = await fetch(url, { method: 'GET' })
      if (r.ok || r.status === 404) return // any HTTP response means it's up
    } catch (err) {
      lastErr = err
    }
    await sleep(250)
  }
  throw new Error(`Preview server never came up at ${url}: ${lastErr?.message ?? 'timeout'}`)
}

async function main() {
  if (!existsSync(DIST)) {
    throw new Error(`dist/ not found at ${DIST} — run \`vite build\` before prerendering`)
  }

  // ⚠️ Captured BEFORE the loop writes over dist/index.html with the rendered
  // Eliv8 landing. See the note where unstuck-shell.html is written.
  const shellHtml = await readFile(path.join(DIST, 'index.html'), 'utf8')

  console.log('[prerender] starting vite preview…')
  const preview = spawn(
    'npx',
    ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
    { cwd: PROJECT, stdio: ['ignore', 'pipe', 'pipe'], env: process.env },
  )
  preview.stdout.on('data', (d) => process.stdout.write(`[preview] ${d}`))
  preview.stderr.on('data', (d) => process.stderr.write(`[preview] ${d}`))

  // If preview dies before we're done, fail loudly.
  preview.on('exit', (code, signal) => {
    if (code !== 0 && signal !== 'SIGTERM' && signal !== 'SIGKILL') {
      console.error(`[preview] exited unexpectedly (code=${code}, signal=${signal})`)
    }
  })

  let browser
  try {
    await waitForServer(HOST)

    console.log('[prerender] launching headless Chrome…')
    // Prefer env override, then puppeteer's own downloaded Chrome, then system Chrome.
    const SYSTEM_CHROME_PATHS = [
      '/usr/bin/google-chrome-stable',
      '/usr/bin/google-chrome',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
    ]
    let executablePath = process.env.PUPPETEER_EXECUTABLE_PATH
    if (!executablePath) {
      try { executablePath = puppeteer.executablePath() } catch {}
    }
    if (!executablePath) {
      executablePath = SYSTEM_CHROME_PATHS.find(p => existsSync(p))
    }
    if (executablePath) console.log(`[prerender] Chrome: ${executablePath}`)
    try {
      browser = await puppeteer.launch({
        headless: 'new',
        ...(executablePath ? { executablePath } : {}),
        args: [
          '--no-sandbox', '--disable-setuid-sandbox',
          /**
           * 🔴🔴 WITHOUT THESE THE BUILD HANGS, AND IT LOOKS LIKE MACHINE LOAD.
           * Chrome throttles pages it believes are backgrounded or occluded —
           * and a throttled page STOPS FIRING requestAnimationFrame entirely.
           * The rAF tick below then never resolves, and the failure surfaces
           * 180 seconds later as `Runtime.callFunctionOn timed out`, which
           * names the transport rather than the cause.
           * ⚠️ It was recorded twice as "puppeteer flake under load" and it is
           * not flaky: it is deterministic whenever the machine has enough
           * other Chrome windows for this one to be treated as background.
           */
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
        ],
      })
    } catch (launchErr) {
      // Deliberately NOT fatal — a missing browser must never block a deploy.
      //
      // But this warning hid a real outage for weeks: on Netlify the launch
      // failed every time (Chrome lands in $HOME/.cache/puppeteer, which the
      // build cannot reach), so every production deploy shipped the raw SPA
      // shell while the build went green in 13 seconds. See netlify.toml.
      //
      // So it is loud now. A skipped prerender means crawlers and AI
      // assistants get no title, no meta and no JSON-LD.
      console.warn('')
      console.warn('  ⚠️  PRERENDER SKIPPED — Chrome would not launch.')
      console.warn('      Every marketing page will ship as an empty SPA shell:')
      console.warn('      no per-page title, no meta, no JSON-LD for crawlers or AI.')
      console.warn(`      Reason: ${launchErr.message}`)
      console.warn('      On Netlify this means PUPPETEER_CACHE_DIR is not set (netlify.toml).')
      console.warn('')
      return
    }

    for (const { path: route, titleContains } of ROUTES) {
      console.log(`[prerender] ${route}`)
      const page = await browser.newPage()

      // Surface page-side console errors so hydration mismatches don't slip
      // through silently.
      page.on('pageerror', (err) => console.error(`[page error] ${route} →`, err.message))
      page.on('console', (msg) => {
        if (msg.type() === 'error') console.error(`[page console] ${route} →`, msg.text())
      })

      /**
       * 🔴 /wayout/* off its own domain is sent to the LIVE getunstuckmap.com
       * (WayoutDomainGuard in App.jsx), so a snapshot taken at
       * 127.0.0.1/wayout/privacy was of production: the noindex shell and all.
       * Google then reported Unstuck's privacy page as "Excluded by noindex".
       * ⭐ So these routes load as getunstuckmap.com itself, answered from here:
       * the page is the clean shell, every file comes from the preview server,
       * and the app takes its own-domain path exactly as it does live.
       */
      const own = route.startsWith('/wayout/')
      if (own) {
        await page.setRequestInterception(true)
        page.on('request', (req) => {
          const u = req.url()
          // Analytics runs on the real hostname; a build is not a visitor.
          if (u.includes('plausible.io')) return req.abort()
          if (!u.startsWith(UNSTUCK_ORIGIN)) return req.continue()
          if (req.isNavigationRequest()) return req.respond({ status: 200, contentType: 'text/html', body: shellHtml })
          // ⚠️ Fetched here and handed over: Chrome refuses to swap https for
          // the preview server's http on a continued request.
          fetch(HOST + u.slice(UNSTUCK_ORIGIN.length))
            .then(async (r) => req.respond({
              status: r.status,
              contentType: r.headers.get('content-type') ?? undefined,
              body: Buffer.from(await r.arrayBuffer()),
            }))
            .catch(() => req.abort())
        })
      }

      /**
       * ⚠️ `networkidle0` WAS THE WRONG READINESS SIGNAL AND IT IS NOT THE ONE
       * THIS SCRIPT ACTUALLY TRUSTS. It waits for 500ms with no connections at
       * all — which a page that fetches Google Fonts, or retries anything, or
       * is simply slow because the machine is busy, may never reach. The build
       * then dies on a navigation timeout that says nothing about the page.
       *
       * ⭐ The real check is three lines below and always has been: poll
       * `document.title` for this route's signature. Helmet rewrites the title
       * in place, so that fires exactly when the page-level Helmet has run —
       * and every other tag this script serialises (meta, JSON-LD) is written
       * in the same pass. Waiting for the DOM and then for THAT is both faster
       * and strictly more correct than waiting for the network to go quiet.
       */
      await page.goto(own ? UNSTUCK_ORIGIN + route.slice('/wayout'.length) : HOST + route, { waitUntil: 'domcontentloaded', timeout: 60_000 })

      // Wait for Helmet to flush by polling document.title for the route's
      // signature substring. react-helmet-async rewrites the title in place
      // (document.title = ...), so this is a single, deterministic source
      // of truth for "the page-level Helmet has run."
      try {
        /**
         * 🔴🔴 `polling` IS THE WHOLE BUG, AND IT TOOK FOUR FAILED BUILDS TO SEE.
         * puppeteer's default for waitForFunction is `'raf'` — it re-evaluates
         * the predicate once per animation frame. Chrome stops firing frames in
         * a page it considers backgrounded or occluded, which is any headless
         * page on a machine with enough other Chrome windows open. So the
         * predicate was never evaluated ONCE, the wait died at 20s, and the
         * catch below then read a title that had been correct the whole time:
         *   expected to contain: "Answers for owner-operators"
         *   actual title:        "Answers for owner-operators — Eliv8 OS"
         * A failure message that disproves itself is the tell.
         *
         * ⚠️ This is the same cause as the rAF tick further down and the
         * "protocol timeout" that has been written off twice as machine load.
         * It is not load and it is not flaky — it is deterministic, and every
         * wait in this script had it.
         * ⭐ A plain interval cannot be throttled out of existence.
         */
        await page.waitForFunction(
          (needle) => document.title.includes(needle),
          { timeout: 20_000, polling: 250 },
          titleContains,
        )
      } catch {
        // A bare timeout here is almost always a title that was edited without
        // updating ROUTES. Say so, with both strings, instead of making the
        // next person read this file to find out.
        const actual = await page.title()
        throw new Error(
          `Title check failed for ${route}\n` +
          `  expected to contain: ${JSON.stringify(titleContains)}\n` +
          `  actual title:        ${JSON.stringify(actual)}\n` +
          `  Fix the needle in ROUTES (scripts/prerender.mjs) or the page's Helmet title.`,
        )
      }

      // One more rAF tick so any final Helmet flush settles before we serialize.
      /**
       * ⚠️ AND THE TICK ITSELF MUST BE ABLE TO GIVE UP. The flags above stop the
       * throttling that causes this, but an unbounded wait on a frame is the
       * wrong shape regardless: this is a grace note — one frame so a final
       * Helmet flush settles — and a grace note may never be the thing that
       * blocks a deploy. Whichever of the two fires first wins.
       */
      await page.evaluate(() => new Promise((r) => {
        requestAnimationFrame(() => r())
        setTimeout(r, 250)
      }))

      // De-dupe <head>. The static index.html ships a fallback head; Helmet
      // appends its own copy of every overridden tag, so a naive snapshot
      // contains both. Crawlers reading the first occurrence would see the
      // home-page meta on /pricing and /about. Keep only the last instance of
      // each unique name/property/rel — that's the Helmet-injected (correct)
      // version. Title and JSON-LD scripts get the same treatment.
      await page.evaluate(() => {
        const head = document.head

        // <title>: keep only the FIRST. react-helmet-async sets document.title
        // (which mutates the existing static title element rather than creating
        // a new one), so the first <title> ends up with the page-specific text;
        // any later duplicates are stale carryover from the static head.
        const titles = head.querySelectorAll('title')
        for (let i = 1; i < titles.length; i++) titles[i].remove()

        // <link rel="canonical">: keep only the last
        const canonicals = head.querySelectorAll('link[rel="canonical"]')
        for (let i = 0; i < canonicals.length - 1; i++) canonicals[i].remove()

        // The analytics tag index.html adds on getunstuckmap.com. The /wayout/
        // pages render on that hostname, so it is already in the DOM; saved,
        // the live page would load it twice and count every visit twice.
        for (const sc of head.querySelectorAll('script[src*="plausible.io"]')) sc.remove()

        // <meta name=… | property=…>: keep only the last per key.
        // Skips charset / viewport / non-keyed meta which we never duplicate.
        const lastByKey = new Map()
        for (const m of head.querySelectorAll('meta')) {
          const key = m.getAttribute('name') || m.getAttribute('property')
          if (!key) continue
          if (lastByKey.has(key)) lastByKey.get(key).remove()
          lastByKey.set(key, m)
        }

        // <script type="application/ld+json">: dedupe by exact content. The
        // static head ships an Organization schema; Helmet may emit the same
        // one again. We want one copy, not two.
        const seenLd = new Set()
        for (const s of head.querySelectorAll('script[type="application/ld+json"]')) {
          const norm = s.textContent.replace(/\s+/g, '')
          if (seenLd.has(norm)) s.remove()
          else seenLd.add(norm)
        }
      })

      // ⚠️ Unstuck Map pages are built from Eliv8's index.html; the parts of the
      // head Helmet does not manage are swapped here (scripts/lib/unstuckHead.mjs).
      const raw = await page.content()
      const html = isUnstuckRoute(route) ? unstuckHead(raw) : raw

      const outDir = route === '/' ? DIST : path.join(DIST, route.replace(/^\//, ''))
      await mkdir(outDir, { recursive: true })
      const outPath = path.join(outDir, 'index.html')
      await writeFile(outPath, html, 'utf8')
      console.log(`[prerender]   → ${path.relative(PROJECT, outPath)}`)

      await page.close()
    }
    /**
     * 🔴🔴 THE SPA FALLBACK WAS ELIV8'S LANDING PAGE, FULLY RENDERED.
     *
     * Daniel, hard-refreshing a wayout route: "the refresh shows the Eliv8
     * homescreen." He is right and it is this loop's doing — route `/` writes to
     * `dist/index.html`, which is also the document Netlify serves for every
     * path that is not a real file. So `/plan`, `/questions`, `/chapter` and the
     * rest hand the browser 28KB of Eliv8's rendered landing, which paints
     * immediately, and only then does React boot, read the hostname and replace
     * it.
     *
     * ⚠️ IT ONLY SHOWS ON A HARD REFRESH because that is the one case where the
     * bundle is not cached: normally React takes over within a frame. Which is
     * exactly why it survived this long.
     *
     * ⭐⭐ THE ANSWER IS A NEUTRAL SHELL, NOT A SECOND LANDING. Pointing the
     * fallback at Unstuck Map's own landing would flash the wrong page instead
     * of the wrong product. These routes are all authenticated and cannot be
     * prerendered anyway, so the honest document is an EMPTY one carrying the
     * right name — cream, wordmark, nothing to be wrong about.
     *
     * ⚠️ Built from the ORIGINAL index.html, captured before this loop
     * overwrote it — vite leaves `<div id="root"></div>` empty there, so there
     * is nothing to strip and no fragile regex over nested divs.
     */
    const shell = shellHtml
      .replace(/<title>[^<]*<\/title>/, '<title>Unstuck Map</title>')
      .replace(/<meta name="description"[^>]*>/, '')
      .replace(/<link rel="canonical"[^>]*>/, '')
      .replace(/<meta property="og:[^"]*"[^>]*>/g, '')
      .replace(/<meta name="twitter:[^"]*"[^>]*>/g, '')
      .replace('</head>', '  <meta name="robots" content="noindex, nofollow">\n  </head>')
    await writeFile(path.join(DIST, 'unstuck-shell.html'), unstuckHead(shell, { description: UNSTUCK_DESCRIPTION }), 'utf8')
    console.log('[prerender]   → dist/unstuck-shell.html (neutral SPA fallback for getunstuckmap.com)')
  } finally {
    if (browser) await browser.close()
    if (!preview.killed) {
      preview.kill('SIGTERM')
      await sleep(200)
      if (!preview.killed) preview.kill('SIGKILL')
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[prerender] FAILED:', err)
    process.exit(1)
  })
