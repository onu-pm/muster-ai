/**
 * Leave balance, and the part of it that can be paid out.
 *
 * The model here — this year's entitlement held separately from what was
 * carried forward, and the carry-forward split into the part that expires and
 * the part that does not — is taken from
 * urlaubsverwaltung/urlaubsverwaltung (Apache-2.0), specifically its
 * `VacationDaysLeft` and `ExpiredRemainingVacationDays`. One flat "balance"
 * number cannot answer the question that matters at an exit, which is how much
 * of the balance is still live; keeping the three buckets apart can.
 *
 * Earned leave in India is statutory but set per state under the Shops and
 * Establishments Acts and the Factories Act 1948 (s.79, one day for every
 * twenty worked), so the entitlement and the carry-forward cap are policy
 * inputs rather than constants: they come from a confirmed rule. The defaults
 * below are the common private-sector shape, not a statutory minimum, and are
 * labelled as such wherever they reach a person.
 */

export interface LeavePolicy {
  /** Earned leave credited for a full year of service. */
  annualEntitlementDays: number;
  /** The most that may be carried into the next year. */
  carryForwardCapDays: number;
  /** Whether carried-forward days lapse if unused. */
  carryForwardExpires: boolean;
  /** Days that may be paid out rather than taken. */
  encashableCapDays: number;
}

export const DEFAULT_LEAVE_POLICY: LeavePolicy = {
  annualEntitlementDays: 18,
  carryForwardCapDays: 30,
  carryForwardExpires: false,
  encashableCapDays: 30,
};

export function leavePolicyFrom(
  definition: Record<string, unknown> | null | undefined,
): LeavePolicy {
  if (!definition) return DEFAULT_LEAVE_POLICY;

  const number = (...keys: string[]): number | null => {
    for (const key of keys) {
      const raw = Number(definition[key]);
      if (Number.isFinite(raw) && raw >= 0 && raw <= 365) return raw;
    }
    return null;
  };

  return {
    annualEntitlementDays:
      number('annual_entitlement_days', 'annualEntitlementDays', 'entitlement') ??
      DEFAULT_LEAVE_POLICY.annualEntitlementDays,
    carryForwardCapDays:
      number('carry_forward_cap_days', 'carryForwardCapDays', 'carry_forward_cap') ??
      DEFAULT_LEAVE_POLICY.carryForwardCapDays,
    carryForwardExpires:
      typeof definition.carry_forward_expires === 'boolean'
        ? definition.carry_forward_expires
        : typeof definition.carryForwardExpires === 'boolean'
          ? definition.carryForwardExpires
          : DEFAULT_LEAVE_POLICY.carryForwardExpires,
    encashableCapDays:
      number('encashable_cap_days', 'encashableCapDays', 'encashable_cap') ??
      DEFAULT_LEAVE_POLICY.encashableCapDays,
  };
}

export interface LeaveBalance {
  /** Credited for the current year, pro-rated for a part year of service. */
  entitlementThisYear: number;
  /** Brought in from last year, after the cap was applied. */
  carriedForward: number;
  /** The share of the carry-forward that survives the expiry date. */
  carriedForwardNotExpiring: number;
  takenThisYear: number;
  /** What is actually left to take today. */
  available: number;
  /** What may be paid out, which is not the same as what is left. */
  encashable: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Months of service inside the leave year, used to pro-rate a part year. */
export function monthsOfServiceInYear(
  doj: string | null,
  yearStart: Date,
  asOf: Date,
): number {
  if (!doj) return 12;
  const joined = new Date(doj);
  if (Number.isNaN(joined.getTime())) return 12;

  const from = joined > yearStart ? joined : yearStart;
  if (from > asOf) return 0;

  const months =
    (asOf.getFullYear() - from.getFullYear()) * 12 +
    (asOf.getMonth() - from.getMonth()) +
    // A part month counts once the day of the month has come round.
    (asOf.getDate() >= from.getDate() ? 1 : 0);

  return Math.max(0, Math.min(12, months));
}

export function leaveBalance(input: {
  policy: LeavePolicy;
  doj: string | null;
  /** Days brought in from last year, before the cap. */
  carriedForwardRaw: number;
  takenThisYear: number;
  yearStart: Date;
  asOf: Date;
}): LeaveBalance {
  const { policy } = input;

  const months = monthsOfServiceInYear(
    input.doj,
    input.yearStart,
    input.asOf,
  );

  // Pro-rated: somebody who joined in October has not earned a full year.
  const entitlementThisYear = round1(
    (policy.annualEntitlementDays * months) / 12,
  );

  const carriedForward = round1(
    Math.max(0, Math.min(input.carriedForwardRaw, policy.carryForwardCapDays)),
  );

  const carriedForwardNotExpiring = policy.carryForwardExpires
    ? 0
    : carriedForward;

  const taken = round1(Math.max(0, input.takenThisYear));

  // Carried-forward days are spent first, so the current year's credit is not
  // consumed by leave that an expiring balance would have covered.
  const available = round1(
    Math.max(0, entitlementThisYear + carriedForward - taken),
  );

  const encashable = round1(Math.min(available, policy.encashableCapDays));

  return {
    entitlementThisYear,
    carriedForward,
    carriedForwardNotExpiring,
    takenThisYear: taken,
    available,
    encashable,
  };
}

/**
 * What a day of leave is worth when it is paid out instead of taken.
 *
 * There is no statutory formula for a private employer, so both the base and
 * the divisor are policy. The common shape — basic and dearness allowance over
 * a thirty-day month — is the default, and the sentence that reaches a person
 * says which was used.
 */
export function encashmentAmount(input: {
  basicAndDa: number;
  days: number;
  divisor?: number;
}): number {
  const divisor =
    Number.isFinite(input.divisor) && (input.divisor as number) > 0
      ? (input.divisor as number)
      : 30;

  if (!Number.isFinite(input.basicAndDa) || input.basicAndDa <= 0) return 0;
  if (!Number.isFinite(input.days) || input.days <= 0) return 0;

  return Math.round((input.basicAndDa / divisor) * input.days);
}
