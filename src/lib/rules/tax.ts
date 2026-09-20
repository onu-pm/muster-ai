/**
 * Income tax and statutory contributions.
 *
 * Deterministic and unit-tested. A model may read a proof document and say what
 * it claims; only this file decides what that is worth, and only this file
 * produces a figure that reaches a payslip.
 */

import {
  CESS_RATE,
  DEDUCTION_CAPS,
  EPF,
  ESI,
  NEW_REGIME_MAX_SURCHARGE,
  NEW_REGIME_SLABS,
  OLD_REGIME_SLABS,
  REBATE_87A,
  STANDARD_DEDUCTION,
  SURCHARGE_BANDS,
  type Regime,
  type Slab,
} from './tax-tables';

const round = (n: number) => Math.round(n * 100) / 100;
const rupees = (n: number) => Math.round(n);

export function slabsFor(regime: Regime): Slab[] {
  return regime === 'new' ? NEW_REGIME_SLABS : OLD_REGIME_SLABS;
}

/** Tax on a taxable income, before rebate, surcharge and cess. */
export function taxOnSlabs(taxableIncome: number, regime: Regime): number {
  if (!Number.isFinite(taxableIncome) || taxableIncome <= 0) return 0;

  let tax = 0;
  let lower = 0;

  for (const slab of slabsFor(regime)) {
    const upper = slab.upTo ?? Number.POSITIVE_INFINITY;
    if (taxableIncome > lower) {
      const bandAmount = Math.min(taxableIncome, upper) - lower;
      tax += bandAmount * slab.rate;
    }
    lower = upper;
    if (taxableIncome <= lower) break;
  }

  return round(tax);
}

export function rebate87A(
  taxableIncome: number,
  taxBeforeRebate: number,
  regime: Regime,
): number {
  const rule = REBATE_87A[regime];
  if (taxableIncome > rule.incomeLimit) return 0;
  return round(Math.min(taxBeforeRebate, rule.maxRebate));
}

export function surchargeOn(
  taxAfterRebate: number,
  totalIncome: number,
  regime: Regime,
): number {
  let rate = 0;
  for (const band of SURCHARGE_BANDS) {
    if (totalIncome > band.above) rate = band.rate;
  }
  if (regime === 'new') rate = Math.min(rate, NEW_REGIME_MAX_SURCHARGE);
  return round(taxAfterRebate * rate);
}

/** Caps a declared amount at its statutory ceiling, unless a confirmed rule sets a lower one. */
export function capDeduction(
  category: string,
  declared: number,
  ruleCaps?: Record<string, number> | null,
): { allowed: number; cap: number; trimmed: boolean } {
  const statutory = DEDUCTION_CAPS[category] ?? Number.POSITIVE_INFINITY;
  const fromRule = ruleCaps?.[category];

  // A company rule may tighten a cap but never loosen one.
  const cap =
    typeof fromRule === 'number' && Number.isFinite(fromRule) && fromRule >= 0
      ? Math.min(fromRule, statutory)
      : statutory;

  const amount = Number.isFinite(declared) && declared > 0 ? declared : 0;
  const allowed = Math.min(amount, cap);

  return { allowed: round(allowed), cap, trimmed: allowed < amount };
}

export interface AnnualTaxInput {
  grossAnnualSalary: number;
  regime: Regime;
  /** Verified deductions by category, old regime only. */
  deductions?: Record<string, number>;
  /** Caps from a confirmed `proof_category_cap` rule. */
  ruleCaps?: Record<string, number> | null;
}

export interface AnnualTaxResult {
  grossAnnualSalary: number;
  standardDeduction: number;
  totalDeductions: number;
  taxableIncome: number;
  taxBeforeRebate: number;
  rebate: number;
  surcharge: number;
  cess: number;
  totalTax: number;
  monthlyTds: number;
  /** Categories whose declared amount was trimmed to a cap. */
  trimmed: string[];
}

export function computeAnnualTax(input: AnnualTaxInput): AnnualTaxResult {
  const gross =
    Number.isFinite(input.grossAnnualSalary) && input.grossAnnualSalary > 0
      ? input.grossAnnualSalary
      : 0;

  const standardDeduction = Math.min(
    STANDARD_DEDUCTION[input.regime],
    gross,
  );

  let totalDeductions = 0;
  const trimmed: string[] = [];

  // Chapter VI-A deductions are an old-regime feature; the new regime does not
  // allow them, so declared amounts are ignored rather than silently applied.
  if (input.regime === 'old' && input.deductions) {
    for (const [category, declared] of Object.entries(input.deductions)) {
      const result = capDeduction(category, declared, input.ruleCaps);
      totalDeductions += result.allowed;
      if (result.trimmed) trimmed.push(category);
    }
  }

  const taxableIncome = Math.max(
    0,
    gross - standardDeduction - totalDeductions,
  );

  const taxBeforeRebate = taxOnSlabs(taxableIncome, input.regime);
  const rebate = rebate87A(taxableIncome, taxBeforeRebate, input.regime);
  const afterRebate = Math.max(0, taxBeforeRebate - rebate);
  const surcharge = surchargeOn(afterRebate, taxableIncome, input.regime);
  const cess = round((afterRebate + surcharge) * CESS_RATE);
  const totalTax = round(afterRebate + surcharge + cess);

  return {
    grossAnnualSalary: rupees(gross),
    standardDeduction: rupees(standardDeduction),
    totalDeductions: rupees(totalDeductions),
    taxableIncome: rupees(taxableIncome),
    taxBeforeRebate: rupees(taxBeforeRebate),
    rebate: rupees(rebate),
    surcharge: rupees(surcharge),
    cess: rupees(cess),
    totalTax: rupees(totalTax),
    monthlyTds: rupees(totalTax / 12),
    trimmed,
  };
}

/* ---------- Provident fund and state insurance ---------- */

export interface ContributionResult {
  employee: number;
  employer: number;
  /** Employer share diverted to the pension scheme. */
  pension?: number;
  applicable: boolean;
}

export function epfContribution(
  basicPlusDa: number,
  /** Some employers contribute on full wages rather than the ceiling. */
  applyCeiling = true,
): ContributionResult {
  const wage =
    Number.isFinite(basicPlusDa) && basicPlusDa > 0 ? basicPlusDa : 0;
  const base = applyCeiling ? Math.min(wage, EPF.wageCeiling) : wage;

  const employee = round(base * EPF.employeeRate);
  const pension = round(Math.min(base, EPF.wageCeiling) * EPF.epsRate);
  const employer = round(base * EPF.employerRate);

  return {
    employee,
    employer,
    pension,
    applicable: base > 0,
  };
}

export function esiContribution(monthlyGross: number): ContributionResult {
  const wage =
    Number.isFinite(monthlyGross) && monthlyGross > 0 ? monthlyGross : 0;

  // ESI applies only up to the coverage ceiling.
  if (wage === 0 || wage > ESI.wageCeiling) {
    return { employee: 0, employer: 0, applicable: false };
  }

  // Below the daily-wage exemption the employee pays nothing, employer still does.
  const dailyAverage = wage / 30;
  const employee =
    dailyAverage <= ESI.dailyWageExemption
      ? 0
      : round(wage * ESI.employeeRate);

  return {
    employee,
    employer: round(wage * ESI.employerRate),
    applicable: true,
  };
}
