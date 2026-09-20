/**
 * Reads what someone typed into the goal box.
 *
 * Deterministic on purpose: this decides which work runs and over what period,
 * and that must not depend on a model's mood. Models are used later, for
 * reading unstructured documents and drafting language — never for choosing
 * what to execute or for any figure.
 */

export const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
] as const;

export interface PayrollIntent {
  kind: 'run_payroll';
  month: number;
  year: number;
  periodLabel: string;
}

export interface SchedulePayrollIntent {
  kind: 'schedule_payroll';
  /** Day of the month the run should happen on. */
  day: number;
  recurrence: 'monthly';
  /** "the 25th of each month" */
  cadenceLabel: string;
}

export interface StatusIntent {
  kind: 'status';
}

export interface UnknownIntent {
  kind: 'unknown';
}

export type Intent =
  | PayrollIntent
  | SchedulePayrollIntent
  | StatusIntent
  | UnknownIntent;

/*
 * A payroll RUN is a command, not a topic. "Find the salary of Rahul" mentions
 * salary and must never start a run — it is a question, and questions go to the
 * planner, which can reach any teammate's capabilities.
 *
 * So this needs an action verb sitting next to the payroll word. Anything else
 * falls through, deliberately.
 */
const RUN_VERB = String.raw`(?:run|process|start|do|execute|kick\s*off|close|finish|schedule|set\s*up)`;
const PAYROLL_NOUN = String.raw`(?:payroll|pay\s*run|payrun|pay\s*cycle)`;

const PAYROLL_WORDS = new RegExp(
  `\\b${RUN_VERB}\\b[^.?!]{0,30}\\b${PAYROLL_NOUN}\\b|\\b${PAYROLL_NOUN}\\b[^.?!]{0,15}\\b${RUN_VERB}\\b`,
  'i',
);

/** A question is never a command, however many payroll words it contains. */
const QUESTION_WORDS =
  /^\s*(?:what|who|when|where|which|how|why|find|show|tell|list|get|can|could|do|does|did|is|are|has|have)\b|\?\s*$/i;

const STATUS_WORDS =
  /\b(status|pending|waiting|what's happening|whats happening|outstanding|anything for me|anything i need)\b/i;

/** Resolves a named month to a concrete year: the most recent one not in the future. */
export function resolvePeriod(
  monthIndex: number,
  explicitYear: number | null,
  now = new Date(),
): { month: number; year: number } {
  if (explicitYear !== null) return { month: monthIndex + 1, year: explicitYear };

  const year =
    monthIndex > now.getMonth() ? now.getFullYear() - 1 : now.getFullYear();
  return { month: monthIndex + 1, year };
}

const RECURRING_WORDS =
  /\b(every month|each month|monthly|recurring|repeat|schedule|automatically|from now on)\b/i;

/** "on the 25th", "on 25th", "every 3rd" */
const DAY_OF_MONTH = /\b(?:on\s+(?:the\s+)?)?(\d{1,2})(?:st|nd|rd|th)\b/i;

export function readIntent(text: string, now = new Date()): Intent {
  const lower = text.toLowerCase();

  /*
   * A question is answered, never executed — no exceptions. "What's the payroll
   * schedule?" must not set one up, and "find the salary of Rahul" must not run
   * a month. Questions go to the planner, which can reach any teammate and can
   * still offer to set something up in conversation.
   */
  if (QUESTION_WORDS.test(text)) {
    return STATUS_WORDS.test(lower) ? { kind: 'status' } : { kind: 'unknown' };
  }

  // A recurring payroll instruction is a different thing from running one now:
  // it needs permission before anything is saved.
  if (PAYROLL_WORDS.test(lower) && RECURRING_WORDS.test(lower)) {
    const match = lower.match(DAY_OF_MONTH);
    const parsed = match ? Number(match[1]) : Number.NaN;
    const day =
      Number.isFinite(parsed) && parsed >= 1 && parsed <= 28 ? parsed : 1;

    return {
      kind: 'schedule_payroll',
      day,
      recurrence: 'monthly',
      cadenceLabel: `the ${ordinal(day)} of each month`,
    };
  }

  if (PAYROLL_WORDS.test(lower)) {
    const monthIndex = MONTHS.findIndex((m) => lower.includes(m));
    const yearMatch = lower.match(/\b(20\d{2})\b/);
    const explicitYear = yearMatch ? Number(yearMatch[1]) : null;

    const index = monthIndex >= 0 ? monthIndex : lastCompleteMonth(now).month;
    const resolved = resolvePeriod(
      index,
      explicitYear,
      monthIndex >= 0 ? now : lastCompleteMonth(now).at,
    );

    return {
      kind: 'run_payroll',
      month: resolved.month,
      year: resolved.year,
      periodLabel: `${capitalise(MONTHS[resolved.month - 1])} ${resolved.year}`,
    };
  }

  if (STATUS_WORDS.test(lower)) return { kind: 'status' };

  return { kind: 'unknown' };
}

/** No month named means the month just gone, which is what people mean. */
function lastCompleteMonth(now: Date): { month: number; at: Date } {
  const at = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return { month: at.getMonth(), at: now };
}

function capitalise(value: string): string {
  return value.replace(/^./, (c) => c.toUpperCase());
}

export function ordinal(n: number): string {
  const rest = n % 100;
  if (rest >= 11 && rest <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}
