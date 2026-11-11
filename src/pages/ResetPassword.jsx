import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Helmet } from 'react-helmet-async'
import { supabase } from '../lib/supabase'
import { SITE_URL, SITE_NAME } from '../lib/seo'
import Wordmark from '../components/brand/Wordmark'

/**
 * ResetPassword — handles the link from a "Forgot password" email.
 * Supabase embeds a recovery token in the URL hash; the client SDK
 * picks it up automatically via onAuthStateChange (PASSWORD_RECOVERY event).
 * We just need to present the new-password form once the session is ready.
 */
export default function ResetPassword() {
  const navigate = useNavigate()
  const [password, setPassword]         = useState('')
  const [confirm, setConfirm]           = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [status, setStatus]             = useState('waiting') // waiting | ready | saving | done | error | nolink
  const [errorMsg, setErrorMsg]         = useState(null)

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setStatus('ready')
    })
    // If page loads with a hash token, the event fires quickly.
    // Fallback: if already in a recovery session, set ready.
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setStatus('ready')
    })
    // ⚠️ Without a usable link nothing ever fires, and the spinner turned
    // forever (11 Nov audit). An expired link says so in the hash; a missing
    // one just never verifies, so give it a few seconds and then say so.
    const hash = new URLSearchParams(window.location.hash.slice(1))
    if (hash.get('error')) setStatus('nolink')
    const t = setTimeout(() => setStatus(s => (s === 'waiting' ? 'nolink' : s)), 8000)
    return () => { clearTimeout(t); subscription.unsubscribe() }
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    if (password !== confirm) { setErrorMsg('Passwords do not match.'); return }
    if (password.length < 8)  { setErrorMsg('Password must be at least 8 characters.'); return }
    setStatus('saving')
    setErrorMsg(null)
    const { error } = await supabase.auth.updateUser({ password })
    if (error) { setErrorMsg(error.message); setStatus('ready') }
    else        setStatus('done')
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-ink-50 px-4">
      <Helmet>
        <title>Reset password {SITE_NAME}</title>
        <link rel="canonical" href={`${SITE_URL}/reset-password`} />
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>

      <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-ink-100 p-8">
        <Link to="/" className="block mb-8">
          <Wordmark tone="light" size={22} />
        </Link>

        {status === 'done' ? (
          <div className="text-center">
            <p className="text-3xl mb-3">✅</p>
            <h1 className="text-xl font-bold text-ink-900 mb-2">Password updated</h1>
            <p className="text-sm text-ink-500 mb-6">You can now sign in with your new password.</p>
            <Link
              to="/login"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 px-5 py-2.5 rounded-lg transition-colors"
            >
              Go to login →
            </Link>
          </div>
        ) : status === 'nolink' ? (
          <div className="text-center">
            <h1 className="text-xl font-bold text-ink-900 mb-2">This reset link did not work</h1>
            <p className="text-sm text-ink-500 mb-6">
              It may have expired, been used already, or been cut off when it was copied.
              Ask for a new one and use the newest email.
            </p>
            <Link
              to="/login"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 px-5 py-2.5 rounded-lg transition-colors"
            >
              Get a new link →
            </Link>
          </div>
        ) : status === 'waiting' ? (
          <div className="text-center">
            <div className="w-8 h-8 border-2 border-brand-400 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-sm text-ink-500">Verifying your reset link…</p>
            <p className="text-xs text-ink-400 mt-2">
              If nothing happens,{' '}
              <Link to="/login" className="text-brand-600 hover:underline">go back to login</Link>
              {' '}and request a new link.
            </p>
          </div>
        ) : (
          <>
            <h1 className="text-2xl font-bold text-ink-900 mb-1 tracking-tight">Set new password</h1>
            <p className="text-sm text-ink-500 mb-8">Choose something strong, at least 8 characters.</p>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-widest text-ink-500 mb-2">
                  New password
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    minLength={8}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="Min. 8 characters"
                    autoComplete="new-password"
                    autoFocus
                    className="pr-14"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-ink-400 hover:text-ink-600 font-medium"
                  >
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-widest text-ink-500 mb-2">
                  Confirm password
                </label>
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  minLength={8}
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  placeholder="Same password again"
                  autoComplete="new-password"
                />
              </div>

              {errorMsg && (
                <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                  {errorMsg}
                </div>
              )}

              <button
                type="submit"
                disabled={status === 'saving'}
                className="w-full bg-gold-gradient text-white rounded-lg px-4 py-3 text-sm font-bold tracking-wide disabled:opacity-50 glow-gold-sm hover:glow-gold transition-all duration-200"
              >
                {status === 'saving' ? 'Saving…' : 'Set new password →'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
