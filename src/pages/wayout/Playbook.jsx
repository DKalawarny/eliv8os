import { Link } from 'react-router-dom'
import WayoutShell from './WayoutShell'
import { WAYOUT_BASE } from '../../lib/wayout/brand'
import { Marked } from '../../lib/wayout/marked.jsx'
import { readableDeep } from '../../lib/wayout/mapContract'

/**
 * ⭐⭐ ONE MOVE, AT A GLANCE (Daniel, 6 Nov 2026: "I like the idea of an
 * overview but it's messy and confusing").
 *
 * The path is where somebody DOES the move, a step at a time. This page is the
 * overview of it: what the move is, the one thing to do first, the steps it is
 * made of (each opens on the path), and the detail folded into cards that open
 * when tapped. The ask box and "I have done this" sit under it (children).
 *
 * ⚠️ Presentation only. It renders whatever the generator returned and nothing
 * it did not: every block is conditional. An empty section is information; a
 * padded one is a lie with a heading on it.
 *
 * ⚠️ WHAT HE LIKED, KEPT (29 Sep, when a plain numbered rebuild was reverted:
 * "I like the yellow highlights, the whole feel before"): the yellow stroke on
 * the title and the warm card for the first thing to do. What changed is the
 * clutter around them, not the character.
 *
 * ⚠️ Every string goes through readableDeep: stored walkthroughs were written
 * before the no-dash rule reached them.
 */
function Fold({ label, count = null, onSection, children, open = false }) {
  return (
    <details className="wayout__ovfold" open={open}>
      <summary>
        <span>{label}{count ? <small>{count}</small> : null}</span>
        <i aria-hidden="true">+</i>
      </summary>
      <div className="wayout__ovbody">
        {children}
        {/* ⭐ Seeds the one conversation at the bottom with what this is about,
            instead of a box per section (seven textareas is a form). */}
        {onSection && (
          <button type="button" className="wayout__ovask" onClick={() => onSection(label)}>
            Ask about this
          </button>
        )}
      </div>
    </details>
  )
}

const STEP_LABEL = { done: 'Done', tried: 'Tried', now: 'Up next', parked: 'Later', blocked: 'Waits on another step', open: '' }

function Content({ play, index, onSection, steps }) {
  const needs = (play.need_first?.length ?? 0) + (play.dont_need_yet?.length ?? 0)
  const money = play.money && (play.money.what_to_charge || play.money.how_you_know || play.money.getting_paid)
  return (
    <>
      <p className="wayout__oveyebrow">Move {index} · overview</p>
      <h2 className="wayout__ovtitle"><Marked text={play.title} derive /></h2>

      {play.thisWeek?.action && (
        <div className="wayout__ovfirst">
          <b>Do this first{play.thisWeek.when ? ` · ${play.thisWeek.when}` : ''}</b>
          <p>{play.thisWeek.action}</p>
          {play.thisWeek.why_first && <span>{play.thisWeek.why_first}</span>}
        </div>
      )}

      {steps?.length > 0 && (
        <section className="wayout__ovsteps">
          <h3>The steps in this move</h3>
          <ol>
            {steps.map(s => (
              <li key={s.id} className={`is-${s.status}`}>
                <Link to={`${WAYOUT_BASE}/path?step=${encodeURIComponent(s.id)}`}>
                  <i aria-hidden="true">{s.status === 'done' || s.status === 'tried' ? '✓' : ''}</i>
                  <span>{s.title}</span>
                  {STEP_LABEL[s.status] && <em>{STEP_LABEL[s.status]}</em>}
                </Link>
              </li>
            ))}
          </ol>
        </section>
      )}

      <div className="wayout__ovfolds">
        {play.words?.script && (
          <Fold label="Words to say" onSection={onSection}>
            {/* The model's context is a sentence ("If anything needs a phone
                call…"), too long for a card title, so it leads inside. */}
            {play.words.context && <p className="wayout__ovctx">{play.words.context}</p>}
            <blockquote className="wayout__pscript">{play.words.script}</blockquote>
          </Fold>
        )}
        {money && (
          <Fold label="The money" onSection={onSection}>
            <dl className="wayout__pfacts">
              {play.money.what_to_charge && <><dt>What to charge</dt><dd>{play.money.what_to_charge}</dd></>}
              {/* Where the figure came from is shown deliberately: it is how a
                  reader tells their own history from a guess. */}
              {play.money.how_you_know && <><dt>How you know</dt><dd>{play.money.how_you_know}</dd></>}
              {play.money.getting_paid && <><dt>Getting paid</dt><dd>{play.money.getting_paid}</dd></>}
            </dl>
          </Fold>
        )}
        {needs > 0 && (
          <Fold label="What you need" count={play.need_first?.length || null} onSection={onSection}>
            {play.need_first?.length > 0 && <ul className="wayout__plist">{play.need_first.map((t, i) => <li key={i}>{t}</li>)}</ul>}
            {/* As important as the list above: most people do not fail from
                under-preparing, they spend weeks on a logo and never start. */}
            {play.dont_need_yet?.length > 0 && (
              <>
                <h4>Not needed yet</h4>
                <ul className="wayout__plist is-skip">{play.dont_need_yet.map((t, i) => <li key={i}>{t}</li>)}</ul>
              </>
            )}
          </Fold>
        )}
        {play.goes_wrong?.length > 0 && (
          <Fold label="What usually goes wrong" count={play.goes_wrong.length} onSection={onSection}>
            {play.goes_wrong.map((g, i) => <div key={i} className="wayout__prisk"><b>{g.what}</b><span>{g.do}</span></div>)}
          </Fold>
        )}
        {/* Name the thing, name who actually knows, do not pretend to be them. */}
        {play.check_first?.length > 0 && (
          <Fold label="Check before you start" count={play.check_first.length} onSection={onSection}>
            {play.check_first.map((c, i) => <div key={i} className="wayout__prisk"><b>{c.thing}</b><span>Ask: {c.who_knows}</span></div>)}
          </Fold>
        )}
      </div>

      {/* What finishing OPENS. "You are done when" is the check above the done
          button (Play.jsx), so it is not repeated here. */}
      {play.opens && (
        <div className="wayout__ovnext"><b>When this is done</b><p>{play.opens}</p></div>
      )}
      {play.disclaimer && <p className="wayout__pfine">{play.disclaimer}</p>}
    </>
  )
}

export default function Playbook({ play: raw, index = 1, children, onSection, notice = null, superseded = false, steps = null }) {
  if (!raw) return null
  const play = readableDeep(raw)
  return (
    <WayoutShell title={`Move ${index}`} wide>
      <div className="wayout__ov">
        {/* At the TOP, where somebody decides to leave. */}
        <p className="wayout__crumb">
          <Link to={`${WAYOUT_BASE}/plan`}>← Back to your plan</Link>
        </p>
        {/* ⭐ A plan that changed since this was written: say so, offer the one
            way forward, and fold the old steps away. They used to fill the page
            faded under the notice, so the first thing to read was something to
            ignore. The week already spent on them is theirs, so they are kept. */}
        {superseded ? (
          <>
            {notice}
            <details className="wayout__ovold">
              <summary>See the old steps</summary>
              <Content play={play} index={index} steps={null} />
            </details>
          </>
        ) : (
          <>
            <Content play={play} index={index} onSection={onSection} steps={steps} />
            {/* The ask box and "I have done this" belong to a current move only:
                on an old one they would ask about, and tick, steps the plan no
                longer has. */}
            {children}
          </>
        )}
      </div>
    </WayoutShell>
  )
}
