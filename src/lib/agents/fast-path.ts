import { MONTHS } from './intent';

/**
 * Questions common enough to answer without asking a model which teammate owns
 * them.
 *
 * Routing through a model costs a whole round trip to decide something a
 * pattern already knows. These cover what people actually ask day to day; the
 * planner still handles everything else, so a miss here costs nothing but the
 * latency it would have cost anyway.
 *
 * Deliberately conservative: a pattern must be unambiguous to match. Answering
 * the wrong question quickly is worse than answering the right one slowly.
 */

export interface FastMatch {
  capability: string;
  input: Record<string, unknown>;
}

/**
 * Things worth answering without spending a request.
 *
 * The free tier allows 50 model requests a day for the whole account, so a
 * greeting or a "what can you do" costs the same as a real question. These are
 * answered from a fixed script instead, which keeps the day's budget for work
 * that actually needs thinking about.
 */
export type SmallTalk = 'greeting' | 'thanks' | 'capabilities' | 'goodbye';

const SMALL_TALK: { kind: SmallTalk; when: RegExp }[] = [
  { kind: 'greeting', when: /^\s*(hi|hey|hello|yo|good (morning|afternoon|evening))\b[\s!.]*$/i },
  { kind: 'thanks', when: /^\s*(thanks|thank you|ta|cheers|great|perfect|nice|lovely|brilliant|got it|ok|okay)\b[\s!.]*$/i },
  { kind: 'goodbye', when: /^\s*(bye|goodbye|see you|later|night)\b[\s!.]*$/i },
  {
    /*
     * "help" only counts on its own. "Help me understand the wage test for
     * Priya" is a real question and must reach the team, not a canned blurb.
     */
    kind: 'capabilities',
    when: /^\s*help\s*[?!.]*$|\b(what can you do|what do you do|how can you help|what are you for|who are you)\b/i,
  },
];

export function matchSmallTalk(text: string): SmallTalk | null {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 60) return null;
  for (const { kind, when } of SMALL_TALK) {
    if (when.test(trimmed)) return kind;
  }
  return null;
}

const PERSON_AFTER =
  /(?:of|for|does|is|on)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\b/;

/** "Priya's file", "Rahul Menon's documents". */
const POSSESSIVE = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})'s\b/;

interface Rule {
  when: RegExp;
  /** Must not match, to avoid stealing a question meant for something else. */
  unless?: RegExp;
  to: (text: string) => FastMatch | null;
}

const RULES: Rule[] = [
  {
    // "salary of Rahul", "what is Priya paid", "how much does Rahul earn"
    when: /\b(salary|pay|paid|earn|earning|package|ctc|compensation)\b/i,
    unless: /\b(run|process|structure|slab|rule|everyone|all staff|total)\b/i,
    to: (text) => {
      const name = text.match(PERSON_AFTER)?.[1];
      return name
        ? { capability: 'payroll.person_summary', input: { name } }
        : null;
    },
  },
  {
    // "attendance for August", "leave in September"
    when: /\b(attendance|leave|absence|lop|loss of pay)\b/i,
    unless: /\b(run|process|policy|rule)\b/i,
    to: (text) => {
      const month = MONTHS.find((m) => text.toLowerCase().includes(m));
      return { capability: 'payroll.attendance_summary', input: { month } };
    },
  },
  {
    // "who is on payroll", "how many employees", "headcount"
    when: /\b(roster|headcount|how many (?:people|employees|staff)|who(?:'s| is| are)\s+(?:on|in)\s+(?:the\s+)?payroll|payroll list)\b/i,
    to: () => ({ capability: 'payroll.roster', input: {} }),
  },
  {
    // "who's in the pipeline", "candidates", "who have we got applying"
    when: /\b(pipeline|candidate|candidates|applicant|applicants|who(?:'s| is| are) applying)\b/i,
    to: () => ({ capability: 'hiring.candidate_list', input: {} }),
  },
  {
    // "what rules do we use", "what do you know"
    when: /\b(what rules|which rules|rules (?:do|are) (?:we|you)|what do you know|what have you learned)\b/i,
    to: () => ({ capability: 'payroll.what_i_know', input: {} }),
  },
  {
    // "how's the team doing", "team update", "standup"
    when: /\b(standup|stand-up|team update|how(?:'s| is) the team|what(?:'s| is) everyone)\b/i,
    to: () => ({ capability: 'team.standup', input: {} }),
  },

  /* ---- Records ---- */
  {
    // "what's missing", "whose file is incomplete", "are records complete"
    when: /\b(what(?:'s| is) missing|missing (?:details|documents|information)|incomplete (?:records?|files?)|records? (?:audit|check|complete)|check (?:the )?(?:records|files))\b|\b(?:records?|files?|paperwork)\b(?:\s+\w+){0,2}\s+\b(?:incomplete|missing)\b/i,
    unless: /\bof\s+[A-Z]/,
    to: () => ({ capability: 'records.audit', input: {} }),
  },
  {
    // "what's on Priya's file", "Rahul's documents"
    when: /\b(file|record|documents?|paperwork)\b/i,
    unless: /\b(run|audit|register|all|everyone|missing)\b/i,
    to: (text) => {
      const name =
        text.match(PERSON_AFTER)?.[1] ?? text.match(POSSESSIVE)?.[1] ?? null;
      return name
        ? { capability: 'records.person_file', input: { name } }
        : null;
    },
  },
  {
    // "can we produce the registers", "statutory registers"
    when: /\b(statutory register|registers?|form 11|muster roll|inspection ready)\b/i,
    to: () => ({ capability: 'records.statutory_registers', input: {} }),
  },

  /* ---- Benefits ---- */
  {
    // "who's covered", "insurance", "group cover", "mediclaim"
    when: /\b(group cover|who(?:'s| is| are) covered|insurance|insured|mediclaim|medical cover|gmc|gpa|benefits?)\b/i,
    unless: /\b(add|enrol|enroll|remove|claim)\b/i,
    to: () => ({ capability: 'benefits.coverage', input: {} }),
  },
  {
    // "who isn't covered", "cover gaps"
    when: /\b(not covered|without cover|cover gaps?|uncovered|missing cover)\b/i,
    to: () => ({ capability: 'benefits.gaps', input: {} }),
  },

  /* ---- Reviews ---- */
  {
    // "whose review is due", "overdue reviews", "appraisals"
    // "whose review is due", "is Priya's review overdue", "any appraisals due"
    when: /\breviews?\b(?:\s+\w+){0,2}\s+\b(due|overdue|pending)\b|\b(due|overdue|pending)\b(?:\s+\w+){0,2}\s+\breviews?\b|\bappraisals?\b|\bwho needs a review\b/i,
    to: () => ({ capability: 'performance.due_reviews', input: {} }),
  },
  {
    // "how's the review cycle going", "review cycle status"
    when: /\b(review cycle|appraisal cycle|performance cycle)\b/i,
    unless: /\b(start|open|begin|run)\b/i,
    to: () => ({ capability: 'performance.cycle_status', input: {} }),
  },
  {
    // "who's on probation", "probation confirmations"
    when: /\b(probation|confirmations?)\b/i,
    to: () => ({ capability: 'performance.due_reviews', input: {} }),
  },

  /* ---- Exits ---- */
  {
    // "who's leaving", "exits in flight", "resignations"
    when: /\b(who(?:'s| is| are) leaving|exits?(?: in flight)?|resignations?|offboarding|notice period)\b/i,
    // A question about the notice *rule* belongs with the rules, not with a
    // list of who is on their way out.
    unless: /\b(settle|settlement|final|f&f|start|begin|process|policy|rule|rules)\b/i,
    to: () => ({ capability: 'exits.status', input: {} }),
  },
  {
    // "what's outstanding on Priya's exit"
    when: /\b(exit (?:checklist|clearance)|outstanding on|clearance for)\b/i,
    to: (text) => {
      const name =
        text.match(PERSON_AFTER)?.[1] ?? text.match(POSSESSIVE)?.[1] ?? null;
      return name ? { capability: 'exits.checklist', input: { name } } : null;
    },
  },
];

export function matchFastPath(text: string): FastMatch | null {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 200) return null;

  for (const rule of RULES) {
    if (!rule.when.test(trimmed)) continue;
    if (rule.unless?.test(trimmed)) continue;

    const match = rule.to(trimmed);
    if (match) return match;
  }

  return null;
}
