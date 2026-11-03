/**
 * One build, three domains. This is the job Netlify's 49 `_redirects` rules did:
 * Cloudflare's static hosting cannot choose a file by DOMAIN, and both products
 * ship in one `dist`, so the choice is made here.
 *
 * ⚠️ `public/_redirects` is still the source of truth while Netlify is live.
 * Every rule there has its twin below; change both or neither.
 *
 * ⚠️ /assets/* never reaches this file (see `run_worker_first` in
 * wrangler.deploy.jsonc), so a page view costs one Worker request, not thirty.
 */
const UNSTUCK = 'getunstuckmap.com'
const ELIV8 = 'eliv8os.com'

// On getunstuckmap.com these well-known paths serve Unstuck Map's own file.
const UNSTUCK_FILES = {
  '/robots.txt': '/robots-unstuckmap.txt',
  '/sitemap.xml': '/sitemap-unstuckmap.xml',
  '/llms.txt': '/llms-unstuckmap.txt',
  '/favicon.svg': '/favicon-unstuckmap.svg',
  '/manifest.json': '/manifest-unstuckmap.json',
  '/apple-touch-icon.svg': '/apple-touch-icon-unstuckmap.png',
  '/apple-touch-icon.png': '/apple-touch-icon-unstuckmap.png',
  '/apple-touch-icon-precomposed.png': '/apple-touch-icon-unstuckmap.png',
}

const SECURITY = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), geolocation=(), microphone=(self), payment=(self "https://js.stripe.com" "https://checkout.stripe.com")',
}

// The one address a sign in or reset email links to. See passAuthLink below.
const SUPABASE = 'https://ufhduewbamnmoiksqgfq.supabase.co'
const AUTH_LINK = '/auth/v1/verify'

const moved = (to) => new Response(null, { status: 301, headers: { Location: to } })

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const host = url.hostname.toLowerCase()
    const bare = host.replace(/^www\./, '')
    const path = url.pathname
    const rest = path + url.search

    // The old name, and every www, go to the one true address.
    if (bare === 'leadeos.com') return moved(`https://${ELIV8}${rest}`)
    const site = bare === UNSTUCK ? 'unstuck' : 'eliv8'
    // `LOCAL` is set only by the local test run, where everything is http.
    const local = host === 'localhost' || host === '127.0.0.1'
    if (!local && !host.endsWith('.workers.dev')) {
      if (host !== bare || (url.protocol === 'http:' && !env.LOCAL)) {
        // ⚠️ www.eliv8os.com/wayout/* must land on Unstuck Map, not bounce
        // through eliv8os.com first, so the product rules run before this.
        const cross = site === 'eliv8' ? eliv8ToUnstuck(path, url.search) : null
        return moved(cross ?? `https://${bare}${rest}`)
      }
    }

    if (path === AUTH_LINK) return passAuthLink(request, url)

    const asset = (p) => env.ASSETS.fetch(new Request(new URL(p, url), request))
    // A real file if there is one: the path itself, then the prerendered page.
    const find = async (p) => {
      const tries = /\.[a-z0-9]+$/i.test(p) ? [p] : [p.replace(/\/$/, '') + '/index.html', p]
      for (const t of tries) {
        if (t === '/index.html' && p !== '/') continue
        const r = await asset(t)
        if (r.status !== 404) return r
      }
      return null
    }

    let res
    if (site === 'unstuck') {
      if (path === '/wayout/hello' || path === '/wayout' || path === '/wayout/') return moved(`https://${UNSTUCK}/`)
      if (path.startsWith('/wayout/')) return moved(`https://${UNSTUCK}${path.slice(7)}${url.search}`)
      if (UNSTUCK_FILES[path]) res = await asset(UNSTUCK_FILES[path])
      else if (path === '/') res = await asset('/hello/index.html')
      // 🔴 /terms and /privacy exist as files, and the files are Eliv8 OS's.
      // Unstuck's own are prerendered under /wayout/ (scripts/prerender.mjs).
      else if (/^\/(terms|privacy)\/?$/.test(path)) {
        res = (await find(`/wayout/${path.replace(/\//g, '')}`)) ?? (await asset('/unstuck-shell.html'))
      }
      else res = (await find(path)) ?? (await asset('/unstuck-shell.html'))
    } else {
      const cross = eliv8ToUnstuck(path, url.search)
      if (cross) return moved(cross)
      res = path === '/' ? await asset('/index.html') : ((await find(path)) ?? (await asset('/index.html')))
    }

    const out = await withRange(request, res)
    for (const [k, v] of Object.entries(SECURITY)) out.headers.set(k, v)
    return out
  },
}

// 🔴 Safari on iPhone will not play a video unless the server answers "give me
// bytes X to Y" with exactly those bytes (206). The asset store answered with
// the whole file (17 Oct, checked locally), so the landing video would sit dead
// on every iPhone. Videos only: everything else streams as before.
async function withRange(request, res) {
  const range = request.headers.get('Range')
  const type = res.headers.get('Content-Type') || ''
  if (res.status !== 200 || !range || !type.startsWith('video/')) {
    const out = new Response(res.body, res)
    if (type.startsWith('video/')) out.headers.set('Accept-Ranges', 'bytes')
    return out
  }
  const buf = await res.arrayBuffer()
  const size = buf.byteLength
  const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
  let start = m && m[1] !== '' ? Number(m[1]) : NaN
  let end = m && m[2] !== '' ? Number(m[2]) : size - 1
  if (m && m[1] === '' && m[2] !== '') { start = Math.max(0, size - Number(m[2])); end = size - 1 }
  if (!m || Number.isNaN(start) || start >= size || start > end) {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}`, 'Accept-Ranges': 'bytes' } })
  }
  end = Math.min(end, size - 1)
  const headers = new Headers(res.headers)
  headers.set('Content-Range', `bytes ${start}-${end}/${size}`)
  headers.set('Content-Length', String(end - start + 1))
  headers.set('Accept-Ranges', 'bytes')
  return new Response(request.method === 'HEAD' ? null : buf.slice(start, end + 1), { status: 206, headers })
}

// Unstuck Map used to live under eliv8os.com/wayout. Those links still exist.
function eliv8ToUnstuck(path, search) {
  if (path === '/wayout' || path === '/wayout/' || path === '/wayout/hello') return `https://${UNSTUCK}/`
  if (path.startsWith('/wayout/')) return `https://${UNSTUCK}${path.slice(7)}${search}`
  if (path === '/hello' || path === '/questions') return `https://${UNSTUCK}/`
  if (path === '/start') return `https://${UNSTUCK}/start`
  if (path === '/stuck' || path.startsWith('/stuck/')) return `https://${UNSTUCK}${path}`
  return null
}

// 🔴 The link in a sign in email has to sit on the sender's own domain, or
// Hotmail files the email as junk (12 Oct). So the email links here and this
// hands the click to Supabase and passes its answer straight back: a redirect
// to the page they asked for, signed in.
// ⚠️ `redirect: 'manual'` is the whole point. Following the redirect here would
// use the one-time link up on the server and leave the person signed out.
async function passAuthLink(request, url) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405 })
  const res = await fetch(`${SUPABASE}${AUTH_LINK}${url.search}`, {
    method: request.method,
    redirect: 'manual',
    headers: {
      'User-Agent': request.headers.get('User-Agent') ?? '',
      'X-Forwarded-For': request.headers.get('CF-Connecting-IP') ?? '',
    },
  })
  const out = new Response(res.body, res)
  out.headers.set('Cache-Control', 'no-store')
  out.headers.set('Referrer-Policy', 'no-referrer')
  return out
}
