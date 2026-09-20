/**
 * The 50% wage-definition test, from the Code on Wages, 2019 (section 2(y)).
 *
 * Wages must be at least half of total remuneration. Where they are not, the
 * shortfall is treated as wages for statutory purposes. Deterministic and
 * tested: no model output reaches this file.
 */

export interface SalaryStructure {
  [component: string]: number;
}

/** Components that count as wages unless an organisation's confirmed rule says otherwise. */
export const DEFAULT_WAGE_COMPONENTS = ['basic', 'da', 'dearnessAllowance'];

/**
 * Components excluded from total remuneration when applying the test.
 * Statutory exclusions under section 2(y) that are not part of monthly pay.
 */
export const DEFAULT_EXCLUDED_COMPONENTS = [
  'gratuity',
  'pf',
  'employerPf',
  'esi',
  'employerEsi',
  'overtime',
  'commission',
  'hraStatutoryExclusion',
];

export interface WageDefinition {
  /** Component keys that count as wages. */
  wageComponents: string[];
  /** Component keys left out of the remuneration total. */
  excludedComponents: string[];
  /** The floor, as a fraction. Statutory value is 0.5. */
  threshold: number;
}

export const STATUTORY_WAGE_DEFINITION: WageDefinition = {
  wageComponents: DEFAULT_WAGE_COMPONENTS,
  excludedComponents: DEFAULT_EXCLUDED_COMPONENTS,
  threshold: 0.5,
};

export interface WageTestResult {
  /** Sum of the components that count as wages. */
  wages: number;
  /** Sum of all components counted as remuneration. */
  remuneration: number;
  /** wages / remuneration, 0 when there is no remuneration. */
  ratio: number;
  passed: boolean;
  /** Amount that must be reclassified as wages to reach the threshold. 0 when passing. */
  shortfall: number;
  threshold: number;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export function applyWageTest(
  structure: SalaryStructure,
  definition: WageDefinition = STATUTORY_WAGE_DEFINITION,
): WageTestResult {
  const wageKeys = new Set(definition.wageComponents);
  const excluded = new Set(definition.excludedComponents);

  let wages = 0;
  let remuneration = 0;

  for (const [component, rawValue] of Object.entries(structure)) {
    const value = Number(rawValue);
    if (!Number.isFinite(value) || value < 0) continue;
    if (excluded.has(component)) continue;

    remuneration += value;
    if (wageKeys.has(component)) wages += value;
  }

  const ratio = remuneration > 0 ? wages / remuneration : 0;
  const passed = remuneration === 0 ? true : ratio >= definition.threshold;
  const shortfall = passed
    ? 0
    : definition.threshold * remuneration - wages;

  return {
    wages: round(wages),
    remuneration: round(remuneration),
    ratio: remuneration > 0 ? Math.round(ratio * 10000) / 10000 : 0,
    passed,
    shortfall: round(shortfall),
    threshold: definition.threshold,
  };
}

/**
 * Reads an organisation's confirmed `wage_definition` rule. Anything the rule
 * does not state falls back to the statutory default, so a partial rule cannot
 * silently drop the threshold.
 */
export function wageDefinitionFrom(
  definition: Record<string, unknown> | null | undefined,
): WageDefinition {
  if (!definition) return STATUTORY_WAGE_DEFINITION;

  const wageComponents = asStringArray(
    definition.wageComponents ?? definition.wage_components ?? definition.includes,
  );
  const excludedComponents = asStringArray(
    definition.excludedComponents ??
      definition.excluded_components ??
      definition.excludes,
  );

  const rawThreshold = Number(
    definition.threshold ?? definition.minimumRatio ?? definition.minimum_ratio,
  );

  return {
    wageComponents: wageComponents ?? STATUTORY_WAGE_DEFINITION.wageComponents,
    excludedComponents:
      excludedComponents ?? STATUTORY_WAGE_DEFINITION.excludedComponents,
    // A rule may never raise the bar above what the statute requires being met,
    // but it may not lower it either — the statutory floor always applies.
    threshold:
      Number.isFinite(rawThreshold) && rawThreshold >= 0.5 && rawThreshold <= 1
        ? rawThreshold
        : STATUTORY_WAGE_DEFINITION.threshold,
  };
}

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const items = value.filter((v): v is string => typeof v === 'string');
  return items.length > 0 ? items : null;
}
