'use server';

import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolveMemberOrg } from '@/lib/data/guard';
import { listNeedsYou } from '@/lib/data/catchup';
import { getProvider } from '@/lib/catalog/providers';
import { ordinal } from '@/lib/agents/intent';
import { connectProvider } from '@/app/actions/connections';
import { decideOnException, type Outcome } from '@/app/actions/decisions';
import { executePayroll } from '@/lib/agents/turns';
import {
  EMPTY_STATE,
  type ConversationState,
  type ThreadMessage,
  type TurnResult,
} from '@/lib/agents/conversation';

/**
 * What the inline buttons in the thread call.
 *
 * Typed messages go to /api/chat so they can stream. These are short, discrete
 * actions with a definite end, so they stay ordinary server actions — there is
 * nothing to stream and a round trip is simpler than a stream for both sides.
 */

/** A data source connected from inside the conversation. */
export async function connectFromChat(
  providerKey: string,
  credentials: Record<string, string>,
  incoming: ConversationState,
): Promise<TurnResult> {
  const result = await connectProvider(providerKey, credentials);
  const provider = getProvider(providerKey);
  const state: ConversationState = { ...incoming, awaiting: null };

  if (!result.ok) {
    return {
      messages: [
        {
          from: 'Holly',
          body: result.error ?? "That didn't work. Try again?",
          action: {
            kind: 'connect',
            providerKey,
            label: provider?.label ?? providerKey,
            fields: provider?.fields ?? [],
            alternatives: [],
          },
        },
      ],
      state: { ...incoming, awaiting: 'connection' },
    };
  }

  const member = await resolveMemberOrg();
  if (!member.ok) {
    return { messages: [{ from: 'Holly', body: member.error }], state };
  }

  const messages: ThreadMessage[] = [
    {
      from: 'Holly',
      body: `${provider?.label ?? 'That'} is connected. Picking up where we left off.`,
    },
  ];

  // Resume whatever the person originally asked for.
  if (state.intent === 'run_payroll' && state.period) {
    await executePayroll(member.orgId, state.period, (from, body, action) =>
      messages.push({ from, body, action }),
    );
  }

  return { messages, state };
}

/** A decision taken inline, without leaving the thread. */
export async function decideFromChat(
  exceptionId: string,
  outcome: Outcome,
  note: string | undefined,
  incoming: ConversationState,
): Promise<TurnResult> {
  const result = await decideOnException(exceptionId, outcome, note);

  if (!result.ok) {
    return {
      messages: [
        {
          from: 'Holly',
          body: result.error ?? "I couldn't record that. Try again?",
        },
      ],
      state: incoming,
    };
  }

  const said =
    outcome === 'approved'
      ? "Approved — I'll apply that."
      : outcome === 'rejected'
        ? "Rejected. I'll leave it alone."
        : "Got it. I've written that down so I don't ask you the same thing again.";

  const member = await resolveMemberOrg();
  const messages: ThreadMessage[] = [{ from: 'Holly', body: said }];

  if (member.ok) {
    const remaining = await listNeedsYou(member.orgId);
    if (remaining.length === 0) {
      messages.push({ from: 'Holly', body: "That's everything. You're clear." });
    } else {
      const next = remaining[0];
      messages.push({
        from: 'Holly',
        body: next.conclusion,
        action: {
          kind: 'decide',
          exceptionId: next.id,
          about: next.personName ?? 'this',
        },
      });
    }
  }

  return { messages, state: incoming };
}

/**
 * Saves a recurring run, but only once a person has said yes.
 *
 * Nothing here executes on its own at save time: the schedule records the
 * intent, and /api/cron picks it up on the day and still brings findings back.
 */
export async function authoriseSchedule(
  incoming: ConversationState,
): Promise<TurnResult> {
  const member = await resolveMemberOrg();
  if (!member.ok) {
    return {
      messages: [{ from: 'Holly', body: member.error }],
      state: EMPTY_STATE,
    };
  }

  const day = incoming.scheduleDay ?? 1;
  const state: ConversationState = { ...incoming, awaiting: null };

  const next = new Date();
  next.setDate(day);
  if (next.getTime() < Date.now()) next.setMonth(next.getMonth() + 1);

  const { error } = await createAdminClient().from('deadlines').insert({
    org_id: member.orgId,
    date: next.toISOString().slice(0, 10),
    recurrence: incoming.recurrence ?? 'monthly',
    owner: 'Holly',
    status: 'scheduled',
  });

  if (error) {
    return {
      messages: [
        { from: 'Holly', body: `I couldn't save that schedule: ${error.message}` },
      ],
      state,
    };
  }

  revalidatePath('/team/holly');
  revalidatePath('/catchup');

  return {
    messages: [
      {
        from: 'Holly',
        body: `Saved. I'll start the run on the ${ordinal(day)} of each month, beginning ${next.toLocaleDateString('en-IN', { day: 'numeric', month: 'long' })}, and bring you anything that needs deciding. I won't pay anyone without you.`,
      },
    ],
    state,
  };
}
