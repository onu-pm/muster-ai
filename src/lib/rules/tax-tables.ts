/**
 * Statutory rate tables for Indian payroll, FY 2026-27 (AY 2027-28).
 *
 * PROVENANCE — see README. Each block records where its figures came from and
 * whether they were confirmed against a primary government source. Nothing here
 * is produced by a model, and no figure in this file may be changed without
 * re-checking it against the source named beside it.
 */

export type Regime = 'old' | 'new';

export interface Slab {
  /** Upper bound of the band, inclusive. `null` means no upper bound. */
  upTo: number | null;
  rate: number;
}

/**
 * Section 115BAC, FY 2026-27.
 * SOURCE: not verified against a primary source — incometaxindia.gov.in
 * refused automated access (HTTP 403). Corroborated across independent tax
 * publishers only. Re-check before this is used for real filing.
 */
export const NEW_REGIME_SLABS: Slab[] = [
  { upTo: 400_000, rate: 0 },
  { upTo: 800_000, rate: 0.05 },
  { upTo: 1_200_000, rate: 0.1 },
  { upTo: 1_600_000, rate: 0.15 },
  { upTo: 2_000_000, rate: 0.2 },
  { upTo: 2_400_000, rate: 0.25 },
  { upTo: null, rate: 0.3 },
];

/**
 * Old regime, individuals below 60.
 * SOURCE: not verified against a primary source (see above).
 */
export const OLD_REGIME_SLABS: Slab[] = [
  { upTo: 250_000, rate: 0 },
  { upTo: 500_000, rate: 0.05 },
  { upTo: 1_000_000, rate: 0.2 },
  { upTo: null, rate: 0.3 },
];

/** SOURCE: not verified against a primary source (see above). */
export const STANDARD_DEDUCTION: Record<Regime, number> = {
  new: 75_000,
  old: 50_000,
};

/**
 * Section 87A rebate.
 * SOURCE: not verified against a primary source (see above).
 */
export const REBATE_87A: Record<
  Regime,
  { incomeLimit: number; maxRebate: number }
> = {
  new: { incomeLimit: 1_200_000, maxRebate: 60_000 },
  old: { incomeLimit: 500_000, maxRebate: 12_500 },
};

/** Health and education cess. SOURCE: not verified against a primary source. */
export const CESS_RATE = 0.04;

/**
 * Surcharge on tax where total income exceeds the threshold.
 * The new regime caps surcharge at 25%.
 * SOURCE: not verified against a primary source (see above).
 */
export const SURCHARGE_BANDS: { above: number; rate: number }[] = [
  { above: 50_00_000, rate: 0.1 },
  { above: 1_00_00_000, rate: 0.15 },
  { above: 2_00_00_000, rate: 0.25 },
  { above: 5_00_00_000, rate: 0.37 },
];

export const NEW_REGIME_MAX_SURCHARGE = 0.25;

/**
 * Deduction ceilings, old regime only.
 * SOURCE: not verified against a primary source (see above).
 */
export const DEDUCTION_CAPS: Record<string, number> = {
  '80C': 150_000,
  '80CCD1B': 50_000,
  '80D': 25_000,
  '80D_SENIOR': 50_000,
  '24B': 200_000,
  '80E': Number.POSITIVE_INFINITY,
  '80G': Number.POSITIVE_INFINITY,
};

/**
 * Employees' Provident Fund.
 * SOURCE: epfo.gov.in — employer pays 12%, of which 8.33% is diverted to the
 * Pension Fund, plus 0.5% of pay to EDLI; the wage ceiling for mandatory
 * membership and for restricting contribution is Rs 15,000 of basic + DA.
 * Confirmed from EPFO's own published material; the contribution-rate PDF
 * itself could not be parsed, so the admin-charge figure below is the least
 * certain of these.
 */
export const EPF = {
  employeeRate: 0.12,
  employerRate: 0.12,
  epsRate: 0.0833,
  edliRate: 0.005,
  adminChargeRate: 0.005,
  wageCeiling: 15_000,
};

/**
 * Employees' State Insurance.
 * SOURCE: esic.gov.in/contribution — "0.75% of the wages" for employees and
 * "3.25% of the wages paid/payable" for employers, in force since 1 July 2019.
 * Employees on a daily average wage up to Rs 176 are exempt from paying their
 * share, though the employer still contributes.
 * VERIFIED against the primary source.
 *
 * The Rs 21,000 monthly coverage ceiling is NOT stated on that page and is
 * carried here unverified.
 */
export const ESI = {
  employeeRate: 0.0075,
  employerRate: 0.0325,
  wageCeiling: 21_000,
  dailyWageExemption: 176,
  effectiveFrom: '2019-07-01',
};
