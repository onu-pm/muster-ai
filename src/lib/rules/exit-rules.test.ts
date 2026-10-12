import { describe, expect, it } from 'vitest';
import {
  GRATUITY_CEILING,
  completedYears,
  daysBetween,
  gratuity,
} from './gratuity';
import {
  DEFAULT_LEAVE_POLICY,
  encashmentAmount,
  leaveBalance,
  leavePolicyFrom,
  monthsOfServiceInYear,
} from './leave-balance';
import {
  DEFAULT_NOTICE_POLICY,
  noticePolicyFrom,
  noticeShortfall,
} from './notice';
import { prepareSettlement } from './settlement';

/**
 * These cover the figures that reach a person at the end of their employment.
 * A settlement is the last payment an employer makes and no later month catches
 * a mistake in it, so each component is pinned separately and then pinned again
 * in composition.
 */

describe('gratuity — Payment of Gratuity Act 1972', () => {
  it('pays nothing under five years of continuous service', () => {
    const result = gratuity({
      basicAndDa: 50_000,
      doj: '2021-01-01',
      lastDay: '2024-06-30',
    });

    expect(result.eligible).toBe(false);
    expect(result.amount).toBe(0);
  });

  it('applies the 15/26 formula on completed years', () => {
    // 10 years exactly, basic+DA 26,000: 26000 * 15/26 * 10 = 150,000.
    const result = gratuity({
      basicAndDa: 26_000,
      doj: '2014-01-01',
      lastDay: '2024-01-01',
    });

    expect(result.eligible).toBe(true);
    expect(result.countedYears).toBe(10);
    expect(result.amount).toBe(150_000);
  });

  it('rounds a part year up only when it exceeds six months', () => {
    // 182 days over is not "in excess of six months"; 183 is.
    expect(completedYears(7 * 365 + 182)).toBe(7);
    expect(completedYears(7 * 365 + 183)).toBe(8);
  });

  it('caps at the statutory ceiling', () => {
    const result = gratuity({
      basicAndDa: 5_00_000,
      doj: '1990-01-01',
      lastDay: '2024-01-01',
    });

    expect(result.amount).toBe(GRATUITY_CEILING);
    expect(result.capped).toBe(true);
  });

  it('waives the five-year condition on death or disablement', () => {
    const result = gratuity({
      basicAndDa: 26_000,
      doj: '2022-01-01',
      lastDay: '2024-01-01',
      reason: 'death',
    });

    expect(result.eligible).toBe(true);
    expect(result.countedYears).toBe(2);
  });

  it('flags four years and 240 days without paying it', () => {
    const doj = '2020-01-01';
    const lastDay = new Date(
      new Date(doj).getTime() + (4 * 365 + 250) * 86_400_000,
    )
      .toISOString()
      .slice(0, 10);

    const result = gratuity({ basicAndDa: 30_000, doj, lastDay });

    expect(result.eligible).toBe(false);
    expect(result.amount).toBe(0);
    // The contested reading is surfaced for a person, never applied.
    expect(result.contestedEligibility).toBe(true);
  });

  it('treats anything paid above the statutory amount as taxable', () => {
    const result = gratuity({
      basicAndDa: 26_000,
      doj: '2014-01-01',
      lastDay: '2024-01-01',
      exGratia: 50_000,
    });

    expect(result.exemptAmount).toBe(150_000);
    expect(result.taxableExcess).toBe(50_000);
    expect(result.amount).toBe(200_000);
  });

  it('counts days between two dates inclusively of the span', () => {
    expect(daysBetween('2024-01-01', '2024-01-31')).toBe(30);
  });
});

describe('leave balance', () => {
  it('pro-rates entitlement for a part year of service', () => {
    const months = monthsOfServiceInYear(
      '2024-07-01',
      new Date('2024-01-01'),
      new Date('2024-12-31'),
    );
    expect(months).toBe(6);
  });

  it('caps what may be carried forward', () => {
    const balance = leaveBalance({
      policy: { ...DEFAULT_LEAVE_POLICY, carryForwardCapDays: 10 },
      doj: '2020-01-01',
      carriedForwardRaw: 40,
      takenThisYear: 0,
      yearStart: new Date('2024-01-01'),
      asOf: new Date('2024-12-31'),
    });

    expect(balance.carriedForward).toBe(10);
    expect(balance.available).toBe(28);
  });

  it('never lets a balance go negative when more was taken than earned', () => {
    const balance = leaveBalance({
      policy: DEFAULT_LEAVE_POLICY,
      doj: '2024-01-01',
      carriedForwardRaw: 0,
      takenThisYear: 40,
      yearStart: new Date('2024-01-01'),
      asOf: new Date('2024-12-31'),
    });

    expect(balance.available).toBe(0);
    expect(balance.encashable).toBe(0);
  });

  it('separates what is left from what may be paid out', () => {
    const balance = leaveBalance({
      policy: { ...DEFAULT_LEAVE_POLICY, encashableCapDays: 5 },
      doj: '2020-01-01',
      carriedForwardRaw: 20,
      takenThisYear: 0,
      yearStart: new Date('2024-01-01'),
      asOf: new Date('2024-12-31'),
    });

    expect(balance.available).toBe(38);
    expect(balance.encashable).toBe(5);
  });

  it('values a paid-out day on basic over a thirty-day month', () => {
    expect(encashmentAmount({ basicAndDa: 30_000, days: 10 })).toBe(10_000);
  });

  it('falls back to the default policy on nonsense input', () => {
    const policy = leavePolicyFrom({ annual_entitlement_days: -5 });
    expect(policy.annualEntitlementDays).toBe(
      DEFAULT_LEAVE_POLICY.annualEntitlementDays,
    );
  });
});

describe('notice period', () => {
  it('recovers the shortfall on basic by default', () => {
    const result = noticeShortfall({
      policy: DEFAULT_NOTICE_POLICY,
      resignedOn: '2024-06-01',
      lastDay: '2024-06-16',
      basicAndDa: 30_000,
      monthlyGross: 60_000,
    });

    expect(result.shortfallDays).toBe(15);
    expect(result.recovery).toBe(15_000);
  });

  it('recovers nothing when the full notice was served', () => {
    const result = noticeShortfall({
      policy: DEFAULT_NOTICE_POLICY,
      resignedOn: '2024-06-01',
      lastDay: '2024-07-05',
      basicAndDa: 30_000,
      monthlyGross: 60_000,
    });

    expect(result.recovery).toBe(0);
    expect(result.overserved).toBe(true);
  });

  it('does not pay for notice served beyond the requirement', () => {
    const result = noticeShortfall({
      policy: DEFAULT_NOTICE_POLICY,
      resignedOn: '2024-01-01',
      lastDay: '2024-06-01',
      basicAndDa: 30_000,
      monthlyGross: 60_000,
    });

    expect(result.recovery).toBe(0);
  });

  it('honours waived days', () => {
    const result = noticeShortfall({
      policy: DEFAULT_NOTICE_POLICY,
      resignedOn: '2024-06-01',
      lastDay: '2024-06-16',
      basicAndDa: 30_000,
      monthlyGross: 60_000,
      waivedDays: 15,
    });

    expect(result.shortfallDays).toBe(0);
    expect(result.recovery).toBe(0);
  });

  it('recovers nothing when there is no resignation date to measure from', () => {
    const result = noticeShortfall({
      policy: DEFAULT_NOTICE_POLICY,
      resignedOn: null,
      lastDay: '2024-06-16',
      basicAndDa: 30_000,
      monthlyGross: 60_000,
    });

    expect(result.recovery).toBe(0);
  });

  it('reads a confirmed policy, and rejects an impossible divisor', () => {
    expect(noticePolicyFrom({ notice_days: 60, base: 'gross' })).toMatchObject({
      noticeDays: 60,
      base: 'gross',
    });
    expect(noticePolicyFrom({ divisor: 0 }).divisor).toBe(
      DEFAULT_NOTICE_POLICY.divisor,
    );
  });
});

describe('full and final settlement', () => {
  const base = {
    fullName: 'Priya Nair',
    doj: '2014-04-01',
    lastDay: '2024-06-20',
    resignedOn: '2024-05-21',
    reason: 'resignation' as const,
    monthlyGross: 60_000,
    basicAndDa: 30_000,
    daysWorkedInFinalMonth: 20,
    daysInFinalMonth: 30,
    payDivisor: 30,
    noticePolicy: DEFAULT_NOTICE_POLICY,
    outstandingLoans: [],
    leavePolicyConfirmed: true,
    noticePolicyConfirmed: true,
    leave: leaveBalance({
      policy: DEFAULT_LEAVE_POLICY,
      doj: '2014-04-01',
      carriedForwardRaw: 12,
      takenThisYear: 4,
      yearStart: new Date('2024-01-01'),
      asOf: new Date('2024-06-20'),
    }),
  };

  it('itemises every part and adds up to the net', () => {
    const settlement = prepareSettlement(base);

    const sum = settlement.lines.reduce((s, l) => s + l.amount, 0);
    expect(sum).toBe(settlement.netBeforeTax);
    expect(settlement.netBeforeTax).toBe(
      settlement.earnings - settlement.deductions,
    );
  });

  it('pays the final part month pro rata', () => {
    const settlement = prepareSettlement(base);
    const line = settlement.lines.find((l) => l.key === 'final_month_salary');
    expect(line?.amount).toBe(40_000);
  });

  it('recovers an outstanding advance', () => {
    const settlement = prepareSettlement({
      ...base,
      outstandingLoans: [
        { kind: 'advance', label: 'Salary advance', outstanding: 25_000 },
      ],
    });

    const line = settlement.lines.find((l) => l.key === 'recovery_advance');
    expect(line?.amount).toBe(-25_000);
  });

  it('stops rather than returning a negative payment', () => {
    const settlement = prepareSettlement({
      ...base,
      outstandingLoans: [
        { kind: 'loan', label: 'Loan', outstanding: 50_00_000 },
      ],
    });

    expect(settlement.netBeforeTax).toBeLessThan(0);
    expect(settlement.blockers.length).toBeGreaterThan(0);
  });

  it('names a default policy as an assumption rather than hiding it', () => {
    const settlement = prepareSettlement({
      ...base,
      leavePolicyConfirmed: false,
    });

    expect(settlement.assumptions.some((a) => /default/i.test(a))).toBe(true);
  });

  it('blocks when there is no salary structure to work from', () => {
    const settlement = prepareSettlement({
      ...base,
      monthlyGross: 0,
      basicAndDa: 0,
    });

    expect(settlement.blockers.length).toBeGreaterThan(0);
  });

  it('carries the gratuity exemption through for the tax projection', () => {
    const settlement = prepareSettlement(base);
    expect(settlement.taxExempt).toBe(settlement.gratuity.exemptAmount);
    expect(settlement.gratuity.eligible).toBe(true);
  });
});
