import { describe, expect, it } from 'vitest';
import { dutyStateAfter } from './duty-lifecycle';

/**
 * These exist because closing a duty on approval is right almost everywhere
 * and catastrophically wrong in two places. Approving group cover used to close
 * the duty that *is* that cover, which took the person off the policy at the
 * moment somebody said to put them on it.
 */

describe('what happens to a duty once a person has decided', () => {
  it('leaves a duty alone while anything else is still waiting', () => {
    expect(dutyStateAfter('settlement_proposed', 'approved', 2)).toBeNull();
  });

  it('closes ordinary work when the last thing is settled', () => {
    expect(dutyStateAfter('lop_discrepancy', 'approved', 0)).toBe('closed');
    expect(dutyStateAfter('wage_definition_breach', 'rejected', 0)).toBe(
      'closed',
    );
    expect(dutyStateAfter('record_incomplete', 'corrected', 0)).toBe('closed');
  });

  it('keeps group cover live when an enrolment is approved', () => {
    // The duty is the cover. Closing it here would end the cover.
    expect(dutyStateAfter('benefit_enrolment_proposed', 'approved', 0)).toBe(
      'in_progress',
    );
  });

  it('ends the enrolment when it is turned down', () => {
    expect(dutyStateAfter('benefit_enrolment_proposed', 'rejected', 0)).toBe(
      'closed',
    );
  });

  it('ends cover when a removal is approved, and keeps it when it is not', () => {
    expect(dutyStateAfter('benefit_removal_proposed', 'approved', 0)).toBe(
      'closed',
    );
    expect(dutyStateAfter('benefit_removal_proposed', 'rejected', 0)).toBe(
      'in_progress',
    );
  });

  it('keeps an exit open after the settlement is agreed', () => {
    // They are still on the roster until the last day passes. The sweep
    // closes it then, which is also what moves them off the roster.
    expect(dutyStateAfter('settlement_proposed', 'approved', 0)).toBe(
      'in_progress',
    );
  });

  it('closes an unknown kind rather than leaving work stuck forever', () => {
    expect(dutyStateAfter('something_nobody_has_written_yet', 'approved', 0)).toBe(
      'closed',
    );
    expect(dutyStateAfter(null, 'approved', 0)).toBe('closed');
  });
});
