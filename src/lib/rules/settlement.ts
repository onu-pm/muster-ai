import { encashmentAmount, type LeaveBalance } from './leave-balance';
import { gratuity, type GratuityResult } from './gratuity';
import { noticeShortfall, type NoticePolicy, type NoticeResult } from './notice';

/**
 * Full and final settlement.
 *
 * This is the single most consequential figure in the product: it is the last
 * money a person receives from an employer, and a mistake in it is not caught
 * by a later month. So it is composed here, from tested rule code, out of parts
 * that are each individually tested — and never by a model. A model may put the
 * result into a sentence. It may not contribute a number to it.
 *
 * The settlement is *prepared*, not paid. It leaves here as an itemised
 * proposal with every assumption named, goes onto the exception desk, and waits
 * for a person to approve it.
 */

export interface SettlementLine {
  key: string;
  /** Said the way it would be said to a person. */
  label: string;
  /** Positive is owed to them, negative is recovered from them. */
  amount: number;
  /** One line on where the figure came from. */
  basis: string;
}

export interface Settlement {
  lines: SettlementLine[];
  earnings: number;
  deductions: number;
  /** Before tax. Tax on the settlement is worked out separately. */
  netBeforeTax: number;
  /** Parts of this that are exempt from tax, for the projection that follows. */
  taxExempt: number;
  /**
   * Assumptions a person should see before approving. A settlement with
   * assumptions on it is still correct arithmetic on uncertain inputs.
   */
  assumptions: string[];
  /** Things that must be settled by a person before this can go out at all. */
  blockers: string[];
  gratuity: GratuityResult;
  notice: NoticeResult;
}

export interface SettlementInput {
  fullName: string;
  doj: string | null;
  lastDay: string;
  resignedOn: string | null;
  reason?: 'resignation' | 'termination' | 'retirement' | 'death' | 'disablement';
  monthlyGross: number;
  basicAndDa: number;
  /** Days of the final month actually worked. */
  daysWorkedInFinalMonth: number;
  daysInFinalMonth: number;
  leave: LeaveBalance;
  /** Divisor for the final part month, from the loss-of-pay rule. */
  payDivisor: number;
  noticePolicy: NoticePolicy;
  noticeWaivedDays?: number;
  /** Still owed to the company, from the loans ledger. */
  outstandingLoans: { kind: string; label: string; outstanding: number }[];
  /** Whether the leave policy came from a confirmed rule or a default. */
  leavePolicyConfirmed: boolean;
  noticePolicyConfirmed: boolean;
}

export function prepareSettlement(input: SettlementInput): Settlement {
  const lines: SettlementLine[] = [];
  const assumptions: string[] = [];
  const blockers: string[] = [];

  /* ---- Salary for the part month worked ---- */

  const divisor =
    Number.isFinite(input.payDivisor) && input.payDivisor > 0
      ? input.payDivisor
      : input.daysInFinalMonth;

  const daysWorked = Math.max(
    0,
    Math.min(input.daysWorkedInFinalMonth, input.daysInFinalMonth),
  );

  if (input.monthlyGross > 0 && daysWorked > 0) {
    lines.push({
      key: 'final_month_salary',
      label: 'Salary for the final part month',
      amount: Math.round((input.monthlyGross / divisor) * daysWorked),
      basis: `${daysWorked} of ${input.daysInFinalMonth} days worked, over a ${divisor}-day month.`,
    });
  } else if (input.monthlyGross <= 0) {
    blockers.push(
      'No salary structure on file, so there is no monthly figure to pro-rate.',
    );
  }

  /* ---- Leave encashment ---- */

  if (input.leave.encashable > 0) {
    const amount = encashmentAmount({
      basicAndDa: input.basicAndDa,
      days: input.leave.encashable,
      divisor: 30,
    });

    if (amount > 0) {
      lines.push({
        key: 'leave_encashment',
        label: 'Leave encashment',
        amount,
        basis: `${input.leave.encashable} encashable ${
          input.leave.encashable === 1 ? 'day' : 'days'
        } of a ${input.leave.available}-day balance, on basic and dearness allowance over a 30-day month.`,
      });
    }
  }

  if (!input.leavePolicyConfirmed) {
    assumptions.push(
      'The leave entitlement and encashment cap are the common private-sector defaults, not a rule you have confirmed. Confirm your own and I will use it instead.',
    );
  }

  /* ---- Gratuity ---- */

  const gratuityResult = gratuity({
    basicAndDa: input.basicAndDa,
    doj: input.doj,
    lastDay: input.lastDay,
    reason: input.reason,
  });

  if (gratuityResult.eligible && gratuityResult.amount > 0) {
    lines.push({
      key: 'gratuity',
      label: 'Gratuity',
      amount: gratuityResult.amount,
      basis: gratuityResult.reason,
    });
  }

  if (gratuityResult.contestedEligibility) {
    blockers.push(
      `${input.fullName} has ${gratuityResult.serviceYears} years of service — past four years and 240 days but short of five. Some High Courts treat that as qualifying for gratuity. I have left it out; whether to pay it is your call.`,
    );
  }

  if (gratuityResult.capped) {
    assumptions.push(
      'Gratuity has been capped at the statutory ceiling of twenty lakh.',
    );
  }

  /* ---- Notice shortfall ---- */

  const notice = noticeShortfall({
    policy: input.noticePolicy,
    resignedOn: input.resignedOn,
    lastDay: input.lastDay,
    basicAndDa: input.basicAndDa,
    monthlyGross: input.monthlyGross,
    waivedDays: input.noticeWaivedDays,
  });

  if (notice.recovery > 0) {
    lines.push({
      key: 'notice_recovery',
      label: 'Notice period shortfall',
      amount: -notice.recovery,
      basis: notice.explanation,
    });
  }

  if (!input.noticePolicyConfirmed && notice.recovery > 0) {
    assumptions.push(
      'The notice period is the thirty-day default rather than a rule you have confirmed, so check it against their contract before this goes out.',
    );
  }

  if (!input.resignedOn && input.reason === 'resignation') {
    assumptions.push(
      'No resignation date on file, so nothing has been recovered for notice.',
    );
  }

  /* ---- Money still owed to the company ---- */

  for (const loan of input.outstandingLoans) {
    if (loan.outstanding <= 0) continue;
    lines.push({
      key: `recovery_${loan.kind}`,
      label: loan.label,
      amount: -Math.round(loan.outstanding),
      basis: 'Outstanding balance on the loans and advances ledger.',
    });
  }

  /* ---- Totals ---- */

  const earnings = lines
    .filter((l) => l.amount > 0)
    .reduce((sum, l) => sum + l.amount, 0);

  const deductions = lines
    .filter((l) => l.amount < 0)
    .reduce((sum, l) => sum + Math.abs(l.amount), 0);

  const netBeforeTax = earnings - deductions;

  if (netBeforeTax < 0) {
    blockers.push(
      `What is recovered comes to more than what is owed, so ${input.fullName} would end up owing the company. That is a decision, not a calculation — it needs you.`,
    );
  }

  return {
    lines,
    earnings,
    deductions,
    netBeforeTax,
    taxExempt: gratuityResult.exemptAmount,
    assumptions,
    blockers,
    gratuity: gratuityResult,
    notice,
  };
}
