/**
 * Group cover: who is eligible, for how much, and what a mid-term addition
 * costs.
 *
 * Deterministic and tested. A premium share is deducted from somebody's pay, so
 * it is a figure that belongs here rather than anywhere a model can reach.
 *
 * The one statutory interaction worth encoding: an employee within the ESI wage
 * ceiling is already covered for medical treatment under the Employees' State
 * Insurance Act 1948, and most employers therefore leave them out of the group
 * medical policy rather than paying twice. That is a common policy, not a legal
 * requirement, so it is a default that a confirmed rule can switch off — and
 * the sentence that reaches a person says which way it was set.
 */

import { ESI_WAGE_CEILING } from './records';

export type CoverKind = 'group_medical' | 'group_accident' | 'group_term_life';

export interface BenefitPolicy {
  /** Cover available to everyone on the books. */
  covers: CoverKind[];
  /** Sum insured for the medical policy, per family. */
  medicalSumInsured: number;
  /** Accident and life cover as a multiple of annual pay. */
  accidentMultiple: number;
  termLifeMultiple: number;
  /** Share of the premium the employee pays, as a fraction. */
  employeeShare: number;
  /** Months of service before cover starts. Zero means from day one. */
  waitingMonths: number;
  /** Leave ESI-covered employees out of the medical policy. */
  excludeEsiCovered: boolean;
  /** Annual premium per person for the medical policy, before dependants. */
  medicalPremiumPerPerson: number;
  /** Multiplier applied for each dependant added. */
  dependantPremiumShare: number;
}

export const DEFAULT_BENEFIT_POLICY: BenefitPolicy = {
  covers: ['group_medical', 'group_accident', 'group_term_life'],
  medicalSumInsured: 5_00_000,
  accidentMultiple: 3,
  termLifeMultiple: 3,
  employeeShare: 0,
  waitingMonths: 0,
  excludeEsiCovered: true,
  medicalPremiumPerPerson: 8_000,
  dependantPremiumShare: 0.5,
};

export function benefitPolicyFrom(
  definition: Record<string, unknown> | null | undefined,
): BenefitPolicy {
  if (!definition) return DEFAULT_BENEFIT_POLICY;

  const num = (keys: string[], min: number, max: number): number | null => {
    for (const key of keys) {
      const raw = Number(definition[key]);
      if (Number.isFinite(raw) && raw >= min && raw <= max) return raw;
    }
    return null;
  };

  const bool = (keys: string[]): boolean | null => {
    for (const key of keys) {
      if (typeof definition[key] === 'boolean') return definition[key] as boolean;
    }
    return null;
  };

  return {
    covers: Array.isArray(definition.covers)
      ? (definition.covers as string[]).filter((c): c is CoverKind =>
          ['group_medical', 'group_accident', 'group_term_life'].includes(c),
        )
      : DEFAULT_BENEFIT_POLICY.covers,
    medicalSumInsured:
      num(['medical_sum_insured', 'medicalSumInsured'], 0, 1_00_00_000) ??
      DEFAULT_BENEFIT_POLICY.medicalSumInsured,
    accidentMultiple:
      num(['accident_multiple', 'accidentMultiple'], 0, 20) ??
      DEFAULT_BENEFIT_POLICY.accidentMultiple,
    termLifeMultiple:
      num(['term_life_multiple', 'termLifeMultiple'], 0, 20) ??
      DEFAULT_BENEFIT_POLICY.termLifeMultiple,
    employeeShare:
      num(['employee_share', 'employeeShare'], 0, 1) ??
      DEFAULT_BENEFIT_POLICY.employeeShare,
    waitingMonths:
      num(['waiting_months', 'waitingMonths'], 0, 24) ??
      DEFAULT_BENEFIT_POLICY.waitingMonths,
    excludeEsiCovered:
      bool(['exclude_esi_covered', 'excludeEsiCovered']) ??
      DEFAULT_BENEFIT_POLICY.excludeEsiCovered,
    medicalPremiumPerPerson:
      num(['medical_premium_per_person', 'medicalPremiumPerPerson'], 0, 10_00_000) ??
      DEFAULT_BENEFIT_POLICY.medicalPremiumPerPerson,
    dependantPremiumShare:
      num(['dependant_premium_share', 'dependantPremiumShare'], 0, 5) ??
      DEFAULT_BENEFIT_POLICY.dependantPremiumShare,
  };
}

export interface Eligibility {
  eligible: CoverKind[];
  excluded: { cover: CoverKind; because: string }[];
  /** When cover would start, given the waiting period. */
  startsOn: string | null;
  waiting: boolean;
}

export function monthsSince(from: string | null, asOf: Date): number {
  if (!from) return 0;
  const start = new Date(from);
  if (Number.isNaN(start.getTime())) return 0;
  if (start > asOf) return 0;

  return (
    (asOf.getFullYear() - start.getFullYear()) * 12 +
    (asOf.getMonth() - start.getMonth()) +
    (asOf.getDate() >= start.getDate() ? 0 : -1)
  );
}

export function eligibilityFor(
  person: { type: string; doj: string | null; monthlyGross: number },
  policy: BenefitPolicy,
  asOf = new Date(),
): Eligibility {
  const excluded: { cover: CoverKind; because: string }[] = [];

  if (person.type !== 'employee') {
    return {
      eligible: [],
      excluded: policy.covers.map((cover) => ({
        cover,
        because: 'Cover starts once they are an employee on the books.',
      })),
      startsOn: null,
      waiting: false,
    };
  }

  const served = monthsSince(person.doj, asOf);
  const waiting = served < policy.waitingMonths;

  let startsOn: string | null = null;
  if (person.doj) {
    const start = new Date(person.doj);
    if (!Number.isNaN(start.getTime())) {
      start.setMonth(start.getMonth() + policy.waitingMonths);
      startsOn = start.toISOString().slice(0, 10);
    }
  }

  const eligible: CoverKind[] = [];

  for (const cover of policy.covers) {
    if (
      cover === 'group_medical' &&
      policy.excludeEsiCovered &&
      person.monthlyGross > 0 &&
      person.monthlyGross <= ESI_WAGE_CEILING
    ) {
      excluded.push({
        cover,
        because:
          'Within the ESI wage ceiling, so they are already covered for medical treatment under the ESI scheme.',
      });
      continue;
    }

    if (waiting) {
      excluded.push({
        cover,
        because: `Still inside the ${policy.waitingMonths}-month waiting period.`,
      });
      continue;
    }

    eligible.push(cover);
  }

  return { eligible, excluded, startsOn, waiting };
}

export interface SumInsured {
  cover: CoverKind;
  amount: number;
  basis: string;
}

export function sumsInsuredFor(
  annualPay: number,
  covers: CoverKind[],
  policy: BenefitPolicy,
): SumInsured[] {
  const sums: SumInsured[] = [];

  for (const cover of covers) {
    if (cover === 'group_medical') {
      sums.push({
        cover,
        amount: policy.medicalSumInsured,
        basis: 'A flat family sum insured, the same for everyone on the policy.',
      });
    }
    if (cover === 'group_accident' && annualPay > 0) {
      sums.push({
        cover,
        amount: Math.round(annualPay * policy.accidentMultiple),
        basis: `${policy.accidentMultiple} times annual pay.`,
      });
    }
    if (cover === 'group_term_life' && annualPay > 0) {
      sums.push({
        cover,
        amount: Math.round(annualPay * policy.termLifeMultiple),
        basis: `${policy.termLifeMultiple} times annual pay.`,
      });
    }
  }

  return sums;
}

export interface PremiumShare {
  annualPremium: number;
  /** Pro-rated for the part of the policy year that remains. */
  proRatedPremium: number;
  employeeAnnualShare: number;
  employeeMonthlyDeduction: number;
  daysRemaining: number;
  basis: string;
}

/**
 * What an addition part-way through the policy year costs.
 *
 * Insurers charge a mid-term addition pro rata on the days left in the policy
 * year, which is why the renewal date matters and not just the premium.
 */
export function premiumFor(input: {
  policy: BenefitPolicy;
  dependants: number;
  joinsOn: Date;
  policyRenewsOn: Date;
}): PremiumShare {
  const { policy } = input;

  const dependants = Math.max(0, Math.round(input.dependants));
  const annualPremium = Math.round(
    policy.medicalPremiumPerPerson *
      (1 + dependants * policy.dependantPremiumShare),
  );

  const daysRemaining = Math.max(
    0,
    Math.min(
      365,
      Math.round(
        (input.policyRenewsOn.getTime() - input.joinsOn.getTime()) /
          86_400_000,
      ),
    ),
  );

  const proRatedPremium = Math.round((annualPremium * daysRemaining) / 365);
  const employeeAnnualShare = Math.round(proRatedPremium * policy.employeeShare);

  return {
    annualPremium,
    proRatedPremium,
    employeeAnnualShare,
    employeeMonthlyDeduction:
      daysRemaining > 0
        ? Math.round(employeeAnnualShare / Math.max(1, Math.round(daysRemaining / 30)))
        : 0,
    daysRemaining,
    basis:
      dependants > 0
        ? `Self plus ${dependants} ${dependants === 1 ? 'dependant' : 'dependants'}, pro-rated over the ${daysRemaining} days left in the policy year.`
        : `Self only, pro-rated over the ${daysRemaining} days left in the policy year.`,
  };
}
