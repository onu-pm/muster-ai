import type { SalaryStructure } from './wage-definition';

/**
 * Splitting an annual package into a monthly structure.
 *
 * Deterministic and tested. This is the only place a package becomes component
 * figures, and no model output reaches it — Hansel can ask for a split, but the
 * arithmetic happens here.
 */

export interface StructureShape {
  /** Basic as a share of gross. */
  basicPct: number;
  /** HRA as a share of gross. */
  hraPct: number;
}

/**
 * Basic at half of gross clears the wage-definition test by construction, and
 * HRA at 40% of basic is the usual non-metro figure. An organisation's own
 * confirmed `ctc_breakup` rule overrides both.
 */
export const DEFAULT_SHAPE: StructureShape = {
  basicPct: 0.5,
  hraPct: 0.2,
};

export function structureFromRule(
  definition: Record<string, unknown> | null | undefined,
): StructureShape {
  if (!definition) return DEFAULT_SHAPE;

  const basic = Number(definition.basic_pct ?? definition.basicPct);
  const hra = Number(definition.hra_pct ?? definition.hraPct);

  const shape = {
    basicPct:
      Number.isFinite(basic) && basic > 0 && basic <= 100
        ? basic > 1
          ? basic / 100
          : basic
        : DEFAULT_SHAPE.basicPct,
    hraPct:
      Number.isFinite(hra) && hra >= 0 && hra <= 100
        ? hra > 1
          ? hra / 100
          : hra
        : DEFAULT_SHAPE.hraPct,
  };

  // A split whose parts exceed the whole is not a split.
  if (shape.basicPct + shape.hraPct >= 1) return DEFAULT_SHAPE;
  return shape;
}

export function splitCtc(
  annualCtc: number,
  shape: StructureShape = DEFAULT_SHAPE,
): SalaryStructure & {
  basic: number;
  hra: number;
  specialAllowance: number;
} {
  if (!Number.isFinite(annualCtc) || annualCtc <= 0) {
    return { basic: 0, hra: 0, specialAllowance: 0 };
  }

  const monthly = annualCtc / 12;
  const basic = Math.round(monthly * shape.basicPct);
  const hra = Math.round(monthly * shape.hraPct);

  // Whatever is left, so the parts always add back to the whole.
  const specialAllowance = Math.max(0, Math.round(monthly) - basic - hra);

  return { basic, hra, specialAllowance };
}
