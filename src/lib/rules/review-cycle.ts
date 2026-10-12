/**
 * Review cycles: who is due, when, and what has quietly slipped.
 *
 * Deterministic and tested. A review has no statutory basis at all — it is
 * entirely policy — so everything here is a policy input with a documented
 * default, and nothing is ever inferred about a person's performance. This
 * module answers "whose review is due" and "how late is it". It does not score
 * anybody, and no model reads it.
 *
 * A rating can imply a pay revision, but this module never produces one: the
 * revision is Holly's, through the tested structure code, after a person has
 * approved the rating.
 */

export type CycleFrequency = 'annual' | 'half_yearly' | 'quarterly';

export interface ReviewPolicy {
  frequency: CycleFrequency;
  /** Months of service before someone's first review. */
  probationMonths: number;
  /** Days after the cycle opens before a review counts as late. */
  windowDays: number;
  /** Whether a new joiner gets a confirmation review at the end of probation. */
  confirmationReview: boolean;
}

export const DEFAULT_REVIEW_POLICY: ReviewPolicy = {
  frequency: 'annual',
  probationMonths: 6,
  windowDays: 30,
  confirmationReview: true,
};

export function reviewPolicyFrom(
  definition: Record<string, unknown> | null | undefined,
): ReviewPolicy {
  if (!definition) return DEFAULT_REVIEW_POLICY;

  const frequency = String(definition.frequency ?? '');
  const probation = Number(
    definition.probation_months ?? definition.probationMonths,
  );
  const window = Number(definition.window_days ?? definition.windowDays);

  return {
    frequency: (['annual', 'half_yearly', 'quarterly'] as const).includes(
      frequency as CycleFrequency,
    )
      ? (frequency as CycleFrequency)
      : DEFAULT_REVIEW_POLICY.frequency,
    probationMonths:
      Number.isFinite(probation) && probation >= 0 && probation <= 24
        ? probation
        : DEFAULT_REVIEW_POLICY.probationMonths,
    windowDays:
      Number.isFinite(window) && window > 0 && window <= 180
        ? window
        : DEFAULT_REVIEW_POLICY.windowDays,
    confirmationReview:
      typeof definition.confirmation_review === 'boolean'
        ? definition.confirmation_review
        : DEFAULT_REVIEW_POLICY.confirmationReview,
  };
}

export const MONTHS_PER_CYCLE: Record<CycleFrequency, number> = {
  annual: 12,
  half_yearly: 6,
  quarterly: 3,
};

export type ReviewReason = 'cycle' | 'confirmation';

export interface DueReview {
  personId: string;
  fullName: string;
  reason: ReviewReason;
  /** When it became due. */
  dueOn: string;
  /** Days past the window. Zero or less means still inside it. */
  overdueDays: number;
  /** Already recorded in this cycle, so nothing is due. */
  done: boolean;
  because: string;
}

function addMonths(date: Date, months: number): Date {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * When somebody's next review falls due.
 *
 * Reviews run from the joining date rather than from a company-wide date,
 * because that is the only date every person actually has. A cycle anchored to
 * a fixed month can be layered on top by passing `anchor`.
 */
export function nextReviewDue(input: {
  doj: string | null;
  policy: ReviewPolicy;
  /** The last review actually recorded, if any. */
  lastReviewedOn: string | null;
  asOf: Date;
  /** A company-wide cycle start, when reviews do not run from the joining date. */
  anchor?: string | null;
}): { dueOn: string; reason: ReviewReason } | null {
  if (!input.doj) return null;

  const joined = new Date(input.doj);
  if (Number.isNaN(joined.getTime())) return null;

  const { policy } = input;

  // Probation confirmation comes first, and only once.
  if (policy.confirmationReview && !input.lastReviewedOn) {
    const confirmOn = addMonths(joined, policy.probationMonths);
    if (confirmOn <= input.asOf) {
      return { dueOn: iso(confirmOn), reason: 'confirmation' };
    }
    // Still on probation: nothing is due yet.
    return null;
  }

  const step = MONTHS_PER_CYCLE[policy.frequency];
  const from = input.lastReviewedOn
    ? new Date(input.lastReviewedOn)
    : input.anchor
      ? new Date(input.anchor)
      : addMonths(joined, policy.probationMonths);

  if (Number.isNaN(from.getTime())) return null;

  let due = addMonths(from, step);
  // Walk forward if several cycles have gone by without one being recorded.
  let guard = 0;
  while (due <= input.asOf && guard < 40) {
    const next = addMonths(due, step);
    if (next > input.asOf) break;
    due = next;
    guard += 1;
  }

  return { dueOn: iso(due), reason: 'cycle' };
}

export function dueReviews(input: {
  people: {
    id: string;
    fullName: string;
    type: string;
    doj: string | null;
    lastReviewedOn: string | null;
  }[];
  policy: ReviewPolicy;
  asOf?: Date;
  anchor?: string | null;
}): DueReview[] {
  const asOf = input.asOf ?? new Date();
  const out: DueReview[] = [];

  for (const person of input.people) {
    if (person.type !== 'employee') continue;

    const due = nextReviewDue({
      doj: person.doj,
      policy: input.policy,
      lastReviewedOn: person.lastReviewedOn,
      asOf,
      anchor: input.anchor,
    });

    if (!due) continue;

    const dueDate = new Date(due.dueOn);
    if (dueDate > asOf) continue;

    const daysPast = Math.round(
      (asOf.getTime() - dueDate.getTime()) / 86_400_000,
    );
    const overdueDays = Math.max(0, daysPast - input.policy.windowDays);

    out.push({
      personId: person.id,
      fullName: person.fullName,
      reason: due.reason,
      dueOn: due.dueOn,
      overdueDays,
      done: false,
      because:
        due.reason === 'confirmation'
          ? `Their ${input.policy.probationMonths}-month probation is up, so a confirmation review is due.`
          : `A ${input.policy.frequency.replace('_', ' ')} review fell due on this date.`,
    });
  }

  // Latest problems first: the most overdue is the one worth saying out loud.
  return out.sort((a, b) => b.overdueDays - a.overdueDays);
}

/** A rating scale with no numbers in it, so nothing reads as a score to act on. */
export const REVIEW_OUTCOMES = [
  { key: 'exceeded', label: 'Exceeded what the role asked for' },
  { key: 'met', label: 'Met what the role asked for' },
  { key: 'developing', label: 'Developing into the role' },
  { key: 'below', label: 'Below what the role asked for' },
] as const;

export type ReviewOutcome = (typeof REVIEW_OUTCOMES)[number]['key'];

export function isReviewOutcome(value: string): value is ReviewOutcome {
  return REVIEW_OUTCOMES.some((o) => o.key === value);
}
