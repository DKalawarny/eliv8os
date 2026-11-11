import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { loadMemory, dismissMemory } from '../lib/memory'
import ShareWithUnstuck from '../components/settings/ShareWithUnstuck'

/**
 * What Solomon is working from — /context
 *
 * Two jobs, and the second one is the reason this page exists.
 *
 * 1. Trust. Every answer he gives is either drawn from their business or is
 *    general reasoning, and an owner should be able to see which without
 *    taking his word for it.
 * 2. Filling the gaps. Nobody feeds an advisor context they don't know he's
 *    missing. Naming the gap — and what it costs them in the quality of his
 *    answers — is what makes anyone bother.
 *
 * Deliberately NOT an upload wall. There is no version of this that greets a
 * new owner with "connect six things before we start"; the gaps are shown so
 * he can ask for what he needs at the moment it would have changed his answer.
 */

export default function SolomonContext() {
  const { profile } = useAuth()
  const [s, setS] = useState({ loading: true })
  const [memory, setMemory] = useState([])

  useEffect(() => {
    if (!profile?.company_id) return
    let cancelled = false
    const cid = profile.company_id
    const count = (table, build = q => q) =>
      build(supabase.from(table).select('id', { count: 'exact', head: true }).eq('company_id', cid))

    ;(async () => {
      const [staff, files, chunks, safety, snaps, qbo, checkins, chats, docs, plays, latestSnap] = await Promise.all([
        count('staff_members'),
        count('knowledge_files', q => q.eq('status', 'ready')),
        count('document_chunks'),
        count('safety_documents', q => q.eq('is_current', true)),
        count('financial_snapshots'),
        supabase.from('integrations').select('status').eq('company_id', cid).eq('provider', 'quickbooks').maybeSingle(),
        count('checkins'),
        count('chat_messages'),
        count('documents'),
        count('work_order_templates', q => q.is('archived_at', null)),
        supabase.from('financial_snapshots').select('synced_at').eq('company_id', cid).order('synced_at', { ascending: false }).limit(1).maybeSingle(),
      ])
      const mem = await loadMemory(cid, profile.id).catch(() => [])
      if (cancelled) return
      setMemory(mem)
      setS({
        loading: false,
        staff: staff.count ?? 0,
        files: files.count ?? 0,
        chunks: chunks.count ?? 0,
        safety: safety.count ?? 0,
        snaps: snaps.count ?? 0,
        qbo: qbo.data?.status ?? 'disconnected',
        checkins: checkins.count ?? 0,
        chats: chats.count ?? 0,
        docs: docs.count ?? 0,
        plays: plays.count ?? 0,
        lastSync: latestSnap.data?.synced_at ?? null,
      })
    })()
    return () => { cancelled = true }
  }, [profile?.company_id])

  if (s.loading) {
    return (
      <div className="min-h-screen bg-ink-50">
        <div className="mx-auto max-w-[760px] px-6 py-14 flex flex-col gap-5">
          <div className="h-9 w-72 rounded bg-ink-100" />
          <div className="h-28 w-full rounded-2xl bg-ink-100" />
          <div className="h-28 w-full rounded-2xl bg-ink-100" />
        </div>
      </div>
    )
  }

  const qboLive = s.qbo === 'connected' || s.qbo === 'active'
  const connected = [
    qboLive && {
      title: 'QuickBooks',
      detail: s.lastSync
        ? `Revenue, margin and cash position, synced ${relative(s.lastSync)}`
        : 'Revenue, margin and cash position',
    },
    // Only claim this when the files are actually indexed. Uploaded and
    // searchable are different states, and a file with no chunks is invisible
    // to him — saying "Live" over it is the most misleading thing this page
    // could do, because it is the exact question the page exists to answer.
    s.files > 0 && s.chunks > 0 && {
      title: `Your documents, ${s.files} ${s.files === 1 ? 'file' : 'files'}`,
      detail: 'Searched by meaning, so he can quote the relevant part rather than the whole file',
    },
    s.safety > 0 && {
      title: `Licences and compliance, ${s.safety} ${s.safety === 1 ? 'document' : 'documents'}`,
      detail: 'Answered against the real regulation, with the source shown',
    },
    s.staff > 0 && {
      title: `Your team, ${s.staff} ${s.staff === 1 ? 'person' : 'people'}`,
      detail: 'Who does what, and who is carrying how much',
    },
  ].filter(Boolean)

  const learned = [
    s.checkins > 0 && { title: `${s.checkins} check-${s.checkins === 1 ? 'in' : 'ins'}`, detail: 'How the year has actually gone' },
    s.chats   > 0 && { title: `${s.chats} messages with Solomon`, detail: "What you've already ruled out" },
    s.plays   > 0 && { title: `${s.plays} ${s.plays === 1 ? 'job' : 'jobs'} written down`, detail: 'What the business knows how to do without you' },
    s.docs    > 0 && { title: `${s.docs} ${s.docs === 1 ? 'thing' : 'things'} he's made`, detail: 'Kept so he can build on them instead of starting over' },
  ].filter(Boolean)

  const gaps = [
    s.staff === 0 && {
      key: 'crew',
      headline: "He doesn't know your crew.",
      body: "Names, who does what, roughly how long they've been with you. Two minutes, and it changes what he can say about hiring, about who's carrying too much, and about who could run a job without you. Until then he'll tell you plainly that he can't judge anything about your people, which is honest, but it's also half an answer.",
      cta: { label: 'Add your team', to: '/settings/team' },
    },
    !qboLive && {
      key: 'books',
      headline: "He can't see your numbers.",
      body: 'Without the books he can reason about your business but not about your money, so anything about cash, margin or whether you can afford something is guesswork he will refuse to do.',
      cta: { label: 'Connect QuickBooks', to: '/settings/integrations' },
    },
    s.files > 0 && s.chunks === 0 && {
      key: 'unindexed',
      headline: `Your ${s.files} ${s.files === 1 ? 'file is' : 'files are'} uploaded, but he can't read ${s.files === 1 ? 'it' : 'them'} yet.`,
      body: "They were added while document search was switched off, so they were never indexed, which means every answer so far has ignored them completely. Indexing takes a few seconds and only needs doing once.",
      cta: { label: 'Index them now', to: '/admin/backfill' },
    },
    s.files === 0 && {
      key: 'docs',
      headline: 'Nothing of yours is in his hands yet.',
      body: 'Contracts, your handbook, a job debrief, last year’s numbers, whatever is already written down. He reads what you give him and quotes the relevant part back rather than generalising.',
      cta: { label: 'Add documents', to: '/documents' },
    },
  ].filter(Boolean)

  return (
    <div className="min-h-screen bg-ink-50">
      <div className="mx-auto w-full max-w-[760px] px-6 py-14 flex flex-col gap-7">

        <header className="flex flex-col gap-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-300">Solomon</p>
          <h1 className="font-serif text-[32px] leading-[1.15] text-ink-900">What he's working from</h1>
          <p className="text-[14.5px] leading-[1.6] text-ink-500 max-w-[600px]">
            The more of your business he can see, the less he has to generalise.
            Nothing here leaves your company, and none of it trains anything.
          </p>
        </header>

        <MemorySection
          rows={memory}
          onDismiss={async id => {
            setMemory(m => m.filter(r => r.id !== id))
            await dismissMemory(id)
          }}
        />

        {/* ⭐ The shared summary with Unstuck Map; renders only for people with a plan there. */}
        <ShareWithUnstuck />

        {connected.length > 0 && <Group label="Connected" rows={connected} live />}
        {learned.length   > 0 && <Group label="Picked up from using the app" rows={learned} />}

        {gaps.map(g => (
          <section key={g.key} className="rounded-2xl border border-amber-200 bg-amber-50/60 p-6 flex flex-col gap-3.5">
            <div className="flex items-center gap-2.5">
              <svg viewBox="0 0 24 24" className="w-[17px] h-[17px] text-amber-700" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="9" /><path d="M12 8v5" /><path d="M12 16.5v.5" />
              </svg>
              <p className="text-[11px] font-semibold uppercase tracking-[0.09em] text-amber-800">
                What he still can't see
              </p>
            </div>
            <p className="font-serif text-[20px] leading-[1.5] text-ink-900">{g.headline}</p>
            <p className="text-[14.5px] leading-[1.65] text-ink-700">{g.body}</p>
            <div className="flex flex-wrap items-center gap-3">
              <Link
                to={g.cta.to}
                className="px-5 py-2.5 rounded-[10px] bg-brand-600 hover:bg-brand-700 text-white text-[14px] font-semibold transition-colors"
              >
                {g.cta.label}
              </Link>
              <span className="text-[13.5px] text-ink-400">Or leave it, he'll ask again when it matters.</span>
            </div>
          </section>
        ))}

        <div className="flex items-start gap-2.5 pt-2">
          <svg viewBox="0 0 24 24" className="w-[15px] h-[15px] text-ink-300 mt-0.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="10" width="16" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" />
          </svg>
          <p className="text-[13px] leading-[1.6] text-ink-400">
            Your data stays inside your company. It is never used to train a model,
            and no one else's business is ever in your answers.
          </p>
        </div>

      </div>
    </div>
  )
}

function Group({ label, rows, live = false }) {
  return (
    <section className="bg-white border border-ink-100 rounded-2xl px-6 pt-5 pb-1">
      <p className="text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-300 pb-2">{label}</p>
      {rows.map((r, i) => (
        <div key={r.title} className={`flex items-center gap-4 py-3.5 ${i < rows.length - 1 ? 'border-b border-ink-100' : ''}`}>
          <div className="flex-1 min-w-0 flex flex-col gap-0.5">
            <p className="text-[14.5px] font-semibold text-ink-900">{r.title}</p>
            <p className="text-[13px] text-ink-400">{r.detail}</p>
          </div>
          {live && <span className="text-[12.5px] font-semibold text-brand-700 shrink-0">Live</span>}
        </div>
      ))}
    </section>
  )
}

function relative(iso) {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (!Number.isFinite(days)) return 'recently'
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days} days ago`
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })
}

const KIND_LABEL = {
  constraint: 'A line you drew',
  decision:   'Decided',
  person:     'Someone',
  commitment: 'You said you would',
  preference: 'How you like it',
  context:    'Background',
}

/**
 * What he remembers, and the button that says he's wrong.
 *
 * The dismiss control is the entire trust model of this feature. A durable
 * fact the owner cannot correct is worse than no memory at all — it quietly
 * skews every later answer with no way to find out why.
 */
function MemorySection({ rows, onDismiss }) {
  if (!rows.length) {
    return (
      <section className="bg-white border border-ink-100 rounded-2xl p-6 flex flex-col gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-300">
          What he remembers
        </p>
        <p className="text-[14.5px] leading-[1.65] text-ink-500">
          Nothing yet. As you talk, he writes down the things that will still
          matter in six months: lines you’ve drawn, decisions you’ve already
          made, who your people are. Not the conversation, just what lasts.
        </p>
      </section>
    )
  }
  return (
    <section className="bg-white border border-ink-100 rounded-2xl px-6 pt-5 pb-2 flex flex-col">
      <div className="flex items-baseline justify-between pb-1">
        <p className="text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-300">
          What he remembers
        </p>
        <span className="text-[12.5px] text-ink-300">{rows.length}</span>
      </div>
      <p className="text-[13px] text-ink-400 pb-3">
        Wrong, or no longer true? Remove it and he’ll stop using it.
      </p>
      {rows.map((r, i) => (
        <div key={r.id} className={`group flex items-start gap-4 py-3.5 ${i < rows.length - 1 ? 'border-b border-ink-100' : ''}`}>
          <div className="flex-1 min-w-0 flex flex-col gap-1">
            <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
              <span className="text-[10.5px] font-bold uppercase tracking-[0.05em] text-brand-700">
                {KIND_LABEL[r.kind] ?? r.kind}
              </span>
              {r.first_seen && (
                <span className="text-[11.5px] text-ink-300">
                  {new Date(r.first_seen).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
                </span>
              )}
            </div>
            <p className="text-[14.5px] leading-[1.55] text-ink-900">{r.statement}</p>
            {r.detail && <p className="text-[13px] leading-[1.55] text-ink-400">{r.detail}</p>}
            {/* Where a commitment stands, so the owner can see and correct
                what Solomon thinks happened. ⚠️ Deliberately the same muted
                grey whether he did it or not — a green tick beside a red
                cross is a scoreboard, and this page is not a report card.
                Same principle as migration 028: no grading. */}
            {r.kind === 'commitment' && (r.outcome || r.due_on) && (
              <p className="text-[12.5px] leading-[1.5] text-ink-400">
                {r.outcome
                  ? { kept: 'He did it.', dropped: 'It didn’t happen.', changed: 'He changed his mind.' }[r.outcome] ?? r.outcome
                  : `Due ${new Date(r.due_on + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`}
                {r.outcome_note ? ` ${r.outcome_note}` : ''}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => onDismiss(r.id)}
            className="shrink-0 opacity-0 group-hover:opacity-100 pointer-coarse:opacity-100 focus:opacity-100 transition-opacity text-[12.5px] font-semibold text-ink-300 hover:text-red-600 px-2 py-1"
          >
            Remove
          </button>
        </div>
      ))}
    </section>
  )
}
