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
  benefitPolicyFrom,
  eligibilityFor,
  premiumFor,
  sumsInsuredFor,
  type BenefitPolicy,
  type CoverKind,
} from '@/lib/rules/benefits';
import {
  findOpenDuty,
  latestStepsByDuty,
  listDuties,
  openDuty,
  raiseException,
  recordStep,
  setDutyState,
} from '@/lib/data/duties';
import { register } from './registry';
import { coverKindLabel, formatDate, formatMoney, pluralise } from '@/lib/copy/labels';

/**
 * Dev — benefits and insurance.
 *
 * Enrolling somebody in group cover sends their name and family details to an
 * insurer and starts a premium. Removing somebody ends their cover, which is
 * the kind of mistake nobody notices until a claim is refused. Both are
 * irreversible from where he sits, so he prepares them and stops: an enrolment
 * leaves here as a proposal with the premium worked out, and waits for a
 * person.
 *
 * Every figure comes from the tested rules in lib/rules/benefits.ts. Sum
 * insured, eligibility and the pro-rated premium for a mid-year addition are
 * all arithmetic on policy inputs, so none of it is anywhere a model can reach.
 */

const DEV = 'Dev';

/** The policy year an insurer renews on. April is the common Indian default. */
function renewalDate(
  definition: Record<string, unknown> | null | undefined,
  asOf: Date,
): { date: Date; fromRule: boolean } {
  const raw = definition?.renews_on ?? definition?.renewsOn;

  if (typeof raw === 'string') {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
      // Roll it forward to the next renewal still ahead of us.
      while (parsed <= asOf) parsed.setFullYear(parsed.getFullYear() + 1);
      return { date: parsed, fromRule: true };
    }
  }

  const april = new Date(asOf.getFullYear(), 3, 1);
  if (april <= asOf) april.setFullYear(april.getFullYear() + 1);
  return { date: april, fromRule: false };
}

async function policyFor(orgId: string): Promise<{
  policy: BenefitPolicy;
  confirmed: boolean;
  definition: Record<string, unknown> | null;
}> {
  const rule = await getConfirmedRule(orgId, 'benefits_policy');
  return {
    policy: benefitPolicyFrom(rule?.definition),
    confirmed: Boolean(rule),
    definition: (rule?.definition as Record<string, unknown> | null) ?? null,
  };
}

interface Enrolled {
  personId: string;
  dutyId: string;
  covers: CoverKind[];
  approved: boolean;
}

/** Who is already on the policy, read back off the enrolment duties. */
async function enrolments(orgId: string): Promise<Map<string, Enrolled>> {
  const duties = await listDuties(orgId, 'benefit_enrolment');
  const steps = await latestStepsByDuty(
    duties.map((d) => d.id),
    'enrol',
  );

  const byPerson = new Map<string, Enrolled>();

  for (const duty of duties) {
    if (!duty.subjectPersonId) continue;
    const step = steps.get(duty.id) ?? {};
    byPerson.set(duty.subjectPersonId, {
      personId: duty.subjectPersonId,
      dutyId: duty.id,
      covers: Array.isArray(step.covers) ? (step.covers as CoverKind[]) : [],
      // Still blocked means it is proposed and waiting on a person.
      approved: duty.state === 'in_progress',
    });
  }

  return byPerson;
}

register({
  key: 'benefits.coverage',
  teammate: DEV,
  describe: 'who is on the group cover and who is not',
  async run(ctx) {
    const [people, { policy, confirmed }, onPolicy] = await Promise.all([
      listFullPeople(ctx.orgId),
      policyFor(ctx.orgId),
      enrolments(ctx.orgId),
    ]);

    const employees = people.filter((p) => p.type === 'employee');

    if (employees.length === 0) {
      return {
        ok: true,
        messages: [
          {
            from: DEV,
            body: 'Nobody on the books yet, so there is no cover to report on.',
          },
        ],
        data: { covered: 0 },
      };
    }

    const covered = employees.filter((p) => onPolicy.get(p.id)?.approved);
    const proposed = employees.filter(
      (p) => onPolicy.has(p.id) && !onPolicy.get(p.id)!.approved,
    );
    const eligibleNotCovered = employees.filter((person) => {
      if (onPolicy.has(person.id)) return false;
      return eligibilityFor(person, policy).eligible.length > 0;
    });

    const messages = [
      {
        from: DEV,
        body: `${pluralise(covered.length, 'person is', 'people are')} on the group cover out of ${employees.length} on the books.`,
      },
    ];

    if (proposed.length > 0) {
      messages.push({
        from: DEV,
        body: `${pluralise(proposed.length, 'enrolment is', 'enrolments are')} drawn up and waiting for you to approve before I send anything to the insurer.`,
      });
    }

    if (eligibleNotCovered.length > 0) {
      messages.push({
        from: DEV,
        body: `${pluralise(eligibleNotCovered.length, 'person is', 'people are')} eligible with no cover at all: ${eligibleNotCovered
          .slice(0, 5)
          .map((p) => p.fullName)
          .join(', ')}. Say the word and I'll draw up the additions.`,
      });
    }

    // Who is deliberately out, so a gap never looks like an oversight.
    const excluded = employees
      .map((person) => ({ person, result: eligibilityFor(person, policy) }))
      .filter((row) => row.result.eligible.length === 0 && row.result.excluded.length > 0);

    if (excluded.length > 0) {
      messages.push({
        from: DEV,
        body: `${pluralise(excluded.length, 'person is', 'people are')} out of the medical policy on purpose — ${excluded[0].result.excluded[0].because.toLowerCase()}`,
      });
    }

    if (!confirmed) {
      messages.push({
        from: DEV,
        body: `I'm working from the usual shape — ${formatMoney(policy.medicalSumInsured)} family cover, employer paying the premium. Tell me your actual policy and I'll use that instead.`,
      });
    }

    return {
      ok: true,
      messages,
      data: {
        covered: covered.length,
        proposed: proposed.length,
        eligibleNotCovered: eligibleNotCovered.length,
        policyConfirmed: confirmed,
      },
    };
  },
});

register({
  key: 'benefits.enrol',
  teammate: DEV,
  describe: 'draw up an addition to the group cover for approval',
  async run(ctx, input) {
    const name = String(input.name ?? '').trim();
    if (!name) {
      return {
        ok: false,
        error: 'No name given.',
        messages: [{ from: DEV, body: 'Who should I add to the cover?' }],
      };
    }

    const [people, { policy, confirmed, definition }] = await Promise.all([
      listFullPeople(ctx.orgId),
      policyFor(ctx.orgId),
    ]);

    const matches = matchPeople(people, name);

    if (matches.length !== 1) {
      return {
        ok: false,
        error: matches.length === 0 ? 'Not found.' : 'Ambiguous.',
        messages: [
          {
            from: DEV,
            body:
              matches.length === 0
                ? `I don't have anyone called ${name} on the books.`
                : `More than one person matches ${name} — ${matches.map((p) => p.fullName).join(', ')}. Which one?`,
          },
        ],
      };
    }

    const person = matches[0];
    const existing = await findOpenDuty(
      ctx.orgId,
      'benefit_enrolment',
      person.id,
    );

    if (existing) {
      return {
        ok: true,
        messages: [
          {
            from: DEV,
            body:
              existing.state === 'in_progress'
                ? `${person.fullName} is already on the cover — nothing to do.`
                : `${person.fullName}'s enrolment is already drawn up and waiting on your approval.`,
          },
        ],
        data: { dutyInstanceId: existing.id, alreadyExisted: true },
      };
    }

    const eligibility = eligibilityFor(person, policy);

    if (eligibility.eligible.length === 0) {
      return {
        ok: true,
        messages: [
          {
            from: DEV,
            body: `${person.fullName} isn't eligible for anything on the current policy. ${eligibility.excluded[0]?.because ?? ''}`.trim(),
          },
          ...(eligibility.waiting && eligibility.startsOn
            ? [
                {
                  from: DEV,
                  body: `Cover would start on ${formatDate(eligibility.startsOn)} once the waiting period is up. I'll pick it up then.`,
                },
              ]
            : []),
        ],
        data: { eligible: false, startsOn: eligibility.startsOn },
      };
    }

    const dependants = Number(input.dependants);
    const annualPay = person.monthlyGross * 12;
    const sums = sumsInsuredFor(annualPay, eligibility.eligible, policy);
    const renewal = renewalDate(definition, new Date());

    const premium = premiumFor({
      policy,
      dependants: Number.isFinite(dependants) ? dependants : 0,
      joinsOn: new Date(),
      policyRenewsOn: renewal.date,
    });

    const dutyId = await openDuty(ctx.orgId, 'benefit_enrolment', {
      subjectPersonId: person.id,
      state: 'in_progress',
    });

    if (!dutyId) {
      return {
        ok: false,
        error: 'Could not open the enrolment.',
        messages: [
          { from: DEV, body: "I couldn't start that off. Try again in a moment." },
        ],
      };
    }

    await recordStep(
      dutyId,
      'enrol',
      { personId: person.id, dependants: premium.annualPremium > 0 ? dependants : 0 },
      {
        summary: `Drew up group cover for ${person.fullName}`,
        covers: eligibility.eligible,
        sumsInsured: sums,
        premium,
      },
    );

    const messages = [
      {
        from: DEV,
        body: `${person.fullName} is eligible for ${eligibility.eligible
          .map((c) => coverKindLabel(c).toLowerCase())
          .join(', ')}.`,
      },
      {
        from: DEV,
        body: sums
          .map((s) => `${coverKindLabel(s.cover)} ${formatMoney(s.amount)} — ${s.basis.toLowerCase()}`)
          .join(' '),
      },
      {
        from: DEV,
        body: `Premium works out at ${formatMoney(premium.proRatedPremium)} for the rest of this policy year, which runs to ${formatDate(renewal.date.toISOString().slice(0, 10))}. ${premium.basis}`,
      },
    ];

    if (premium.employeeAnnualShare > 0) {
      messages.push({
        from: DEV,
        body: `${formatMoney(premium.employeeAnnualShare)} of that is their share, so ${formatMoney(premium.employeeMonthlyDeduction)} a month would come off their pay. I'll ask Holly to put it on the structure once you approve.`,
      });
    }

    if (!renewal.fromRule) {
      messages.push({
        from: DEV,
        body: 'I’ve assumed the policy year runs from April because nothing on file says otherwise — worth checking before this goes out.',
      });
    }

    if (!confirmed) {
      messages.push({
        from: DEV,
        body: `These are the usual figures rather than your actual policy, so treat the premium as an estimate.`,
      });
    }

    /*
     * Sending somebody's details to an insurer and starting a premium is not
     * mine to do. It goes on the desk with the figures already worked out.
     */
    const exceptionId = await raiseException(dutyId, {
      kind: 'benefit_enrolment_proposed',
      conclusion: `${person.fullName} would go onto ${eligibility.eligible
        .map((c) => coverKindLabel(c).toLowerCase())
        .join(' and ')} at ${formatMoney(premium.proRatedPremium)} for the rest of the policy year.${premium.employeeAnnualShare > 0 ? ` ${formatMoney(premium.employeeMonthlyDeduction)} a month would come off their pay.` : ''}`,
      confidence: confirmed ? 0.9 : 0.6,
      payload: {
        personName: person.fullName,
        personRef: person.id,
        ruleApplied:
          'Nobody is added to a policy, and no premium is started, without someone approving it.',
        covers: eligibility.eligible,
        sumsInsured: sums,
        premium,
        policyConfirmed: confirmed,
      },
    });

    messages.push({
      from: DEV,
      body: 'Approve it and I’ll treat them as covered from today.',
      ...(exceptionId
        ? {
            action: {
              kind: 'decide' as const,
              exceptionId,
              about: `Add ${person.fullName} to the group cover`,
            },
          }
        : {}),
    });

    return {
      ok: true,
      messages,
      data: {
        dutyInstanceId: dutyId,
        personId: person.id,
        covers: eligibility.eligible,
        proRatedPremium: premium.proRatedPremium,
        exceptionId,
      },
    };
  },
});

register({
  key: 'benefits.remove',
  teammate: DEV,
  describe: 'take someone off the group cover when they leave',
  async run(ctx, input) {
    const personId = input.personId ? String(input.personId) : null;
    const name = String(input.name ?? '').trim();

    const people = await listFullPeople(ctx.orgId);
    const person = personId
      ? people.find((p) => p.id === personId)
      : matchPeople(people, name)[0];

    if (!person) {
      return {
        ok: false,
        error: 'Not found.',
        messages: [
          { from: DEV, body: `I can't find ${name || 'them'} on the books.` },
        ],
      };
    }

    const duty = await findOpenDuty(ctx.orgId, 'benefit_enrolment', person.id);

    if (!duty) {
      return {
        ok: true,
        messages: [
          {
            from: DEV,
            body: `${person.fullName} isn't on the group cover, so there's nothing for me to take off.`,
          },
        ],
        data: { removed: false, wasCovered: false },
      };
    }

    /*
     * Ending cover is the mistake nobody notices until a claim is refused, so
     * the date it ends is a person's decision and not a side effect of an exit
     * being processed.
     */
    const exceptionId = await raiseException(duty.id, {
      kind: 'benefit_removal_proposed',
      conclusion: `${person.fullName} is leaving, so they would come off the group cover. Cover ends the day you approve this — any treatment after that is not covered.`,
      confidence: 0.9,
      payload: {
        personName: person.fullName,
        personRef: person.id,
        ruleApplied:
          'Cover is never ended automatically. A claim refused after an exit is worse than a month of extra premium.',
      },
    });

    return {
      ok: true,
      messages: [
        {
          from: DEV,
          body: `I've drawn up the removal for ${person.fullName}. Cover stays live until you approve it, which is deliberate.`,
          ...(exceptionId
            ? {
                action: {
                  kind: 'decide' as const,
                  exceptionId,
                  about: `Take ${person.fullName} off the group cover`,
                },
              }
            : {}),
        },
      ],
      data: {
        dutyInstanceId: duty.id,
        personId: person.id,
        removed: false,
        exceptionId,
      },
    };
  },
});

register({
  key: 'benefits.gaps',
  teammate: DEV,
  describe: 'new joiners who are eligible but not yet covered',
  async run(ctx) {
    const [people, { policy }, onPolicy] = await Promise.all([
      listFullPeople(ctx.orgId),
      policyFor(ctx.orgId),
      enrolments(ctx.orgId),
    ]);

    const gaps = people
      .filter((p) => p.type === 'employee' && !onPolicy.has(p.id))
      .map((person) => ({ person, result: eligibilityFor(person, policy) }))
      .filter((row) => row.result.eligible.length > 0);

    if (gaps.length === 0) {
      return {
        ok: true,
        messages: [
          {
            from: DEV,
            body: 'Everyone eligible is either on the cover or drawn up waiting for you.',
          },
        ],
        data: { gaps: 0 },
      };
    }

    return {
      ok: true,
      messages: [
        {
          from: DEV,
          body: `${pluralise(gaps.length, 'person is', 'people are')} eligible for cover and not on it: ${gaps
            .slice(0, 6)
            .map((g) => g.person.fullName)
            .join(', ')}.`,
        },
        {
          from: DEV,
          body: 'Want me to draw up the additions? Nothing goes to the insurer until you approve them.',
        },
      ],
      data: { gaps: gaps.length, names: gaps.map((g) => g.person.fullName) },
    };
  },
});

/** The scheduled sweep: find the gaps, do not act on them. */
export async function sweepBenefits(
  orgId: string,
  people: FullPerson[],
): Promise<{ gaps: number }> {
  // No user on this path, so the rule is read with the service role.
  const rule = await getConfirmedRuleAsService(orgId, 'benefits_policy');
  const policy = benefitPolicyFrom(rule?.definition);
  const onPolicy = await enrolments(orgId);

  const gaps = people
    .filter((p) => p.type === 'employee' && !onPolicy.has(p.id))
    .filter((person) => eligibilityFor(person, policy).eligible.length > 0);

  if (gaps.length === 0) return { gaps: 0 };

  const dutyId =
    (await findOpenDuty(orgId, 'benefits_review'))?.id ??
    (await openDuty(orgId, 'benefits_review'));

  if (dutyId) {
    await recordStep(
      dutyId,
      'review_cover',
      { scheduled: true },
      {
        summary: `${pluralise(gaps.length, 'person', 'people')} eligible for cover and not on it`,
        names: gaps.map((g) => g.fullName),
      },
    );
    await setDutyState(dutyId, 'in_progress');
  }

  return { gaps: gaps.length };
}
