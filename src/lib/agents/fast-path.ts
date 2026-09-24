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
  /(?:of|for|does|is)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\b/;

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
