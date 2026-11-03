import { Helmet } from 'react-helmet-async'
import PublicHeader from '../../components/layout/PublicHeader'
import { buildPageMeta, jsonLd, organizationSchema, CONTACT_EMAIL, ORG_NAME } from '../../lib/seo'
import { OPERATOR_LEGAL_NAME } from '../../lib/terms'

/**
 * /privacy — privacy policy.
 *
 * Drafted as a plain-language privacy policy that's still legally workable
 * for a Canadian SaaS handling personal info under PIPEDA. NOT legal advice.
 * Run by a real lawyer before going live in front of paying customers,
 * especially if you start handling US customers (CCPA / CPRA implications).
 *
 * Last reviewed: 2026-05 — keep this up to date when vendor list changes.
 */

const PRIVACY_META = buildPageMeta({
  title:       'Privacy policy — Eliv8 OS',
  description: 'How Eliv8 OS collects, uses, stores, and shares personal information. Plain-language privacy policy compliant with PIPEDA. No data sold, no AI training on your data.',
  path:        '/privacy',
})

const LAST_UPDATED = '2026-11-02'

export default function Privacy() {
  return (
    <div className="min-h-screen bg-white">
      <Helmet>
        <title>{PRIVACY_META.title}</title>
        <link rel="canonical" href={PRIVACY_META.canonical} />
        {PRIVACY_META.meta.map((m, i) =>
          m.property
            ? <meta key={i} property={m.property} content={m.content} />
            : <meta key={i} name={m.name} content={m.content} />
        )}
        <script type="application/ld+json">{jsonLd(organizationSchema())}</script>
      </Helmet>

      <PublicHeader />

      <main className="max-w-3xl mx-auto px-6 py-16">
        <p className="text-brand-600 text-xs font-bold uppercase tracking-widest mb-4">Privacy</p>
        <h1 className="text-4xl md:text-5xl font-black text-gray-900 tracking-tight leading-tight mb-3">
          Privacy policy
        </h1>
        <p className="text-sm text-gray-500 mb-12">Last updated: {LAST_UPDATED}</p>

        <p className="text-gray-700 leading-relaxed mb-12">
          {ORG_NAME} ("we", "us", "our") provides an AI business advisor and
          related tools to business owners. It is operated by{' '}
          {OPERATOR_LEGAL_NAME}, a British Columbia company. This policy
          explains what personal and business information we collect, how we
          use it, who we share it with, and your rights. We try to write it
          in plain English. If anything is unclear, email{' '}
          <a href={`mailto:${CONTACT_EMAIL}`} className="text-brand-600 hover:underline">{CONTACT_EMAIL}</a>{' '}
          and we'll explain.
        </p>

        <Sec title="1. Information we collect">
          <p>We collect information in three categories:</p>
          <ul>
            <li>
              <strong>Account info you give us:</strong> name, email, password (hashed),
              phone if you provide it, company name, role, and basic business profile
              answers (industry, team size, goals).
            </li>
            <li>
              <strong>Business data you put into the product:</strong> financial figures
              you enter, QuickBooks data if you connect it, hiring notes, check-in entries,
              roadmap milestones, documents you upload, conversations with Solomon.
            </li>
            <li>
              <strong>Technical info we collect automatically:</strong> IP address,
              browser type, pages visited, error logs. Used to keep the product running
              and debug problems, never sold.
            </li>
          </ul>
        </Sec>

        <Sec title="2. How we use it">
          <p>To run the product:</p>
          <ul>
            <li>Provide your subscription, sync data, generate AI outputs.</li>
            <li>Send service emails (password resets, billing, security alerts).</li>
            <li>Improve the product (aggregate, anonymized usage patterns, never your specific data).</li>
            <li>Comply with legal obligations.</li>
          </ul>
          <p className="mt-3">
            We may send occasional product update emails. Every one has an unsubscribe
            link, and unsubscribing doesn't affect your service emails.
          </p>
        </Sec>

        <Sec title="3. Who we share data with">
          <p>To run Eliv8 OS, we share minimum-necessary data with:</p>
          <ul>
            <li><strong>Supabase</strong>: database, auth, storage</li>
            <li><strong>Anthropic</strong>: AI processing (Claude)</li>
            <li><strong>Stripe</strong>: billing</li>
            <li><strong>QuickBooks (optional)</strong>: financial sync, only if you connect it</li>
            <li><strong>Email providers</strong>: to deliver transactional email</li>
            <li><strong>ElevenLabs (optional)</strong>: text-to-speech, only when you press Listen on a reply</li>
            <li><strong>Google or Apple (optional)</strong>: speech-to-text, only while you are dictating, via your browser&rsquo;s built-in microphone feature</li>
          </ul>
          <p className="mt-3">
            <strong>We do not:</strong> sell your data, share it with advertisers,
            use it to train AI models, or share it with anyone not on this list
            without your explicit consent. If we ever add a vendor that processes
            your data, we'll update this list and notify existing customers by
            email if the change is material.
          </p>
        </Sec>

        <Sec title="4. AI processing">
          <p>
            When you use Solomon or any AI tool, we send the prompt and the
            context needed to answer (your relevant business data) to Anthropic's
            API. Anthropic processes the request and returns the answer. Per
            Anthropic's API terms, this data is not used to train models. Like
            any API provider, Anthropic may hold requests for a limited time to
            check for misuse, and then deletes them.
          </p>
        </Sec>

        <Sec title="5. Cookies and tracking">
          <p>
            We use minimal cookies, authentication (so you stay logged in)
            and basic preferences. We do not use third-party advertising cookies,
            tracking pixels, or sell data to data brokers.
          </p>
        </Sec>

        <Sec title="6. Data location">
          <p>
            Your data is stored in Supabase data centres in North America.
            QuickBooks data is processed via Intuit's regional infrastructure.
            Anthropic processes AI requests in the United States. By using
            Eliv8 OS you consent to this cross-border processing.
          </p>
        </Sec>

        <Sec title="7. Retention">
          <p>
            We keep your account data as long as your account is active. If you
            delete your account, your workspace and data are deleted within 30
            days (the window allows for backup rotation). Some legal records
            (billing receipts, audit logs) may be kept longer where required by
            tax or other law.
          </p>
        </Sec>

        <Sec title="8. Your rights">
          <p>You have the right to:</p>
          <ul>
            <li>Access the personal information we hold about you.</li>
            <li>Correct it if it's wrong.</li>
            <li>Delete it (we comply unless legally required to keep it).</li>
            <li>Export it in a machine-readable format.</li>
            <li>Withdraw consent for non-essential processing.</li>
          </ul>
          {/* ⚠️ Said "most of these are self-serve in /settings". Only delete
              is. Export does not exist in the product at all — see the matching
              note on the security page. */}
          <p className="mt-3">
            Deleting your workspace is self-serve, in Settings → Danger zone.
            Export isn't built yet, so for that, or anything else here, email{' '}
            <a href={`mailto:${CONTACT_EMAIL}`} className="text-brand-600 hover:underline">{CONTACT_EMAIL}</a>{' '}
            and we'll handle it within 30 days.
          </p>
        </Sec>

        <Sec title="9. Children">
          <p>
            Eliv8 OS is for businesses. We do not knowingly collect data from
            anyone under 18. If you believe a minor has used the product,
            email us and we will delete the account.
          </p>
        </Sec>

        <Sec title="10. Changes to this policy">
          <p>
            If we change this policy materially, we'll notify customers by email
            and post the change here at least 14 days before it takes effect.
            Minor wording fixes don't trigger a notification.
          </p>
        </Sec>

        <Sec title="11. Contact">
          <p>
            {OPERATOR_LEGAL_NAME} is responsible for your information and has a
            privacy officer who answers for it. Privacy questions, requests, or
            complaints:{' '}
            <a href={`mailto:${CONTACT_EMAIL}`} className="text-brand-600 hover:underline">{CONTACT_EMAIL}</a>.
            We follow Canada&rsquo;s privacy law (PIPEDA) and British
            Columbia&rsquo;s (PIPA). If you believe we have not handled your data
            properly, you can also contact the Office of the Privacy Commissioner
            of Canada (priv.gc.ca) or, in British Columbia, the Information and
            Privacy Commissioner (oipc.bc.ca). If you are in Europe or the UK, you
            have the same rights listed above and can complain to your local data
            protection authority.
          </p>
        </Sec>
      </main>
    </div>
  )
}

function Sec({ title, children }) {
  return (
    <section className="mb-8">
      <h2 className="text-lg font-black text-gray-900 mb-3">{title}</h2>
      <div className="text-gray-700 leading-relaxed text-[15px] [&_strong]:text-gray-900 [&_ul]:list-disc [&_ul]:pl-6 [&_li]:mb-1">
        {children}
      </div>
    </section>
  )
}
