'use server';

import { resolveMemberOrg } from '@/lib/data/guard';
import { listComingUp, listNeedsYou } from '@/lib/data/catchup';
import { listPeople } from '@/lib/data/knowledge';
import { listConnections } from '@/lib/data/connections';
import { dutyTypeLabel, pluralise } from '@/lib/copy/labels';
import { readIntent } from '@/lib/agents/intent';

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
    replies.push({
      from: 'Holly',
      body: `On it — ${intent.periodLabel} payroll. Let me gather attendance and leave first.`,
    });

    if (people.length === 0) {
      replies.push({
        from: 'Holly',
        body:
          connected.length === 0
            ? "I don't have anyone on record yet, and nothing is connected for me to read from. Connect Remote.com or upload an attendance sheet and I'll pick it straight up."
            : "Nothing is connected that has people in it yet. Once your source has employees in it, I'll reconcile their attendance and leave.",
        link:
          connected.length === 0
            ? { href: '/marketplace', label: 'Connect a data source' }
            : undefined,
      });
      return replies;
    }

    replies.push({
      from: 'Holly',
      body: `I have ${pluralise(people.length, 'person', 'people')} on record. Checking attendance against leave for each of them.`,
    });

    if (needsYou.length > 0) {
      replies.push({
        from: 'Holly',
        body: `${pluralise(needsYou.length, 'thing needs', 'things need')} your review before I can finish. Everything else is settled.`,
        link: { href: '/catchup', label: 'Review them' },
      });
    } else {
      replies.push({
        from: 'Holly',
        body: "Nothing needs your review right now. I'll bring anything I can't settle to Catchup.",
      });
    }

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
