import type { DutyState } from './duties';

/**
 * What happens to a piece of work when the last thing waiting on a person is
 * settled.
 *
 * For most duties the answer is "it is finished", and closing it is right. But
 * a few duties are not tasks — they are the record of a state that continues,
 * and closing one means something specific:
 *
 *  - A benefit enrolment duty *is* the cover. Open and blocked means proposed;
 *    in progress means live; closed means off the policy. So approving an
 *    enrolment must leave it in progress. Closing it on approval would take the
 *    person off the cover at the exact moment somebody said to put them on it.
 *  - An exit stays open after the settlement is approved, because the person is
 *    still on the roster until their last day has passed. The scheduled sweep
 *    closes it then, and only once the settlement is on the record.
 *
 * It also depends on the outcome, not just the duty: approving a removal ends
 * cover, rejecting the same removal leaves it running. So the decision is keyed
 * on the exception kind and what the person decided.
 */

export type DecisionOutcome = 'approved' | 'rejected' | 'corrected';

const LIFECYCLE: Record<
  string,
  Partial<Record<DecisionOutcome, DutyState>>
> = {
  benefit_enrolment_proposed: {
    // Said yes: they are on the cover, and the duty is that fact.
    approved: 'in_progress',
    // Said no: there is no cover, so the enrolment is over.
    rejected: 'closed',
    corrected: 'in_progress',
  },
  benefit_removal_proposed: {
    // Said yes: cover has ended.
    approved: 'closed',
    // Said no: cover carries on.
    rejected: 'in_progress',
    corrected: 'in_progress',
  },
  settlement_proposed: {
    /*
     * Approved means the figures are agreed, not that the person has left. They
     * stay on the roster until the last day passes; the sweep closes this.
     */
    approved: 'in_progress',
    rejected: 'in_progress',
    corrected: 'in_progress',
  },
  exit_blocked: {
    approved: 'in_progress',
    rejected: 'in_progress',
    corrected: 'in_progress',
  },
  review_cycle_proposed: {
    approved: 'in_progress',
    rejected: 'closed',
    corrected: 'in_progress',
  },
};

/**
 * The state a duty should be left in. `null` means the duty still has other
 * open exceptions, so nothing changes.
 */
export function dutyStateAfter(
  kind: string | null | undefined,
  outcome: DecisionOutcome,
  openExceptionsRemaining: number,
): DutyState | null {
  if (openExceptionsRemaining > 0) return null;
  if (!kind) return 'closed';
  return LIFECYCLE[kind]?.[outcome] ?? 'closed';
}
