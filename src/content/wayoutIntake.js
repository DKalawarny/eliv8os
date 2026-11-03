/**
 * The way out — the six intake screens (SPEC §2).
 *
 * ⭐ THE ORDER IS THE PRODUCT, AND IT IS NOT ALPHABETICAL OR CONVENIENT.
 * Constraints come first (S1), then the people affected (S2), then what they
 * already own (S3), then money (S4), then what they would trade (S5), and only
 * at the end where they want to end up (S6). Most products of this shape ask
 * for the dream first because it is the pleasant question. Asking it first
 * produces a plan they cannot follow — and worse, it teaches them to answer the
 * constraint questions in a way that protects the dream they just described.
 *
 * ⚠️ Screens are DATA, not six hand-written components. Six near-identical
 * components is six places for the validation, the reflection card, the back
 * button and the progress count to drift apart, and this is the part of the
 * product most likely to be reworded weekly.
 *
 * Field kinds:
 *   chips       multi-select, with `allowCustom` for "+ Add your own"
 *   choice      single-select
 *   rank        drag to order
 *   number      currency input
 *   text        free text (textarea)
 *   shorttext   free text (single line)
 *
 * `required: true` blocks Next and shows the inline message from `emptyMessage`.
 */

export const WAYOUT_OPENING = {
  headline: 'You’re not stuck. You’re missing the order of the steps.',
  // The word to mark. Must appear verbatim in headline and must not wrap.
  highlight: 'the order',
  // ⚠️ NO COUNT HERE. "Six" already means the six TAPS on the free side; using it
  // again for the six intake screens put two different sixes in one flow, which is
  // the kind of small wrongness that makes somebody wonder what else does not add
  // up. What this screen promises is the plan, so that is what it says.
  lead: 'Honest questions, then a plan built from what you already have, or what you’d be glad to be rid of.',
  field: {
    key: 'out',
    kind: 'text',
    label: 'In one sentence, what does “out” look like for you?',
    placeholder: 'Not clocking in for someone else. Fridays with my kids.',
    hint: 'Rough is fine. Better questions are coming.',
    required: true,
    emptyMessage: 'A sentence is enough.',
  },
  cta: 'Let’s figure it out',
  // 🔴🔴 `fine: 'About 15 minutes.'` LIVED HERE AND WAS WRONG BY FIVE MINUTES.
  // The whole point of moving the time promise into brand.js was that a claim
  // repeated across eight files drifts the next time the flow changes — and this
  // is the proof, because it survived three passes: the greps were for "three
  // minutes" and "six questions", and this said neither.
  // ⭐ The line is composed at render from `timeLine()` and `priceShort()`. There
  // is no time literal in this file any more, which is the only version of this
  // that stays true on its own.
  // ⚠️ The ONLY handwritten line in the entire product (SPEC §6). Caveat is
  // loaded for this one string. If a second one appears, the first stops
  // meaning anything.
  handwritten: 'Not another course. Promise.',
}

const goalKeys = a => (Array.isArray(a?.goalType) ? a.goalType : a?.goalType ? [a.goalType] : []).map(x => x?.key ?? x)
/** Time is one of the things they want. */
export const wantsTime = a => goalKeys(a).includes('time')
/** They want time and did not ask for money. Changes wording only. */
export const onlyTime = a => wantsTime(a) && !goalKeys(a).includes('money')

export const WAYOUT_SCREENS = [
  // ── S1 ────────────────────────────────────────────────────────────────────
  {
    id: 's1',
    section: 'The constraints',
    why: 'Your plan has to work around these, so it helps to be honest about which ones are truly fixed.',
    question: 'What can’t change right now?',
    // No reflection card before the first screen — there is nothing to reflect
    // on yet, and a card here would have to be generic, which teaches the user
    // to skip all of them.
    reflectAfter: true,
    fields: [
      {
        /**
         * 🔴🔴 THE COUNTRY WAS NEVER ASKED HERE. It only arrived if somebody had
         * tapped it on the free check's last screen — two of the first four
         * finished plans had none, so a crisis reply for them could only say
         * "findahelpline.com". Daniel, 1 Oct: "make sure any numbers are given to
         * their area or at least country — that's why it's important to get that
         * info at the start." So it is the first thing asked, and required.
         * ⚠️ Keys must match crisisLines.js — a test fails if an option here has
         * no entry there (other than "other").
         */
        key: 'region',
        kind: 'choice',
        label: 'Which country do you live in?',
        hint: 'It decides which numbers and services we point you to, including the ones that matter most if things get hard.',
        required: true,
        emptyMessage: 'Pick the closest one.',
        options: [
          { key: 'ca', label: 'Canada' },
          { key: 'us', label: 'United States' },
          { key: 'uk', label: 'United Kingdom' },
          { key: 'ie', label: 'Ireland' },
          { key: 'au', label: 'Australia' },
          { key: 'nz', label: 'New Zealand' },
          { key: 'other', label: 'Somewhere else' },
        ],
      },
      {
        // ⚠️ 9 Oct: moved here from screen five, straight after the country, so
        // "where do you live" is asked once and reads as one question.
        key: 'locationText',
        // ⭐ A written answer somebody might rather say out loud. Opt-in, so a
        // microphone never turns up beside a name or an age.
        dictate: true,
        kind: 'shorttext',
        label: 'What town or area do you live in?',
        hint: 'If your work is somewhere else or online, say that too. Your area and its seasons change what is possible.',
        placeholder: 'Nanaimo BC · remote, clients in the US · two weeks on in Alberta',
        required: true,
        emptyMessage: 'Roughly is fine.',
      },
      {
        key: 'immovables',
        kind: 'chips',
        // ⚠️ 9 Oct: had NO label, so the chips floated under the screen title with
        // nothing saying what they answer. Angela: "what is this asking?"
        label: 'What ties you to where you are now? Tap any that apply.',
        allowCustom: true,
        required: true,
        emptyMessage: 'Add at least one.',
        options: [
          { key: 'kids-home', label: 'Kids at home' },
          { key: 'custody', label: 'Shared custody' },
          { key: 'parent', label: 'Aging parent' },
          { key: 'partner-job', label: 'Partner’s job' },
          { key: 'health', label: 'Caring for someone who is unwell' },
          { key: 'lease', label: 'Lease / mortgage' },
          { key: 'legal', label: 'A legal agreement' },
          { key: 'partners', label: 'Business partners' },
          { key: 'faith', label: 'A community here' },
          // 🔴 THIS WAS MISSING AND THE FIELD IS REQUIRED, so someone genuinely
          // unconstrained could not get past screen one without inventing a
          // tie. On the screen whose entire job is "tell me the truth about
          // what is fixed", the form was insisting there had to be something.
          //
          // ⚠️ Exclusive: "Nothing" and "Shared custody" cannot both be true,
          // and a plan built from a contradiction is worse than one built from
          // a blank.
          { key: 'nothing', label: 'Nothing, really', exclusive: true },
        ],
      },
      {
        key: 'immovablesNote',
        /**
         * ⭐⭐ CONDITIONAL. This asks which of the chips above are truly fixed —
         * meaningless to somebody who ticked "Nothing, really", and asking it
         * anyway is how a form teaches people it is not reading their answers.
         */
        showIf: a => (a.immovables ?? []).some(x => (x.key ?? x) !== 'nothing'),
        kind: 'text',
        label: 'Of the ones you tapped, could any of them actually change if you wanted?',
        placeholder: '',
        required: false,
      },

      // ⭐⭐ TWO PROFILE FIELDS, ASKED NEUTRALLY, WITH A REAL "DOESN'T APPLY".
      //
      // Daniel's framing, and it is the right one: a question is not an
      // assertion. A four-box FAMILY · FRIENDS · FINANCE · FAITH grid on a
      // screen a stranger sees would be announcing something at the door —
      // the exact move he reversed on the other product three times, where the
      // line that settled it was "a promise not to preach is still preaching".
      // A field with N/A announces nothing and sorts nobody.
      //
      // ⭐ And the payoff here is practical, not philosophical: BOTH OF THESE
      // ARE CONSTRAINTS ON THE WEEK, which is what this screen is for. Faith is
      // usually a standing commitment — a Sunday morning, a Friday prayer, a
      // Wednesday evening — and a plan that books door-knocking across it is a
      // plan that gets abandoned in week two. Health is the ceiling on what
      // anyone can take on, and it is the constraint that quietly ends plans.
      //
      // 🔴 COLLECTED DISCREETLY, USED BEHAVIOURALLY, NEVER SAID BACK. The map
      // must never open with "as a Christian" or "given your back" — it simply
      // does not schedule work on a Sunday morning, and does not propose
      // hauling to someone who told us they cannot lift. Shown back as a label
      // it becomes the thing it was carefully not being.
      //
      // ⚠️ FREE TEXT, NOT A PICKER. A list of faiths is a list someone can be
      // missing from, and being absent from it is its own small insult. The
      // same goes for a dropdown of conditions.
      {
        key: 'faith',
        kind: 'chips',
        label: 'Do you have a faith or practice that takes up part of your week?',
        hint: 'If you do, your plan will not book work over that time.',
        required: false,
        options: [
          { key: 'yes', label: 'Yes' },
          { key: 'na', label: 'Doesn’t apply', exclusive: true },
        ],
      },
      {
        key: 'faithNote',
        // ⭐ A written answer somebody might rather say out loud. Opt-in, so a
        // microphone never turns up beside a name or an age.
        dictate: true,
        // ⚠️ Only when they said yes. Asking "which, and anything in your week it
        // holds" of somebody who just answered "doesn't apply" is the form not
        // listening, on the screen where being listened to matters most.
        showIf: a => a.faith === 'yes' || (a.faith ?? []).includes?.('yes'),
        kind: 'shorttext',
        label: 'Which one, and what part of your week does it take?',
        placeholder: 'Which, and anything in your week it holds',
        required: false,
      },
      {
        // ⚠️ Daniel: "meant more about exercise, getting in shape — that can be
        // part of being stuck. The idea is that this helps your whole life."
        // Framing it only as a limitation missed half of it: for a lot of
        // people getting their body back IS the way out, or the thing that has
        // to happen before anything else will hold.
        key: 'health',
        kind: 'chips',
        label: 'Is your health part of this?',
        hint: 'Tap if something limits what you can take on, or if getting fitter is one of your goals.',
        required: false,
        options: [
          { key: 'limits', label: 'Something limits me' },
          { key: 'goal', label: 'Getting fitter is part of it' },
          { key: 'energy', label: 'I’m worn out' },
          { key: 'na', label: 'Doesn’t apply', exclusive: true },
        ],
      },
      {
        key: 'healthNote',
        // ⭐ A written answer somebody might rather say out loud. Opt-in, so a
        // microphone never turns up beside a name or an age.
        dictate: true,
        showIf: a => {
          const v = a.health
          const picked = Array.isArray(v) ? v : v ? [v] : []
          return picked.some(x => (x.key ?? x) !== 'na')
        },
        kind: 'shorttext',
        label: 'Anything your plan should know about it?',
        placeholder: 'Only as much as you want to say',
        required: false,
      },
    ],
      },

  // ── S2 ────────────────────────────────────────────────────────────────────
  {
    id: 's2',
    section: 'Who it has to work for',
    why: 'Your plan has to work for the people in your life too, so a few quick questions about you and them.',
    question: 'Tell us about you and the people around you.',
    reflectAfter: false,
    fields: [
      // 🔴 THE PLAN IS ADDRESSED TO THEM AND WE WERE INVENTING BOTH OF THESE.
      // The design reference's own map header reads "Jake, 23. Nanaimo." — a
      // name and an age we never asked for. Age in particular changes the
      // horizon, the acceptable risk and what is realistic more than almost
      // anything else on this form.
      {
        key: 'name',
        kind: 'shorttext',
        label: 'What’s your first name?',
        required: true,
        emptyMessage: 'Just a first name.',
      },
      {
        key: 'age',
        kind: 'shorttext',
        label: 'How old are you?',
        placeholder: '',
        required: true,
        emptyMessage: 'Roughly is fine.',
      },
      {
        // ⭐ Every move about the job you already have — the raise, the shift,
        // four days, contracting back — depends on this, and we were guessing.
        // "Ask for a four-day week" is meaningless to someone self-employed.
        key: 'workType',
        kind: 'choice',
        label: 'What kind of work do you do now?',
        required: true,
        emptyMessage: 'Pick the closest one.',
        options: [
          { key: 'employed', label: 'Employed' },
          { key: 'self', label: 'Self-employed' },
          { key: 'contract', label: 'Contract' },
          { key: 'casual', label: 'Casual or shifts' },
          { key: 'seasonal', label: 'Seasonal' },
          { key: 'none', label: 'Not working right now' },
        ],
      },
      {
        key: 'relationship',
        kind: 'choice',
        // 🔴 THIS HAD NO LABEL, so its chips rendered directly under the
        // "What kind of work?" group and read as answers to it — "Employed,
        // Self-employed, Contract, Casual or shifts, Seasonal, Not working right
        // now, Single, Partnered…" as one list. Daniel, on the live page:
        // "mixed question". Every `kind: choice` needs its own heading or it
        // silently joins the one above it.
        label: 'Do you have a partner, and how do they feel about a change?',
        required: true,
        emptyMessage: 'Pick the closest one.',
        options: [
          { key: 'single', label: 'Single' },
          { key: 'aligned', label: 'Partnered, on the same page' },
          { key: 'nervous', label: 'Partnered, they’re nervous' },
          { key: 'against', label: 'Partnered, they’re against it' },
        ],
      },
      {
        key: 'kidsAges',
        // ⚠️ 9 Oct: kids were asked twice ("Kids at home" on screen one, then
        // "Do you have kids?"). Now only the ages, and only when they said so.
        showIf: a => (a.immovables ?? []).some(x => ['kids-home', 'custody'].includes(x?.key ?? x)),
        allowCustom: true,
        kind: 'chips',
        label: 'How old are your kids?',
        required: false,
        options: [
          { key: '0-4', label: '0–4' },
          { key: '5-11', label: '5–11' },
          { key: '12-17', label: '12–17' },
          { key: 'adult', label: 'Adult' },
        ],
      },
      {
        /* ⭐⭐ ONE BOX FOR THE PEOPLE, 9 OCT. It was two: "what does your partner
           want?" and "who will fight this plan?". Both treated family as an
           obstacle to plan around, which is how a hustle app thinks. Daniel
           asked for a family question "to keep in line with not being a hustle
           app", and for a shorter intake, so this asks what the plan is FOR
           them and who will push back, in one answer. Key stays `peopleNote`
           (the chapter flow reuses it); older sessions may also hold
           `partnerWants`, and the prompt still reads it. */
        key: 'peopleNote',
        kind: 'text',
        label: 'The people closest to you: what do you want this to give them, and will anyone push back?',
        hint: 'If it is only you, say what it gives you back.',
        placeholder: 'Be at the games. My wife is nervous about money, my dad thinks I’m crazy.',
        required: false,
      },
    ],
  },

  // ── S3 ────────────────────────────────────────────────────────────────────
  // ⭐ The screen the whole product turns on — and the one most likely to lose
  // someone, because it is where they find out whether this thing is for people
  // like them.
  //
  // 🔴 THE FIRST VERSION OF THIS LIST SORTED PEOPLE AT THE DOOR. It was truck,
  // trailer, mower, pressure washer, garage, land, home equity — a list for
  // someone rural or suburban who owns a vehicle and property. A nurse renting
  // a flat, a parent with school hours and no car, someone with a laptop and
  // three free evenings: they tap nothing, on the screen built to tell them
  // they have more than they think, and correctly conclude this is not for
  // them. Same failure as targeting by identity, just wearing overalls.
  //
  // So the groups are the fix, not more chips. They say out loud that a skill,
  // an evening and a person who would sub you work all count as things you
  // already have — which is true, and is usually the faster move for anyone
  // without a driveway.
  //
  // ⚠️ "have", not "own". Owning is a property word, and half of this list is
  // not property.
  {
    id: 's3',
    section: 'What you can start from',
    why: 'Things you own, things you can do, and time you could spare. Most people have more than they think, and the first step usually starts here.',
    question: 'What do you already have that could make money?',
    // ⭐⭐ 10 OCT: A PERSON WHO CAME FOR TIME IS NOT ASKED WHAT COULD MAKE MONEY
    // FIRST. A friend who went through it read the product as "for people
    // starting a business", and this screen is where that reading comes from.
    // Daniel: it is "about getting out of a situation you don't want to be in.
    // That could be even working too much and no time for family."
    // ⚠️ `goalType` is usually known by here, carried from the first tap.
    questionFor: a => onlyTime(a) ? 'What takes your time, and what do you have to work with?' : null,
    whyFor: a => onlyTime(a) ? 'To get time back, your plan has to know where it goes now. Then what you have that could help.' : null,
    reflectAfter: true,
    fields: [
      {
        // ⚠️ NOT REQUIRED, deliberately. `intakeIsComplete` walks required
        // fields, so a required one added today would send everybody who
        // already finished and wants more time back into the questions.
        key: 'timeEaters',
        showIf: a => wantsTime(a),
        kind: 'chips',
        label: 'What takes up most of your week? Tap any that apply.',
        hint: 'Your plan looks here first for hours to give back.',
        allowCustom: true,
        required: false,
        options: [
          // ⚠️ Keys chosen to be things nobody writes. mapContract treats a
          // hyphenated chip key found in a plan as our label leaking, so a key
          // like "second-job" would flag an ordinary sentence.
          { key: 'work-long', label: 'Long hours at my job' },
          { key: 'work-travel', label: 'Getting to and from work' },
          { key: 'work-second', label: 'A second job or side work' },
          { key: 'work-own', label: 'My own business' },
          { key: 'care-kids', label: 'Looking after kids' },
          { key: 'care-family', label: 'Looking after a parent or family' },
          { key: 'home-running', label: 'Running the house' },
        ],
      },
      {
        // 🔴 The plan is a sequence and we were asking the horizon in YEARS
        // while never asking how many hours a week exist to build it in. Five
        // hours and twenty-five hours are different plans, not the same plan
        // at different speeds.
        key: 'hoursPerWeek',
        kind: 'choice',
        // 🔴 "hours a week to what? doesn't say."
        label: 'How many spare hours a week could you put toward this?',
        hint: 'Time outside your job and the things you have to do, like evenings or a weekend morning. Your plan will not ask for more than this.',
        required: true,
        emptyMessage: 'Pick the closest one.',
        options: [
          { key: '0-5',   label: 'Under 5' },
          { key: '5-10',  label: '5 to 10' },
          { key: '10-20', label: '10 to 20' },
          { key: '20+',   label: 'More than 20' },
        ],
      },
      {
        key: 'assets',
        kind: 'chips',
        // ⚠️ 9 Oct: had NO label and sat straight under the hours question, so
        // its hint read as describing these. Angela: "what is this asking? The
        // choices are things... vehicle, boat".
        label: 'What do you have that could earn money? Tap anything that applies.',
        labelFor: a => onlyTime(a) ? 'What do you have that could help? Tap anything that applies.' : null,
        hint: 'Things you own, space you have, things you are good at, and people who could send you work.',
        allowCustom: true,
        required: true,
        emptyMessage: 'Add at least one. Everyone has something here. It is not only tools and trucks.',
        groups: [
          {
            label: 'Vehicles and gear',
            options: [
              { key: 'truck', label: 'Truck or van' },
              { key: 'trailer', label: 'Trailer' },
              { key: 'car', label: 'A car' },
              { key: 'tools', label: 'Tools' },
              { key: 'mower', label: 'Mower' },
              { key: 'pressure-washer', label: 'Pressure washer' },
              { key: 'camera', label: 'Camera' },
              { key: 'boat', label: 'Boat / jet ski' },
            ],
          },
          {
            label: 'Space',
            options: [
              { key: 'spare-room', label: 'Spare room' },
              { key: 'garage', label: 'Garage' },
              { key: 'parking', label: 'Driveway or parking' },
              { key: 'land', label: 'Land / yard' },
              { key: 'home-equity', label: 'Home equity' },
            ],
          },
          {
            label: 'What you can do',
            options: [
              { key: 'licence', label: 'A ticket or licence' },
              { key: 'trade', label: 'A trade' },
              { key: 'admin', label: 'Books or admin' },
              { key: 'computers', label: 'Good with computers' },
              { key: 'design', label: 'Design or writing' },
              { key: 'teaching', label: 'Teaching or tutoring' },
              { key: 'care', label: 'Care or medical' },
              { key: 'cooking', label: 'Cooking' },
              { key: 'language', label: 'Another language' },
              { key: 'business', label: 'A business already' },
            ],
          },
          {
            // ⚠️ 9 Oct: Evenings / Weekends / School hours left this list. The
            // hours question above already asks about spare time.
            label: 'People who could send you work',
            options: [
              { key: 'sub-work', label: 'Someone who’d sub me work' },
              { key: 'employer', label: 'An employer who’d contract me' },
              { key: 'audience', label: 'A group or following' },
            ],
          },
        ],
      },
      /* ⭐⭐ MOVED OFF SCREEN 5 ON 28 SEP, AND THE REASON IS THE CURVE, NOT THE
         CATEGORY. Measured: screen five had SEVEN required answers on one page —
         two of them essays and one a ranking exercise — arriving straight after
         the 231-word money screen. It is the heaviest thing in the product by a
         distance and it sits two thirds of the way in, which is exactly where
         somebody decides whether to finish.
         ⚠️ These three are TAPS. They were making a hard screen longer while
         adding no thinking, and each of them reads more naturally here anyway. */
      {
        // ⭐ These two catch what no list can. They are the most universal part
        // of the screen — everyone has been asked for help with something — and
        // they are what the seen card is usually built from, because they are
        // the person's own words rather than our labels.
        // ⚠️ ONE BOX SINCE 9 OCT; it was two ("ask you for help" and "paid
        // for, even once"). Older sessions still hold `paidFor`.
        key: 'askedFor',
        kind: 'text',
        label: 'What do people ask you for help with, or have paid you for, even once?',
        placeholder: 'Fixing stuff. Hauling. A neighbour paid me twice to wash his driveway.',
        required: false,
      },
    ],
  },

  // ── S4 ────────────────────────────────────────────────────────────────────
  {
    id: 's4',
    section: 'The arithmetic',
    /**
     * ⭐⭐ THE REASONING LIVES HERE NOW, ONCE. Daniel, on this screen: "say it
     * only on one section." Four fields each carried a paragraph explaining why
     * the number mattered — housing being the line plans move, the rate being
     * what makes a debt worth clearing, the cut list needing nobody's
     * permission. Every one of them was true and interesting, and together they
     * turned a form into an essay with inputs in it.
     * ⚠️ A field hint's job is to tell somebody HOW to answer. The reason to
     * answer at all belongs to the section, said once, where it reads as the
     * point of the screen rather than as the form defending itself.
     */
    why: 'Rough numbers are fine. Your plan is built from these figures.',
    question: 'What comes in and what goes out?',
    reflectAfter: false,
    fields: [
      {
        key: 'takeHome',
        kind: 'number',
        // 🔴 "Monthly take-home" alone was ambiguous, and S2 has already
        // established there may be a partner. Yours or the household's changes
        // the quit number — the single figure the whole plan aims at — and
        // nothing told us which one we had been given.
        label: 'How much do you take home each month?',
        hint: 'What actually lands in your account, after tax. Just yours. The household comes next.',
        required: true,
        emptyMessage: 'A rough number is fine.',
      },
      {
        // 🔴 Daniel: "missing major payments, mortgage etc". The label said
        // "must-pay" and left people guessing what counted, so the single most
        // important number on the form was being answered inconsistently.
        key: 'mustPay',
        kind: 'number',
        label: 'What do you have to pay every month, no matter what?',
        hint: 'Rent or mortgage, insurance, utilities, phone, food, fuel, childcare, loan and card minimums, child support. Everything that happens whether you like it or not.',
        required: true,
        emptyMessage: 'A rough number is fine.',
      },
      {
        key: 'householdTakeHome',
        kind: 'number',
        label: 'Does anyone else in your home bring in money? How much a month?',
        hint: 'Leave it blank if it is only you.',
        // ⭐ 2 Nov 2026 (Daniel: "can you get the same results with cutting more
        // questions?"): a single person's answer is always "no one".
        showIf: a => !!a.relationship && a.relationship !== 'single',
        required: false,
      },
      {
        key: 'savings',
        kind: 'number',
        label: 'How much savings could you get to if you needed it?',
        hint: 'Cash you could reach without a penalty.',
        required: false,
      },
      {
        // ⭐⭐ THE ONE LINE INSIDE MUST-PAY THAT ANY PLAN WILL WANT TO MOVE.
        //
        // Daniel: "what do you think about adding what you'll need once these
        // bills are gone?" The answer needs the split, and `mustPay` is a
        // single total — so the product has had to write "we cannot know what
        // is left of your $5,000 once the house goes, go and work it out",
        // which is honest and is a worse answer than knowing.
        //
        // ⚠️ HOUSING, NOT THE HOUSE. It is the biggest line in almost
        // everybody's must-pay and it is the one a plan most often changes:
        // selling, downsizing, moving somewhere cheaper, renting a room,
        // owning outright. Asking it once here means every one of those moves
        // can be sized in arithmetic instead of in a promise to find out.
        //
        // ⚠️ Optional, and a total. Nobody is being asked to itemise — a rough
        // number is enough to turn "you will need less" into a figure, and
        // asking for a breakdown here is how somebody abandons a form.
        key: 'housingCost',
        // ⭐ 2 Nov 2026: only asked of someone who said they could move. It is
        // there to price a move; for anybody tied down it is a question with no use.
        showIf: a => (a.immovables ?? []).some(x => (x?.key ?? x) === 'nothing'),
        kind: 'number',
        label: 'Of what you pay each month, how much is for your home?',
        hint: 'Rent or mortgage plus property tax, insurance, heat and hydro.',
        required: false,
      },
      {
        // 🔴🔴 THIS FIELD DID NOT EXIST, AND DEBT IS OFTEN THE WHOLE PROBLEM.
        // `mustPay` swallows the minimum PAYMENTS inside its total, so the plan
        // could see that money left every month and never that clearing a
        // balance would stop it — which makes the single most powerful move
        // available to an indebted person invisible.
        //
        // ⭐⭐ AND THE RATE IS THE POINT, WHICH IS WHY IT IS ASKED FOR IN THE
        // LABEL RATHER THAN HOPED FOR. Daniel: "your vehicle payment is x,
        // interest is x — you could instead of paying off, invest this amount
        // and the interest from the investment pays for this. Credit cards are
        // high interest so those typically would have to go." Clearing a debt
        // is a guaranteed return equal to its rate. Without the rate that
        // comparison cannot be made at all; with it, it makes itself.
        //
        // ⚠️ Free text, not a number, and optional. People carry several debts
        // at different rates, most do not know all of them, and a required
        // field here would stop somebody at the exact question that embarrasses
        // them most.
        key: 'debt',
        kind: 'text',
        label: 'Do you owe money? Roughly how much, and at what interest rate?',
        hint: 'For example: $8,000 on a credit card at 20%. Your statement will show the rate.',
        placeholder: '$30k on cards at about 21%, $22k left on the truck at 4%',
        required: false,
      },
      {
        // ⭐ HOW BOLD THE PLAN IS ALLOWED TO BE. A 23-year-old's downside on a
        // failed first move is a wasted Saturday. A 52-year-old's is his
        // family's security. Same plan shape, completely different acceptable
        // risk — and until now the product would have spoken to both with the
        // same confidence.
        key: 'atStake',
        kind: 'choice',
        label: 'If the first thing you try doesn’t work, what does it cost you?',
        hint: 'This tells your plan how careful to be.',
        required: true,
        emptyMessage: 'Pick the closest one.',
        options: [
          { key: 'time', label: 'Some wasted weekends' },
          { key: 'savings', label: 'Money I’d rather not lose' },
          { key: 'security', label: 'My family’s security' },
          { key: 'cannot-fail', label: 'It can’t fail, there’s no cushion' },
        ],
      },
      {
        key: 'discretionary',
        kind: 'chips',
        /* ⭐ THE TAP IS THE CONSENT, 9 OCT. It was two steps: tap what you
           spend on, then write "which of those would you actually miss?". One
           tap now says the same thing, and says it more plainly: a picked item
           is one they said can go. Older sessions hold `fiveYearTest` instead. */
        label: 'What do you spend on that you would not miss? Tap any.',
        hint: 'Only what you tap can go on the cut list. Nothing else gets touched.',
        allowCustom: true,
        required: false,
        options: [
          { key: 'eating-out', label: 'Eating out' },
          { key: 'subscriptions', label: 'Subscriptions' },
          { key: 'vehicle', label: 'The vehicle' },
          { key: 'gym', label: 'Gym / hobbies' },
          { key: 'nights-out', label: 'Nights out' },
          { key: 'shopping', label: 'Shopping' },
          // Not everyone has slack. Saying so out loud matters here: the cut
          // list is where most plans find their first money, and someone with
          // nothing to cut should be told that is an answer, not a failure.
          { key: 'none', label: 'I’d miss all of it, or there isn’t any', exclusive: true },
        ],
      },
    ],
  },

  // ── S5 ────────────────────────────────────────────────────────────────────
  {
    id: 's5',
    section: 'What it can cost you, and what’s realistic',
    why: 'This helps your plan decide what comes first, and what to protect.',
    question: 'What matters most to you?',
    reflectAfter: true,
    fields: [
      {
        // ⭐⭐ 2 NOV 2026: ONE TAP SCREEN, NOT NINE SCORES. Daniel had asked for
        // 1 to 10 scores ("not arrows"), and on the one-question-per-screen
        // redesign it became nine screens; asked whether the plan could get the
        // same result with fewer questions, he agreed to this. The plan only ever
        // used the scores to know what not to trade away, and that is exactly
        // what this asks. Older plans keep `tradeRank` and are still read.
        key: 'protect',
        kind: 'chips',
        label: 'Which of these would you protect, even if it slowed things down?',
        hint: 'Tap any. Your plan will not trade these away.',
        required: true,
        emptyMessage: 'Tap at least one.',
        options: [
          { key: 'comfort', label: 'Comfort, the standard of living you’re used to' },
          { key: 'space', label: 'Space: room in the house, a yard, somewhere to work' },
          { key: 'stability', label: 'Stability, knowing what’s coming in each month' },
          { key: 'status', label: 'Status, how it looks to other people' },
          { key: 'savings', label: 'Savings, the cushion staying where it is' },
          { key: 'family-proximity', label: 'Being near family' },
          { key: 'time-with-people', label: 'Time with the people you love' },
          { key: 'health', label: 'Your health and fitness' },
          { key: 'community', label: 'A community you’re part of' },
        ],
      },
      {
        // ⭐ Without this the plan can confidently hand someone the exact thing
        // that already failed them, which ends their trust in the rest of it.
        // It is also where the real reason usually surfaces — most things do
        // not fail because they were the wrong idea.
        key: 'alreadyTried',
        kind: 'text',
        label: 'What have you already tried, and what happened?',
        placeholder: 'Even something that only lasted a month.',
        // 🔴 REQUIRED as of 27 Sep. Without it the plan hands back what already
        // failed, which is the single most trust-destroying thing this product
        // can do — proven when the second-plan work shipped and a refused raise
        // came straight back in chapter two until the history was fed in.
        required: true,
        nudge: true,
        nudgeMessage: 'A little more here helps. What happened and why it stopped keeps the plan from suggesting it again, and if it is nothing yet, what has been in the way.',
        emptyMessage: 'Even “nothing yet” tells the plan something.',
      },
      {
        // ⭐ A plan whose first move they will never start is worth nothing.
        // Someone who will not knock on doors will not knock on doors, and no
        // amount of good sequencing survives that.
        key: 'refuse',
        kind: 'text',
        /**
         * 🔴 "don't like the wording." "Whatever it paid" is a dare — it invites
         * somebody to prove they are not precious rather than to answer, and the
         * people most likely to under-answer it are exactly the ones whose first
         * move then gets built on something they will quietly never start.
         * ⭐ The honest version asks about the plan, not about their character.
         */
        label: 'Is there anything you would never do, even if it worked?',
        placeholder: 'Cold calling. Managing staff again. Anything that means weekends.',
        // 🔴 REQUIRED as of 27 Sep. A plan containing something they would never do is
        // not a plan, it is a list they will close — and this is the only field
        // that stops it being written.
        required: true,
        emptyMessage: 'One thing. It shapes what gets crossed off.',
      },
    ],
  },

  // ── S6 ────────────────────────────────────────────────────────────────────
  {
    id: 's6',
    section: 'Where it ends up',
    why: 'Your way out, in your own words. Your plan works backwards from here, so the more detail you give, the more it fits you.',
    question: 'Where do you want to be?',
    reflectAfter: false,
    fields: [
      /* ⭐⭐ MOVED OFF SCREEN 5 ON 28 SEP, AND THE REASON IS THE CURVE, NOT THE
         CATEGORY. Measured: screen five had SEVEN required answers on one page —
         two of them essays and one a ranking exercise — arriving straight after
         the 231-word money screen. It is the heaviest thing in the product by a
         distance and it sits two thirds of the way in, which is exactly where
         somebody decides whether to finish.
         ⚠️ These three are TAPS. They were making a hard screen longer while
         adding no thinking, and each of them reads more naturally here anyway. */
      {
        // ⭐⭐ THE HIGHEST-YIELD QUESTION ON THE FORM, AND IT IS NOW ASKED FIRST
        // ON THIS SCREEN. Daniel: "one question on intake should be what do you
        // want out of life, what's it look like, let's help you plan it out —
        // something like that will give lots of insight."
        //
        // 🔴 IT USED TO COME AFTER `goalType`, WHICH IS A LIST OF CATEGORIES:
        // More time · More money · Something simpler. Asking somebody to tick
        // those and THEN describe their life gets the categories back in
        // sentence form. An open question asked second is not an open question.
        //
        /**
         * 🔴🔴 "A TUESDAY" IS GONE FROM WHAT ANYBODY READS. Daniel, on a plan
         * that came back saying "the thing between you and Tuesday is sequence,
         * not resources": "this last sentence doesn't make sense — you and
         * tuesday. Cut that stuff out."
         *
         * ⭐⭐ THE DEVICE WAS OURS, NOT THEIRS. Picking an arbitrary weekday is a
         * writing trick for getting a specific answer instead of "happy and
         * free" — and it works. But the moment the word travels back out of the
         * product it is a private reference the reader was never in on, and it
         * reads as the machine talking to itself. The key stays `tuesday` because
         * renaming it would strand every stored session; nothing a person sees
         * says it.
         *
         * ⚠️ THE SPECIFICITY IS KEPT — it is the whole value of the question. It
         * is now carried by the hint asking for the ordinary detail, which is
         * what was doing the work anyway.
         *
         * 🔴 AND THE EXAMPLE WAS "AI TALK". Daniel: "up at 7 without an alarm —
         * that's more AI talk, don't like it." He is right about why: it is a
         * lifestyle-brand morning, not a life. Nobody describes their own day in
         * a rising tricolon. The replacement is flatter, has a job and a
         * complication in it, and sounds like somebody answering a question
         * rather than writing copy about themselves.
         */
        key: 'tuesday',
        kind: 'text',
        /* ⭐⭐ THE FIRST RUNG OF A LADDER, 9 OCT. Daniel, after family testing:
           "its suppose to give a way out so do we ask that question what is your
           way out whats your end goal 1,5,10 year". This was ONE picture at
           three years; it is now the one-year rung, and the three moves aim at
           it. Five and ten sit below it as the longer arc the moves must not
           work against. The key stays `tuesday` so the prompts, the chapter
           flow and every stored session keep reading it as the destination. */
        label: 'A year from now, what’s different? Where are you, doing what, with who?',
        hint: 'This is the one the plan aims at, so take a minute. An ordinary day, not a holiday: what you get up for, who is around, what you are doing by mid-morning.',
        placeholder: 'Out of debt. Not working Saturdays. Home when the kids get in.',
        required: true,
        emptyMessage: 'A few lines is enough.',
        nudge: true,
        nudgeMessage: 'Say a bit more if you can. The whole plan aims at this one, so the more of the day you describe, the more the plan is yours.',
      },
      /* ⭐ `fiveYears` and `tenYears` LEFT ON 2 NOV 2026 (Daniel: "can you get
         the same results with cutting more questions?"). The plan aims at the
         one-year day; the longer arc was read only as "never contradict it",
         and the open box at the end catches anyone for whom it matters. Older
         answers that carry them are still read. */
      /* ⚠️ `horizon` ("how long before you want to be there?") LEFT THIS SCREEN
         ON 9 OCT. With the ladder the rungs ARE the timing, and a 6m/1y/3y/5y
         pick under "a year from now" asked the same thing twice and could
         contradict it. The diagnostic still carries one in when they gave it,
         and the prompt reads it as how fast the first rung has to show. */
      {
        // ⭐ THE AXIS THAT WAS MISSING ENTIRELY, and the product did worse than
        // ignore it: the map check FLAGGED a plan as broken when someone in a
        // cold climate had an outdoor first move and no winter work. For the
        // landscaper who earns twelve months of money in six and spends the
        // winter somewhere warm, the December hole IS the plan — and we would
        // have looked at his correct answer and called it a failure.
        // 🔴 "what shape of year — terribly worded."
        key: 'yearShape',
        kind: 'choice',
        label: 'Would you rather earn the same every month, or is earning more in busy seasons okay?',
        hint: 'Some work is busy for part of the year and quiet the rest. That suits some people and not others.',
        required: true,
        emptyMessage: 'Pick the closest one.',
        /**
         * 🔴 "weird options" — Daniel, and the fault is that one of them did not
         * answer the question. The question asks about the SHAPE of the money:
         * evenly, or in bursts. "Fewer hours every week, all year" is an answer
         * about HOURS — it does not say whether the money arrives evenly, and
         * somebody who wants both has to pick between two things that are not
         * alternatives.
         * ⭐ Hours are already asked properly on the work screen, so the option
         * was also collecting an answer we had. Replaced with the third real
         * shape of a year: one big payday that has to last.
         */
        options: [
          { key: 'steady', label: 'Evenly, the same every month' },
          { key: 'seasonal', label: 'In bursts, flat out, then time off' },
          { key: 'lumpy', label: 'One big payday I make last' },
          { key: 'dontmind', label: 'Don’t mind' },
        ],
      },
      {
        // 🔴 Same correction as the diagnostic: people want several of these at
        // once, and a plan built on one of them because the form only allowed
        // one is built on a misreading.
        key: 'goalType',
        kind: 'chips',
        label: 'What do you want more of? Tap all that apply.',
        required: true,
        emptyMessage: 'Pick at least one.',
        // 🔴 Every option here used to be acquisitive except "more time", so
        // someone who has done well and decided it is not everything had no
        // way to say so — he would tick the nearest wrong thing and the plan
        // would misread him from the first screen. A way out is closing the gap
        // between what a life costs and what it gives back; you can close it
        // from either side.
        options: [
          { key: 'money', label: 'More money' },
          { key: 'time', label: 'More time' },
          { key: 'independent', label: 'Not working for someone else' },
          { key: 'mobile', label: 'Freedom to move' },
          { key: 'simpler', label: 'Less, a simpler life' },
          { key: 'place', label: 'To be somewhere else' },
        ],
      },
      {
        // ⭐ AND THEN THE QUESTION THE WHOLE PRODUCT IS ABOUT. You can want
        // three things; a plan still has to put them in an order, and that is
        // the thing being sold. Asking which comes first is not a limitation —
        // it is the product's own premise applied to the goals.
        key: 'goalFirst',
        // ⚠️ Only when they picked two or more (9 Oct, shortening). With one
        // goal there is nothing to put first.
        showIf: a => Array.isArray(a.goalType) && a.goalType.length > 1,
        kind: 'choice',
        label: 'If you could only have one of them this year, which?',
        required: false,
        options: [
          { key: 'money', label: 'More money' },
          { key: 'time', label: 'More time' },
          { key: 'independent', label: 'Not working for someone else' },
          { key: 'mobile', label: 'Freedom to move' },
          { key: 'simpler', label: 'Less, a simpler life' },
          { key: 'place', label: 'To be somewhere else' },
        ],
      },
      {
        // ⭐⭐ THE QUESTION NOBODY HAS EVER ASKED THEM. For the person stepping
        // down it is the number the entire plan turns on, and most people have
        // never said it out loud — which is why the honest answer is sometimes
        // "you passed it two years ago".
        key: 'enough',
        kind: 'text',
        // 🔴 "too vague of a question". It is the most important number on the
        // form and it was asked in three words with no anchor.
        /**
         * 🔴 "worded weird, it wouldn't apply to all types of people." Two faults,
         * and Daniel named the second one. "Worth it" measures the PLAN against a
         * number, which only parses for somebody chasing more — the person
         * stepping back, or trading money for hours, is being asked whether their
         * own life clears a bar. And "$4,500 and my Fridays" is a trade only one
         * kind of person is making.
         * ⭐ The question is really "what does this have to cover" — which is the
         * same question whether they are climbing or getting out, and it is the
         * figure the whole plan aims at either way.
         */
        /**
         * 🔴 "NEED" ASKED FOR A FLOOR AND GOT AN AIM. Daniel answered $8,000 —
         * what he would like to make — and the plan then called it his floor
         * and judged every option as failing it. The floor is already asked:
         * "What has to go out every month". This one is the aim, so it says so.
         */
        label: 'How much would you like to bring in each month?',
        hint: 'Your goal, not the least you could live on.',
        placeholder: 'About $4,500, enough to cover everything without watching the account.',
        required: false,
      },
    ],
  },
]

/** Screens whose completion triggers a reflection card on the NEXT screen. */
/**
 * The open door — the last step, after the six questions.
 *
 * ⭐⭐ WHY IT IS LAST AND NOT FIRST. Asked cold at the start, "tell me about
 * your life" gets a shrug and two lines — nobody knows what kind of detail
 * matters yet. Asked after six specific questions, and immediately after "what
 * are you running from and running toward", people know exactly what this thing
 * is for and write the real thing. The most useful sentence in the whole intake
 * usually lands here.
 *
 * ⭐ It is also the only field that can carry what no list can: an illness, a
 * bankruptcy, a marriage that is ending, a record, a kid who needs more than
 * the others, the job that is about to go. Every one of those changes the plan,
 * and none of them is a chip.
 *
 * ⚠️ NOT NUMBERED, so the promise on the opening screen — "six honest
 * questions" — stays true. It is a door, not a seventh interrogation.
 *
 * 🔴🔴 NOW REQUIRED, REVERSING THE CALL BELOW — and the old reasoning is kept
 * because it was not wrong, just answered.
 *
 * It used to read: "NOT REQUIRED. A forced life story gets 'n/a', and then we
 * have taught them the box is a formality." Daniel, 27 Sep: "it can't be
 * negotiable — this dictates the whole platform." He is right, and the audit
 * that followed proved it: of eleven prompted free-text questions in this file,
 * TEN were optional. Somebody could finish the entire intake having typed two
 * sentences, and every guard downstream treats only their own words as facts
 * they gave us — chips have never counted. So the thing the plan is built from
 * was the thing easiest to skip.
 *
 * ⚠️ THE FEAR WAS REAL AND THE FIX IS NOT OPTIONALITY, IT IS A FLOOR. Anything
 * is accepted, including a few words. What is refused is nothing at all. A
 * one-word answer still tells the plan something; an empty box tells it that
 * the most important field in the product was a formality.
 */
export const WAYOUT_OPEN = {
  question: 'Anything else?',
  lead: 'The questions were narrow on purpose. This is the context around them: the things no question asked that change what the plan should be.',
  field: {
    key: 'story',
    kind: 'text',
    label: 'What else should your plan know about your situation?',
    // ⚠️ Since 9 Oct this also carries what used to be its own box, "anything
    // already coming that changes the picture?" (`coming`).
    placeholder: 'Whatever matters. Something coming that changes things: a raise, a lease ending, a car paid off. What went wrong before, what you are carrying.',
    required: true,
    nudge: true,
    nudgeMessage: 'Anything more you can add here makes the plan sharper. Press See the plan again if that is everything.',
    emptyMessage: 'A few words is enough, but this one is not a formality.',
  },
  hint: 'Take as long as you want. Nobody reads this but the plan.',
  cta: 'See the plan',
}

export const REFLECT_AFTER = WAYOUT_SCREENS.filter(s => s.reflectAfter).map(s => s.id)

export const WAYOUT_TOTAL_SCREENS = WAYOUT_SCREENS.length
