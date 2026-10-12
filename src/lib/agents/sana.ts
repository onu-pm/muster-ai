import 'server-only';
import {
  getConfirmedRule,
  getConfirmedRuleAsService,
} from '@/lib/data/rules';
import {
  listFullPeople,
  matchPeople,
  type FullPerson,
} from '@/lib/data/people-records';
import {
  REVIEW_OUTCOMES,
  dueReviews,
  isReviewOutcome,
  reviewPolicyFrom,
  type ReviewPolicy,
} from '@/lib/rules/review-cycle';
import {
  findOpenDuty,
  latestStepsByDuty,
  listDuties,
  openDuty,
  raiseException,
  raiseOnce,
  recordStep,
  setDutyState,
} from '@/lib/data/duties';
import { register } from './registry';
import {
  cycleFrequencyLabel,
  formatDate,
  pluralise,
  relativeDay,
  reviewOutcomeLabel,
} from '@/lib/copy/labels';

/**
 * Sana — performance and reviews.
 *
 * A review cycle fails quietly. Nobody notices the month it did not happen;
 * they notice eighteen months later when somebody resigns over it. So her whole
 * job is to make the slipping visible — who is due, how far past the window,
 * and which ones have been due so long that saying "due" is generous.
 *
 * She records an outcome; she does not form one. There is no model anywhere in
 * this file reading anyone's work, and the scale she writes against has no
 * numbers in it, so nothing here can be mistaken for a score to act on. A
 * rating that implies a pay rise goes to Holly, who does the arithmetic.
 */

const SANA = 'Sana';

async function policyFor(
  orgId: string,
): Promise<{ policy: ReviewPolicy; confirmed: boolean }> {
  const rule = await getConfirmedRule(orgId, 'review_policy');
  return {
    policy: reviewPolicyFrom(rule?.definition),
    confirmed: Boolean(rule),
  };
}

/** The last review actually recorded for each person. */
async function lastReviewed(orgId: string): Promise<Map<string, string>> {
  const duties = await listDuties(orgId, 'performance_review', {
    includeClosed: true,
  });

  const steps = await latestStepsByDuty(
    duties.map((d) => d.id),
    'record_review',
  );

  const byPerson = new Map<string, string>();

  for (const duty of duties) {
    if (!duty.subjectPersonId) continue;
    const step = steps.get(duty.id);
    const on =
      typeof step?.reviewedOn === 'string'
        ? step.reviewedOn
        : (duty.closedAt ?? duty.openedAt);

    const existing = byPerson.get(duty.subjectPersonId);
    // Duties come back newest first, so only the first one per person counts.
    if (!existing && on) byPerson.set(duty.subjectPersonId, on.slice(0, 10));
  }

  return byPerson;
}

async function whoIsDue(
  orgId: string,
  people: FullPerson[],
  policy: ReviewPolicy,
) {
  const reviewed = await lastReviewed(orgId);

  return dueReviews({
    people: people.map((p) => ({
      id: p.id,
      fullName: p.fullName,
      type: p.type,
      doj: p.doj,
      lastReviewedOn: reviewed.get(p.id) ?? null,
    })),
    policy,
  });
}

register({
  key: 'performance.due_reviews',
  teammate: SANA,
  describe: 'whose review is due and how late it is',
  async run(ctx) {
    const [people, { policy, confirmed }] = await Promise.all([
      listFullPeople(ctx.orgId),
      policyFor(ctx.orgId),
    ]);

    const employees = people.filter((p) => p.type === 'employee');

    if (employees.length === 0) {
      return {
        ok: true,
        messages: [
          { from: SANA, body: 'Nobody on the books, so no reviews to run.' },
        ],
        data: { due: 0 },
      };
    }

    const due = await whoIsDue(ctx.orgId, people, policy);

    /*
     * A review cycle runs from the joining date, so without one there is
     * nothing to count from. "Nothing due" would be a lie dressed as good news:
     * the honest answer is that it cannot be worked out yet, and what would fix
     * it. Mira is the one who collects the dates, so she is named.
     */
    const undated = employees.filter((p) => !p.doj);

    if (undated.length === employees.length) {
      return {
        ok: true,
        messages: [
          {
            from: SANA,
            body: `I can't tell you what's due — none of the ${employees.length} on the roster have a joining date on file, and a cycle runs from that date.`,
          },
          {
            from: SANA,
            body: 'Mira is the one who chases those. Once they are on the files I can tell you exactly who is overdue and by how long.',
          },
        ],
        data: { due: 0, undated: undated.length, cannotTell: true },
      };
    }

    if (due.length === 0) {
      return {
        ok: true,
        messages: [
          {
            from: SANA,
            body: `Nothing due. Reviews run ${cycleFrequencyLabel(policy.frequency).toLowerCase()}, first one ${policy.probationMonths} months in.`,
          },
          ...(undated.length > 0
            ? [
                {
                  from: SANA,
                  body: `That is across the ${employees.length - undated.length} people who have a joining date on file. ${pluralise(undated.length, 'person does', 'people do')} not, so I cannot count a cycle for them.`,
                },
              ]
            : []),
        ],
        data: { due: 0, undated: undated.length },
      };
    }

    const overdue = due.filter((d) => d.overdueDays > 0);
    const confirmations = due.filter((d) => d.reason === 'confirmation');

    const messages = [
      {
        from: SANA,
        body: `${pluralise(due.length, 'review is', 'reviews are')} due${overdue.length > 0 ? `, and ${overdue.length} of those are past the window` : ''}.`,
      },
    ];

    if (overdue.length > 0) {
      messages.push({
        from: SANA,
        body: `Longest waiting: ${overdue
          .slice(0, 4)
          .map(
            (d) =>
              `${d.fullName} (${d.overdueDays} ${d.overdueDays === 1 ? 'day' : 'days'} over)`,
          )
          .join(', ')}.`,
      });
    }

    if (confirmations.length > 0) {
      messages.push({
        from: SANA,
        body: `${pluralise(confirmations.length, 'person is', 'people are')} at the end of probation and waiting to be confirmed: ${confirmations
          .slice(0, 4)
          .map((d) => d.fullName)
          .join(', ')}. That one matters — they're employed on a different footing until it happens.`,
      });
    }

    if (!confirmed) {
      messages.push({
        from: SANA,
        body: `I'm assuming reviews run ${cycleFrequencyLabel(policy.frequency).toLowerCase()} after a ${policy.probationMonths}-month probation. Tell me how yours actually run and I'll use that.`,
      });
    }

    return {
      ok: true,
      messages,
      data: {
        due: due.length,
        overdue: overdue.length,
        names: due.map((d) => d.fullName),
      },
    };
  },
});

register({
  key: 'performance.cycle_status',
  teammate: SANA,
  describe: 'where the current review cycle has got to',
  async run(ctx) {
    const [people, { policy }, cycles] = await Promise.all([
      listFullPeople(ctx.orgId),
      policyFor(ctx.orgId),
      listDuties(ctx.orgId, 'review_cycle', { includeClosed: true }),
    ]);

    const open = cycles.find((c) => c.state !== 'closed');
    const reviews = await listDuties(ctx.orgId, 'performance_review', {
      includeClosed: true,
    });

    const employees = people.filter((p) => p.type === 'employee');
    const done = reviews.filter((r) => r.state === 'closed').length;
    const due = await whoIsDue(ctx.orgId, people, policy);

    if (!open && reviews.length === 0) {
      const undated = employees.filter((p) => !p.doj).length;
      return {
        ok: true,
        messages: [
          {
            from: SANA,
            body:
              undated === employees.length && employees.length > 0
                ? `No cycle has been run yet. ${pluralise(employees.length, 'person is', 'people are')} on the books, though none of them have a joining date on file, so I can't say who is due until that is sorted.`
                : `No cycle has been run yet. ${pluralise(employees.length, 'person is', 'people are')} on the books and ${pluralise(due.length, 'review is', 'reviews are')} already due.`,
          },
          {
            from: SANA,
            body: 'Want me to open one? I’ll draw it up and it waits for you before anybody hears about it.',
            action: {
              kind: 'choice' as const,
              options: [
                { value: 'start a review cycle', label: 'Open a cycle' },
                { value: 'decline_schedule', label: 'Not now' },
              ],
            },
          },
        ],
        data: { cycleOpen: false, due: due.length },
      };
    }

    const messages = [];

    if (open) {
      messages.push({
        from: SANA,
        body: `A cycle has been running since ${formatDate(open.openedAt)}${open.dueAt ? `, meant to close ${relativeDay(open.dueAt).toLowerCase()}` : ''}.`,
      });
    }

    messages.push({
      from: SANA,
      body: `${done} of ${employees.length} reviews recorded${due.length > 0 ? `, ${due.length} still due` : ' — that is everybody'}.`,
    });

    const undated = employees.filter((p) => !p.doj).length;
    if (undated > 0) {
      messages.push({
        from: SANA,
        body: `${pluralise(undated, 'person has', 'people have')} no joining date on file, so I can't work out whether they are due at all.`,
      });
    }

    return {
      ok: true,
      messages,
      data: { cycleOpen: Boolean(open), done, due: due.length },
    };
  },
});

register({
  key: 'performance.start_cycle',
  teammate: SANA,
  describe: 'open a review cycle, for approval',
  async run(ctx) {
    const [people, { policy, confirmed }] = await Promise.all([
      listFullPeople(ctx.orgId),
      policyFor(ctx.orgId),
    ]);

    const existing = await findOpenDuty(ctx.orgId, 'review_cycle');

    if (existing) {
      return {
        ok: true,
        messages: [
          {
            from: SANA,
            body: `There's already a cycle open from ${formatDate(existing.openedAt)}. I'd rather finish that one than run two.`,
          },
        ],
        data: { dutyInstanceId: existing.id, alreadyExisted: true },
      };
    }

    const employees = people.filter((p) => p.type === 'employee');

    if (employees.length === 0) {
      return {
        ok: true,
        messages: [
          {
            from: SANA,
            body: 'There is nobody to review yet.',
          },
        ],
        data: { started: false },
      };
    }

    const due = await whoIsDue(ctx.orgId, people, policy);
    const closesOn = new Date();
    closesOn.setDate(closesOn.getDate() + policy.windowDays);

    const dutyId = await openDuty(ctx.orgId, 'review_cycle', {
      state: 'in_progress',
      dueAt: closesOn.toISOString(),
    });

    if (!dutyId) {
      return {
        ok: false,
        error: 'Could not open the cycle.',
        messages: [
          { from: SANA, body: "I couldn't get that started. Try again shortly." },
        ],
      };
    }

    await recordStep(
      dutyId,
      'open_cycle',
      { people: employees.length, requestedBy: ctx.userName },
      {
        summary: `Drew up a ${cycleFrequencyLabel(policy.frequency).toLowerCase()} cycle covering ${pluralise(employees.length, 'person', 'people')}`,
        due: due.length,
      },
    );

    /*
     * A cycle is the moment managers and their reports are told reviews are
     * happening. That announcement is not reversible, so the cycle is drawn up
     * and waits.
     */
    const exceptionId = await raiseException(dutyId, {
      kind: 'review_cycle_proposed',
      conclusion: `A ${cycleFrequencyLabel(policy.frequency).toLowerCase()} cycle covering ${pluralise(employees.length, 'person', 'people')}, closing ${formatDate(closesOn.toISOString())}. ${due.length > 0 ? `${pluralise(due.length, 'review is', 'reviews are')} already due.` : ''}`.trim(),
      confidence: confirmed ? 0.9 : 0.7,
      payload: {
        ruleApplied:
          'A cycle is announced to everyone it covers, so it starts when a person says so.',
        people: employees.length,
        due: due.length,
        closesOn: closesOn.toISOString().slice(0, 10),
        policyConfirmed: confirmed,
      },
    });

    return {
      ok: true,
      messages: [
        {
          from: SANA,
          body: `Drawn up: a ${cycleFrequencyLabel(policy.frequency).toLowerCase()} cycle covering ${pluralise(employees.length, 'person', 'people')}, closing ${formatDate(closesOn.toISOString())}.`,
        },
        {
          from: SANA,
          body: 'Nobody hears anything until you say so.',
          ...(exceptionId
            ? {
                action: {
                  kind: 'decide' as const,
                  exceptionId,
                  about: `Open a ${cycleFrequencyLabel(policy.frequency).toLowerCase()} cycle for ${pluralise(employees.length, 'person', 'people')}`,
                },
              }
            : {}),
        },
      ],
      data: { dutyInstanceId: dutyId, people: employees.length, exceptionId },
    };
  },
});

register({
  key: 'performance.record_outcome',
  teammate: SANA,
  describe: 'record a review outcome against someone',
  async run(ctx, input) {
    const name = String(input.name ?? '').trim();
    const outcome = String(input.outcome ?? '').trim().toLowerCase();

    if (!name) {
      return {
        ok: false,
        error: 'No name given.',
        messages: [{ from: SANA, body: 'Whose review is this?' }],
      };
    }

    if (!isReviewOutcome(outcome)) {
      return {
        ok: false,
        error: 'Not a recognised outcome.',
        messages: [
          {
            from: SANA,
            body: `I record outcomes against a fixed scale so they mean the same thing for everybody. Which is it: ${REVIEW_OUTCOMES.map((o) => o.label.toLowerCase()).join('; ')}?`,
          },
        ],
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
            from: SANA,
            body:
              matches.length === 0
                ? `I don't have anyone called ${name}.`
                : `More than one person matches ${name} — ${matches.map((p) => p.fullName).join(', ')}. Which one?`,
          },
        ],
      };
    }

    const person = matches[0];
    const dutyId = await openDuty(ctx.orgId, 'performance_review', {
      subjectPersonId: person.id,
      state: 'in_progress',
    });

    if (!dutyId) {
      return {
        ok: false,
        error: 'Could not record it.',
        messages: [
          { from: SANA, body: "I couldn't write that down. Try again shortly." },
        ],
      };
    }

    const note = typeof input.note === 'string' ? input.note.trim() : '';

    await recordStep(
      dutyId,
      'record_review',
      { personId: person.id, outcome, recordedBy: ctx.userName },
      {
        summary: `Recorded ${person.fullName}'s review: ${reviewOutcomeLabel(outcome).toLowerCase()}`,
        outcome,
        note,
        reviewedOn: new Date().toISOString().slice(0, 10),
      },
    );

    const messages = [
      {
        from: SANA,
        body: `Recorded for ${person.fullName}: ${reviewOutcomeLabel(outcome).toLowerCase()}.`,
      },
    ];

    /*
     * A rating is not a rise. If one is intended it is a separate decision with
     * an amount attached, and the amount is Holly's — worked out by the tested
     * structure code, never by me and never by a model.
     */
    if (outcome === 'exceeded' || outcome === 'met') {
      messages.push({
        from: SANA,
        body: 'If that comes with a rise, tell me the new package and Holly will work out the split. I don’t touch pay myself.',
      });
    }

    if (outcome === 'below') {
      messages.push({
        from: SANA,
        body: 'I’ve written it down as given. What happens next is yours to decide — I don’t draw conclusions from a rating.',
      });
    }

    await setDutyState(dutyId, 'closed');

    return {
      ok: true,
      messages,
      data: { personId: person.id, outcome, dutyInstanceId: dutyId },
    };
  },
});

/** The scheduled sweep: put the slipping reviews on the desk once. */
export async function sweepReviews(
  orgId: string,
  people: FullPerson[],
): Promise<{ due: number; raised: number }> {
  // No user on this path, so the rule is read with the service role.
  const rule = await getConfirmedRuleAsService(orgId, 'review_policy');
  const policy = reviewPolicyFrom(rule?.definition);
  const due = await whoIsDue(orgId, people, policy);
  const slipped = due.filter((d) => d.overdueDays > 0);

  if (slipped.length === 0) return { due: due.length, raised: 0 };

  const dutyId =
    (await findOpenDuty(orgId, 'review_cycle'))?.id ??
    (await openDuty(orgId, 'review_cycle'));

  if (!dutyId) return { due: due.length, raised: 0 };

  await recordStep(
    dutyId,
    'record_review',
    { scheduled: true },
    {
      summary: `${pluralise(slipped.length, 'review has', 'reviews have')} slipped past the window`,
      names: slipped.map((s) => s.fullName),
    },
  );

  const worst = slipped[0];
  // One finding per set of overdue people, not one per night.
  const signature = slipped
    .map((s) => s.personId)
    .sort()
    .join('|');

  const id = await raiseOnce(dutyId, `overdue:${signature}`, {
    kind: 'review_overdue',
    conclusion: `${pluralise(slipped.length, 'review has', 'reviews have')} gone past the window — the longest is ${worst.fullName}, ${worst.overdueDays} ${worst.overdueDays === 1 ? 'day' : 'days'} over. ${worst.because}`,
    confidence: 0.95,
    payload: {
      personName: worst.fullName,
      personRef: worst.personId,
      ruleApplied:
        'A review is due a set number of months after the last one, within a fixed window.',
      overdue: slipped.map((s) => ({
        name: s.fullName,
        days: s.overdueDays,
        reason: s.reason,
      })),
    },
  });

  return { due: due.length, raised: id ? 1 : 0 };
}
