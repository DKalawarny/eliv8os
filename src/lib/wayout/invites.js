import { supabase } from '../supabase'
import { WAYOUT_SITE_URL } from './brand'

/**
 * ⭐ Invite links and the inviter's dashboard (17 Oct 2026, migration 101).
 *
 * 🔴 The friend decides whether the person who sent them can see they joined.
 * Until they say yes they are "someone". No friend's email or phone is stored:
 * "who hasn't signed up yet" comes from one link per person, with a nickname
 * only the inviter sees.
 *
 * ⚠️ Nothing here may break the product. An invite is a nice extra; a failure
 * in any of these is swallowed so the plan still loads.
 */
const KEY = 'wayout:invite'
const OPENED = 'wayout:invite-opened'
// ⭐ The inviter's first name, when they let it be shown (migration 103), so
// the friend sees "Danny invited you" and knows they are in the right place.
const FROM = 'wayout:invited-by'

export const inviteUrl = code => `${WAYOUT_SITE_URL}/?i=${encodeURIComponent(code)}&utm_source=invite`

/** On any page load: remember the code from `?i=`, and count the open once per browser. */
export function captureInvite() {
  try {
    if (typeof window === 'undefined') return
    const code = new URLSearchParams(window.location.search).get('i')?.trim().slice(0, 20)
    if (!code || !/^[a-z0-9]+$/i.test(code)) return
    localStorage.setItem(KEY, JSON.stringify({ code, at: Date.now() }))
    const opened = JSON.parse(localStorage.getItem(OPENED) || '[]')
    if (opened.includes(code)) return
    localStorage.setItem(OPENED, JSON.stringify([...opened, code].slice(-20)))
    supabase.rpc('wayout_invite_open', { p_code: code }).then(({ data }) => {
      try {
        if (data) localStorage.setItem(FROM, JSON.stringify({ code, name: String(data).slice(0, 30) }))
        else localStorage.removeItem(FROM)
        window.dispatchEvent(new Event('wayout:invited'))
      } catch { /* nothing breaks */ }
    }, () => {})
  } catch { /* private mode: nothing recorded, nothing breaks */ }
}

/** After sign-in: credit the link once. The database refuses anyone who already had an account. */
export async function claimInvite() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null')
    if (!saved?.code) return
    await supabase.rpc('wayout_invite_claim', { p_code: saved.code })
    localStorage.removeItem(KEY)
  } catch { /* the plan matters more than the credit */ }
}

/**
 * Who invited this browser, for the welcome note: { name } or { name: null }
 * when a link was opened but the inviter keeps their name private; null when
 * no invite link was ever opened here.
 */
export function invitedBy() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null')
    if (!saved?.code) return null
    const from = JSON.parse(localStorage.getItem(FROM) || 'null')
    return { name: from?.code === saved.code ? from.name : null }
  } catch { return null }
}

/** The caller's main link: { code, short, show_name } (migration 103). */
export async function myInvite() {
  const { data, error } = await supabase.rpc('wayout_invite_mine')
  if (error) return null
  return data ?? null
}

export async function setShowName(show) {
  const { error } = await supabase.rpc('wayout_invite_show_name', { p_show: Boolean(show) })
  if (error) throw new Error('That did not save. Try again in a moment.')
}

/**
 * A friend typing a code after signing up another way.
 * Returns 'ok' · 'own' · 'unknown' · 'already' · 'too_late'.
 */
export async function claimCode(code) {
  const { data, error } = await supabase.rpc('wayout_invite_claim_code', { p_code: String(code ?? '').trim() })
  if (error) throw new Error('That did not go through. Try again in a moment.')
  return data
}

/** { from, show, answered } for someone who joined from a link, else null. */
export async function myReferral() {
  const { data, error } = await supabase.rpc('wayout_my_referral')
  if (error) return null
  return data ?? null
}

export async function answerReferral(show) {
  const { error } = await supabase.rpc('wayout_invite_consent', { p_show: Boolean(show) })
  if (error) throw new Error('That did not save. Try again in a moment.')
}

export async function mainInviteCode() {
  const { data, error } = await supabase.rpc('wayout_invite_main')
  if (error) return null
  return data ?? null
}

export async function createInvite(label) {
  const { data, error } = await supabase.rpc('wayout_invite_create', { p_label: label })
  if (error) throw new Error(error.message?.includes('200 links') ? error.message : 'That link did not save. Try again in a moment.')
  return data
}

export async function myInvites() {
  const { data, error } = await supabase.rpc('wayout_my_invites')
  if (error) throw new Error('Your invites did not load. Try again in a moment.')
  return Array.isArray(data) ? data : []
}

export async function deleteInvite(code) {
  const { error } = await supabase.from('wayout_invites').delete().eq('code', code)
  if (error) throw new Error('That did not delete. Try again in a moment.')
}

/** The numbers across the top of the dashboard. */
export function inviteTotals(invites = []) {
  const friends = invites.flatMap(i => i.friends ?? [])
  return {
    opened: invites.reduce((n, i) => n + (Number(i.opened) || 0), 0),
    joined: friends.length,
    plans: friends.filter(f => f.plan).length,
    paying: friends.filter(f => f.paying).length,
  }
}

/** How far one friend has got, in words. */
export function friendStage(f) {
  if (f?.paying) return 'Paying'
  if (f?.plan) return 'Made a plan'
  return 'Joined'
}
