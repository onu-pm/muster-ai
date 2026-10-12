/**
 * Notice period, and what is recovered when it is not served.
 *
 * There is no statutory notice period for most private employment in India —
 * it is contractual, with the state Shops and Establishments Act setting a
 * floor for some categories (commonly one month after a year of service). So
 * both the length and the recovery base are policy inputs, read from a
 * confirmed rule, and the sentence that reaches a person says which was used.
 *
 * Deterministic and tested. A recovery is money taken off what somebody is
 * owed, which is exactly the kind of figure that never comes from a model.
 */

export interface NoticePolicy {
  /** Days of notice the contract requires. */
  noticeDays: number;
  /** What a recovery is charged on. */
  base: 'basic_and_da' | 'gross';
  /** Days used to turn a month into a daily rate. */
  divisor: number;
}

export const DEFAULT_NOTICE_POLICY: NoticePolicy = {
  noticeDays: 30,
  base: 'basic_and_da',
  divisor: 30,
};

export function noticePolicyFrom(
  definition: Record<string, unknown> | null | undefined,
): NoticePolicy {
  if (!definition) return DEFAULT_NOTICE_POLICY;

  const days = Number(
    definition.notice_days ?? definition.noticeDays ?? definition.days,
  );
  const divisor = Number(definition.divisor ?? definition.day_divisor);
  const base = String(definition.base ?? definition.recovery_base ?? '');

  return {
    noticeDays:
      Number.isFinite(days) && days >= 0 && days <= 365
        ? days
        : DEFAULT_NOTICE_POLICY.noticeDays,
    base: base === 'gross' ? 'gross' : 'basic_and_da',
    divisor:
      Number.isFinite(divisor) && divisor > 0 && divisor <= 31
        ? divisor
        : DEFAULT_NOTICE_POLICY.divisor,
  };
}

export interface NoticeResult {
  requiredDays: number;
  servedDays: number;
  shortfallDays: number;
  /** Positive means it is recovered from them; zero means nothing is owed. */
  recovery: number;
  /** True when more notice was served than required — nothing is paid for it. */
  overserved: boolean;
  explanation: string;
}

export function noticeShortfall(input: {
  policy: NoticePolicy;
  /** When they gave notice. */
  resignedOn: string | null;
  /** Their last working day. */
  lastDay: string;
  basicAndDa: number;
  monthlyGross: number;
  /** Notice the employer chose to waive, in days. */
  waivedDays?: number;
}): NoticeResult {
  const { policy } = input;

  if (!input.resignedOn) {
    return {
      requiredDays: policy.noticeDays,
      servedDays: 0,
      shortfallDays: 0,
      recovery: 0,
      overserved: false,
      explanation:
        'No resignation date on file, so notice served cannot be worked out. Nothing recovered.',
    };
  }

  const from = new Date(input.resignedOn);
  const to = new Date(input.lastDay);

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return {
      requiredDays: policy.noticeDays,
      servedDays: 0,
      shortfallDays: 0,
      recovery: 0,
      overserved: false,
      explanation: 'The dates on file do not read as dates. Nothing recovered.',
    };
  }

  const servedDays = Math.max(
    0,
    Math.round((to.getTime() - from.getTime()) / 86_400_000),
  );

  const waived = Math.max(0, Math.round(input.waivedDays ?? 0));
  const required = Math.max(0, policy.noticeDays - waived);
  const shortfallDays = Math.max(0, required - servedDays);

  if (shortfallDays === 0) {
    return {
      requiredDays: required,
      servedDays,
      shortfallDays: 0,
      recovery: 0,
      overserved: servedDays > required,
      explanation:
        servedDays > required
          ? `${servedDays} days served against ${required} required — nothing to recover, and notice served over the requirement is not paid for separately.`
          : `${servedDays} days served, which meets the ${required} required.`,
    };
  }

  const monthly =
    policy.base === 'gross' ? input.monthlyGross : input.basicAndDa;

  const recovery =
    Number.isFinite(monthly) && monthly > 0
      ? Math.round((monthly / policy.divisor) * shortfallDays)
      : 0;

  return {
    requiredDays: required,
    servedDays,
    shortfallDays,
    recovery,
    overserved: false,
    explanation: `${servedDays} days served against ${required} required, so ${shortfallDays} ${
      shortfallDays === 1 ? 'day' : 'days'
    } short, charged on ${
      policy.base === 'gross' ? 'gross pay' : 'basic and dearness allowance'
    } over a ${policy.divisor}-day month.`,
  };
}
