'use server';

import { resolveMemberOrg } from '@/lib/data/guard';
import { listComingUp, listNeedsYou } from '@/lib/data/catchup';
import { listPeople } from '@/lib/data/knowledge';
import { listConnections } from '@/lib/data/connections';
import { dutyTypeLabel, pluralise } from '@/lib/copy/labels';
import { readIntent } from '@/lib/agents/intent';
import { runInput } from '@/lib/agents/input';
import { runStructure } from '@/lib/agents/structure';
import { runTax } from '@/lib/agents/tax';

export interface ThreadMessage {
  from: 'you' | 'Holly';
  body: string;
  link?: { href: string; label: string };
}

/**
 * What the goal box talks to. Holly answers for the whole team — the person
 * typing should never need to know Input, Structure and Tax are separate.
 */
export async function runGoal(goal: string): Promise<ThreadMessage[]> {
  const member = await resolveMemberOrg();
  if (!member.ok) {
    return [{ from: 'Holly', body: member.error }];
  }

  const intent = readIntent(goal);
  const [people, connections, needsYou, comingUp] = await Promise.all([
    listPeople(member.orgId),
    listConnections(member.orgId),
    listNeedsYou(member.orgId),
    listComingUp(member.orgId),
  ]);

  const connected = connections.filter((c) => c.status === 'connected');
  const replies: ThreadMessage[] = [];

  if (intent.kind === 'run_payroll') {
    if (connected.length === 0) {
      return [
        {
          from: 'Holly',
          body: `I'd start on ${intent.periodLabel} straight away, but nothing is connected for me to read attendance from. Connect Remote.com or upload a sheet and I'll pick it up.`,
          link: { href: '/marketplace', label: 'Connect a data source' },
        },
      ];
    }

    replies.push({
      from: 'Holly',
      body: `On it — ${intent.periodLabel} payroll. Gathering attendance and leave first.`,
    });

    const input = await runInput(member.orgId, intent.year, intent.month);

    if (!input.ok) {
      replies.push({
        from: 'Holly',
        body: input.error ?? "I couldn't read the attendance data just now.",
        link: { href: '/marketplace', label: 'Check your connections' },
      });
      return replies;
    }

    replies.push({
      from: 'Holly',
      body: input.crossChecked
        ? `Checked attendance for ${pluralise(input.peopleCount, 'person', 'people')}.` +
          (input.raised > 0
            ? ` ${pluralise(input.raised, 'thing needs', 'things need')} your review.`
            : ' Attendance and leave agree.') +
          (input.explainedByFact > 0
            ? ` ${pluralise(input.explainedByFact, 'gap was', 'gaps were')} explained by what you've already told me.`
            : '')
        : `Read leave for ${pluralise(input.peopleCount, 'person', 'people')} from Remote. That's my only record of the month, so there's nothing to check it against — upload an attendance sheet and I can tell you where the two disagree.`,
    });

    if (input.dutyInstanceId) {
      const [structure, tax] = await Promise.all([
        runStructure(member.orgId, input.dutyInstanceId),
        runTax(member.orgId, input.dutyInstanceId),
      ]);

      if (structure.checked > 0) {
        replies.push({
          from: 'Holly',
          body:
            (structure.breaches > 0
              ? `On pay structures: ${pluralise(structure.breaches, 'person is', 'people are')} below the statutory half on basic pay. I've put that on your desk rather than changing anyone's split.`
              : `Pay structures all pass the 50% wage test${structure.usedConfirmedRule ? ', using your own wage definition' : ''}.`) +
            (structure.withoutStructure > 0
              ? ` ${pluralise(structure.withoutStructure, 'person has', 'people have')} no salary structure on record, so I couldn't test them either way.`
              : ''),
        });
      } else if (structure.withoutStructure > 0) {
        replies.push({
          from: 'Holly',
          body: `I have ${pluralise(structure.withoutStructure, 'person', 'people')} on the roster but no salary structure for any of them, so there was nothing to test and nothing to pay yet.`,
        });
      }

      if (tax.projected > 0) {
        replies.push({
          from: 'Holly',
          body:
            `Projected this month's tax for ${pluralise(tax.projected, 'person', 'people')}.` +
            (tax.trimmedClaims > 0
              ? ` ${pluralise(tax.trimmedClaims, 'claim was', 'claims were')} above the cap, so I've allowed the cap only.`
              : ''),
        });
      }
    }

    const outstanding = needsYou.length + input.raised;
    replies.push({
      from: 'Holly',
      body:
        outstanding > 0
          ? `That's as far as I can take it on my own. ${pluralise(outstanding, 'item is', 'items are')} waiting on you.`
          : "Nothing needs you. I'll bring anything I can't settle to Catchup.",
      link:
        outstanding > 0
          ? { href: '/catchup', label: 'Review them' }
          : undefined,
    });

    return replies;
  }

  if (intent.kind === 'status') {
    if (needsYou.length === 0 && comingUp.length === 0) {
      replies.push({
        from: 'Holly',
        body: "Nothing needs you and nothing is in flight. All quiet.",
      });
      return replies;
    }

    if (needsYou.length > 0) {
      replies.push({
        from: 'Holly',
        body: `${pluralise(needsYou.length, 'thing is', 'things are')} waiting on you.`,
        link: { href: '/catchup', label: 'Open Catchup' },
      });
    }

    if (comingUp.length > 0) {
      const first = comingUp[0];
      replies.push({
        from: 'Holly',
        body: `${pluralise(comingUp.length, 'job is', 'jobs are')} in flight, including ${dutyTypeLabel(first.dutyType).toLowerCase()}.`,
      });
    }

    return replies;
  }

  replies.push({
    from: 'Holly',
    body: "I handle payroll and statutory compliance — attendance and leave, pay structures, tax declarations and what gets filed. Ask me to run a payroll month, or ask what's pending.",
  });

  if (needsYou.length > 0) {
    replies.push({
      from: 'Holly',
      body: `While you're here, ${pluralise(needsYou.length, 'thing is', 'things are')} waiting on you.`,
      link: { href: '/catchup', label: 'Open Catchup' },
    });
  }

  return replies;
}
