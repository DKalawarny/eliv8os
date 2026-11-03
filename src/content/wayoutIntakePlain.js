/**
 * ⭐ THE QUESTIONS, IN PLAIN WORDS (Daniel, 2 Nov 2026: "all these questions are
 * worded really weird", on the intake, then "let's see in test page").
 *
 * Wording only. Every field key and every option key stays exactly as it is in
 * wayoutIntake.js, because that is what the plan reads; only what a person
 * SEES changes. The test page (/questions-test) lays these over the real
 * questions. When he approves, they move into wayoutIntake.js itself and this
 * file goes.
 *
 * ⚠️ Written the way you would ask a person across a table: short, one thing
 * at a time, no labels like "Stability" or "Status" that need explaining.
 */
export const PLAIN = {
  out: { kicker: 'Getting started', label: 'What would getting unstuck look like for you?', hint: 'One sentence is plenty. Rough is fine.' },

  region: { kicker: 'Where you live', label: 'What country do you live in?', hint: 'So your plan uses your money and your local services.' },
  locationText: { kicker: 'Where you live', label: 'What town or city are you in?', hint: 'If your work is somewhere else or online, say that too.' },
  immovables: {
    kicker: 'Your situation', label: 'What keeps you where you are right now?', hint: 'Tap any that apply.',
    options: {
      'kids-home': 'Kids at home', custody: 'Shared custody', parent: 'Looking after a parent', 'partner-job': 'My partner’s job',
      health: 'Caring for someone who is sick', lease: 'Rent or mortgage', legal: 'A contract I signed', partners: 'Business partners',
      faith: 'My community', nothing: 'Nothing, I could move',
    },
  },
  immovablesNote: { kicker: 'Your situation', label: 'Could any of those change if you wanted them to?' },
  faith: { kicker: 'Your situation', label: 'Do you set aside time each week for your faith?', hint: 'If you do, your plan won’t book anything over it.', options: { yes: 'Yes', na: 'No' } },
  faithNote: { kicker: 'Your situation', label: 'Which faith, and what time does it take each week?' },
  health: {
    kicker: 'Your situation', label: 'Does your health affect what you can take on?', hint: null,
    options: { limits: 'Yes, something limits me', goal: 'I want to get fitter', energy: 'I’m worn out', na: 'No' },
  },
  healthNote: { kicker: 'Your situation', label: 'Anything your plan should know about your health?' },

  name: { kicker: 'About you', label: 'What’s your first name?' },
  age: { kicker: 'About you', label: 'How old are you?' },
  workType: {
    kicker: 'About you', label: 'What do you do for work right now?',
    options: { employed: 'I have a job', self: 'I work for myself', contract: 'Contract work', casual: 'Shifts or casual', seasonal: 'Seasonal work', none: 'I’m not working right now' },
  },
  relationship: {
    kicker: 'About you', label: 'Do you have a partner? How do they feel about making a change?',
    options: { single: 'No partner', aligned: 'Yes, and they’re on board', nervous: 'Yes, and they’re nervous', against: 'Yes, and they’re against it' },
  },
  kidsAges: { kicker: 'About you', label: 'How old are your kids?', options: { '0-4': 'Under 5', '5-11': '5 to 11', '12-17': '12 to 17', adult: 'Grown up' } },
  peopleNote: { kicker: 'About you', label: 'What do you want this to give the people closest to you? Will anyone push back?', hint: 'If it’s just you, what would it give you?' },

  timeEaters: {
    kicker: 'Your time', label: 'What takes up most of your week?', hint: 'Tap any that apply. Your plan looks here first for time to give back.',
    options: {
      'work-long': 'Long hours at work', 'work-travel': 'Getting to and from work', 'work-second': 'A second job',
      'work-own': 'My own business', 'care-kids': 'Looking after kids', 'care-family': 'Looking after family', 'home-running': 'Running the house',
    },
  },
  hoursPerWeek: {
    kicker: 'Your time', label: 'How many free hours a week could you put into this?', hint: 'Count evenings and weekends. Your plan won’t ask for more.',
    options: { '0-5': 'Less than 5', '5-10': '5 to 10', '10-20': '10 to 20', '20+': 'More than 20' },
  },
  assets: {
    kicker: 'Your time', label: 'What do you have that could help you earn?', hint: 'Things you own, skills you have, people you know.',
    groups: ['Things you own', 'Space', 'Skills', 'People'],
    options: {
      mower: 'Lawn mower', boat: 'Boat', parking: 'Driveway', land: 'Land or a yard', 'home-equity': 'Equity in my home',
      licence: 'A licence or ticket', admin: 'Bookkeeping', computers: 'Computers', teaching: 'Teaching', care: 'Nursing or care',
      business: 'I already run a business', 'sub-work': 'Someone who could send me work', employer: 'A past boss who’d hire me back',
      audience: 'People who follow me online',
    },
  },
  askedFor: { kicker: 'Your time', label: 'What do people ask you to help with? Has anyone paid you for it?', hint: 'Even once counts.' },

  takeHome: { kicker: 'Your money', label: 'How much do you take home each month after tax?', hint: 'Just yours. A rough number is fine.' },
  mustPay: { kicker: 'Your money', label: 'How much do your must-pay bills come to each month?', hint: 'Rent or mortgage, bills, food, gas, loan payments.' },
  householdTakeHome: { kicker: 'Your money', label: 'Does anyone else at home bring in money? How much a month?', hint: 'Leave it blank if it’s just you.' },
  savings: { kicker: 'Your money', label: 'How much savings could you get to if you needed it?', hint: 'Money you could use without a penalty.' },
  housingCost: { kicker: 'Your money', label: 'How much of your bills is for your home?', hint: 'Rent or mortgage, plus property tax, insurance and heat.' },
  debt: { kicker: 'Your money', label: 'Do you owe money? Roughly how much, and at what interest?', hint: 'For example: $8,000 on a credit card at 20%.' },
  atStake: {
    kicker: 'Your money', label: 'If your first try doesn’t work out, what would you lose?', hint: null,
    options: { time: 'A few weekends', savings: 'Some money I’d rather keep', security: 'My family’s security', 'cannot-fail': 'Everything. I can’t afford to fail' },
  },
  discretionary: {
    kicker: 'Your money', label: 'What do you spend on that you wouldn’t miss?', hint: 'Only what you tap can be cut. Nothing else gets touched.',
    options: { vehicle: 'My vehicle', gym: 'Gym or hobbies', none: 'Nothing, I’d miss all of it' },
  },

  tradeRank: {
    kicker: 'What’s important', label: 'How important is each of these to you?', hint: null,
    options: {
      comfort: 'Keeping the lifestyle you have now', space: 'Keeping a home with plenty of space', stability: 'A steady paycheque you can count on',
      status: 'What other people think', savings: 'Keeping your savings untouched', 'family-proximity': 'Living close to family',
      'time-with-people': 'Time with the people you love', health: 'Looking after your health', community: 'Staying part of your community',
    },
  },
  alreadyTried: { kicker: 'What’s important', label: 'What have you tried already, and how did it go?', hint: '“Nothing yet” is a fine answer.' },
  refuse: { kicker: 'What’s important', label: 'Is there anything you won’t do, even if it would work?', hint: null },

  tuesday: { kicker: 'Your goal', label: 'Picture a year from now. What does a normal day look like?', hint: 'Where are you, what are you doing, and who are you with?' },
  fiveYears: { kicker: 'Your goal', label: 'And in five years?', hint: 'Rough is fine.' },
  tenYears: { kicker: 'Your goal', label: 'And in ten?', hint: 'What is all of this for?' },
  yearShape: {
    kicker: 'Your goal', label: 'Would you rather earn the same every month, or more in busy seasons?', hint: null,
    options: { steady: 'The same every month', seasonal: 'Busy seasons, then time off', lumpy: 'One big payday I make last', dontmind: 'I don’t mind' },
  },
  goalType: {
    kicker: 'Your goal', label: 'What do you want more of?', hint: 'Tap all that apply.',
    options: { money: 'Money', time: 'Time', independent: 'Being my own boss', mobile: 'Freedom to travel or move', simpler: 'A simpler life', place: 'A fresh start somewhere new' },
  },
  goalFirst: { kicker: 'Your goal', label: 'If you could only have one this year, which would it be?' },
  enough: { kicker: 'Your goal', label: 'How much would you like to bring in each month?', hint: 'What you want, not the least you could live on.' },

  story: { kicker: 'Last question', label: 'Anything else your plan should know?', hint: 'Say as much as you like. Only your plan reads this.' },
}

const relabelGoal = opts => opts?.map(o => (PLAIN.goalType.options[o.key] ? { ...o, label: PLAIN.goalType.options[o.key] } : o))

/** The field with its plain wording laid over it. Keys are never touched. */
export function plainField(field) {
  const p = PLAIN[field.key]
  if (!p) return field
  const relabel = opts => opts?.map(o => (p.options?.[o.key] ? { ...o, label: p.options[o.key] } : o))
  return {
    ...field,
    label: p.label ?? field.label,
    hint: p.hint === null ? '' : (p.hint ?? field.hint),
    kicker: p.kicker,
    options: field.key === 'goalFirst' && PLAIN.goalType.options ? relabelGoal(field.options) : relabel(field.options),
    groups: field.groups?.map((g, i) => ({ ...g, label: p.groups?.[i] ?? g.label, options: relabel(g.options) })),
  }
}
