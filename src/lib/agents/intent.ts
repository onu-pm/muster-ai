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

export interface StatusIntent {
  kind: 'status';
}

export interface UnknownIntent {
  kind: 'unknown';
}

export type Intent = PayrollIntent | StatusIntent | UnknownIntent;

const PAYROLL_WORDS = /\b(payroll|salary|salaries|pay run|payrun|process pay)\b/i;
const STATUS_WORDS =
  /\b(status|pending|waiting|what's happening|whats happening|anything|update|outstanding)\b/i;

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

export function readIntent(text: string, now = new Date()): Intent {
  const lower = text.toLowerCase();

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
