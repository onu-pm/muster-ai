import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { getConfirmedRule } from '@/lib/data/rules';
import { listPeople } from '@/lib/data/knowledge';
import {
  applyWageTest,
  wageDefinitionFrom,
  type SalaryStructure,
} from '@/lib/rules/wage-definition';

/**
 * Structure — salary structures and the wage-definition test.
 *
 * Reads the organisation's confirmed `wage_definition` rule before falling back
 * to the statutory definition, then applies the 50% test from
 * `src/lib/rules/wage-definition.ts`. Every figure comes from that tested code.
 */

export interface StructureRunResult {
  ok: boolean;
  error?: string;
  /** People who had a structure to test. */
  checked: number;
  /** People with nothing on file to test — neither passed nor failed. */
  withoutStructure: number;
  breaches: number;
  usedConfirmedRule: boolean;
}

export async function runStructure(
  orgId: string,
  dutyInstanceId: string,
): Promise<StructureRunResult> {
  const [people, rule] = await Promise.all([
    listPeople(orgId),
    getConfirmedRule(orgId, 'wage_definition'),
  ]);

  const definition = wageDefinitionFrom(rule?.definition);
  const admin = createAdminClient();
  const now = new Date().toISOString();

  const employees = people.filter((p) => p.type === 'employee');

  // Someone with no structure on file has not "passed" the test — there was
  // nothing to test. Counting them as passing would be the kind of quiet lie
  // this whole system exists to avoid.
  const withStructure = employees.filter(
    (p) => Object.values(p.salaryStructure).some((v) => Number(v) > 0),
  );
  const withoutStructure = employees.length - withStructure.length;

  const results = withStructure.map((person) => ({
    person,
    result: applyWageTest(person.salaryStructure as SalaryStructure, definition),
  }));

  const breaches = results.filter(({ result }) => !result.passed);

  await admin.from('steps').insert({
    duty_instance_id: dutyInstanceId,
    capability: 'execute',
    input: {
      wageDefinition: definition,
      fromConfirmedRule: Boolean(rule),
      peopleCount: employees.length,
      testable: withStructure.length,
      withoutStructure,
    },
    output: {
      summary: `Checked the basic-pay split for ${withStructure.length} of ${
        employees.length
      }. ${breaches.length} below the statutory half.${
        withoutStructure > 0
          ? ` ${withoutStructure} have no salary structure on record.`
          : ''
      }`,
      results: results.map(({ person, result }) => ({
        person: person.fullName,
        ratio: result.ratio,
        passed: result.passed,
      })),
    },
    at: now,
  });

  if (breaches.length > 0) {
    await admin.from('exceptions').insert(
      breaches.map(({ person, result }) => ({
        duty_instance_id: dutyInstanceId,
        kind: 'wage_definition_breach',
        conclusion: `${person.fullName}: basic and dearness allowance are ${(
          result.ratio * 100
        ).toFixed(1)}% of total wages, below the statutory 50%.`,
        // The arithmetic is certain; what to do about it is the judgment call.
        confidence: 0.95,
        status: 'open',
        opened_at: now,
        payload: {
          personName: person.fullName,
          personRef: person.id,
          evidence: {
            wages: result.wages,
            remuneration: result.remuneration,
            ratio: result.ratio,
            shortfall: result.shortfall,
          },
          usedConfirmedRule: Boolean(rule),
          ruleApplied: rule
            ? `Your confirmed wage definition: ${rule.label ?? 'company policy'}.`
            : 'Basic and dearness allowance together must be at least 50% of total wages.',
        },
      })),
    );

    // salary_revisions carries the test result alongside the structure it judged.
    await admin.from('salary_revisions').insert(
      breaches.map(({ person, result }) => ({
        org_id: orgId,
        person_id: person.id,
        duty_instance_id: dutyInstanceId,
        reason: 'Wage definition test failed during the monthly run',
        previous_structure: person.salaryStructure,
        new_structure: person.salaryStructure,
        effective_from: now.slice(0, 10),
        basic_wage: result.wages,
        gross_wage: result.remuneration,
        wage_test_ratio: result.ratio,
        wage_test_passed: result.passed,
      })),
    );
  }

  return {
    ok: true,
    checked: withStructure.length,
    withoutStructure,
    breaches: breaches.length,
    usedConfirmedRule: Boolean(rule),
  };
}
