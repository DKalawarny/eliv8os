/**
 * ⭐ THE MORNING CHECK: open every public site the way a stranger would, and
 * fail loudly if any of them is broken.
 *
 * Why it exists: on 18 Oct 2026 a TERMS_VERSION bump put a legal agreement in
 * front of every Eliv8 demo visitor, and nobody knew for hours. Every check
 * here is something that has actually broken, or that a stranger meets in
 * their first minute.
 *
 * ⚠️ It is a plain script, not an AI. Opening pages and reading them needs no
 * judgement, and a script is cheaper, faster and never invents a pass.
 *
 * Runs daily on GitHub Actions (.github/workflows/morning-check.yml). A failed
 * run makes GitHub email the repo owner, so a quiet inbox means all is well.
 * Locally: node scripts/morning-check.mjs
 *
 * ⭐ IT FIXES WHAT IT SAFELY CAN, THEN LOOKS AGAIN (Daniel, 29 Oct 2026).
 * Anything that fails gets a second look 10 minutes later, so a slow page or a
 * blip never wakes anyone. If kinwove itself is down, it first asks Render to
 * start it again (a deploy hook in the RENDER_KINWOVE_DEPLOY_HOOK secret: it
 * re-runs what is already live, it cannot change anything). Only what still
 * fails on the second look fails the run. It never changes code, words or data.
 *
 * Side effects, deliberately few: opening /demo clones the sample company for
 * a visitor (cleaned up after 6h, same as any visitor). kinwove's Ask box is
 * NOT used, because every question lands in qa_events, the keyword tool.
 */
import puppeteer from 'puppeteer'
import tls from 'node:tls'
import fs from 'node:fs'

const results = []   // { site, check, ok, detail }
const record = (site, check, ok, detail = '') => {
  detail = String(detail).replace(/\s+/g, ' ').trim()   // one line, or the table breaks
  results.push({ site, check, ok, detail })
  console.log(`${ok ? '✓' : '✗'} ${site}: ${check}${detail ? ` (${detail})` : ''}`)
}
// Every check is registered first and run later, so a failed one can be run
// again on the second look.
const checks = []
const add = (site, check, fn) => checks.push({ site, check, fn })
async function attempt({ site, check, fn }) {
  try { const detail = await fn(); record(site, check, true, detail || '') }
  catch (e) { record(site, check, false, e.message) }
}
const must = (cond, msg) => { if (!cond) throw new Error(msg) }

async function get(url) {
  const t0 = Date.now()
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(30000), headers: { 'user-agent': 'Mozilla/5.0 (morning-check)' } })
  const body = await res.text()
  return { status: res.status, type: res.headers.get('content-type') || '', body, ms: Date.now() - t0 }
}

function certDaysLeft(host) {
  return new Promise((resolve, reject) => {
    const s = tls.connect(443, host, { servername: host, timeout: 15000 }, () => {
      const c = s.getPeerCertificate(); s.end()
      resolve(Math.floor((new Date(c.valid_to) - Date.now()) / 86400000))
    })
    s.on('error', reject); s.on('timeout', () => { s.destroy(); reject(new Error('timed out')) })
  })
}

function page(site, url, { title, minMs } = {}) {
  add(site, 'home page loads', async () => {
    const r = await get(url)
    must(r.status === 200, `status ${r.status}`)
    const t = (r.body.match(/<title>([^<]*)/) || [])[1] || ''
    must(!title || t.includes(title), `title is "${t}"`)
    return `${(r.ms / 1000).toFixed(1)}s`
  })
}

function sitemap(site, url, min) {
  add(site, 'sitemap', async () => {
    const r = await get(url)
    must(r.status === 200 && r.type.includes('xml'), `status ${r.status}, ${r.type}`)
    // Only "is it there and whole". Missing dates and the like are tidiness,
    // not breakage, and belong in the weekly SEO report, not a morning alarm.
    const locs = (r.body.match(/<loc>/g) || []).length
    must(locs >= min, `${locs} pages, expected at least ${min}`)
    return `${locs} pages`
  })
}

function cert(site, host) {
  add(site, 'security certificate', async () => {
    const days = await certDaysLeft(host)
    must(days >= 14, `expires in ${days} days`)
    return `${days} days left`
  })
}

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] })
async function inBrowser(fn) {
  const p = await browser.newPage()
  await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true })
  try { return await fn(p) } finally { await p.close() }
}
const text = p => p.evaluate(() => document.body.innerText)
const wait = ms => new Promise(r => setTimeout(r, ms))

// ── Eliv8 OS ────────────────────────────────────────────────────────────────
page('Eliv8', 'https://eliv8os.com/', { title: 'Eliv8' })
sitemap('Eliv8', 'https://eliv8os.com/sitemap.xml', 70)
cert('Eliv8', 'eliv8os.com')
add('Eliv8', 'live demo opens with no account', () => inBrowser(async p => {
  await p.goto('https://eliv8os.com/demo', { waitUntil: 'networkidle2', timeout: 60000 })
  for (let i = 0; i < 20 && !p.url().includes('/dashboard'); i++) await wait(1000)
  await wait(4000)
  const t = await text(p)
  must(p.url().includes('/dashboard'), `stuck at ${p.url()}`)
  must(!/Welcome to the pilot/.test(t), 'the pilot agreement popup is blocking the demo')
  must(/live demo with sample data/.test(t), 'demo banner missing')
}))

// ── Unstuck Map ─────────────────────────────────────────────────────────────
page('Unstuck', 'https://getunstuckmap.com/', { title: 'Unstuck Map' })
sitemap('Unstuck', 'https://getunstuckmap.com/sitemap.xml', 50)
cert('Unstuck', 'getunstuckmap.com')
add('Unstuck', 'six taps give a result', () => inBrowser(async p => {
  await p.goto('https://getunstuckmap.com/start', { waitUntil: 'networkidle2', timeout: 60000 })
  for (let i = 0; i < 10; i++) {
    await wait(900)
    if (/is the one that fits/.test(await text(p))) return
    const chips = await p.evaluate(() => {
      const c = [...document.querySelectorAll('.wayout__chips button, .wayout__chips [role=button], .wayout__chips label')]
      if (c.length) (c[1] || c[0]).click()
      return c.length
    })
    await wait(500)
    const fwd = await p.evaluate(() => {
      const b = [...document.querySelectorAll('.wayout__nav button, button.wayout__btn')].find(x => !x.disabled && !/back|←/i.test(x.innerText))
      if (b) b.click()
      return !!b
    })
    if (!chips && !fwd) break
  }
  must(/is the one that fits/.test(await text(p)), 'no result after the six questions')
}))

// ── kinwove ─────────────────────────────────────────────────────────────────
page('kinwove', 'https://www.kinwove.com/', { title: 'kinwove' })
add('kinwove', 'server health', async () => {
  const r = await get('https://www.kinwove.com/api/health')
  must(r.status === 200 && /"ok":\s*true/.test(r.body), `status ${r.status}: ${r.body.slice(0, 80)}`)
})
sitemap('kinwove', 'https://www.kinwove.com/sitemap.xml', 20)
cert('kinwove', 'www.kinwove.com')
add('kinwove', 'ask box shows', () => inBrowser(async p => {
  await p.goto('https://www.kinwove.com/', { waitUntil: 'networkidle2', timeout: 60000 })
  await wait(2000)
  must(await p.$('input[placeholder*="Ask anything"]'), 'the Ask box is not on the page')
}))

// ── first look ──────────────────────────────────────────────────────────────
for (const c of checks) await attempt(c)
const firstFails = results.filter(r => !r.ok)
const notes = []

// ── fix what is safe to fix, then the second look ───────────────────────────
if (firstFails.length) {
  const kinwoveDown = firstFails.some(r => r.site === 'kinwove' && /home page|server health/.test(r.check))
  const hook = process.env.RENDER_KINWOVE_DEPLOY_HOOK
  if (kinwoveDown && hook) {
    try {
      const r = await fetch(hook, { method: 'POST', signal: AbortSignal.timeout(30000) })
      notes.push(`kinwove was down, so Render was asked to start it again (${r.status})`)
    } catch (e) { notes.push(`kinwove was down, and asking Render to start it again failed (${e.message})`) }
  } else if (kinwoveDown) notes.push('kinwove was down; no restart, RENDER_KINWOVE_DEPLOY_HOOK is not set')
  notes.forEach(n => console.log(`↻ ${n}`))

  const mins = Number(process.env.RECHECK_MIN ?? 10)
  console.log(`\n${firstFails.length} failed, looking again in ${mins} min`)
  await wait(mins * 60 * 1000)
  const again = checks.filter(c => firstFails.some(f => f.site === c.site && f.check === c.check))
  for (const c of again) {
    results.splice(results.findIndex(r => r.site === c.site && r.check === c.check), 1)
    await attempt(c)
  }
}

await browser.close()

// ── report ──────────────────────────────────────────────────────────────────
const failed = results.filter(r => !r.ok)
const recovered = firstFails.filter(f => !failed.some(r => r.site === f.site && r.check === f.check))
const lines = [
  `# Morning check: ${failed.length ? `${failed.length} problem${failed.length > 1 ? 's' : ''}` : 'all good'}`,
  '',
  ...notes.map(n => `- ${n}`),
  ...recovered.map(r => `- ${r.site}: ${r.check} failed at first (${r.detail}) and passed on the second look`),
  '',
  '| Site | Check | Result |', '|---|---|---|',
  ...results.map(r => `| ${r.site} | ${r.check} | ${r.ok ? '✅' : '🔴'} ${r.detail} |`),
]
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n')
console.log(`\n${results.length - failed.length} of ${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
