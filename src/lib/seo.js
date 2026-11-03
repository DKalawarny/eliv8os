/**
 * src/lib/seo.js — single source of truth for site-wide SEO configuration.
 *
 * Why centralize this:
 *   - Domain changes once when we move to a real production URL.
 *   - Keyword sets are reused across page meta, schema, llms.txt, and copy.
 *   - JSON-LD schema helpers stay consistent — Google + AI assistants parse
 *     them, so getting the shape right matters more than the wording.
 *
 * Where this gets consumed:
 *   - src/pages/Landing.jsx, Pricing.jsx, marketing/CRM.jsx — <Helmet> blocks
 *   - public/sitemap.xml, public/llms.txt — manually kept in sync (small list)
 *   - public/robots.txt — references SITEMAP_URL
 *
 * If you add a new public page, do three things:
 *   1. Add a <Helmet> block in the page using buildPageMeta()
 *   2. Add the URL to PUBLIC_PAGES below
 *   3. Add it to public/sitemap.xml
 *
 * Keyword philosophy:
 *   ⚠️ This changed with the reposition. The buyer is no longer defined by
 *   SECTOR (a plumber, a roofer) but by CONVICTION — a Christian owner who
 *   wants the business run a particular way. That axis cuts across every
 *   industry, so ranking for "AI advisor for HVAC contractors" now brings
 *   the wrong visitor to a page that will not speak to them.
 *
 *   So: rank on the conviction terms, stay industry-neutral in the general
 *   copy, and keep a SHORT trades list only because /for/:trade pages still
 *   exist and trades are Daniel's actual network — not as the wedge.
 *
 *   The old list enumerated ~55 verticals for breadth. Breadth against the
 *   wrong axis is not reach, it is noise.
 */

// The price lives in exactly one place. The schema below publishes it to
// Google and to AI assistants, so a hardcoded copy here silently becomes a
// second source of truth — which is how it came to advertise $97 CAD long
// after the price was $147 USD.
import { PRICE_MONTHLY_USD, SHOW_PUBLIC_PRICE } from './pricing.js'

// ── Site constants ──────────────────────────────────────────────────────────

/**
 * Production URL. Every canonical link, og:url, sitemap entry, and llms.txt
 * entry follows from this.
 */
import { ANSWERS } from '../content/answers.js'

const ANSWER_SLUGS = ANSWERS.map(a => a.slug)

export const SITE_URL = 'https://eliv8os.com'

export const SITE_NAME = 'Eliv8 OS'

export const ORG_NAME  = 'Eliv8 OS'

export const CONTACT_EMAIL = 'support@eliv8os.com'

/** Default OG image — needs to exist at /public/og-default.png (1200×630). */
export const OG_DEFAULT_IMAGE = `${SITE_URL}/og-default.png`

// ── Keyword sets ────────────────────────────────────────────────────────────

/**
 * Trades still listed because /for/:trade pages exist and because trades are
 * the network Daniel actually knows. Deliberately short — this is a tail, not
 * the wedge. Adding a trade here does not commit us to trade-specific
 * features, and it should never grow back into a keyword dump.
 */
export const TRADES = [
  'demolition contractors',
  'plumbing contractors',
  'electrical contractors',
  'HVAC contractors',
  'roofing contractors',
  'landscaping contractors',
  'general contractors',
]

/**
 * Who this is actually for. The buyer is defined by how they want to run the
 * business, not by what the business does — so these are stated as people,
 * not verticals.
 */
export const AUDIENCE = [
  'owner-operators',
  'small business owners',
  'family business owners',
]

/**
 * Higher-level categories — used in copy and meta where the full audience
 * list would be too long.
 */
export const SERVICE_CATEGORIES = [
  'small and mid-sized businesses',
  'owner-operated businesses',
  'family-owned businesses',
]

/**
 * Core feature/benefit keywords — what Eliv8 OS actually does.
 *
 * ⚠️ Every entry here must correspond to something a signed-in user can
 * really reach today (see the Sidebar nav and SolomonLauncher groups).
 * "Google Business Profile audit" and "AI search visibility" were removed
 * because neither is surfaced in the app any more — keeping them would have
 * been marketing a thing we do not ship.
 */
export const FEATURE_KEYWORDS = [
  // ⭐ NO FAITH-TARGETING TERMS HERE, DELIBERATELY (26 Aug, Daniel).
  //
  // An earlier version targeted "Christian business owners", "faith-driven
  // companies", "biblical business principles" and the like. They are gone, and
  // the reasoning is a step past the 22 Aug decision rather than a repeat of it:
  //
  //   "it doesn't bring in non-Christians. I want this open to everyone. It's
  //    the fundamentals, the hidden code, that is Christian."
  //
  // So the conviction is the SUBSTRATE, not the audience filter. Sorting people
  // by identity — even invisibly, even in a meta tag nobody reads — is still
  // sorting, and it selects against exactly the owner this could reach first.
  // Attraction, not persuasion: the product behaves with conviction, and where
  // that comes from stays findable in /about for anyone who goes looking.
  //
  // ⚠️ Do not re-add identity targeting here. What we compete on is what it
  // does and how it behaves, which is legible to everyone.
  'AI business advisor',
  'stewardship in business',
  'business decision making',
  'CFO dashboard',
  'cash flow forecasting',
  'hiring planner',
  'succession planning',
  'business roadmap',
  'standard operating procedures',
  'safety and compliance tracking',
  'QuickBooks integration',
  'small business AI',
]

/** Top keyword set for meta tags — what it does, for anyone who needs it. */
export const PRIMARY_KEYWORDS = [
  // See the note in the main keyword list: no identity targeting. This set used
  // to lead with "Christian business advisor" and "faith-driven business
  // software"; it now leads with the job, which is legible to every owner.
  'running a business with integrity',
  'stewardship business',
  'business advisor for small business',
  'AI business advisor',
  'CFO dashboard for small business',
  'cash flow forecasting',
  'hiring planner',
  'succession planning for owners',
  'business growth roadmap',
  'QuickBooks AI advisor',
  'small business operating system',
]

// ── Public routes ────────────────────────────────────────────────────────────

/**
 * Authoritative list of public, indexable pages. Source of truth for
 * sitemap.xml — when adding a new public route, add it here AND to the
 * sitemap (sitemap is static for now; if it grows, generate it from this).
 *
 * Slug-driven pages (/vs/:competitor and /for/:trade) are enumerated
 * from the COMPETITOR_SLUGS / TRADE_SLUGS exports in their respective
 * page components, then folded into PUBLIC_PAGES below. That way adding
 * a new comparison or trade only requires one edit in the page file.
 */
const COMPETITOR_SLUGS = ['knowify', 'jobber', 'housecall-pro', 'buildertrend']
const TRADE_SLUGS      = ['plumbers', 'electricians', 'hvac', 'roofing', 'demolition', 'landscaping']

export const PUBLIC_PAGES = [
  { path: '/',                priority: '1.0', changefreq: 'weekly'  },
  { path: '/pricing',         priority: '0.9', changefreq: 'monthly' },
  { path: '/tour',            priority: '0.9', changefreq: 'monthly' },
  { path: '/about',           priority: '0.7', changefreq: 'monthly' },
  { path: '/security',        priority: '0.5', changefreq: 'yearly'  },
  { path: '/privacy',         priority: '0.4', changefreq: 'yearly'  },
  { path: '/terms',           priority: '0.4', changefreq: 'yearly'  },
  { path: '/free-gbp-audit',  priority: '0.8', changefreq: 'monthly' },
  { path: '/answers',         priority: '0.8', changefreq: 'weekly'  },
  // ⚠️ Answer pages are the reason the sitemap is now GENERATED rather than
  // hand-kept: the old file had drifted to 16 URLs against 18 live routes, and
  // adding these by hand would have guaranteed it drifted further. A page an
  // assistant cannot find is a page that does not exist.
  ...ANSWER_SLUGS.map(slug => ({ path: `/answers/${slug}`, priority: '0.7', changefreq: 'monthly' })),
  ...COMPETITOR_SLUGS.map(slug => ({ path: `/vs/${slug}`,  priority: '0.7', changefreq: 'monthly' })),
  ...TRADE_SLUGS     .map(slug => ({ path: `/for/${slug}`, priority: '0.7', changefreq: 'monthly' })),
]

// ── Page meta builders ──────────────────────────────────────────────────────

/**
 * Build a complete meta config for a page. Returns an object the page can
 * spread into <Helmet>. Centralizes the "shape" of meta — every page gets
 * canonical, og:*, twitter:* without each page having to know the spec.
 *
 * @param {object}  opts
 * @param {string}  opts.title        — under 60 chars; pageName | siteName
 * @param {string}  opts.description  — 150-160 chars; what's on the page + value prop
 * @param {string}  opts.path         — the route, e.g. "/pricing"
 * @param {string} [opts.image]       — full URL to OG image; falls back to default
 * @param {string} [opts.keywords]    — comma-separated; falls back to PRIMARY_KEYWORDS
 * @returns {object}                   — { title, meta, link } shaped for <Helmet>
 */
export function buildPageMeta({ title, description, path, image, keywords }) {
  const url       = `${SITE_URL}${path}`
  const ogImage   = image    ?? OG_DEFAULT_IMAGE
  const kw        = keywords ?? PRIMARY_KEYWORDS.join(', ')

  return {
    title,
    canonical: url,
    meta: [
      { name: 'description',                     content: description },
      { name: 'keywords',                        content: kw },

      // Open Graph (Facebook, Slack, Discord, iMessage, LinkedIn unfurls)
      { property: 'og:type',                     content: 'website' },
      { property: 'og:url',                      content: url },
      { property: 'og:title',                    content: title },
      { property: 'og:description',              content: description },
      { property: 'og:image',                    content: ogImage },
      { property: 'og:image:width',              content: '1200' },
      { property: 'og:image:height',             content: '630' },
      { property: 'og:site_name',                content: SITE_NAME },
      { property: 'og:locale',                   content: 'en_CA' },

      // Twitter / X cards
      { name: 'twitter:card',                    content: 'summary_large_image' },
      { name: 'twitter:url',                     content: url },
      { name: 'twitter:title',                   content: title },
      { name: 'twitter:description',             content: description },
      { name: 'twitter:image',                   content: ogImage },

      // Robots — explicitly permissive on public pages
      { name: 'robots',                          content: 'index, follow, max-image-preview:large, max-snippet:-1' },

      // Theme + mobile
      { name: 'theme-color',                     content: '#0F172A' },
      { name: 'apple-mobile-web-app-capable',    content: 'yes' },
      { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' },
    ],
  }
}

// ── JSON-LD schema builders ─────────────────────────────────────────────────

/**
 * Organization schema. Goes on every page (or at least Landing) so Google
 * + AI assistants know who runs the site. Without this, AI answers like
 * "who built Eliv8 OS?" return nothing useful.
 */
export function organizationSchema() {
  return {
    '@context': 'https://schema.org',
    '@type':    'Organization',
    name:        ORG_NAME,
    url:         SITE_URL,
    logo:        `${SITE_URL}/favicon.svg`,
    description: 'An AI business advisor that reads your actual numbers, remembers what you decided and why, argues the hard calls both ways, and treats how the business is run as mattering. Not only what it earns.',
    sameAs:      [
      // Add LinkedIn / X / YouTube once those exist
    ],
  }
}

/**
 * SoftwareApplication schema. Used on Landing — tells Google + AI tools what
 * category of software this is so it shows up in "AI business advisor"
 * business owners" type queries.
 *
 * ⚠️ The price is read from pricing.js, not written here. This schema is what
 * an AI assistant quotes when someone asks "how much does Eliv8 OS cost?", so
 * a stale number here misinforms buyers before they ever reach the site.
 */
export function softwareApplicationSchema() {
  const price = String(PRICE_MONTHLY_USD)
  // ⚠️ While SHOW_PUBLIC_PRICE is false nothing is for sale, so we publish no
  // Offer at all rather than a number we expect to change. This schema is
  // precisely what an AI assistant quotes when asked "how much does Eliv8 OS
  // cost?" — publishing a price we do not stand behind is how a wrong answer
  // gets cached across the whole answers channel.
  const offers = SHOW_PUBLIC_PRICE ? {
    '@type':         'Offer',
    price,
    priceCurrency:   'USD',
    priceSpecification: {
      '@type':       'UnitPriceSpecification',
      price,
      priceCurrency: 'USD',
      unitText:      'MONTH',
    },
  } : undefined

  return {
    '@context':         'https://schema.org',
    '@type':            'SoftwareApplication',
    name:                SITE_NAME,
    applicationCategory: 'BusinessApplication',
    operatingSystem:     'Web',
    description:         'An AI business advisor with tools for cash flow, finances, hiring, decisions, written procedures, compliance and succession. Reads your real numbers, remembers your decisions, and argues the hard calls both ways.',
    url:                 SITE_URL,
    offers,
    aggregateRating: undefined, // add once we have real reviews — never fake this
  }
}

/**
 * Product schema for the Pricing page. Helps Google show price snippets
 * directly in search results, and lets AI tools answer "how much does
 * Eliv8 OS cost?" with the right number.
 */
export function productSchema({ name, description, price = PRICE_MONTHLY_USD, priceCurrency = 'USD' }) {
  return {
    '@context':    'https://schema.org',
    '@type':       'Product',
    name,
    description,
    brand: {
      '@type': 'Brand',
      name:    SITE_NAME,
    },
    // Same reasoning as softwareApplicationSchema: no Offer while the price
    // is unsettled. A Product with no offer still describes what this is.
    offers: SHOW_PUBLIC_PRICE ? {
      '@type':         'Offer',
      price:           String(price),
      priceCurrency,
      availability:    'https://schema.org/InStock',
      url:             `${SITE_URL}/pricing`,
    } : undefined,
  }
}

/**
 * FAQPage schema. Wraps a list of {q, a} into the JSON-LD shape Google
 * uses to render FAQ rich snippets (the expandable Q&A in search results).
 * AI assistants also use this to answer specific questions about the product.
 *
 * @param {Array<{q: string, a: string}>} faqs
 */
export function faqPageSchema(faqs) {
  return {
    '@context': 'https://schema.org',
    '@type':    'FAQPage',
    mainEntity: faqs.map(({ q, a }) => ({
      '@type': 'Question',
      name:    q,
      acceptedAnswer: {
        '@type': 'Answer',
        text:    a,
      },
    })),
  }
}

/**
 * BreadcrumbList schema. Useful when we add deeper indexable pages like
 * /tools/cash-flow (currently auth-gated, but eventually we may want a
 * marketing variant). For now exported but unused.
 */
export function breadcrumbSchema(items) {
  return {
    '@context': 'https://schema.org',
    '@type':    'BreadcrumbList',
    itemListElement: items.map((item, i) => ({
      '@type':    'ListItem',
      position:    i + 1,
      name:        item.name,
      item:       `${SITE_URL}${item.path}`,
    })),
  }
}

/**
 * Convenience: render a JSON-LD object as a string ready to drop into a
 * <script type="application/ld+json"> tag inside <Helmet>.
 */
export function jsonLd(schema) {
  return JSON.stringify(schema)
}
