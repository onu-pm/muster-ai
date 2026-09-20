import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { getConfirmedRule } from '@/lib/data/rules';
import { listPeople } from '@/lib/data/knowledge';
import {
  applyWageTest,
  wageDefinitionFrom,
} from '@/lib/rules/wage-definition';
import { splitCtc, structureFromRule } from '@/lib/rules/structure';
import { register } from './registry';
import { formatMoney } from '@/lib/copy/labels';

/**
 * Holly's side of a handoff.
 *
 * These are the things other teammates ask her for. Every figure comes from the
 * tested rule code — Hansel can ask for a structure, but he never works one out,
 * and neither does any model.
 */

const HOLLY = 'Holly';

register({
  key: 'payroll.draft_structure',
  teammate: HOLLY,
  describe: 'split an annual package into a compliant monthly structure',
  async run(ctx, input) {
    const name = String(input.name ?? 'them');
    const annualCtc = Number(input.annualCtc);
    const personId = input.personId ? String(input.personId) : null;

    if (!Number.isFinite(annualCtc) || annualCtc <= 0) {
      return {
        ok: false,
        error: 'No annual figure given.',
        messages: [
          {
            from: HOLLY,
            body: "I need the annual package before I can split it.",
          },
        ],
      };
    }

    // An organisation's own breakup rule wins over the default split.
    const [breakupRule, wageRule] = await Promise.all([
      getConfirmedRule(ctx.orgId, 'ctc_breakup'),
      getConfirmedRule(ctx.orgId, 'wage_definition'),
    ]);

    const shape = structureFromRule(breakupRule?.definition);
    const structure = splitCtc(annualCtc, shape);
    const test = applyWageTest(
      structure,
      wageDefinitionFrom(wageRule?.definition),
    );

    const messages = [
      {
        from: HOLLY,
        body:
          `On ${formatMoney(annualCtc)} a year, that's ${formatMoney(structure.basic)} basic, ` +
          `${formatMoney(structure.hra)} HRA and ${formatMoney(structure.specialAllowance)} special allowance a month` +
          (breakupRule ? ', using your own breakup rule.' : '.'),
      },
    ];

    messages.push({
      from: HOLLY,
      body: test.passed
        ? `Basic is ${(test.ratio * 100).toFixed(0)}% of wages, so it clears the statutory half.`
        : `Careful — basic works out at ${(test.ratio * 100).toFixed(0)}% of wages, under the statutory half. ${formatMoney(test.shortfall)} would have to be treated as wages anyway. Worth fixing the split before it goes out.`,
    });

    if (personId) {
      await createAdminClient()
        .from('people')
        .update({
          salary_structure: structure,
          updated_at: new Date().toISOString(),
        })
        .eq('id', personId);
    }

    return {
      ok: true,
      messages,
      data: {
        structure,
        wageTestPassed: test.passed,
        wageTestRatio: test.ratio,
      },
    };
  },
});

register({
  key: 'payroll.place_on_payroll',
  teammate: HOLLY,
  describe: 'confirm someone is ready to be paid',
  async run(ctx, input) {
    const name = String(input.name ?? 'them');
    const personId = String(input.personId ?? '');

    const people = await listPeople(ctx.orgId);
    const person = people.find((p) => p.id === personId);

    if (!person) {
      return {
        ok: false,
        error: 'No such person.',
        messages: [
          { from: HOLLY, body: `I can't find ${name} on my side yet.` },
        ],
      };
    }

    const hasStructure = Object.values(person.salaryStructure).some(
      (v) => Number(v) > 0,
    );

    if (!hasStructure) {
      return {
        ok: true,
        messages: [
          {
            from: HOLLY,
            body: `I've got ${person.fullName}, but there's no salary structure on them yet — so they won't be picked up in a run. Give me the package and I'll sort the split.`,
          },
        ],
        data: { readyToPay: false, reason: 'no_structure' },
      };
    }

    const monthly = Object.values(person.salaryStructure).reduce(
      (sum, v) => sum + (Number(v) || 0),
      0,
    );

    return {
      ok: true,
      messages: [
        {
          from: HOLLY,
          body: `${person.fullName} is on my list at ${formatMoney(monthly)} a month. They'll be in the next run — I'll still bring you anything that looks off.`,
        },
      ],
      data: { readyToPay: true, monthlyGross: monthly },
    };
  },
});

register({
  key: 'payroll.person_summary',
  teammate: HOLLY,
  describe: 'what payroll knows about someone',
  async run(ctx, input) {
    const name = String(input.name ?? '').toLowerCase();
    const people = await listPeople(ctx.orgId);
    const person = people.find((p) => p.fullName.toLowerCase().includes(name));

    if (!person) {
      return {
        ok: false,
        error: 'Not found.',
        messages: [
          { from: HOLLY, body: `I don't have anyone matching "${name}".` },
        ],
      };
    }

    const monthly = Object.values(person.salaryStructure).reduce(
      (sum, v) => sum + (Number(v) || 0),
      0,
    );

    return {
      ok: true,
      messages: [
        {
          from: HOLLY,
          body:
            monthly > 0
              ? `${person.fullName} is on ${formatMoney(monthly)} a month.`
              : `${person.fullName} has no salary structure on file with me.`,
        },
      ],
      data: { personId: person.id, monthlyGross: monthly },
    };
  },
});
