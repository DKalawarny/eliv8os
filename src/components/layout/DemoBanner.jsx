import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { isDemoCompany, DEMO_BUSINESS } from '../../lib/demo'

/**
 * A persistent strip shown on every page while in the demo, so a visitor always
 * knows it is a sample and always has a one-click way to start their own.
 */
export default function DemoBanner() {
  const { company } = useAuth()
  if (!isDemoCompany(company)) return null

  async function startOwn() {
    await supabase.auth.signOut().catch(() => {})
    window.location.href = '/signup'
  }

  return (
    <div className="kb-hide bg-brand-600 text-white px-4 py-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-sm text-center">
      <span className="font-medium">
        You&rsquo;re exploring a live demo with sample data from {DEMO_BUSINESS}, a made-up company.
      </span>
      <button
        onClick={startOwn}
        className="font-bold px-3.5 py-1 rounded-full bg-white text-brand-700 hover:bg-white/90 whitespace-nowrap shadow-sm"
      >
        Get Eliv8 for your business &rarr;
      </button>
    </div>
  )
}
