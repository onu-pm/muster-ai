import { describe, expect, it } from 'vitest';
import {
  applyWageTest,
  wageDefinitionFrom,
  STATUTORY_WAGE_DEFINITION,
} from './wage-definition';
import {
  reconcileLop,
  lopAmount,
  lopDivisorFrom,
  daysInMonth,
} from './lop';
import {
  capDeduction,
  computeAnnualTax,
  epfContribution,
  esiContribution,
  rebate87A,
  taxOnSlabs,
} from './tax';
import { readIntent, resolvePeriod, ordinal } from '@/lib/agents/intent';

describe('wage definition — the 50% test', () => {
  it('passes when basic and DA are at least half of remuneration', () => {
    const result = applyWageTest({ basic: 30_000, da: 5_000, hra: 25_000 });
    expect(result.wages).toBe(35_000);
    expect(result.remuneration).toBe(60_000);
    expect(result.passed).toBe(true);
    expect(result.shortfall).toBe(0);
  });

  it('fails and reports the shortfall when basic is too low', () => {
    // The structure on file in this project: 15000 + 2000 of 60000 = 28.3%.
    const result = applyWageTest({
      basic: 15_000,
      da: 2_000,
      hra: 20_000,
      specialAllowance: 23_000,
    });
    expect(result.remuneration).toBe(60_000);
    expect(result.wages).toBe(17_000);
    expect(result.ratio).toBeCloseTo(0.2833, 4);
    expect(result.passed).toBe(false);
    // Half of 60000 is 30000; 30000 - 17000 = 13000 must be reclassified.
    expect(result.shortfall).toBe(13_000);
  });

  it('treats exactly half as passing', () => {
    const result = applyWageTest({ basic: 25_000, hra: 25_000 });
    expect(result.ratio).toBe(0.5);
    expect(result.passed).toBe(true);
  });

  it('leaves statutory exclusions out of the remuneration total', () => {
    const result = applyWageTest({ basic: 20_000, hra: 20_000, gratuity: 9_999 });
    expect(result.remuneration).toBe(40_000);
    expect(result.passed).toBe(true);
  });

  it('ignores negative and non-numeric components rather than trusting them', () => {
    const result = applyWageTest({
      basic: 30_000,
      hra: -5_000,
      bonus: Number.NaN,
    });
    expect(result.remuneration).toBe(30_000);
    expect(result.wages).toBe(30_000);
  });

  it('does not divide by zero on an empty structure', () => {
    const result = applyWageTest({});
    expect(result.ratio).toBe(0);
    expect(result.passed).toBe(true);
    expect(result.shortfall).toBe(0);
  });
});

describe('wage definition — reading a confirmed rule', () => {
  it('falls back to the statutory default when there is no rule', () => {
    expect(wageDefinitionFrom(null)).toEqual(STATUTORY_WAGE_DEFINITION);
  });

  it('uses the components a confirmed rule names', () => {
    const definition = wageDefinitionFrom({
      wageComponents: ['basic', 'da', 'specialAllowance'],
    });
    expect(definition.wageComponents).toContain('specialAllowance');

    const result = applyWageTest(
      { basic: 15_000, da: 2_000, specialAllowance: 23_000, hra: 20_000 },
      definition,
    );
    expect(result.wages).toBe(40_000);
    expect(result.passed).toBe(true);
  });

  it('refuses a rule that tries to drop below the statutory floor', () => {
    expect(wageDefinitionFrom({ threshold: 0.25 }).threshold).toBe(0.5);
    expect(wageDefinitionFrom({ threshold: 0.6 }).threshold).toBe(0.6);
  });
});

describe('loss of pay', () => {
  const september = { daysInMonth: 30 };

  it('charges nothing when the month is fully accounted for', () => {
    const [line] = reconcileLop(
      [
        {
          personRef: 'p1',
          personName: 'Priya Rao',
          daysPresent: 28,
          ...september,
        },
      ],
      [
        { personRef: 'p1', date: '2026-09-10', paid: true, kind: 'annual' },
        { personRef: 'p1', date: '2026-09-11', paid: true, kind: 'annual' },
      ],
    );
    expect(line.lopDays).toBe(0);
    expect(line.needsReview).toBe(false);
  });

  it('counts unpaid leave as lost pay without flagging it', () => {
    const [line] = reconcileLop(
      [
        {
          personRef: 'p1',
          personName: 'Priya Rao',
          daysPresent: 28,
          ...september,
        },
      ],
      [
        { personRef: 'p1', date: '2026-09-10', paid: false, kind: 'unpaid' },
        { personRef: 'p1', date: '2026-09-11', paid: false, kind: 'unpaid' },
      ],
    );
    expect(line.unpaidLeaveDays).toBe(2);
    expect(line.lopDays).toBe(2);
    expect(line.needsReview).toBe(false);
  });

  it('flags a gap the leave ledger does not explain', () => {
    // This is the lop_discrepancy case already on the exception desk.
    const [line] = reconcileLop(
      [
        {
          personRef: 'p1',
          personName: 'Priya Rao',
          daysPresent: 29,
          ...september,
        },
      ],
      [],
    );
    expect(line.unexplainedDays).toBe(1);
    expect(line.lopDays).toBe(1);
    expect(line.needsReview).toBe(true);
  });

  it('never returns a negative figure when attendance overshoots the month', () => {
    const [line] = reconcileLop(
      [
        {
          personRef: 'p1',
          personName: 'Odd Data',
          daysPresent: 45,
          ...september,
        },
      ],
      [],
    );
    expect(line.daysPresent).toBe(30);
    expect(line.lopDays).toBe(0);
  });

  it('keeps people separate', () => {
    const lines = reconcileLop(
      [
        { personRef: 'a', personName: 'A', daysPresent: 30, ...september },
        { personRef: 'b', personName: 'B', daysPresent: 28, ...september },
      ],
      [{ personRef: 'b', date: '2026-09-02', paid: false, kind: 'unpaid' }],
    );
    expect(lines[0].lopDays).toBe(0);
    expect(lines[1].unpaidLeaveDays).toBe(1);
    expect(lines[1].unexplainedDays).toBe(1);
  });
});

describe('loss of pay — amount', () => {
  it('prorates on the divisor given', () => {
    expect(lopAmount(60_000, 2, 30)).toBe(4_000);
    expect(lopAmount(60_000, 2, 26)).toBeCloseTo(4_615.38, 2);
  });

  it('returns zero for nonsense input rather than a wrong number', () => {
    expect(lopAmount(0, 2, 30)).toBe(0);
    expect(lopAmount(60_000, 0, 30)).toBe(0);
    expect(lopAmount(60_000, 2, 0)).toBe(0);
    expect(lopAmount(Number.NaN, 2, 30)).toBe(0);
  });

  it('never withholds more than a full month', () => {
    expect(lopAmount(60_000, 45, 30)).toBe(60_000);
  });

  it('uses calendar days unless a rule fixes the divisor', () => {
    expect(lopDivisorFrom(null, 30)).toBe(30);
    expect(lopDivisorFrom({ divisor: 26 }, 30)).toBe(26);
    expect(lopDivisorFrom({ divisor: 99 }, 30)).toBe(30);
  });

  it('knows the length of a month', () => {
    expect(daysInMonth(2026, 9)).toBe(30);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2024, 2)).toBe(29);
  });
});

describe('income tax', () => {
  it('charges nothing at or below the first slab', () => {
    expect(taxOnSlabs(400_000, 'new')).toBe(0);
  });

  it('applies new-regime slabs band by band', () => {
    // 4L-8L at 5% = 20,000.
    expect(taxOnSlabs(800_000, 'new')).toBe(20_000);
    // plus 8L-12L at 10% = 40,000.
    expect(taxOnSlabs(1_200_000, 'new')).toBe(60_000);
  });

  it('wipes out tax under the rebate at the new-regime limit', () => {
    const tax = taxOnSlabs(1_200_000, 'new');
    expect(rebate87A(1_200_000, tax, 'new')).toBe(60_000);

    const result = computeAnnualTax({
      grossAnnualSalary: 1_275_000,
      regime: 'new',
    });
    expect(result.taxableIncome).toBe(1_200_000);
    expect(result.totalTax).toBe(0);
  });

  it('charges tax just above the rebate limit', () => {
    const result = computeAnnualTax({
      grossAnnualSalary: 1_400_000,
      regime: 'new',
    });
    expect(result.taxableIncome).toBe(1_325_000);
    expect(result.totalTax).toBeGreaterThan(0);
  });

  it('adds 4% cess on top', () => {
    const result = computeAnnualTax({
      grossAnnualSalary: 2_000_000,
      regime: 'new',
    });
    const beforeCess = result.taxBeforeRebate - result.rebate + result.surcharge;
    expect(result.cess).toBe(Math.round(beforeCess * 0.04));
  });

  it('splits the annual figure into twelve', () => {
    const result = computeAnnualTax({
      grossAnnualSalary: 2_000_000,
      regime: 'new',
    });
    expect(result.monthlyTds).toBe(Math.round(result.totalTax / 12));
  });

  it('ignores Chapter VI-A deductions under the new regime', () => {
    const withDeductions = computeAnnualTax({
      grossAnnualSalary: 1_500_000,
      regime: 'new',
      deductions: { '80C': 150_000 },
    });
    const without = computeAnnualTax({
      grossAnnualSalary: 1_500_000,
      regime: 'new',
    });
    expect(withDeductions.totalTax).toBe(without.totalTax);
    expect(withDeductions.totalDeductions).toBe(0);
  });

  it('allows them under the old regime', () => {
    const result = computeAnnualTax({
      grossAnnualSalary: 1_500_000,
      regime: 'old',
      deductions: { '80C': 150_000, '80D': 25_000 },
    });
    expect(result.totalDeductions).toBe(175_000);
    expect(result.taxableIncome).toBe(1_500_000 - 50_000 - 175_000);
  });

  it('never returns a negative figure for a tiny salary', () => {
    const result = computeAnnualTax({
      grossAnnualSalary: 30_000,
      regime: 'new',
    });
    expect(result.taxableIncome).toBe(0);
    expect(result.totalTax).toBe(0);
  });
});

describe('deduction caps', () => {
  it('trims a declaration to the statutory ceiling', () => {
    const result = capDeduction('80C', 200_000);
    expect(result.allowed).toBe(150_000);
    expect(result.trimmed).toBe(true);
  });

  it('leaves a declaration inside the cap alone', () => {
    const result = capDeduction('80C', 90_000);
    expect(result.allowed).toBe(90_000);
    expect(result.trimmed).toBe(false);
  });

  it('lets a confirmed rule tighten a cap but never loosen it', () => {
    expect(capDeduction('80D', 40_000, { '80D': 15_000 }).allowed).toBe(15_000);
    expect(capDeduction('80D', 40_000, { '80D': 999_999 }).allowed).toBe(25_000);
  });

  it('treats a negative declaration as nothing claimed', () => {
    expect(capDeduction('80C', -5_000).allowed).toBe(0);
  });
});

describe('provident fund and state insurance', () => {
  it('applies the wage ceiling by default', () => {
    const result = epfContribution(50_000);
    expect(result.employee).toBe(1_800);
    expect(result.pension).toBeCloseTo(1_249.5, 2);
  });

  it('contributes on full wages when the ceiling is waived', () => {
    const result = epfContribution(50_000, false);
    expect(result.employee).toBe(6_000);
    // The pension share stays bounded by the ceiling regardless.
    expect(result.pension).toBeCloseTo(1_249.5, 2);
  });

  it('applies ESI only within the coverage ceiling', () => {
    const covered = esiContribution(20_000);
    expect(covered.applicable).toBe(true);
    expect(covered.employee).toBe(150);
    expect(covered.employer).toBe(650);

    const above = esiContribution(25_000);
    expect(above.applicable).toBe(false);
    expect(above.employee).toBe(0);
  });

  it('exempts the employee below the daily wage floor but not the employer', () => {
    const result = esiContribution(5_000);
    expect(result.employee).toBe(0);
    expect(result.employer).toBeGreaterThan(0);
  });
});

describe('reading what someone typed', () => {
  const now = new Date('2026-09-20T00:00:00Z');

  it('recognises a payroll run and its month', () => {
    const intent = readIntent('Run September payroll', now);
    expect(intent.kind).toBe('run_payroll');
    if (intent.kind === 'run_payroll') {
      expect(intent.month).toBe(9);
      expect(intent.year).toBe(2026);
      expect(intent.periodLabel).toBe('September 2026');
    }
  });

  it('reads a month still ahead as last year', () => {
    const intent = readIntent('run december payroll', now);
    if (intent.kind === 'run_payroll') expect(intent.year).toBe(2025);
  });

  it('honours an explicit year', () => {
    const intent = readIntent('run march payroll 2024', now);
    if (intent.kind === 'run_payroll') {
      expect(intent.month).toBe(3);
      expect(intent.year).toBe(2024);
    }
  });

  it('separates a status question from a payroll run', () => {
    expect(readIntent("what's pending?", now).kind).toBe('status');
    expect(readIntent('tell me a joke', now).kind).toBe('unknown');
  });

  it('tells a recurring instruction apart from a one-off run', () => {
    const once = readIntent('Run September payroll', now);
    expect(once.kind).toBe('run_payroll');

    const repeating = readIntent('Run payroll every month on the 25th', now);
    expect(repeating.kind).toBe('schedule_payroll');
    if (repeating.kind === 'schedule_payroll') {
      expect(repeating.day).toBe(25);
      expect(repeating.cadenceLabel).toBe('the 25th of each month');
    }
  });

  it('reads the other ways people phrase a schedule', () => {
    for (const phrase of [
      'run payroll monthly on the 1st',
      'schedule payroll for the 3rd each month',
      'from now on run payroll on the 22nd',
    ]) {
      expect(readIntent(phrase, now).kind).toBe('schedule_payroll');
    }
  });

  it('falls back to the 1st when no day is given, never to a guess', () => {
    const intent = readIntent('run payroll every month', now);
    if (intent.kind === 'schedule_payroll') expect(intent.day).toBe(1);
  });

  it('refuses a day that cannot exist in every month', () => {
    const intent = readIntent('run payroll every month on the 31st', now);
    if (intent.kind === 'schedule_payroll') expect(intent.day).toBe(1);
  });

  it('writes ordinals the way a person would', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23].map(ordinal)).toEqual([
      '1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd',
    ]);
  });

  it('resolves a period without guessing a future year', () => {
    expect(resolvePeriod(8, null, now)).toEqual({ month: 9, year: 2026 });
    expect(resolvePeriod(11, null, now)).toEqual({ month: 12, year: 2025 });
    expect(resolvePeriod(11, 2023, now)).toEqual({ month: 12, year: 2023 });
  });
});
