/**
 * Gratuity, under the Payment of Gratuity Act 1972.
 *
 * Deterministic and tested. Statutory basis, section by section:
 *  - s.4(1): payable on termination after five years of continuous service.
 *    The five-year condition does not apply where the termination is due to
 *    death or disablement.
 *  - s.4(2): fifteen days' wages for every completed year of service, on the
 *    rate of wages last drawn. For a monthly-rated employee fifteen days'
 *    wages is the monthly wage multiplied by 15/26 — twenty-six being the
 *    working days in a month that the Act uses.
 *  - s.4(2), proviso: service of more than six months in excess of a completed
 *    year counts as a whole year. Six months or less is dropped.
 *  - s.4(3): the amount is capped. The current ceiling is Rs 20,00,000, raised
 *    from Rs 10,00,000 by notification S.O. 1420(E) of 29 March 2018.
 *  - s.2(s): "wages" here means basic and dearness allowance. Allowances,
 *    bonus and overtime are excluded, which is why this function takes
 *    basic-and-DA and not gross.
 *
 * One reading is deliberately *not* applied. Several High Courts have held
 * that four years and 240 days amounts to five years of continuous service for
 * this purpose. That reading is contested and not settled by the Supreme Court,
 * so the eligibility test below is strict, and a person short of five years but
 * past four years and 240 days is flagged rather than paid — the call belongs
 * to whoever approves the settlement, with the position in front of them.
 */

export const GRATUITY_CEILING = 20_00_000;
export const GRATUITY_DAYS_PER_YEAR = 15;
export const GRATUITY_MONTH_DAYS = 26;
export const GRATUITY_MIN_YEARS = 5;

export interface GratuityResult {
  eligible: boolean;
  /** Years counted after the six-month rounding rule. */
  countedYears: number;
  /** Actual service, before rounding, for the sentence that explains it. */
  serviceYears: number;
  serviceDays: number;
  amount: number;
  /** True once the statutory ceiling bit. */
  capped: boolean;
  /** Exempt from tax under s.10(10); the excess over it is taxable. */
  exemptAmount: number;
  taxableExcess: number;
  /**
   * Short of five years, but past four years and 240 days — the reading some
   * High Courts have accepted. Flagged for a person, never applied here.
   */
  contestedEligibility: boolean;
  reason: string;
}

export function daysBetween(from: string, to: string): number {
  const start = new Date(from);
  const end = new Date(to);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 86_400_000));
}

/**
 * Completed years, with the proviso applied: more than six months over a
 * completed year rounds up, six months or less is dropped.
 */
export function completedYears(serviceDays: number): number {
  if (!Number.isFinite(serviceDays) || serviceDays <= 0) return 0;

  const years = Math.floor(serviceDays / 365);
  const remainderDays = serviceDays - years * 365;

  // "In excess of six months" — strictly more than half a year.
  return remainderDays > 182 ? years + 1 : years;
}

export function gratuity(input: {
  /** Basic and dearness allowance last drawn, monthly. */
  basicAndDa: number;
  doj: string | null;
  lastDay: string;
  /** s.4(1) waives the five-year condition in these cases. */
  reason?: 'resignation' | 'termination' | 'retirement' | 'death' | 'disablement';
  /** Anything paid above the statutory amount, which is not exempt. */
  exGratia?: number;
}): GratuityResult {
  const empty: GratuityResult = {
    eligible: false,
    countedYears: 0,
    serviceYears: 0,
    serviceDays: 0,
    amount: 0,
    capped: false,
    exemptAmount: 0,
    taxableExcess: 0,
    contestedEligibility: false,
    reason: 'No joining date on file, so service cannot be counted.',
  };

  if (!input.doj) return empty;

  const serviceDays = daysBetween(input.doj, input.lastDay);
  if (serviceDays <= 0) {
    return { ...empty, reason: 'The last day is not after the joining date.' };
  }

  const serviceYears = Math.round((serviceDays / 365) * 100) / 100;
  const waived = input.reason === 'death' || input.reason === 'disablement';
  const meetsFiveYears = serviceDays >= GRATUITY_MIN_YEARS * 365;
  // Four years and 240 days, the reading that is flagged rather than applied.
  const contested =
    !meetsFiveYears && serviceDays >= 4 * 365 + 240;

  if (!meetsFiveYears && !waived) {
    return {
      eligible: false,
      countedYears: 0,
      serviceYears,
      serviceDays,
      amount: 0,
      capped: false,
      exemptAmount: 0,
      taxableExcess: 0,
      contestedEligibility: contested,
      reason: contested
        ? 'Short of five years, but past four years and 240 days — some High Courts treat that as qualifying, which is a call for a person to make.'
        : 'Under five years of continuous service, so no gratuity is due under the Act.',
    };
  }

  const counted = completedYears(serviceDays);
  if (!Number.isFinite(input.basicAndDa) || input.basicAndDa <= 0) {
    return {
      ...empty,
      serviceYears,
      serviceDays,
      countedYears: counted,
      reason: 'No basic and dearness allowance on file to work it out from.',
    };
  }

  const raw =
    (input.basicAndDa * GRATUITY_DAYS_PER_YEAR * counted) /
    GRATUITY_MONTH_DAYS;

  const amount = Math.min(Math.round(raw), GRATUITY_CEILING);
  const exGratia = Math.max(0, Math.round(input.exGratia ?? 0));

  /*
   * s.10(10)(ii): the exemption is the least of the statutory formula amount,
   * the amount actually received, and the ceiling. The amount computed above is
   * already the formula figure capped at the ceiling, so all of it is exempt,
   * and anything paid on top of it is not.
   */
  return {
    eligible: true,
    countedYears: counted,
    serviceYears,
    serviceDays,
    amount: amount + exGratia,
    capped: Math.round(raw) > GRATUITY_CEILING,
    exemptAmount: amount,
    taxableExcess: exGratia,
    contestedEligibility: false,
    reason: waived && !meetsFiveYears
      ? 'The five-year condition does not apply here, so gratuity is due on the service completed.'
      : `${counted} completed ${counted === 1 ? 'year' : 'years'} of service at fifteen days' wages a year.`,
  };
}
