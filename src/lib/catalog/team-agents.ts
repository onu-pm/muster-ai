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
  | 'onboard';

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
    dbTeamKey: null,
    name: 'Mira',
    initial: 'M',
    role: 'Records and documents',
    desk: 'Keeps employee records complete and documents where you can find them.',
    about: 'Not available yet.',
    live: false,
    agents: [],
  },
  {
    key: 'dev',
    dbTeamKey: null,
    name: 'Dev',
    initial: 'D',
    role: 'Benefits and insurance',
    desk: 'Handles group cover, additions, removals and claims chasing.',
    about: 'Not available yet.',
    live: false,
    agents: [],
  },
  {
    key: 'sana',
    dbTeamKey: null,
    name: 'Sana',
    initial: 'S',
    role: 'Performance and reviews',
    desk: 'Runs review cycles and keeps them from quietly slipping.',
    about: 'Not available yet.',
    live: false,
    agents: [],
  },
  {
    key: 'noor',
    dbTeamKey: null,
    name: 'Noor',
    initial: 'N',
    role: 'Exits and final settlement',
    desk: 'Works an exit through notice, recovery and full and final.',
    about: 'Not available yet.',
    live: false,
    agents: [],
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
