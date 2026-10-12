import { describe, expect, it } from 'vitest';
import {
  ESI_WAGE_CEILING,
  auditRecord,
  auditRecords,
  commonGaps,
  type PersonRecord,
} from './records';
import {
  DEFAULT_BENEFIT_POLICY,
  benefitPolicyFrom,
  eligibilityFor,
  premiumFor,
  sumsInsuredFor,
} from './benefits';
import {
  DEFAULT_REVIEW_POLICY,
  dueReviews,
  isReviewOutcome,
  nextReviewDue,
  reviewPolicyFrom,
} from './review-cycle';

const complete: PersonRecord = {
  id: 'p1',
  fullName: 'Rahul Menon',
  type: 'employee',
  pan: 'ABCDE1234F',
  uan: '100200300400',
  esicNo: '3100000000',
  bankAccount: '000123456789',
  bankIfsc: 'HDFC0001234',
  doj: '2022-04-01',
  entityId: 'e1',
  locationId: 'l1',
  monthlyGross: 80_000,
};

describe('records — what must be on file before someone is paid', () => {
  it('passes a complete record', () => {
    expect(auditRecord(complete).complete).toBe(true);
  });

  it('treats a missing bank account as blocking pay', () => {
    const audit = auditRecord({ ...complete, bankAccount: null });
    expect(audit.blocking.map((b) => b.key)).toContain('bank_account');
  });

  it('treats a malformed IFSC as missing, not as present', () => {
    // Filled in but wrong is worse than empty: nothing downstream questions it.
    const audit = auditRecord({ ...complete, bankIfsc: 'HDFC1234' });
    expect(audit.blocking.map((b) => b.key)).toContain('bank_ifsc');
  });

  it('rejects a PAN of the wrong shape', () => {
    const audit = auditRecord({ ...complete, pan: '1234567890' });
    expect(audit.missing.map((m) => m.key)).toContain('pan');
  });

  it('expects an ESIC number only within the wage ceiling', () => {
    const inScope = auditRecord({
      ...complete,
      esicNo: null,
      monthlyGross: ESI_WAGE_CEILING - 1,
    });
    const outOfScope = auditRecord({
      ...complete,
      esicNo: null,
      monthlyGross: ESI_WAGE_CEILING + 1,
    });

    expect(inScope.missing.map((m) => m.key)).toContain('esic_no');
    expect(outOfScope.missing.map((m) => m.key)).not.toContain('esic_no');
  });

  it('reports a missing UAN above the provident fund ceiling without blocking', () => {
    const audit = auditRecord({ ...complete, uan: null, monthlyGross: 80_000 });
    const uan = audit.missing.find((m) => m.key === 'uan');

    expect(uan?.severity).toBe('worth_having');
    expect(audit.blocking).toHaveLength(0);
  });

  it('separates people who cannot be paid from people who cannot be filed for', () => {
    const summary = auditRecords([
      complete,
      { ...complete, id: 'p2', bankAccount: null },
      { ...complete, id: 'p3', pan: null },
    ]);

    expect(summary.complete).toBe(1);
    expect(summary.blocked).toHaveLength(1);
    expect(summary.incomplete).toHaveLength(1);
  });

  it('counts the same gap across everybody', () => {
    const gaps = commonGaps([
      auditRecord({ ...complete, pan: null }),
      auditRecord({ ...complete, id: 'p2', pan: null }),
    ]);

    expect(gaps[0]).toMatchObject({ label: 'PAN', count: 2 });
  });

  it('never leaks a column name into what a person reads', () => {
    const audit = auditRecord({ ...complete, bankIfsc: null, uan: null });
    for (const field of audit.missing) {
      expect(field.label).not.toMatch(/_/);
      expect(field.because.length).toBeGreaterThan(10);
    }
  });
});

describe('group cover', () => {
  it('leaves ESI-covered employees out of the medical policy', () => {
    const result = eligibilityFor(
      { type: 'employee', doj: '2020-01-01', monthlyGross: 18_000 },
      DEFAULT_BENEFIT_POLICY,
      new Date('2024-06-01'),
    );

    expect(result.eligible).not.toContain('group_medical');
    expect(
      result.excluded.find((e) => e.cover === 'group_medical')?.because,
    ).toMatch(/ESI/);
  });

  it('includes them when the policy says to cover everyone', () => {
    const result = eligibilityFor(
      { type: 'employee', doj: '2020-01-01', monthlyGross: 18_000 },
      { ...DEFAULT_BENEFIT_POLICY, excludeEsiCovered: false },
      new Date('2024-06-01'),
    );

    expect(result.eligible).toContain('group_medical');
  });

  it('covers nobody who is not yet an employee', () => {
    const result = eligibilityFor(
      { type: 'candidate', doj: null, monthlyGross: 0 },
      DEFAULT_BENEFIT_POLICY,
    );

    expect(result.eligible).toHaveLength(0);
  });

  it('holds back cover during a waiting period and says when it starts', () => {
    const result = eligibilityFor(
      { type: 'employee', doj: '2024-05-01', monthlyGross: 80_000 },
      { ...DEFAULT_BENEFIT_POLICY, waitingMonths: 3 },
      new Date('2024-06-01'),
    );

    expect(result.waiting).toBe(true);
    expect(result.eligible).toHaveLength(0);
    expect(result.startsOn).toBe('2024-08-01');
  });

  it('sets accident and life cover as a multiple of pay', () => {
    const sums = sumsInsuredFor(
      12_00_000,
      ['group_accident', 'group_term_life'],
      DEFAULT_BENEFIT_POLICY,
    );

    expect(sums.find((s) => s.cover === 'group_accident')?.amount).toBe(36_00_000);
    expect(sums.find((s) => s.cover === 'group_term_life')?.amount).toBe(36_00_000);
  });

  it('pro-rates a mid-term addition over the days left in the policy year', () => {
    const half = premiumFor({
      policy: DEFAULT_BENEFIT_POLICY,
      dependants: 0,
      joinsOn: new Date('2024-07-01'),
      policyRenewsOn: new Date('2025-01-01'),
    });

    expect(half.daysRemaining).toBe(184);
    expect(half.proRatedPremium).toBe(
      Math.round((DEFAULT_BENEFIT_POLICY.medicalPremiumPerPerson * 184) / 365),
    );
  });

  it('charges more for dependants', () => {
    const alone = premiumFor({
      policy: DEFAULT_BENEFIT_POLICY,
      dependants: 0,
      joinsOn: new Date('2024-01-01'),
      policyRenewsOn: new Date('2025-01-01'),
    });
    const family = premiumFor({
      policy: DEFAULT_BENEFIT_POLICY,
      dependants: 3,
      joinsOn: new Date('2024-01-01'),
      policyRenewsOn: new Date('2025-01-01'),
    });

    expect(family.annualPremium).toBeGreaterThan(alone.annualPremium);
  });

  it('deducts nothing from the employee when the employer pays it all', () => {
    const share = premiumFor({
      policy: DEFAULT_BENEFIT_POLICY,
      dependants: 2,
      joinsOn: new Date('2024-01-01'),
      policyRenewsOn: new Date('2025-01-01'),
    });

    expect(DEFAULT_BENEFIT_POLICY.employeeShare).toBe(0);
    expect(share.employeeAnnualShare).toBe(0);
    expect(share.employeeMonthlyDeduction).toBe(0);
  });

  it('ignores a nonsense confirmed policy rather than using it', () => {
    const policy = benefitPolicyFrom({ employee_share: 7 });
    expect(policy.employeeShare).toBe(DEFAULT_BENEFIT_POLICY.employeeShare);
  });
});

describe('review cycles', () => {
  it('holds a first review until probation is up', () => {
    const due = nextReviewDue({
      doj: '2024-04-01',
      policy: DEFAULT_REVIEW_POLICY,
      lastReviewedOn: null,
      asOf: new Date('2024-06-01'),
    });

    expect(due).toBeNull();
  });

  it('makes a confirmation review due at the end of probation', () => {
    const due = nextReviewDue({
      doj: '2024-01-01',
      policy: DEFAULT_REVIEW_POLICY,
      lastReviewedOn: null,
      asOf: new Date('2024-08-01'),
    });

    expect(due).toMatchObject({ dueOn: '2024-07-01', reason: 'confirmation' });
  });

  it('runs the cycle from the last review once there is one', () => {
    const due = nextReviewDue({
      doj: '2020-01-01',
      policy: DEFAULT_REVIEW_POLICY,
      lastReviewedOn: '2023-06-01',
      asOf: new Date('2024-09-01'),
    });

    expect(due).toMatchObject({ dueOn: '2024-06-01', reason: 'cycle' });
  });

  it('counts how far past the window a review has slipped', () => {
    const [first] = dueReviews({
      people: [
        {
          id: 'p1',
          fullName: 'Rahul Menon',
          type: 'employee',
          doj: '2020-01-01',
          lastReviewedOn: '2023-01-01',
        },
      ],
      policy: DEFAULT_REVIEW_POLICY,
      asOf: new Date('2024-03-01'),
    });

    // Due 2024-01-01, a 30-day window, so 60 days past it by 1 March.
    expect(first.dueOn).toBe('2024-01-01');
    expect(first.overdueDays).toBe(30);
  });

  it('leaves candidates and ex-employees out', () => {
    const due = dueReviews({
      people: [
        {
          id: 'p1',
          fullName: 'A Candidate',
          type: 'candidate',
          doj: '2020-01-01',
          lastReviewedOn: null,
        },
        {
          id: 'p2',
          fullName: 'Someone Who Left',
          type: 'ex_employee',
          doj: '2015-01-01',
          lastReviewedOn: null,
        },
      ],
      policy: DEFAULT_REVIEW_POLICY,
      asOf: new Date('2024-06-01'),
    });

    expect(due).toHaveLength(0);
  });

  it('reads a confirmed frequency and ignores an invalid one', () => {
    expect(reviewPolicyFrom({ frequency: 'quarterly' }).frequency).toBe(
      'quarterly',
    );
    expect(reviewPolicyFrom({ frequency: 'fortnightly' }).frequency).toBe(
      DEFAULT_REVIEW_POLICY.frequency,
    );
  });

  it('only accepts outcomes from the written scale', () => {
    expect(isReviewOutcome('met')).toBe(true);
    expect(isReviewOutcome('9/10')).toBe(false);
  });
});
