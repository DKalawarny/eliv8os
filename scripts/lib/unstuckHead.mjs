/**
 * Turn a built document's <head> into Unstuck Map's.
 *
 * 🔴 WHY. index.html is SHARED with Eliv8 OS — one Netlify site, two domains —
 * so every prerendered Unstuck Map page and the getunstuckmap.com SPA fallback
 * shipped Eliv8's identity in the parts Helmet does not manage: an Organization
 * JSON-LD naming "Eliv8 OS" (Google can attribute the site to it), the author
 * and iOS home-screen title, two near-black theme colours over a paper-coloured
 * product, Eliv8's contractor keywords, and Eliv8-internal HTML comments that
 * anybody can read with View Source.
 *
 * ⚠️ Only ever applied to Unstuck Map outputs (scripts/prerender.mjs). Eliv8's
 * own pages keep index.html exactly as it is.
 */
export const UNSTUCK_THEME = '#F5F1E6'
export const UNSTUCK_DESCRIPTION = 'You know your situation. Let’s sort out the order — three moves, in order, built from your own numbers.'

export function unstuckHead(html, { description = null } = {}) {
  let out = html
    // Comments ship to every visitor; these are Eliv8's internal notes.
    .replace(/<!--[\s\S]*?-->/g, '')
    // Any JSON-LD that names the other product goes; Unstuck Map's own stays.
    // ⚠️ Also the renamed type: the runtime swap in WayoutShell has already
    // retyped Eliv8's block by the time prerender captures the page.
    .replace(/<script type="application\/(?:x-eliv8-)?ld\+json"[^>]*>[\s\S]*?<\/script>/g, m => (/Eliv8/i.test(m) ? '' : m))
    .replace(/<meta\s+name="keywords"[^>]*>/g, '')
    .replace(/<meta\s+name="author"[^>]*>/g, '<meta name="author" content="Unstuck Map">')
    .replace(/<meta\s+name="apple-mobile-web-app-title"[^>]*>/g, '<meta name="apple-mobile-web-app-title" content="Unstuck Map">')
    // A dark status bar over paper looks like a bug; let iOS use the page colour.
    .replace(/<meta\s+name="apple-mobile-web-app-status-bar-style"[^>]*>/g, '<meta name="apple-mobile-web-app-status-bar-style" content="default">')
    .replace(/<link rel="apple-touch-icon"[^>]*>/g, '<link rel="apple-touch-icon" href="/apple-touch-icon-unstuckmap.png">')
    .replace(/<meta\s+name="theme-color"[^>]*>/g, '')
  out = out.replace('</head>', `  <meta name="theme-color" content="${UNSTUCK_THEME}">\n  </head>`)
  if (description != null) {
    out = out.replace(/<meta\s+name="description"[^>]*>/g, '')
      .replace('</head>', `  <meta name="description" content="${description}">\n  </head>`)
  }
  return out
}

/** The Unstuck Map routes that are prerendered at the root (see ROUTES). */
export function isUnstuckRoute(route) {
  return route === '/start' || route === '/hello' || route === '/stuck' || route.startsWith('/stuck/') || route === '/why'
    || route === '/wayout/privacy' || route === '/wayout/terms'
}
