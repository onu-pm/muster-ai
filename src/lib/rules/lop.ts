/**
 * Loss of pay: turning days not worked into one figure per person.
 *
 * Deterministic and tested. The reconciliation decides what is unexplained; it
 * never guesses a number, and a discrepancy it cannot explain is raised for a
 * person to settle rather than resolved silently.
 */

export interface AttendanceRecord {
  personRef: string;
  personName: string;
  /** Days the attendance source says were worked. */
  daysPresent: number;
  /** Calendar days in the payroll month. */
  daysInMonth: number;
}

export interface LeaveDay {
  personRef: string;
  date: string;
  /** Whether this leave is paid. Unpaid leave is what drives loss of pay. */
  paid: boolean;
  kind: string;
}

export interface LopLine {
  personRef: string;
  personName: string;
  daysInMonth: number;
  daysPresent: number;
  /** Paid leave taken in the period — costs nothing. */
  paidLeaveDays: number;
  /** Unpaid leave that was properly applied for. */
  unpaidLeaveDays: number;
  /** Days unaccounted for by either attendance or the leave ledger. */
  unexplainedDays: number;
  /** The figure that reaches payroll: unpaid leave plus anything unexplained. */
  lopDays: number;
  /** True when the two sources disagree and a person must settle it. */
  needsReview: boolean;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * One LOP figure per person.
 *
 * A day is lost pay when it was unpaid leave, or when neither attendance nor
 * the leave ledger accounts for it. Where days are unexplained the line is
 * flagged: the number is still computed, but it is not acted on until approved.
 */
export function reconcileLop(
  attendance: AttendanceRecord[],
  leave: LeaveDay[],
): LopLine[] {
  const leaveByPerson = new Map<string, LeaveDay[]>();
  for (const day of leave) {
    const list = leaveByPerson.get(day.personRef) ?? [];
    list.push(day);
    leaveByPerson.set(day.personRef, list);
  }

  return attendance.map((record) => {
    const days = leaveByPerson.get(record.personRef) ?? [];
    const paidLeaveDays = days.filter((d) => d.paid).length;
    const unpaidLeaveDays = days.filter((d) => !d.paid).length;

    const daysInMonth = Math.max(0, record.daysInMonth);
    const daysPresent = clamp(record.daysPresent, 0, daysInMonth);

    // Everything the two sources together account for.
    const accounted = daysPresent + paidLeaveDays + unpaidLeaveDays;
    const unexplainedDays = Math.max(0, daysInMonth - accounted);

    const lopDays = round1(unpaidLeaveDays + unexplainedDays);

    return {
      personRef: record.personRef,
      personName: record.personName,
      daysInMonth,
      daysPresent,
      paidLeaveDays,
      unpaidLeaveDays,
      unexplainedDays: round1(unexplainedDays),
      lopDays,
      needsReview: unexplainedDays > 0,
    };
  });
}

/**
 * The amount withheld for a number of lost days.
 *
 * The divisor is calendar days in the month unless a confirmed
 * `lop_calculation` rule sets a fixed one (commonly 26 or 30).
 */
export function lopAmount(
  monthlyGross: number,
  lopDays: number,
  divisor: number,
): number {
  if (!Number.isFinite(monthlyGross) || monthlyGross <= 0) return 0;
  if (!Number.isFinite(lopDays) || lopDays <= 0) return 0;
  if (!Number.isFinite(divisor) || divisor <= 0) return 0;

  const perDay = monthlyGross / divisor;
  return Math.round(perDay * Math.min(lopDays, divisor) * 100) / 100;
}

/** The divisor a confirmed rule specifies, or calendar days when it does not. */
export function lopDivisorFrom(
  definition: Record<string, unknown> | null | undefined,
  daysInMonth: number,
): number {
  const raw = Number(
    definition?.divisor ?? definition?.days ?? definition?.fixedDivisor,
  );
  if (Number.isFinite(raw) && raw > 0 && raw <= 31) return raw;
  return daysInMonth;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}
