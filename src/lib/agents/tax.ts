import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { getConfirmedRule } from '@/lib/data/rules';
import { listPeople } from '@/lib/data/knowledge';
import { capDeduction, computeAnnualTax } from '@/lib/rules/tax';
import type { Regime } from '@/lib/rules/tax-tables';

/**
 * Tax — declarations, proofs and the monthly TDS projection.
 *
 * Reads the organisation's confirmed `proof_category_cap` rule before falling
 * back to the statutory caps. Every figure comes from `src/lib/rules/tax.ts`.
 * A model may read a proof document elsewhere and report what it claims; what
 * that claim is worth is decided here, in tested code.
 */

export interface TaxRunResult {
  ok: boolean;
  error?: string;
  projected: number;
  trimmedClaims: number;
  usedConfirmedRule: boolean;
}

interface DeclarationRow {
  id: string;
  person_id: string;
  financial_year: string;
  regime: string;
  declared: Record<string, number> | null;
  verified_exemptions: Record<string, number> | null;
}

export async function runTax(
  orgId: string,
  dutyInstanceId: string,
): Promise<TaxRunResult> {
  const admin = createAdminClient();
  const now = new Date().toISOString();

  const [people, rule, declarationsRes] = await Promise.all([
    listPeople(orgId),
    getConfirmedRule(orgId, 'proof_category_cap'),
    admin
      .from('tax_declarations')
      .select('id, person_id, financial_year, regime, declared, verified_exemptions')
      .eq('org_id', orgId),
  ]);

  const ruleCaps = (rule?.definition ?? null) as Record<string, number> | null;
  const declarations = (declarationsRes.data ?? []) as DeclarationRow[];
  const byPerson = new Map(declarations.map((d) => [d.person_id, d]));

  const employees = people.filter((p) => p.type === 'employee');
  let trimmedClaims = 0;
  const projections: {
    personId: string;
    personName: string;
    declarationId: string | null;
    monthlyTds: number;
    regime: Regime;
  }[] = [];

  for (const person of employees) {
    const monthlyGross = Object.values(person.salaryStructure).reduce(
      (sum, value) => sum + (typeof value === 'number' ? value : 0),
      0,
    );
    if (monthlyGross <= 0) continue;

    const declaration = byPerson.get(person.id);

    // Regime on the declaration wins; then the person record; then the default.
    const regime: Regime =
      declaration?.regime === 'old' || declaration?.regime === 'new'
        ? declaration.regime
        : person.taxRegime === 'old'
          ? 'old'
          : 'new';

    // Only verified proofs reduce tax. A declared-but-unverified amount does not.
    const verified = declaration?.verified_exemptions ?? {};
    const deductions: Record<string, number> = {};

    for (const [category, amount] of Object.entries(verified)) {
      const value = Number(amount);
      if (!Number.isFinite(value) || value <= 0) continue;
      const capped = capDeduction(category, value, ruleCaps);
      deductions[category] = capped.allowed;
      if (capped.trimmed) trimmedClaims++;
    }

    const result = computeAnnualTax({
      grossAnnualSalary: monthlyGross * 12,
      regime,
      deductions,
      ruleCaps,
    });

    projections.push({
      personId: person.id,
      personName: person.fullName,
      declarationId: declaration?.id ?? null,
      monthlyTds: result.monthlyTds,
      regime,
    });

    if (declaration) {
      await admin
        .from('tax_declarations')
        .update({ monthly_tds: result.monthlyTds, updated_at: now })
        .eq('id', declaration.id);
    }
  }

  await admin.from('steps').insert({
    duty_instance_id: dutyInstanceId,
    capability: 'execute',
    input: {
      peopleCount: employees.length,
      declarationCount: declarations.length,
      fromConfirmedRule: Boolean(rule),
    },
    output: {
      summary: `Projected monthly tax for ${projections.length} ${
        projections.length === 1 ? 'person' : 'people'
      }.${trimmedClaims > 0 ? ` ${trimmedClaims} claims trimmed to their cap.` : ''}`,
      projections: projections.map((p) => ({
        person: p.personName,
        monthlyTds: p.monthlyTds,
        regime: p.regime,
      })),
    },
    at: now,
  });

  return {
    ok: true,
    projected: projections.length,
    trimmedClaims,
    usedConfirmedRule: Boolean(rule),
  };
}
