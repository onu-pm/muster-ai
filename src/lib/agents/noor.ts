import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { getConfirmedRule } from '@/lib/data/rules';
import {
  listFullPeople,
  matchPeople,
  outstandingLoansFor,
  type FullPerson,
} from '@/lib/data/people-records';
import { leaveBalance, leavePolicyFrom } from '@/lib/rules/leave-balance';
import { noticePolicyFrom } from '@/lib/rules/notice';
import { prepareSettlement } from '@/lib/rules/settlement';
import { daysInMonth, lopDivisorFrom } from '@/lib/rules/lop';
import {
  findOpenDuty,
  latestStep,
  listDuties,
  openDuty,
  raiseException,
  recordStep,
  setDutyState,
  supersedeOpenExceptions,
} from '@/lib/data/duties';
import { register } from './registry';
import {
  exitReasonLabel,
  formatDate,
  formatMoney,
  loanKindLabel,
  pluralise,
  settlementLine,
} from '@/lib/copy/labels';

/**
 * Noor — exits and final settlement.
 *
 * A final settlement is the last money an employer ever sends someone. There is
 * no next month to catch an error in it, and the person receiving it has
 * usually lost the standing to argue. That shapes everything in this file:
 *
 *  - Every figure comes from lib/rules/settlement.ts and the tested rule code
 *    underneath it. No model contributes a number, and none is asked to.
 *  - A settlement is *prepared*, never paid. It leaves here itemised, with
 *    every assumption named, and waits for a person to approve it.
 *  - Where a figure cannot be worked out — no leave balance on file, no
 *    structure — it says so instead of assuming a zero quietly. A missing
 *    encashment looks exactly like a correct one on a payslip.
 *
 * He asks the others rather than duplicating them: Holly for what was last
 * drawn, Mira for the documents, Dev to take them off the cover.
 */

const NOOR = 'Noor';

type ExitReason =
  | 'resignation'
  | 'termination'
  | 'retirement'
  | 'death'
  | 'disablement';

const REASONS: ExitReason[] = [
  'resignation',
  'termination',
  'retirement',
  'death',
  'disablement',
];

function readReason(value: unknown): ExitReason {
  const raw = String(value ?? '').toLowerCase().trim();
  const found = REASONS.find((r) => raw.includes(r));
  if (found) return found;
  if (/\b(sack|fire|let go|dismiss)/.test(raw)) return 'termination';
  if (/\bretir/.test(raw)) return 'retirement';
  return 'resignation';
}

/**
 * Service said the way a person would say it. "10.23 years" is a spreadsheet
 * talking; gratuity turns on completed years and months, so those are what is
 * read out.
 */
function describeService(days: number): string {
  const years = Math.floor(days / 365);
  const months = Math.floor((days - years * 365) / 30);

  if (years === 0) {
    return months <= 1 ? 'under a month' : `${months} months`;
  }
  const yearPart = `${years} ${years === 1 ? 'year' : 'years'}`;
  if (months === 0) return yearPart;
  return `${yearPart} and ${months} ${months === 1 ? 'month' : 'months'}`;
}

/** A date somebody typed, or null. Never a date invented to fill a gap. */
function readDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

interface ExitFacts {
  lastDay: string;
  resignedOn: string | null;
  reason: ExitReason;
  leaveDaysTaken: number | null;
  carriedForward: number;
  noticeWaivedDays: number;
}

function factsFrom(
  input: Record<string, unknown>,
  stored: Record<string, unknown> | null,
  person: FullPerson,
): ExitFacts {
  const number = (...values: unknown[]): number | null => {
    for (const value of values) {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) return n;
    }
    return null;
  };

  return {
    lastDay:
      readDate(input.lastDay) ??
      readDate(stored?.lastDay) ??
      person.doe ??
      new Date().toISOString().slice(0, 10),
    resignedOn:
      readDate(input.resignedOn) ?? readDate(stored?.resignedOn) ?? null,
    reason: readReason(input.reason ?? stored?.reason ?? input.text),
    leaveDaysTaken: number(input.leaveDaysTaken, stored?.leaveDaysTaken),
    carriedForward:
      number(input.leaveCarriedForward, stored?.leaveCarriedForward) ?? 0,
    noticeWaivedDays:
      number(input.noticeWaivedDays, stored?.noticeWaivedDays) ?? 0,
  };
}

register({
  key: 'exits.begin',
  teammate: NOOR,
  describe: 'start working an exit through',
  async run(ctx, input) {
    const name = String(input.name ?? '').trim();
    if (!name) {
      return {
        ok: false,
        error: 'No name given.',
        messages: [{ from: NOOR, body: 'Who is leaving?' }],
      };
    }

    const people = await listFullPeople(ctx.orgId);
    const matches = matchPeople(people, name);

    if (matches.length !== 1) {
      return {
        ok: false,
        error: matches.length === 0 ? 'Not found.' : 'Ambiguous.',
        messages: [
          {
            from: NOOR,
            body:
              matches.length === 0
                ? `I don't have anyone called ${name} on the books.`
                : `More than one person matches ${name} — ${matches.map((p) => p.fullName).join(', ')}. Which one?`,
          },
        ],
      };
    }

    const person = matches[0];

    if (person.type === 'candidate') {
      return {
        ok: false,
        error: 'Not an employee.',
        messages: [
          {
            from: NOOR,
            body: `${person.fullName} is a candidate rather than an employee, so there is nothing for me to work through. Hansel would be the one for that.`,
          },
        ],
      };
    }

    const existing = await findOpenDuty(ctx.orgId, 'exit', person.id);

    if (existing) {
      return {
        ok: true,
        messages: [
          {
            from: NOOR,
            body: `I'm already working ${person.fullName}'s exit, opened ${formatDate(existing.openedAt)}.`,
          },
        ],
        data: { dutyInstanceId: existing.id, alreadyExisted: true },
      };
    }

    const facts = factsFrom(input, null, person);
    const dutyId = await openDuty(ctx.orgId, 'exit', {
      subjectPersonId: person.id,
      state: 'in_progress',
    });

    if (!dutyId) {
      return {
        ok: false,
        error: 'Could not open the exit.',
        messages: [
          { from: NOOR, body: "I couldn't get that started. Try again shortly." },
        ],
      };
    }

    await recordStep(
      dutyId,
      'begin_exit',
      { personId: person.id, startedBy: ctx.userName },
      {
        summary: `Started ${person.fullName}'s exit — ${exitReasonLabel(facts.reason).toLowerCase()}`,
        lastDay: facts.lastDay,
        resignedOn: facts.resignedOn,
        reason: facts.reason,
      },
    );

    // The leaving date goes on the record; they stay an employee until it
    // passes, because during notice they still get paid and still accrue leave.
    await createAdminClient()
      .from('people')
      .update({ doe: facts.lastDay, updated_at: new Date().toISOString() })
      .eq('id', person.id);

    const messages = [
      {
        from: NOOR,
        body: `Right — ${person.fullName}, ${exitReasonLabel(facts.reason).toLowerCase()}, last day ${formatDate(facts.lastDay)}. I've put that on the record.`,
      },
    ];

    if (!facts.resignedOn && facts.reason === 'resignation') {
      messages.push({
        from: NOOR,
        body: 'I don’t have the date they gave notice, which is what decides whether anything is recovered for short notice. Tell me and I’ll factor it in.',
      });
    }

    // Documents are Mira's, and cover is Dev's. He asks rather than guessing.
    const file = await ctx.invoke('records.check_person', {
      personId: person.id,
    });
    messages.push(...file.messages);

    const cover = await ctx.invoke('benefits.remove', {
      personId: person.id,
      name: person.fullName,
    });
    messages.push(...cover.messages);

    messages.push({
      from: NOOR,
      body: 'When you want the settlement worked out, say so and I’ll put the numbers together for you to approve.',
    });

    return {
      ok: true,
      messages,
      data: {
        dutyInstanceId: dutyId,
        personId: person.id,
        lastDay: facts.lastDay,
        reason: facts.reason,
      },
    };
  },
});

register({
  key: 'exits.settlement',
  teammate: NOOR,
  describe: 'work out a final settlement for approval',
  async run(ctx, input) {
    const name = String(input.name ?? '').trim();
    const people = await listFullPeople(ctx.orgId);
    const matches = name ? matchPeople(people, name) : [];

    if (matches.length !== 1) {
      return {
        ok: false,
        error: matches.length === 0 ? 'Not found.' : 'Ambiguous.',
        messages: [
          {
            from: NOOR,
            body:
              !name
                ? 'Whose settlement should I work out?'
                : matches.length === 0
                  ? `I don't have anyone called ${name}.`
                  : `More than one person matches ${name} — ${matches.map((p) => p.fullName).join(', ')}. Which one?`,
          },
        ],
      };
    }

    const person = matches[0];

    const duty =
      (await findOpenDuty(ctx.orgId, 'exit', person.id)) ??
      (await (async () => {
        const id = await openDuty(ctx.orgId, 'exit', {
          subjectPersonId: person.id,
          state: 'in_progress',
        });
        return id
          ? {
              id,
              dutyType: 'exit',
              state: 'in_progress',
              subjectPersonId: person.id,
              openedAt: new Date().toISOString(),
              dueAt: null,
              closedAt: null,
            }
          : null;
      })());

    if (!duty) {
      return {
        ok: false,
        error: 'Could not open the exit.',
        messages: [
          { from: NOOR, body: "I couldn't get that going. Try again shortly." },
        ],
      };
    }

    const stored = await latestStep(duty.id, 'begin_exit');
    const facts = factsFrom(input, stored, person);

    const [leaveRule, noticeRule, lopRule, loans] = await Promise.all([
      getConfirmedRule(ctx.orgId, 'leave_policy'),
      getConfirmedRule(ctx.orgId, 'notice_policy'),
      getConfirmedRule(ctx.orgId, 'lop_calculation'),
      outstandingLoansFor(ctx.orgId, person.id),
    ]);

    const leavePolicy = leavePolicyFrom(leaveRule?.definition);
    const lastDay = new Date(facts.lastDay);
    const finalMonthDays = daysInMonth(
      lastDay.getFullYear(),
      lastDay.getMonth() + 1,
    );

    /*
     * There is no leave ledger in this project — leave arrives from whatever is
     * connected, a month at a time. So an encashable balance is only known if
     * somebody has said what it is. Assuming zero would produce a settlement
     * that looks complete and quietly short-pays them, so instead he asks.
     */
    const leaveKnown = facts.leaveDaysTaken !== null;

    const balance = leaveBalance({
      policy: leavePolicy,
      doj: person.doj,
      carriedForwardRaw: facts.carriedForward,
      takenThisYear: facts.leaveDaysTaken ?? 0,
      yearStart: new Date(lastDay.getFullYear(), 0, 1),
      asOf: lastDay,
    });

    const settlement = prepareSettlement({
      fullName: person.fullName,
      doj: person.doj,
      lastDay: facts.lastDay,
      resignedOn: facts.resignedOn,
      reason: facts.reason,
      monthlyGross: person.monthlyGross,
      basicAndDa: person.basicAndDa,
      daysWorkedInFinalMonth: lastDay.getDate(),
      daysInFinalMonth: finalMonthDays,
      payDivisor: lopDivisorFrom(lopRule?.definition, finalMonthDays),
      noticePolicy: noticePolicyFrom(noticeRule?.definition),
      noticeWaivedDays: facts.noticeWaivedDays,
      outstandingLoans: loans.map((loan) => ({
        kind: loan.kind,
        label: loanKindLabel(loan.kind),
        outstanding: loan.outstanding,
      })),
      // Leave encashment is only included when a balance is actually known.
      leave: leaveKnown
        ? balance
        : { ...balance, available: 0, encashable: 0 },
      leavePolicyConfirmed: Boolean(leaveRule),
      noticePolicyConfirmed: Boolean(noticeRule),
    });

    const messages = [
      {
        from: NOOR,
        body: `${person.fullName}, last day ${formatDate(facts.lastDay)}, ${
          person.doj
            ? `${describeService(settlement.gratuity.serviceDays)} of service`
            : 'no joining date on file'
        }.`,
      },
    ];

    if (settlement.lines.length === 0) {
      messages.push({
        from: NOOR,
        body: 'There is nothing I can work out yet — nothing on file adds up to a figure.',
      });
    } else {
      for (const line of settlement.lines) {
        messages.push({
          from: NOOR,
          body: `${settlementLine(line.label, line.amount)} — ${line.basis}`,
        });
      }

      messages.push({
        from: NOOR,
        body: `That comes to ${formatMoney(settlement.netBeforeTax)} before tax${
          settlement.taxExempt > 0
            ? `, of which ${formatMoney(settlement.taxExempt)} is exempt`
            : ''
        }.`,
      });
    }

    if (!leaveKnown) {
      messages.push({
        from: NOOR,
        body: 'I’ve left leave encashment out entirely, because I don’t have a leave balance for them and a zero would look the same as a correct figure on the payslip. Tell me the days taken this year and I’ll add it.',
      });
    }

    for (const assumption of settlement.assumptions) {
      messages.push({ from: NOOR, body: assumption });
    }

    /* ---- Blockers stop it reaching the desk at all ---- */

    if (settlement.blockers.length > 0) {
      await recordStep(
        duty.id,
        'settle',
        { personId: person.id, lastDay: facts.lastDay },
        {
          summary: `Couldn't settle ${person.fullName} yet — ${settlement.blockers.length} thing${settlement.blockers.length === 1 ? '' : 's'} in the way`,
          blockers: settlement.blockers,
        },
      );

      for (const blocker of settlement.blockers) {
        messages.push({ from: NOOR, body: blocker });
      }

      const exceptionId = await raiseException(duty.id, {
        kind: 'exit_blocked',
        conclusion: `${person.fullName}'s settlement can't be finished: ${settlement.blockers[0]}`,
        confidence: 0.9,
        payload: {
          personName: person.fullName,
          personRef: person.id,
          ruleApplied:
            'A settlement is not sent out with a known gap in it. The gap is settled first.',
          blockers: settlement.blockers,
        },
      });

      return {
        ok: true,
        messages,
        data: {
          dutyInstanceId: duty.id,
          personId: person.id,
          blocked: true,
          exceptionId,
        },
      };
    }

    /*
     * Working it out again replaces the figures, so the earlier proposal is
     * withdrawn rather than left sitting beside this one. Two open approvals
     * for one settlement is how a person gets paid twice.
     */
    const superseded = await supersedeOpenExceptions(
      duty.id,
      'settlement_proposed',
      'Worked out again with newer information.',
    );

    if (superseded > 0) {
      messages.push({
        from: NOOR,
        body: `I'd already put a settlement for ${person.fullName} in front of you — I've withdrawn that one, so there is only ever one set of figures waiting.`,
      });
    }

    await recordStep(
      duty.id,
      'settle',
      { personId: person.id, lastDay: facts.lastDay, reason: facts.reason },
      {
        summary: `Worked out ${person.fullName}'s settlement — ${formatMoney(settlement.netBeforeTax)} before tax`,
        lines: settlement.lines,
        netBeforeTax: settlement.netBeforeTax,
        taxExempt: settlement.taxExempt,
        assumptions: settlement.assumptions,
        leaveKnown,
      },
    );

    /*
     * This is the hard rule of the whole product, at the point where it matters
     * most: an amount that reaches a person is prepared by an agent and
     * approved by a named human. It goes on the desk, itemised, and stops.
     */
    const exceptionId = await raiseException(duty.id, {
      kind: 'settlement_proposed',
      conclusion: `${person.fullName}'s final settlement comes to ${formatMoney(settlement.netBeforeTax)} before tax — ${settlement.lines
        .map((l) => settlementLine(l.label, l.amount).toLowerCase())
        .join(', ')}.`,
      // The arithmetic is certain; the policy inputs behind it may not be.
      confidence: settlement.assumptions.length === 0 ? 0.95 : 0.7,
      payload: {
        personName: person.fullName,
        personRef: person.id,
        ruleApplied:
          'A final settlement is the last payment an employer makes, so it is always approved by a person before it goes out.',
        lines: settlement.lines,
        netBeforeTax: settlement.netBeforeTax,
        taxExempt: settlement.taxExempt,
        assumptions: settlement.assumptions,
        lastDay: facts.lastDay,
        reason: facts.reason,
      },
    });

    messages.push({
      from: NOOR,
      body: 'Nothing goes out until you approve it.',
      ...(exceptionId
        ? {
            action: {
              kind: 'decide' as const,
              exceptionId,
              about: `Pay ${person.fullName} ${formatMoney(settlement.netBeforeTax)} as full and final`,
            },
          }
        : {}),
    });

    return {
      ok: true,
      messages,
      data: {
        dutyInstanceId: duty.id,
        personId: person.id,
        netBeforeTax: settlement.netBeforeTax,
        exceptionId,
      },
    };
  },
});

register({
  key: 'exits.checklist',
  teammate: NOOR,
  describe: 'what is still outstanding on an exit',
  async run(ctx, input) {
    const name = String(input.name ?? '').trim();
    const people = await listFullPeople(ctx.orgId);
    const matches = name ? matchPeople(people, name) : [];

    if (matches.length !== 1) {
      return {
        ok: false,
        error: 'Need one person.',
        messages: [
          {
            from: NOOR,
            body: name
              ? `I can't pin down who you mean by ${name}.`
              : 'Whose exit do you mean?',
          },
        ],
      };
    }

    const person = matches[0];
    const duty = await findOpenDuty(ctx.orgId, 'exit', person.id);

    if (!duty) {
      return {
        ok: true,
        messages: [
          {
            from: NOOR,
            body: `I'm not working an exit for ${person.fullName}. Say the word and I'll start one.`,
          },
        ],
        data: { open: false },
      };
    }

    const settled = await latestStep(duty.id, 'settle');
    const loans = await outstandingLoansFor(ctx.orgId, person.id);

    const outstanding: string[] = [];

    if (!settled) outstanding.push('The settlement has not been worked out yet');
    if (loans.length > 0) {
      outstanding.push(
        `${pluralise(loans.length, 'balance', 'balances')} still owed to the company, ${formatMoney(
          loans.reduce((sum, l) => sum + l.outstanding, 0),
        )} in total`,
      );
    }

    const file = await ctx.invoke('records.check_person', {
      personId: person.id,
    });

    if (file.data && file.data.complete === false) {
      const labels = Array.isArray(file.data.missingSpoken)
        ? (file.data.missingSpoken as string[])
        : [];
      if (labels.length > 0) {
        outstanding.push(`Still missing from the file: ${labels.join(', ')}`);
      }
    }

    return {
      ok: true,
      messages: [
        {
          from: NOOR,
          body: `${person.fullName}'s exit, opened ${formatDate(duty.openedAt)}${person.doe ? `, last day ${formatDate(person.doe)}` : ''}.`,
        },
        ...(outstanding.length === 0
          ? [
              {
                from: NOOR,
                body: 'Nothing outstanding — it is ready to close once the settlement is approved.',
              },
            ]
          : outstanding.map((item) => ({ from: NOOR, body: item }))),
      ],
      data: { open: true, outstanding: outstanding.length },
    };
  },
});

register({
  key: 'exits.status',
  teammate: NOOR,
  describe: 'every exit in flight',
  async run(ctx) {
    const [duties, people] = await Promise.all([
      listDuties(ctx.orgId, 'exit'),
      listFullPeople(ctx.orgId),
    ]);

    if (duties.length === 0) {
      return {
        ok: true,
        messages: [
          { from: NOOR, body: 'No exits in flight. Quiet on my side.' },
        ],
        data: { open: 0 },
      };
    }

    const byId = new Map(people.map((p) => [p.id, p]));
    const lines = duties.slice(0, 8).map((duty) => {
      const person = duty.subjectPersonId
        ? byId.get(duty.subjectPersonId)
        : null;
      return `${person?.fullName ?? 'Someone'}${person?.doe ? `, last day ${formatDate(person.doe)}` : ''}`;
    });

    return {
      ok: true,
      messages: [
        {
          from: NOOR,
          body: `${pluralise(duties.length, 'exit', 'exits')} in flight: ${lines.join('; ')}.`,
        },
      ],
      data: { open: duties.length },
    };
  },
});

/**
 * The scheduled sweep: moves people off the roster once their last day has
 * passed *and* their settlement has been approved. Never on the date alone —
 * somebody still owed money is still on the books.
 */
export async function sweepExits(
  orgId: string,
  people: FullPerson[],
): Promise<{ closed: number; waiting: number }> {
  const duties = await listDuties(orgId, 'exit');
  const today = new Date().toISOString().slice(0, 10);

  let closed = 0;
  let waiting = 0;

  for (const duty of duties) {
    if (!duty.subjectPersonId) continue;

    const person = people.find((p) => p.id === duty.subjectPersonId);
    if (!person || !person.doe || person.doe > today) continue;

    // Blocked means an approval is still sitting there, so nothing moves.
    if (duty.state === 'blocked') {
      waiting += 1;
      continue;
    }

    const settled = await latestStep(duty.id, 'settle');
    if (!settled) {
      waiting += 1;
      continue;
    }

    await createAdminClient()
      .from('people')
      .update({ type: 'ex_employee', updated_at: new Date().toISOString() })
      .eq('id', person.id);

    await recordStep(
      duty.id,
      'begin_exit',
      { scheduled: true },
      {
        summary: `${person.fullName}'s last day has passed and the settlement was approved — moved off the roster`,
      },
    );

    await setDutyState(duty.id, 'closed');
    closed += 1;
  }

  return { closed, waiting };
}
