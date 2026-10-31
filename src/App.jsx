import { lazy, Suspense, useEffect } from 'react'
import { WAYOUT_BASE, WAYOUT_SITE_URL, onOwnDomain } from './lib/wayout/brand'
import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth, AuthProvider } from './hooks/useAuth'

// Landing stays synchronous — it's the most common entry point and we want
// the fastest possible first paint. Every other page is lazy-loaded so a
// visitor hitting / doesn't pull down the dashboard, pdf.worker (~2 MB),
// xlsx, or the Anthropic SDK before they've even seen the hero. Each lazy
// chunk also caches independently, so a returning user navigating between
// marketing pages only pays the cost of routes they hadn't seen yet.
import Landing from './pages/Landing'

// ── Lazy: marketing pages ──────────────────────────────────────────────────
// Small individually, but pulling them out of the main chunk also pulls out
// every shared component they reference (PublicHeader, etc).
const Pricing       = lazy(() => import('./pages/Pricing'))
const About         = lazy(() => import('./pages/marketing/About'))
const Security      = lazy(() => import('./pages/marketing/Security'))
const Privacy       = lazy(() => import('./pages/marketing/Privacy'))
const Terms         = lazy(() => import('./pages/marketing/Terms'))
const Demo          = lazy(() => import('./pages/marketing/Demo'))
const DemoEntry     = lazy(() => import('./pages/DemoEntry'))
const Comparison    = lazy(() => import('./pages/marketing/Comparison'))
const TradePage     = lazy(() => import('./pages/marketing/TradePage'))
const FreeGbpAudit  = lazy(() => import('./pages/marketing/FreeGbpAudit'))
const Login         = lazy(() => import('./pages/Login'))
const Signup        = lazy(() => import('./pages/Signup'))
const ResetPassword = lazy(() => import('./pages/ResetPassword'))

// ── Lazy: authed app shell + chrome ────────────────────────────────────────
// Sidebar, MobileNav, AdvisorBanner, TrialBanner all only matter inside the
// app — keeping them lazy means a logged-out visitor never downloads them.
const AppLayoutChrome = lazy(() => import('./components/layout/AppLayoutChrome'))
const TermsGate       = lazy(() => import('./components/legal/TermsGate'))

// ── Lazy: authed pages ─────────────────────────────────────────────────────
const Onboarding     = lazy(() => import('./pages/Onboarding'))
const Dashboard      = lazy(() => import('./pages/Dashboard'))
const Roadmap        = lazy(() => import('./pages/Roadmap'))
const Advisor        = lazy(() => import('./pages/Advisor'))
const Checkins       = lazy(() => import('./pages/Checkins'))
const Documents      = lazy(() => import('./pages/Documents'))
const Calendar       = lazy(() => import('./pages/Calendar'))
const SettingsLayout       = lazy(() => import('./pages/settings/SettingsLayout'))
const BusinessSettings     = lazy(() => import('./pages/settings/BusinessSettings'))
const BillingSettings      = lazy(() => import('./pages/settings/BillingSettings'))
const TeamSettings         = lazy(() => import('./pages/settings/TeamSettings'))
const IntegrationsSettings = lazy(() => import('./pages/settings/IntegrationsSettings'))
const DangerSettings       = lazy(() => import('./pages/settings/DangerSettings'))
const Help                 = lazy(() => import('./pages/Help'))
const Invite         = lazy(() => import('./pages/Invite'))
const StaffPortal    = lazy(() => import('./pages/StaffPortal'))
const AdvisorPortal  = lazy(() => import('./pages/AdvisorPortal'))
const Trajectories   = lazy(() => import('./pages/Trajectories'))
const Board          = lazy(() => import('./pages/Board'))
const Playbooks      = lazy(() => import('./pages/Playbooks'))
const DailyLogs      = lazy(() => import('./pages/DailyLogs'))
const AnswerIndex    = lazy(() => import('./pages/marketing/Answers').then(m => ({ default: m.AnswerIndex })))
const AnswerPage     = lazy(() => import('./pages/marketing/Answers').then(m => ({ default: m.AnswerPage })))
// ── Lazy: the way out (internal slug `wayout`) ─────────────────────────────
// A separately-named front door on this platform, not a second app: same auth,
// same Supabase project, same Solomon proxy. It carries its own visual system
// and its own fonts, all of which load only on these routes — see WayoutShell.
const WayoutDiagnostic = lazy(() => import('./pages/wayout/Diagnostic'))
// ⭐⭐ The only INDEXABLE pages in this product. Everything else is noindex and
// behind a session — see the note in Situations.jsx.
const WayoutStuck      = lazy(() => import('./pages/wayout/Situations').then(m => ({ default: m.SituationIndex })))
const WayoutWhy          = lazy(() => import('./pages/wayout/Why'))
const UnstuckTermsPage   = lazy(() => import('./pages/wayout/Legal').then(m => ({ default: m.UnstuckTerms })))
const UnstuckPrivacyPage = lazy(() => import('./pages/wayout/Legal').then(m => ({ default: m.UnstuckPrivacy })))
const WayoutNotFoundPage = lazy(() => import('./pages/wayout/NotFound'))
const WayoutStuckPage  = lazy(() => import('./pages/wayout/Situations').then(m => ({ default: m.SituationPage })))
const WayoutIntake     = lazy(() => import('./pages/wayout/Intake'))
const WayoutPlan       = lazy(() => import('./pages/wayout/Plan'))
const WayoutPlay       = lazy(() => import('./pages/wayout/Play'))
const WayoutPath       = lazy(() => import('./pages/wayout/Path'))
const WayoutDone       = lazy(() => import('./pages/wayout/Done'))
const WayoutChapter    = lazy(() => import('./pages/wayout/Chapter'))
const WayoutHistory    = lazy(() => import('./pages/wayout/History'))
const WayoutInvite     = lazy(() => import('./pages/wayout/Invite'))
const WayoutAccount    = lazy(() => import('./pages/wayout/Account'))
const WayoutEnter      = lazy(() => import('./pages/wayout/Enter'))
const WayoutReset      = lazy(() => import('./pages/wayout/Reset'))
const WayoutLanding    = lazy(() => import('./pages/wayout/Landing'))
// 🔴 DEV ONLY. A hardcoded map on a live site is a fabricated artifact wearing
// the same design as a real one — the exact thing the verbatim-quote guard
// exists to prevent. `import.meta.env.DEV` is a compile-time constant, so in a
// production build this import and its route are removed entirely rather than
// merely unreachable.
// ⚠️ The ternary is load-bearing. Declaring this as a plain `lazy(() => import(…))`
// and only guarding the ROUTE still emits the chunk — Rollup sees a dynamic
// import at module scope and writes the file, so a fabricated map shipped to
// production as an unreferenced but fetchable URL. Vite substitutes
// `import.meta.env.DEV` with `false` at build time, which makes the import
// unreachable code and drops it from the output entirely. Verified by grepping
// dist, not by reasoning about it.
const WayoutPreview    = import.meta.env.DEV
  ? lazy(() => import('./pages/wayout/Preview'))
  : null
const WayoutPreviewIn  = import.meta.env.DEV
  ? lazy(() => import('./pages/wayout/PreviewIntake'))
  : null
const WayoutPreviewPb  = import.meta.env.DEV
  ? lazy(() => import('./pages/wayout/PreviewPlaybook'))
  : null
const WayoutPreviewPath = import.meta.env.DEV
  ? lazy(() => import('./pages/wayout/PreviewPath'))
  : null

const AdminBackfill  = lazy(() => import('./pages/AdminBackfill'))
const AdminReview    = lazy(() => import('./pages/AdminReview'))
const Analytics      = lazy(() => import('./pages/Analytics'))

// ── Lazy: tools (each is its own chunk — heavy by design) ──────────────────
const ToolsIndex         = lazy(() => import('./pages/tools/Index'))
const GBP                = lazy(() => import('./pages/tools/GBP'))
const ExitReadiness      = lazy(() => import('./pages/tools/ExitReadiness'))
const Decision           = lazy(() => import('./pages/tools/Decision'))
const SolomonContext     = lazy(() => import('./pages/SolomonContext'))
const Hiring             = lazy(() => import('./pages/tools/Hiring'))
const OfferBuilder       = lazy(() => import('./pages/tools/OfferBuilder'))
const CashFlow           = lazy(() => import('./pages/tools/CashFlow'))
const Safety             = lazy(() => import('./pages/tools/Safety'))
const CFO                = lazy(() => import('./pages/tools/CFO'))
const OrgChart           = lazy(() => import('./pages/tools/OrgChart'))
const Rocks              = lazy(() => import('./pages/tools/Rocks'))
const Newsletter         = lazy(() => import('./pages/tools/Newsletter'))

// Eager imports that are tiny and used by every authed render — leaving these
// in the main chunk would only matter if logged-out users hit the app, which
// the route guards prevent.
import RequireActiveSubscription from './components/billing/RequireActiveSubscription'
import ErrorBoundary from './components/ErrorBoundary'
import { canVisit, homeFor } from './lib/access'

function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-8 h-8 border-4 border-brand-600 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

function AppLayout() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      {/* TermsGate wraps the whole authed shell rather than sitting on one
          page, because the users who most need it — everyone who signed up
          before the pilot agreement existed — can land on any route. It
          fails open on error; see the component. */}
      <TermsGate>
        <AppLayoutChrome>
          <Outlet />
        </AppLayoutChrome>
      </TermsGate>
    </Suspense>
  )
}

function RequireAuth({ children }) {
  const { session, profile, onboarded, loading, isPersonal } = useAuth()
  if (loading) return <LoadingScreen />
  if (!session) return <Navigate to="/login" replace />
  // ⭐ A personal account (the way out) has no business and never will, so
  // `onboarded` is permanently false and the redirect below would drop them
  // into BUSINESS onboarding — asked their annual revenue by a product they
  // have never heard of. Send them back to their own product instead.
  if (isPersonal) {
    // On getunstuckmap.com they stay in-app; on eliv8os.com a personal (Unstuck)
    // account belongs on its own domain, not bounced onto the Eliv8 side.
    if (onOwnDomain()) return <Navigate to="/wayout" replace />
    if (typeof window !== 'undefined') window.location.replace(WAYOUT_SITE_URL + '/')
    return <LoadingScreen />
  }
  if (!profile) return <Navigate to="/onboarding" replace />
  // ⚠️ Having a profile is not proof of setup. The profile is created at
  // signup; the business profile at the END of onboarding. Someone who closed
  // the tab halfway had the first and not the second, and nothing ever sent
  // them back — they simply used a product whose advisor knew nothing about
  // them. `onboarded === false` is deliberate: undefined means not yet
  // determined, and must not redirect.
  if (onboarded === false) return <Navigate to="/onboarding" replace />
  return children
}

/**
 * ⭐ A page this person's role does not cover sends them to their own home
 * rather than an empty screen. 🔴 COSMETIC — the database (migration 075) is
 * what actually stops them; this only keeps the app honest about it.
 * Advisors viewing a client keep the client's view (their reads are already
 * limited to what the owner shared).
 */
function RequireArea({ children }) {
  const { role, loading, activeClientId } = useAuth()
  const location = useLocation()
  if (loading) return <LoadingScreen />
  if (!activeClientId && role && !canVisit(role, location.pathname)) {
    return <Navigate to={homeFor(role)} replace />
  }
  return children
}

function RequireSession({ children }) {
  const { session, loading } = useAuth()
  if (loading) return <LoadingScreen />
  if (!session) return <Navigate to="/login" replace />
  return children
}

/**
 * ⭐ THE WAY OUT'S OWN SESSION GUARD.
 *
 * 🔴 RequireSession sends people to `/login` — Eliv8's door, headed "someone in
 * your corner who reads the numbers", which then lands them in a business
 * dashboard. Someone halfway through writing about their marriage should never
 * see either. This keeps them inside their own product and returns them to the
 * exact screen they were on.
 */
function RequireWayout({ children }) {
  const { session, loading } = useAuth()
  const location = useLocation()
  if (loading) return <LoadingScreen />
  if (!session) {
    return <Navigate to={`/wayout/enter?next=${encodeURIComponent(location.pathname)}`} replace />
  }
  return children
}

function RedirectIfAuthed({ children }) {
  const { session, profile, company, loading } = useAuth()
  if (loading) return <LoadingScreen />
  // A DEMO session must not hijack the marketing root/login/signup — a visitor
  // touring the demo should still see the landing at eliv8os.com and be able to
  // reach signup to convert. Only real owners get bounced to their dashboard.
  if (session && profile && !company?.is_demo) return <Navigate to="/dashboard" replace />
  return children
}

/**
 * Gate a subtree on profile.role. Use inside RequireAuth.
 *   <RequireRole allow={['owner', 'admin', 'cfo']}><CFO /></RequireRole>
 * Non-matching roles fall back to the dashboard rather than the login
 * screen — the user is authenticated, they just can't see this page.
 */
function RequireRole({ allow, children }) {
  const { role, loading } = useAuth()
  if (loading) return <LoadingScreen />
  if (!allow.includes(role)) return <Navigate to="/dashboard" replace />
  return children
}

/**
 * Suspense wrapper for any single lazy route. Keeps the spinner consistent.
 * Public marketing pages get their own boundary so a slow Pricing chunk
 * doesn't blank out a fast Landing on tab switch (Landing is sync anyway,
 * but the principle generalizes if we ever lazy-load it).
 */
function LazyRoute({ children }) {
  return <Suspense fallback={<LoadingScreen />}>{children}</Suspense>
}

/**
 * Public marketing pages scroll the WINDOW (they render outside
 * AppLayoutChrome, which has its own scroll container and resets itself).
 * Without this, following a link from halfway down /pricing drops you halfway
 * down /about.
 *
 * ⚠️ pathname only. Several pages drive tabs and filters from search params,
 * and jumping to the top when someone changes a filter is its own bug.
 */
function ScrollToTopOnNavigate() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
  }, [pathname])
  return null
}

/**
 * 🔴🔴 A PASSWORD RESET MUST NOT LAND SOMEBODY ON THE OTHER PRODUCT'S HOMEPAGE.
 *
 * Enter.jsx asks Supabase to send people to `<origin>/wayout/reset`, which is
 * right — but Supabase only honours a redirect that is on its allow-list, and if
 * it is not, it silently falls back to the project's Site URL. That is
 * eliv8os.com. So a person halfway through a plan about their marriage and their
 * money, at the least confident moment they will ever have with us, lands on a
 * B2B contractor advisor's front page holding a recovery token.
 *
 * ⚠️ IT CANNOT BE FIXED IN _redirects. Supabase puts the token in the URL
 * FRAGMENT, and a fragment never reaches the server — only the browser sees it.
 * A client-side hop preserves it, which is why this lives here.
 *
 * ⭐ THE REAL FIX IS ONE LINE OF CONFIG — adding https://getunstuckmap.com/** to
 * Supabase → Authentication → URL Configuration → Redirect URLs. This is the
 * belt: it works whether or not that was ever done, and it costs one cheap string
 * check on a hash that is empty on essentially every page load.
 *
 * 🔴 Auth config is deliberately NOT touched from here. There is no config.toml
 * on this project, so a push resets every setting it does not list.
 */
function RecoveryRescue() {
  const navigate = useNavigate()
  const { pathname, hash } = useLocation()
  useEffect(() => {
    if (!hash || !hash.includes('type=recovery')) return
    if (pathname.startsWith(WAYOUT_BASE)) return
    // ⚠️ The hash is carried across deliberately — it IS the token. Dropping it
    // would land them on the right page with no way to prove who they are.
    navigate(`${WAYOUT_BASE}/reset${hash}`, { replace: true })
  }, [pathname, hash, navigate])
  return null
}

// Keep Unstuck off the Eliv8 domain. Any /wayout URL on eliv8os.com is sent to
// getunstuckmap.com so the two products never bleed into each other. No-op on
// getunstuckmap.com, where /wayout is the real product.
function WayoutDomainGuard() {
  const { pathname } = useLocation()
  useEffect(() => {
    if (onOwnDomain()) return
    if (pathname === '/wayout' || pathname.startsWith('/wayout/')) {
      const rest = pathname.slice('/wayout'.length) || '/'
      window.location.replace(WAYOUT_SITE_URL + rest + window.location.search + window.location.hash)
    }
  }, [pathname])
  return null
}

export default function App() {
  return (
    <BrowserRouter>
      <ScrollToTopOnNavigate />
      <RecoveryRescue />
      <WayoutDomainGuard />
      {/* ⚠️ AuthProvider must sit ABOVE the routes: every page below calls
          useAuth(), and before this existed each of those 44 call sites ran its
          own session lookup and its own profile/company fetch. One page load
          measured 68 Supabase requests. One provider, one fetch. */}
      <AuthProvider>
      {/* ErrorBoundary lives INSIDE BrowserRouter so its "Go to dashboard"
          fallback can rely on the router being mounted. A render-time throw
          anywhere below this — in a page, a tool, a Suspense fallback —
          gets caught and replaced with the friendly fallback, instead of
          unmounting the entire tree and leaving a blank white page. */}
      <ErrorBoundary>
      <Routes>
        {/* Public marketing routes — accessible to everyone. Landing redirects
            authed users straight to /dashboard so owners don't see marketing
            chrome on their own domain. Pricing stays public always — an owner
            revisiting it to share with a partner is a feature. */}
        {/* ⭐⭐ ONE ROOT ROUTE THAT KNOWS WHICH PRODUCT IT IS. One build serves
            both domains, so `/` is the only path whose meaning cannot be decided
            by the path itself: it is Unstuck Map's landing on getunstuckmap.com
            and Eliv8's on eliv8os.com.
            🔴 The first attempt registered a SECOND `<Route path="/">` lower down
            and it never fired — for identical paths React Router takes the one
            declared first, so Eliv8's landing won on both domains and the check
            caught it rendering "The OS that runs on integrity" at
            getunstuckmap.com. Two routes claiming one path is the bug; this is
            one route that answers the question. */}
        <Route path="/" element={onOwnDomain()
          ? <LazyRoute><WayoutLanding /></LazyRoute>
          : <RedirectIfAuthed><Landing /></RedirectIfAuthed>} />
        <Route path="/pricing"  element={<LazyRoute><Pricing /></LazyRoute>} />
        <Route path="/about"    element={<LazyRoute><About /></LazyRoute>} />
        <Route path="/answers"       element={<LazyRoute><AnswerIndex /></LazyRoute>} />
        <Route path="/answers/:slug" element={<LazyRoute><AnswerPage /></LazyRoute>} />
        <Route path="/security" element={<LazyRoute><Security /></LazyRoute>} />
        {/* ⚠️ Host-aware: getunstuckmap.com has its own terms and privacy,
            written for a person, not for a business owner. */}
        <Route path="/privacy"  element={<LazyRoute>{onOwnDomain() ? <UnstuckPrivacyPage /> : <Privacy />}</LazyRoute>} />
        <Route path="/terms"    element={<LazyRoute>{onOwnDomain() ? <UnstuckTermsPage /> : <Terms />}</LazyRoute>} />
        <Route path="/wayout/privacy" element={<LazyRoute><UnstuckPrivacyPage /></LazyRoute>} />
        <Route path="/wayout/terms"   element={<LazyRoute><UnstuckTermsPage /></LazyRoute>} />
        {/* ⭐ Daniel's own words on why Unstuck Map exists. /why, not /about —
            /about is Eliv8's on the shared site. */}
        <Route path="/why"            element={<LazyRoute><WayoutWhy /></LazyRoute>} />
        <Route path="/wayout/why"     element={<LazyRoute><WayoutWhy /></LazyRoute>} />
        <Route path="/demo"     element={<LazyRoute><DemoEntry /></LazyRoute>} />
        <Route path="/tour"     element={<LazyRoute><Demo /></LazyRoute>} />

        {/* Comparison pages — same component, slug-driven */}
        <Route path="/vs/:competitor" element={<LazyRoute><Comparison /></LazyRoute>} />

        {/* Trade-specific pages — same component, slug-driven */}
        <Route path="/for/:trade" element={<LazyRoute><TradePage /></LazyRoute>} />

        {/* Free-tool lead magnet */}
        <Route path="/free-gbp-audit" element={<LazyRoute><FreeGbpAudit /></LazyRoute>} />

        {/* ── The way out ──────────────────────────────────────────────────
            🔴 THESE SIT OUTSIDE <RequireAuth> ON PURPOSE, AND MUST STAY THERE.
            RequireAuth sends anyone without a business profile to /onboarding —
            correct for Eliv8 OS, where every user owns a company, and fatal
            here, where the user is a person with a life and no business. They
            would be asked their annual revenue before being allowed to answer
            why they feel stuck.

            RequireSession is the right guard: it needs a signed-in user and
            nothing else, the same call AdvisorPortal makes for the same reason
            (an advisor who signed up by invite may not own a company either).

            The diagnostic takes no guard at all — it is the marketing front
            door and is meant to be hit by strangers. */}
        {/* ⭐ The front door. The diagnostic moves one step in — someone who
            arrives cold sees the product before being asked a question. */}
        <Route path="/wayout/hello" element={<LazyRoute><WayoutLanding /></LazyRoute>} />
        <Route path="/hello" element={<LazyRoute><WayoutLanding /></LazyRoute>} />
        <Route path="/wayout/start" element={<LazyRoute><WayoutDiagnostic /></LazyRoute>} />
        <Route path="/start" element={<LazyRoute><WayoutDiagnostic /></LazyRoute>} />
        {/* ⚠️ Public and indexable, deliberately — these are the door. They sit
            OUTSIDE RequireSession because somebody arriving from an assistant
            has no account and must not be asked for one to read an answer. */}
        <Route path="/wayout/stuck"       element={<LazyRoute><WayoutStuck /></LazyRoute>} />
        <Route path="/stuck"       element={<LazyRoute><WayoutStuck /></LazyRoute>} />
        <Route path="/wayout/stuck/:slug" element={<LazyRoute><WayoutStuckPage /></LazyRoute>} />
        <Route path="/stuck/:slug" element={<LazyRoute><WayoutStuckPage /></LazyRoute>} />
        {/* Its own front door. Public, and deliberately NOT wrapped in
            RedirectIfAuthed — an Eliv8 owner who lands here should be able to
            carry on into the way out rather than being bounced to a dashboard
            belonging to the other product. */}
        <Route path="/wayout/enter" element={<LazyRoute><WayoutEnter /></LazyRoute>} />
        <Route path="/enter" element={<LazyRoute><WayoutEnter /></LazyRoute>} />
        {/* Its own password reset. The email must never hand somebody to the
            other product's branding mid-recovery. */}
        <Route path="/wayout/reset" element={<LazyRoute><WayoutReset /></LazyRoute>} />
        <Route path="/reset" element={<LazyRoute><WayoutReset /></LazyRoute>} />
        {/* ⭐ PUBLIC. The six questions are answerable with no account — held in a
            local draft and adopted on sign-up. The account is asked for at the
            END, where someone can see what they would be keeping. */}
        <Route path="/wayout"       element={<LazyRoute><WayoutIntake /></LazyRoute>} />
        <Route path="/questions"       element={<LazyRoute><WayoutIntake /></LazyRoute>} />
        <Route path="/wayout/plan"  element={<LazyRoute><RequireWayout><WayoutPlan /></RequireWayout></LazyRoute>} />
        <Route path="/plan"  element={<LazyRoute><RequireWayout><WayoutPlan /></RequireWayout></LazyRoute>} />
        {/* The play-by-play for one move. Same guard as the plan — there is
            nothing here for anyone without a session, and the page itself
            sends them back if they have no map yet. */}
        <Route path="/wayout/play/:move" element={<LazyRoute><RequireWayout><WayoutPlay /></RequireWayout></LazyRoute>} />
        <Route path="/play/:move" element={<LazyRoute><RequireWayout><WayoutPlay /></RequireWayout></LazyRoute>} />
        {/* ⭐ The path (31 Oct 2026): the three moves as small steps. Paid half. */}
        <Route path="/wayout/path" element={<LazyRoute><RequireWayout><WayoutPath /></RequireWayout></LazyRoute>} />
        <Route path="/path" element={<LazyRoute><RequireWayout><WayoutPath /></RequireWayout></LazyRoute>} />
        {/* After the third move — the only page that asks instead of telling. */}
        {/* ⭐⭐ The door into a new chapter, and the record of every one before
            it. Both need a session and neither needs a finished plan — somebody
            mid-chapter-two must be able to read where they started. */}
        <Route path="/wayout/chapter" element={<LazyRoute><RequireWayout><WayoutChapter /></RequireWayout></LazyRoute>} />
        <Route path="/chapter" element={<LazyRoute><RequireWayout><WayoutChapter /></RequireWayout></LazyRoute>} />
        <Route path="/wayout/history" element={<LazyRoute><RequireWayout><WayoutHistory /></RequireWayout></LazyRoute>} />
        <Route path="/history" element={<LazyRoute><RequireWayout><WayoutHistory /></RequireWayout></LazyRoute>} />
        {/* ⭐ People you invited (17 Oct). Migration 101; the friend decides if they are named. */}
        <Route path="/wayout/invite" element={<LazyRoute><RequireWayout><WayoutInvite /></RequireWayout></LazyRoute>} />
        <Route path="/invite" element={<LazyRoute><RequireWayout><WayoutInvite /></RequireWayout></LazyRoute>} />
        {/* ⭐ Your data — download or delete (3 Oct). /account is free on both hosts. */}
        <Route path="/wayout/account" element={<LazyRoute><RequireWayout><WayoutAccount /></RequireWayout></LazyRoute>} />
        <Route path="/account" element={<LazyRoute><RequireWayout><WayoutAccount /></RequireWayout></LazyRoute>} />
        <Route path="/wayout/done" element={<LazyRoute><RequireWayout><WayoutDone /></RequireWayout></LazyRoute>} />
        <Route path="/done" element={<LazyRoute><RequireWayout><WayoutDone /></RequireWayout></LazyRoute>} />
        {import.meta.env.DEV && (
          <Route path="/wayout/preview" element={<LazyRoute><WayoutPreview /></LazyRoute>} />
          )}
        {import.meta.env.DEV && (
          <Route path="/wayout/preview/intake" element={<LazyRoute><WayoutPreviewIn /></LazyRoute>} />
          )}
        {/* ⚠️ Needs a session — it calls the real model. */}
        {import.meta.env.DEV && (
          <Route path="/wayout/preview/playbook" element={<LazyRoute><RequireWayout><WayoutPreviewPb /></RequireWayout></LazyRoute>} />
          )}
        {/* No session and no model: Luis's sample path, taps kept in memory. */}
        {import.meta.env.DEV && (
          <Route path="/wayout/preview/path" element={<LazyRoute><WayoutPreviewPath /></LazyRoute>} />
          )}

        {/* Public auth routes */}
        <Route path="/login"          element={<LazyRoute><RedirectIfAuthed><Login /></RedirectIfAuthed></LazyRoute>} />
        <Route path="/signup"         element={<LazyRoute><RedirectIfAuthed><Signup /></RedirectIfAuthed></LazyRoute>} />
        <Route path="/reset-password" element={<LazyRoute><ResetPassword /></LazyRoute>} />

        {/* Advisor invite — public (auth is handled inline on the page) */}
        <Route path="/invite/:token" element={<LazyRoute><Invite /></LazyRoute>} />

        {/* Staff magic-link portal — fully public. Auth is the HMAC-signed
            token in the URL, verified server-side by the staff-portal Edge
            Function. Field crew open this from an email on their phone, so
            no Supabase session exists or is required. */}
        <Route path="/staff/:token" element={<LazyRoute><StaffPortal /></LazyRoute>} />

        {/* Advisor portal — requires session but NOT a company profile.
            Advisors who signed up via invite may not own a company. */}
        <Route path="/advisor-portal" element={<LazyRoute><RequireSession><AdvisorPortal /></RequireSession></LazyRoute>} />

        {/* Needs session but no profile check (new user) */}
        <Route path="/onboarding" element={<LazyRoute><RequireSession><Onboarding /></RequireSession></LazyRoute>} />

        {/* Protected app routes — sidebar layout.
            Non-tool routes (dashboard, settings, etc.) are always reachable
            so a user can manage billing + see their content even with no
            active sub. Tool routes are gated below. */}
        <Route element={<RequireAuth><RequireArea><AppLayout /></RequireArea></RequireAuth>}>
          <Route path="/dashboard"    element={<Dashboard />} />
          <Route path="/roadmap"      element={<Roadmap />} />
          <Route path="/advisor"      element={<Advisor />} />
          <Route path="/checkins"     element={<Checkins />} />
          <Route path="/documents"    element={<Documents />} />
          <Route path="/calendar"     element={<Calendar />} />
          <Route path="/trajectories" element={<Trajectories />} />
          <Route path="/board"        element={<Board />} />
          <Route path="/playbooks"    element={<Playbooks />} />
          <Route path="/logs"         element={<DailyLogs />} />
          <Route path="/help"         element={<Help />} />

          {/* Settings is a sub-route tree — the layout renders a left
              sub-nav and an <Outlet />. /settings redirects to the first
              real section so the URL is always specific. */}
          <Route path="/settings" element={<SettingsLayout />}>
            <Route index                 element={<Navigate to="business" replace />} />
            <Route path="business"       element={<BusinessSettings />} />
            <Route path="billing"        element={<BillingSettings />} />
            <Route path="team"           element={<TeamSettings />} />
            <Route path="integrations"   element={<IntegrationsSettings />} />
            <Route path="danger"         element={<DangerSettings />} />
          </Route>

          <Route path="/analytics"    element={<Analytics />} />

          {/* Paywalled subtree. The guard renders <Paywall /> inline (not
              a redirect) when !hasAccess, so the URL stays put and the
              user can see which tool they hit. RequireRole still composes
              for role-gated tools (CFO) — both guards run. */}
          <Route element={<RequireActiveSubscription />}>
            <Route path="/tools"                element={<ToolsIndex />} />
            <Route path="/tools/gbp"            element={<GBP />} />
            <Route path="/tools/exit-readiness" element={<ExitReadiness />} />
            <Route path="/tools/decision" element={<Decision />} />
            <Route path="/context" element={<SolomonContext />} />
            <Route path="/tools/hiring"         element={<Hiring />} />
            <Route path="/tools/offer-builder"  element={<OfferBuilder />} />
            <Route path="/tools/cash-flow"      element={<CashFlow />} />
            <Route path="/tools/safety"         element={<Safety />} />
            <Route path="/tools/cfo"            element={<RequireRole allow={['owner', 'admin', 'cfo']}><CFO /></RequireRole>} />
            <Route path="/tools/org-chart"      element={<OrgChart />} />
            <Route path="/tools/rocks"          element={<Rocks />} />
            <Route path="/tools/newsletter"     element={<Newsletter />} />
          </Route>
        </Route>

        {/* Admin utilities — require auth but bypass subscription/role checks.
            AdminReview self-gates on email match, so RequireSession (no profile
            check) is enough to keep it out of the normal user flow. */}
        <Route path="/admin/backfill" element={<LazyRoute><RequireAuth><AdminBackfill /></RequireAuth></LazyRoute>} />
        <Route path="/admin/review"   element={<LazyRoute><RequireSession><AdminReview /></RequireSession></LazyRoute>} />

        {/* ⚠️ Host-aware: Unstuck Map's own domain gets a real not-found page;
            Eliv8 keeps sending unknown addresses home, as it always has. */}
        <Route path="*" element={onOwnDomain() ? <LazyRoute><WayoutNotFoundPage /></LazyRoute> : <Navigate to="/" replace />} />
      </Routes>
      </ErrorBoundary>
      </AuthProvider>
    </BrowserRouter>
  )
}
