import { Link } from 'react-router-dom'
import WayoutShell from './WayoutShell'
import { WAYOUT_NAME, WAYOUT_BASE, WAYOUT_SITE_URL } from '../../lib/wayout/brand'
import { OPERATOR_LEGAL_NAME, OPERATOR_CONTACT, GOVERNING_PROVINCE, LIABILITY_CAP_CAD } from '../../lib/terms'

/**
 * ⭐⭐ UNSTUCK MAP'S OWN TERMS AND PRIVACY — in plain words, for a person.
 *
 * Daniel, 1 Oct: "the safety we need to protect on this app … making sure that
 * it is clear this isn't legal or financial advice, this is the user's choice."
 *
 * 🔴 Until today sign-up linked to Eliv8 OS's terms, which are written for
 * business owners about an AI business advisor — not for somebody being handed
 * a plan about their money, their home and their family.
 *
 * ⚠️ WRITTEN TO BE TRUE, NOT TO BE CLEVER, and it is not a substitute for a
 * lawyer's review — which is still on the list before the first paying user,
 * along with incorporating (the operator here is a person until then; see
 * lib/terms.js, where the operator name and version change together).
 * ⚠️ Every claim about data must match what the code does. If a vendor or a
 * data flow changes, this page changes in the same commit.
 */
export const WAYOUT_LEGAL_UPDATED = '2 November 2026'

function Section({ title, children }) {
  return (
    <section className="wayout__legalsec">
      <h2>{title}</h2>
      {children}
    </section>
  )
}

export function UnstuckTerms() {
  return (
    <WayoutShell title="Terms of use" wide noindex={false} canonicalPath={`${WAYOUT_BASE}/terms`} home>
      <article className="wayout__legal">
        <h1>Terms of use</h1>
        <p className="wayout__fine">Last updated {WAYOUT_LEGAL_UPDATED}. {WAYOUT_NAME} is operated by {OPERATOR_LEGAL_NAME}, {GOVERNING_PROVINCE}, Canada.</p>

        <div className="wayout__legalkey">
          <p><b>The short version.</b></p>
          <ul>
            <li>{WAYOUT_NAME} helps you think through your situation and put your options in an order. It is a planning tool.</li>
            <li><b>It is not legal, financial, tax, investment, medical or mental-health advice</b>, and using it does not make anyone your adviser.</li>
            <li><b>Every decision is yours.</b> Check anything that matters with a qualified professional before you act on it: especially anything to do with money, tax, property, employment or the law.</li>
            <li>Plans and replies are written by AI from what you tell us. They can be wrong, out of date, or miss something about your life.</li>
            <li><b>It is not a crisis service.</b> If you are in danger, call your local emergency number. If you are struggling, a crisis line in your country can help right now <a href="https://findahelpline.com" target="_blank" rel="noreferrer">findahelpline.com</a> lists one near you.</li>
          </ul>
        </div>

        <Section title="1. What this is">
          <p>You answer questions about your situation, and {WAYOUT_NAME} uses AI to write a plan: a few moves, in an order, with what each one depends on. You can tell it what has changed, compare versions of your plan, and ask for help with a move. Nothing here is personalised professional advice, even where it uses your own numbers.</p>
        </Section>

        <Section title="2. Your choices are yours">
          <p>A plan is a suggestion about order, built only from what you told us. You decide what to do with it. Including whether to do nothing. You are responsible for the decisions you make and for checking anything important with someone qualified to advise on it. Where a plan names a kind of professional (an accountant, a lawyer, a financial planner), that is a suggestion about who to ask, not a referral or an endorsement.</p>
          <p>Any figures, returns, costs, timelines, what something might be worth, are rough and general. Nothing here predicts what your money will earn or promises any result.</p>
        </Section>

        <Section title="3. If you are in crisis">
          <p>{WAYOUT_NAME} watches for signs that someone may be in danger and, when it sees them, stops planning and points to real help for your country. It is not monitored by a person, it cannot call anyone for you, and it cannot replace emergency services or a crisis line. If you are in immediate danger, call your local emergency number now.</p>
        </Section>

        <Section title="4. Who can use it">
          <p>You must be 18 or older. Your account is for you; keep your password to yourself. Don't use {WAYOUT_NAME} to break the law, to harm anyone, to get around its limits, or to try to access anyone else's information.</p>
        </Section>

        <Section title="5. Cost">
          <p>Your plan is free. Some features may be paid in future; if so, you will be told the price clearly before you are ever charged, and nothing will be charged without your agreement.</p>
        </Section>

        <Section title="6. No guarantees, and limits on liability">
          <p>{WAYOUT_NAME} is provided as it is, without warranties of any kind. To the extent the law allows, {OPERATOR_LEGAL_NAME} is not liable for any loss or damage that comes from relying on a plan or anything written here, or from decisions you make. Where liability can't be excluded, it is limited to {LIABILITY_CAP_CAD} Canadian dollars. Nothing in these terms limits rights you have under consumer law that can't be limited.</p>
        </Section>

        <Section title="7. Changes, ending, and the law that applies">
          <p>These terms may change as the product does; if they change in a way that matters, you will be asked to agree again. You can stop using {WAYOUT_NAME} and delete your account at any time from your account page. These terms are governed by the laws of {GOVERNING_PROVINCE} and Canada.</p>
        </Section>

        <Section title="8. Contact">
          <p>Questions, or a request to delete your account: <a href={`mailto:${OPERATOR_CONTACT}`}>{OPERATOR_CONTACT}</a>.</p>
        </Section>

        <p className="wayout__fine"><Link to={`${WAYOUT_BASE}/privacy`}>How your information is handled →</Link></p>
      </article>
    </WayoutShell>
  )
}

export function UnstuckPrivacy() {
  return (
    <WayoutShell title="Privacy" wide noindex={false} canonicalPath={`${WAYOUT_BASE}/privacy`} home>
      <article className="wayout__legal">
        <h1>Privacy</h1>
        <p className="wayout__fine">Last updated {WAYOUT_LEGAL_UPDATED}. {WAYOUT_NAME} ({WAYOUT_SITE_URL.replace('https://', '')}) is operated by {OPERATOR_LEGAL_NAME}, {GOVERNING_PROVINCE}, Canada.</p>

        <div className="wayout__legalkey">
          <p><b>The short version.</b> What you tell us is used to write your plan and for nothing else. It is never sold, never shown to anyone else, and only ever visible to your own account.</p>
        </div>

        <Section title="What we keep">
          <ul>
            <li><b>Your account:</b> your email address and a securely stored password.</li>
            <li><b>Your answers:</b> what you tell us about your situation, including money, work, family and where you live.</li>
            <li><b>What we write for you:</b> your plan, its versions, what you say under “Something changed?”, your notes and what you tick off.</li>
            <li><b>The free check:</b> your six taps are recorded without your name, to see which situations people arrive with.</li>
            <li><b>In your browser:</b> answers you give before you have an account are kept in your own browser until you make one, so nothing is lost.</li>
            <li><b>If you invite people:</b> the links you make, any nickname you give a link (only you see it), and how many times each link was opened. We never ask for or keep your friends' email addresses or phone numbers.</li>
            <li><b>If someone invited you:</b> which link brought you here, and your answer to whether they may see that you joined.</li>
            <li><b>How you found us:</b> on your first visit, the website, search or ad that brought you here (for example "google" or a campaign name), never who you are. It tells us which places actually help people, and it is never shared with advertisers.</li>
          </ul>
        </Section>

        <Section title="What it is used for">
          <p>To write and keep your plan, to answer you when you tell us something changed, and to keep the service working and safe (including limits that stop it being misused). We never sell your information, we never share what you tell us with advertisers unless you have said yes, and we do not use it to train AI models. (We do advertise Unstuck Map itself, that never involves your answers.)</p>
        </Section>

        {/* ⚠️ Described by KIND, not by brand. Daniel, 2 Oct: listing vendor names
            "makes it seem less legit". PIPEDA and GDPR ask for the categories of
            who processes data and whether it leaves the country, not names — and
            the list stays true if a provider changes. The current names are
            given to anyone who asks.
            🔴 Never claim the AI provider "keeps nothing": providers hold requests
            briefly for abuse monitoring. What is true, and what is said, is that
            it is not used to train their models. */}
        <Section title="Who handles it for us">
          <p>A small number of trusted service providers do this work for us, under contract:</p>
          <ul>
            <li>A secure cloud database stores your account and your plan.</li>
            <li>An AI provider writes your plan and replies. It receives only what is needed to write them, when they are written, and does not use it to train its models.</li>
            <li>A web hosting provider serves the website.</li>
            <li>An email provider sends any email we send you.</li>
          </ul>
          <p>Some of these store or process information outside Canada, including in the United States. You can ask us for the current list of providers at any time.</p>
        </Section>

        <Section title="Who can see it">
          <p>Only you, through your account. Your plan is never visible to an employer, a partner or anyone else. If you also run a business on Eliv8 OS, you can choose to share a few lines you write yourself with your own Eliv8 OS account. Only those lines go across, only when you press share, and only you can see them there. Nothing else is ever shared.</p>
          <p>If you joined from someone's invite link, they can see that someone joined from it. They see your first name and whether you have made a plan only if you say yes, and you can change that any time. They never see your answers, your numbers or your plan.</p>
        </Section>

        {/* ⭐ 2 Nov 2026. A friend of Daniel's who works with data centres read
            the site and asked where the information is stored, how it is
            secured, and whether people can delete their own account. The
            buttons already existed (Account.jsx); this page still said "email
            us". Each line below is checked against what is actually true:
            database in Oregon, encrypted, row-level security on every Unstuck
            table, daily copies kept 30 days on an encrypted computer
            (scripts/backup-eliv8.mjs, FileVault on). If any of that changes,
            this page changes in the same commit. */}
        <Section title="How it is protected">
          <ul>
            <li>Your information is stored in a secure cloud database in the United States (Oregon). It is encrypted while stored and while it travels between you and us.</li>
            <li>Passwords are never stored as you typed them, only in a scrambled form that cannot be turned back.</li>
            <li>The database only lets each account read its own plans. Nobody signed in as someone else can reach yours.</li>
            <li>A copy is made each day so nothing is lost if something breaks. Copies are kept for 30 days on an encrypted computer that only we use.</li>
            <li>If your information is ever exposed in a way that could harm you, we will tell you and the Privacy Commissioner of Canada as soon as we can.</li>
          </ul>
        </Section>

        <Section title="How long we keep it">
          <p>For as long as you have an account. When you delete it, your plans and answers are removed straight away, and the daily copies that still hold them are gone within 30 days.</p>
        </Section>

        <Section title="Your choices">
          <p>You can correct your answers from your plan at any time. On your <Link to={`${WAYOUT_BASE}/account`}>account page</Link> you can download a copy of everything you have told us, or delete your account and everything in it yourself. You can also email us for either.</p>
        </Section>

        <Section title="Who is responsible">
          <p>{OPERATOR_LEGAL_NAME} is responsible for your information and has a privacy officer who answers for it. Questions, requests or complaints: <a href={`mailto:${OPERATOR_CONTACT}`}>{OPERATOR_CONTACT}</a>. We follow Canada’s privacy law (PIPEDA) and British Columbia’s (PIPA). If you are not happy with our answer, you can complain to the Office of the Privacy Commissioner of Canada (<a href="https://www.priv.gc.ca" target="_blank" rel="noreferrer">priv.gc.ca</a>) or, in British Columbia, the Information and Privacy Commissioner (<a href="https://www.oipc.bc.ca" target="_blank" rel="noreferrer">oipc.bc.ca</a>).</p>
        </Section>

        <Section title="If you live in Europe or the UK">
          <p>We use your information because you asked us to write your plan (to provide the service) and, for anything optional, because you said yes. You have the right to see, correct, download and delete it, to object to how it is used, and to complain to your local data protection authority. Your information is stored and processed in the United States and Canada.</p>
        </Section>

        <p className="wayout__fine"><Link to={`${WAYOUT_BASE}/terms`}>Terms of use →</Link></p>
      </article>
    </WayoutShell>
  )
}
