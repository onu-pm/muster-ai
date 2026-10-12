import { describe, expect, it } from 'vitest';
import { matchFastPath, matchSmallTalk } from './fast-path';
import { groupByGap } from '@/lib/rules/records';

/**
 * Answering the wrong question quickly is worse than answering the right one
 * slowly, so each pattern is pinned both ways: what it must catch, and what it
 * must not steal from another teammate.
 */

const routes = (text: string) => matchFastPath(text)?.capability ?? null;

describe('fast path — what each question reaches', () => {
  it('sends a pay question to payroll with the name parsed out', () => {
    expect(matchFastPath('what is the salary of Rahul Menon')).toEqual({
      capability: 'payroll.person_summary',
      input: { name: 'Rahul Menon' },
    });
  });

  it('sends records questions to Mira', () => {
    expect(routes('what is missing from our records')).toBe('records.audit');
    expect(routes('whose file is incomplete')).toBe('records.audit');
    expect(routes('can we produce the statutory registers')).toBe(
      'records.statutory_registers',
    );
  });

  it("reads a name out of a possessive when asking about a file", () => {
    expect(matchFastPath("what's on Priya's file")).toEqual({
      capability: 'records.person_file',
      input: { name: 'Priya' },
    });
  });

  it('sends cover questions to Dev', () => {
    expect(routes('who is covered')).toBe('benefits.coverage');
    expect(routes('what does our group cover look like')).toBe(
      'benefits.coverage',
    );
    expect(routes('who is not covered')).toBe('benefits.gaps');
  });

  it('sends review questions to Sana', () => {
    expect(routes('whose review is due')).toBe('performance.due_reviews');
    expect(routes('any overdue reviews')).toBe('performance.due_reviews');
    expect(routes('who is on probation')).toBe('performance.due_reviews');
    expect(routes('how is the review cycle going')).toBe(
      'performance.cycle_status',
    );
  });

  it('sends exit questions to Noor', () => {
    expect(routes('who is leaving')).toBe('exits.status');
    expect(routes('any resignations')).toBe('exits.status');
  });

  it('still routes the questions that existed before', () => {
    expect(routes('how many employees do we have')).toBe('payroll.roster');
    expect(routes('who is in the pipeline')).toBe('hiring.candidate_list');
    expect(routes('what rules do we use')).toBe('payroll.what_i_know');
    expect(routes('attendance for August')).toBe(
      'payroll.attendance_summary',
    );
  });
});

describe('fast path — what it must not steal', () => {
  it('does not treat a payroll run as a question', () => {
    // These are commands with their own deterministic path.
    expect(routes('run September payroll')).toBeNull();
    expect(routes('process payroll for August')).toBeNull();
  });

  it('does not send an attendance record question to records', () => {
    expect(routes('what does the attendance record say for August')).toBe(
      'payroll.attendance_summary',
    );
  });

  it('does not send a rules question to records', () => {
    expect(routes('what rules do we use')).toBe('payroll.what_i_know');
  });

  it('does not answer a settlement request with a list of exits', () => {
    // A settlement computes money, so it must reach Noor's capability through
    // the planner rather than being answered with a status list.
    expect(routes('work out the final settlement for Priya')).not.toBe(
      'exits.status',
    );
  });

  it('does not answer an enrolment request with a coverage summary', () => {
    expect(routes('add Rahul to the group cover')).not.toBe(
      'benefits.coverage',
    );
    expect(routes('enrol Priya in the insurance')).not.toBe(
      'benefits.coverage',
    );
  });

  it('does not answer "start a review cycle" with a status report', () => {
    expect(routes('start a review cycle')).not.toBe(
      'performance.cycle_status',
    );
  });

  it('does not treat a policy question as a status question', () => {
    // "what is our notice period" is about the rule, not about who is leaving.
    expect(routes('what is our notice period policy')).not.toBe(
      'exits.status',
    );
  });

  it('leaves anything long enough to be a CV alone', () => {
    expect(routes('a'.repeat(400))).toBeNull();
  });
});

describe('small talk stays off the model', () => {
  it('catches a greeting on its own', () => {
    expect(matchSmallTalk('hi')).toBe('greeting');
    expect(matchSmallTalk('good morning')).toBe('greeting');
  });

  it('catches a bare help but never a real question', () => {
    expect(matchSmallTalk('help')).toBe('capabilities');
    expect(matchSmallTalk('help me understand the wage test for Priya')).toBe(
      null,
    );
  });

  it('does not treat a question about people as small talk', () => {
    expect(matchSmallTalk('who is leaving this month')).toBeNull();
  });
});

describe('record gaps are grouped, not repeated', () => {
  const field = (key: string, label: string) => ({
    key,
    label,
    spoken: `a ${label.toLowerCase()}`,
    severity: 'blocks_pay' as const,
    because: 'Because.',
  });

  const audit = (name: string, keys: string[]) => ({
    personId: name,
    fullName: name,
    missing: keys.map((k) => field(k, k)),
    blocking: keys.map((k) => field(k, k)),
    complete: false,
  });

  it('puts everybody short of the same fields in one group', () => {
    const groups = groupByGap([
      audit('A', ['bank_account', 'doj']),
      audit('B', ['doj', 'bank_account']),
      audit('C', ['bank_account', 'doj']),
    ]);

    // Order within a person's gaps must not split the group.
    expect(groups).toHaveLength(1);
    expect(groups[0].audits).toHaveLength(3);
  });

  it('keeps different gaps apart, biggest pattern first', () => {
    const groups = groupByGap([
      audit('A', ['bank_account']),
      audit('B', ['doj']),
      audit('C', ['bank_account']),
      audit('D', ['bank_account']),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0].audits).toHaveLength(3);
    expect(groups[1].audits).toHaveLength(1);
  });

  it('loses nobody', () => {
    const everyone = ['A', 'B', 'C', 'D', 'E'];
    const groups = groupByGap(
      everyone.map((n, i) => audit(n, i % 2 ? ['doj'] : ['bank_account'])),
    );
    const covered = groups.flatMap((g) => g.audits.map((a) => a.fullName));
    expect(covered.sort()).toEqual(everyone);
  });
});
