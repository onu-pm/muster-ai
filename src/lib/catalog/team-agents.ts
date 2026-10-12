import type { ProviderCategory } from './providers';

export type AgentKey =
  // Holly
  | 'input'
  | 'structure'
  | 'tax'
  | 'pursue'
  // Hansel
  | 'screen'
  | 'offer'
  | 'onboard'
  // Mira
  | 'audit'
  | 'documents'
  | 'registers'
  // Dev
  | 'eligibility'
  | 'enrolment'
  | 'claims'
  // Sana
  | 'cycles'
  | 'reviews'
  | 'confirmations'
  // Noor
  | 'exit_intake'
  | 'settlement'
  | 'clearance';

export interface Agent {
  key: AgentKey;
  name: string;
  /** One plain-language line: what this agent does, said the way a person would say it. */
  oneLiner: string;
  requiredCategories: ProviderCategory[];
  /** Agents that run behind the scenes and aren't given their own card on Overview. */
  internal?: boolean;
}

export interface Teammate {
  /** URL slug and the name people use. */
  key: string;
  /**
   * The `teams.key` this persona fronts. Holly is the face of the
   * "Payroll & Compliance" team row, which predates her name.
   */
  dbTeamKey: string | null;
  name: string;
  initial: string;
  /** One-line role, used on the Home strip. */
  role: string;
  /** One-line desk description, used on the Team Members grid. */
  desk: string;
  /** A short paragraph for the top of the detail page. */
  about: string;
  live: boolean;
  agents: Agent[];
}

export const TEAMMATES: Teammate[] = [
  {
    key: 'holly',
    dbTeamKey: 'payroll_compliance',
    name: 'Holly',
    initial: 'H',
    role: 'Payroll and statutory compliance',
    desk: 'Runs monthly payroll, keeps statutory filings straight.',
    about:
      'Holly runs your monthly payroll end to end. She gathers attendance and leave, works out what each person should be paid, projects their tax, and brings you anything she is not sure about instead of guessing. She never pays anyone or files anything without your say-so.',
    live: true,
    agents: [
      {
        key: 'input',
        name: 'Attendance and leave',
        oneLiner:
          'Reconciles attendance and leave for the month into one loss-of-pay figure per person, and flags anything that does not add up.',
        requiredCategories: ['people_data'],
      },
      {
        key: 'structure',
        name: 'Pay structure',
        oneLiner:
          'Works out basic, allowances and deductions for each person, and checks the split still passes the 50% wage test.',
        requiredCategories: [],
      },
      {
        key: 'tax',
        name: 'Tax and declarations',
        oneLiner:
          'Tracks investment declarations, checks the proofs people submit, and projects monthly tax so there is no March surprise.',
        requiredCategories: [],
      },
      {
        key: 'pursue',
        name: 'Follow-ups',
        oneLiner:
          'Drafts the nudge when someone owes a proof or an explanation. Nothing is sent until you connect a messaging channel.',
        requiredCategories: ['messaging'],
        internal: true,
      },
    ],
  },
  {
    key: 'hansel',
    dbTeamKey: 'hiring_onboarding',
    name: 'Hansel',
    initial: 'H',
    role: 'Hiring and onboarding',
    desk: 'Reads CVs, draws up offers, and gets a new joiner ready to be paid.',
    about:
      "Hansel handles hiring from the first CV to a first day that works. He reads applications against the role, keeps candidates straight, draws up offers, and walks a new joiner onto the books. Anything about pay he takes to Holly rather than working it out himself, and he never turns a candidate down on his own — screening gives you a summary, the decision stays yours.",
    live: true,
    agents: [
      {
        key: 'screen',
        name: 'Applications',
        oneLiner:
          'Reads a CV against what the role actually needs and summarises it, without scoring anyone out.',
        requiredCategories: ['people_data'],
      },
      {
        key: 'offer',
        name: 'Offers',
        oneLiner:
          'Draws up an offer and asks Holly for the pay split, so the structure is right before it goes out.',
        requiredCategories: [],
      },
      {
        key: 'onboard',
        name: 'Onboarding',
        oneLiner:
          'Moves an accepted offer onto the books and tells you what is still missing before they can be paid.',
        requiredCategories: [],
      },
    ],
  },
  {
    key: 'mira',
    dbTeamKey: 'records_documents',
    name: 'Mira',
    initial: 'M',
    role: 'Records and documents',
    desk: 'Keeps employee records complete and documents where you can find them.',
    about:
      "Mira's whole job is what is not there. A salary structure with no bank account behind it looks fine until payday, and a person with no PAN looks fine until a return is filed — so she reads every file against what each statutory register actually needs and tells you what is missing and what it stops. She never fills a gap in herself: a record is somebody's identity and bank details, and guessing at either is the one thing worse than leaving it blank.",
    live: true,
    agents: [
      {
        key: 'audit',
        name: 'File checks',
        oneLiner:
          'Reads every file against what is needed to pay someone and file for them, and says which gaps stop which thing.',
        requiredCategories: [],
      },
      {
        key: 'documents',
        name: 'Documents',
        oneLiner:
          'Keeps offers, proofs and certificates against the right person, so a file can be produced on request.',
        requiredCategories: [],
      },
      {
        key: 'registers',
        name: 'Statutory registers',
        oneLiner:
          'Says whether the registers an inspector would ask for could be produced today, and who is short of what.',
        requiredCategories: [],
      },
    ],
  },
  {
    key: 'dev',
    dbTeamKey: 'benefits_insurance',
    name: 'Dev',
    initial: 'D',
    role: 'Benefits and insurance',
    desk: 'Handles group cover, additions, removals and claims chasing.',
    about:
      'Dev looks after group cover. He works out who is eligible, what they should be insured for and what an addition costs part-way through a policy year, and he knows to leave ESI-covered staff out of the medical policy rather than paying twice. He never sends anything to an insurer on his own: an enrolment comes to you with the premium already worked out, and a removal waits, because a claim refused after someone has left is worse than a month of extra premium.',
    live: true,
    agents: [
      {
        key: 'eligibility',
        name: 'Eligibility',
        oneLiner:
          'Works out who is eligible for which cover and for how much, and who is deliberately out of it.',
        requiredCategories: [],
      },
      {
        key: 'enrolment',
        name: 'Additions and removals',
        oneLiner:
          'Draws up an addition with the pro-rated premium, or a removal on exit, and waits for you to approve it.',
        requiredCategories: [],
      },
      {
        key: 'claims',
        name: 'Claims',
        oneLiner:
          'Keeps track of a claim once it is in, and chases the insurer when it goes quiet. Needs an insurer connected.',
        requiredCategories: ['people_data'],
        internal: true,
      },
    ],
  },
  {
    key: 'sana',
    dbTeamKey: 'performance_reviews',
    name: 'Sana',
    initial: 'S',
    role: 'Performance and reviews',
    desk: 'Runs review cycles and keeps them from quietly slipping.',
    about:
      'A review cycle fails quietly — nobody notices the month it did not happen, they notice eighteen months later when somebody resigns over it. Sana makes that visible: who is due, how far past the window, and which probation confirmations are overdue. She records an outcome against a fixed scale with no numbers in it; she never forms one, and if a rating comes with a rise she hands the arithmetic to Holly.',
    live: true,
    agents: [
      {
        key: 'cycles',
        name: 'Review cycles',
        oneLiner:
          'Opens a cycle, tracks how much of it is done, and waits for you before anybody is told it is happening.',
        requiredCategories: [],
      },
      {
        key: 'reviews',
        name: 'What has slipped',
        oneLiner:
          'Works out whose review is due and how far past the window it has gone.',
        requiredCategories: [],
      },
      {
        key: 'confirmations',
        name: 'Probation confirmations',
        oneLiner:
          'Flags anyone at the end of probation, since they are employed on a different footing until it happens.',
        requiredCategories: [],
      },
    ],
  },
  {
    key: 'noor',
    dbTeamKey: 'exits_settlement',
    name: 'Noor',
    initial: 'N',
    role: 'Exits and final settlement',
    desk: 'Works an exit through notice, recovery and full and final.',
    about:
      'A final settlement is the last money an employer ever sends someone, and there is no next month to catch a mistake in it. Noor works it out from the tested rules — salary to the last day, leave encashment, gratuity under the Act, notice recovery, anything still owed — itemises every line with the basis for it, names every assumption, and stops. Where a figure cannot be worked out he says so rather than assuming a zero, because a missing encashment looks exactly like a correct one on a payslip.',
    live: true,
    agents: [
      {
        key: 'exit_intake',
        name: 'Notice and dates',
        oneLiner:
          'Records the leaving dates, works out notice served against notice required, and pulls in the others.',
        requiredCategories: [],
      },
      {
        key: 'settlement',
        name: 'Full and final',
        oneLiner:
          'Works out the settlement line by line from the tested rules, and brings it to you to approve. Nothing is paid without that.',
        requiredCategories: [],
      },
      {
        key: 'clearance',
        name: 'Clearance',
        oneLiner:
          'Tracks what is still outstanding — documents, balances owed, cover to be ended — before an exit can close.',
        requiredCategories: [],
      },
    ],
  },
];

export function getTeammate(key: string): Teammate | undefined {
  return TEAMMATES.find((t) => t.key === key);
}

/** Every provider category a teammate needs across all of her agents. */
export function requiredCategories(team: Teammate): ProviderCategory[] {
  const seen = new Set<ProviderCategory>();
  for (const agent of team.agents) {
    for (const category of agent.requiredCategories) seen.add(category);
  }
  return [...seen];
}

/** Categories a teammate cannot work at all without. Messaging is optional — Pursue degrades to drafts. */
export function essentialCategories(team: Teammate): ProviderCategory[] {
  const seen = new Set<ProviderCategory>();
  for (const agent of team.agents) {
    if (agent.internal) continue;
    for (const category of agent.requiredCategories) seen.add(category);
  }
  return [...seen];
}

export const HOLLY = TEAMMATES[0];
