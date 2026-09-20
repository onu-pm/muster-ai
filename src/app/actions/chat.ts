'use server';

import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolveMemberOrg } from '@/lib/data/guard';
import { listConnections } from '@/lib/data/connections';
import { listNeedsYou, listComingUp } from '@/lib/data/catchup';
import { getProvider } from '@/lib/catalog/providers';
import { readIntent, ordinal } from '@/lib/agents/intent';
import { runInput } from '@/lib/agents/input';
import { runStructure } from '@/lib/agents/structure';
import { runTax } from '@/lib/agents/tax';
import { connectProvider } from '@/app/actions/connections';
import { decideOnException, type Outcome } from '@/app/actions/decisions';
import {
  EMPTY_STATE,
  type ConversationState,
  type ThreadMessage,
  type TurnResult,
} from '@/lib/agents/conversation';
import { dutyTypeLabel, pluralise } from '@/lib/copy/labels';
import { buildFactsheet } from '@/lib/agents/factsheet';
import { converse } from '@/lib/agents/converse';
import { plan, runPlan } from '@/lib/agents/router';
import { listCapabilities } from '@/lib/agents/registry';

/**
 * Holly's side of the conversation.
 *
 * The rule this file follows: if Holly can do something, she does it and says
 * what happened. If she needs a person, she asks here, in the thread, and the
 * answer is given here too. She never tells someone to go to another screen to
 * finish a job they started in the chat.
 */

const ATTENDANCE_SOURCES = ['remote_com', 'csv_import'];

/** How many findings to surface inline before offering the full list. */
const INLINE_DECISION_LIMIT = 3;

async function connectedSources(orgId: string): Promise<string[]> {
  const connections = await listConnections(orgId);
  return connections
    .filter((c) => c.status === 'connected')
    .map((c) => c.providerKey);
}

/** Asks for a data source without sending anyone to the Marketplace. */
function askForConnection(periodLabel: string): ThreadMessage {
  const remote = getProvider('remote_com');
  return {
    from: 'Holly',
    body: `Before I can start on ${periodLabel}, I need somewhere to read attendance and leave from. Paste a Remote.com token and I'll carry on from here.`,
    action: {
      kind: 'connect',
      providerKey: 'remote_com',
      label: remote?.label ?? 'Remote.com',
      fields: remote?.fields ?? [],
      alternatives: [
        { providerKey: 'csv_import', label: 'I keep it in a spreadsheet' },
      ],
    },
  };
}

/**
 * Runs the month and reports back. Anything Holly could not settle is offered
 * for a decision right here rather than parked on another page.
 */
async function executePayroll(
  orgId: string,
  period: { month: number; year: number; label: string },
): Promise<ThreadMessage[]> {
  const messages: ThreadMessage[] = [];

  const input = await runInput(orgId, period.year, period.month);

  if (!input.ok) {
    return [
      {
        from: 'Holly',
        body: input.error ?? "I couldn't read the attendance data just now.",
      },
    ];
  }

  messages.push({
    from: 'Holly',
    body: input.crossChecked
      ? `Checked attendance against leave for ${pluralise(input.peopleCount, 'person', 'people')}.` +
        (input.explainedByFact > 0
          ? ` ${pluralise(input.explainedByFact, 'gap was', 'gaps were')} explained by what you've already told me.`
          : '')
      : `Read leave for ${pluralise(input.peopleCount, 'person', 'people')} from Remote. That's my only record of the month, so there's nothing to cross-check it against yet.`,
  });

  if (input.dutyInstanceId) {
    const [structure, tax] = await Promise.all([
      runStructure(orgId, input.dutyInstanceId),
      runTax(orgId, input.dutyInstanceId),
    ]);

    if (structure.checked > 0) {
      messages.push({
        from: 'Holly',
        body:
          (structure.breaches > 0
            ? `${pluralise(structure.breaches, 'person is', 'people are')} below the statutory half on basic pay. I haven't changed anyone's split.`
            : `Pay structures all pass the 50% wage test${structure.usedConfirmedRule ? ', using your own wage definition' : ''}.`) +
          (structure.withoutStructure > 0
            ? ` ${pluralise(structure.withoutStructure, 'person has', 'people have')} no salary structure on record, so I couldn't test them either way.`
            : ''),
      });
    } else if (structure.withoutStructure > 0) {
      messages.push({
        from: 'Holly',
        body: `I have ${pluralise(structure.withoutStructure, 'person', 'people')} on the roster but no salary structure for any of them, so there's nothing to pay yet.`,
      });
    }

    if (tax.projected > 0) {
      messages.push({
        from: 'Holly',
        body:
          `Projected this month's tax for ${pluralise(tax.projected, 'person', 'people')}.` +
          (tax.trimmedClaims > 0
            ? ` ${pluralise(tax.trimmedClaims, 'claim was', 'claims were')} above the cap, so I allowed the cap only.`
            : ''),
      });
    }
  }

  // Bring the decisions to the person instead of sending them looking.
  const open = await listNeedsYou(orgId);

  if (open.length === 0) {
    messages.push({
      from: 'Holly',
      body: "Nothing needs a decision from you. I'll come back if that changes.",
    });
    return messages;
  }

  messages.push({
    from: 'Holly',
    body: `${pluralise(open.length, 'thing needs', 'things need')} you. Let's do them here.`,
  });

  for (const item of open.slice(0, INLINE_DECISION_LIMIT)) {
    messages.push({
      from: 'Holly',
      body: item.conclusion,
      action: {
        kind: 'decide',
        exceptionId: item.id,
        about: item.personName ?? 'this',
      },
    });
  }

  if (open.length > INLINE_DECISION_LIMIT) {
    messages.push({
      from: 'Holly',
      body: `There are ${open.length - INLINE_DECISION_LIMIT} more like this. We can work through them here, or you can look at the whole list.`,
      action: { kind: 'link', href: '/catchup', label: 'See the full list' },
    });
  }

  return messages;
}

/** Everything waiting on a decision, offered inline. */
async function offerDecisions(
  orgId: string,
  lead: string,
): Promise<ThreadMessage[]> {
  const open = await listNeedsYou(orgId);
  if (open.length === 0) {
    return [{ from: 'Holly', body: 'Nothing is waiting on you right now.' }];
  }

  const messages: ThreadMessage[] = [{ from: 'Holly', body: lead }];

  for (const item of open.slice(0, INLINE_DECISION_LIMIT)) {
    messages.push({
      from: 'Holly',
      body: item.conclusion,
      action: {
        kind: 'decide',
        exceptionId: item.id,
        about: item.personName ?? 'this',
      },
    });
  }

  return messages;
}

/** Entry point for anything typed into the chat. */
export async function sendGoal(
  text: string,
  incoming: ConversationState = EMPTY_STATE,
  history: { from: string; body: string }[] = [],
): Promise<TurnResult> {
  const member = await resolveMemberOrg();
  if (!member.ok) {
    return {
      messages: [{ from: 'Holly', body: member.error }],
      state: EMPTY_STATE,
    };
  }

  const intent = readIntent(text);
  const state: ConversationState = { ...incoming };

  /*
   * Anything the keyword reader does not recognise used to fall into a single
   * canned reply, so every unrecognised message got the same answer. It now
   * goes to Holly, who either answers it or hands back one of the actions
   * below. The deterministic reader still wins when it matches, because those
   * paths execute real work and must not depend on a model.
   */
  if (intent.kind === 'unknown') {
    const facts = await buildFactsheet(
      member.orgId,
      member.orgName,
      member.userName,
    );

    /*
     * Does this need actual work doing, possibly across more than one
     * teammate? The router decides that; the person is never asked to pick.
     */
    const planned = await plan(text, facts, history);

    if (planned && planned.steps.length > 0) {
      const messages: ThreadMessage[] = [];
      if (planned.opening) {
        const owner = listCapabilities().find(
          (c) => c.key === planned.steps[0].capability,
        );
        messages.push({
          from: owner?.teammate ?? 'Holly',
          body: planned.opening,
        });
      }

      messages.push(
        ...(await runPlan(planned, member.orgId, member.userName, text)),
      );

      if (messages.length > 0) return { messages, state };
    }

    const spoken = await converse(text, facts, history);

    if (spoken.action === 'answer') {
      return {
        messages: spoken.messages.map((body) => ({
          from: 'Holly' as const,
          body,
        })),
        state,
      };
    }

    if (spoken.action === 'review_items') {
      return {
        messages: [
          ...spoken.messages.map((body) => ({ from: 'Holly' as const, body })),
          ...(await offerDecisions(
            member.orgId,
            "Here's the first one.",
          )),
        ],
        state,
      };
    }

    // Holly read it as a command the keyword reader missed. Re-read the same
    // text for the period or day, so no figure comes from the model.
    const reread = readIntent(
      spoken.action === 'schedule_payroll'
        ? `${text} every month`
        : `${text} payroll`,
    );

    const lead = spoken.messages.map((body) => ({
      from: 'Holly' as const,
      body,
    }));

    if (reread.kind === 'schedule_payroll') {
      state.intent = 'schedule_payroll';
      state.scheduleDay = reread.day;
      state.recurrence = reread.recurrence;
      state.awaiting = 'schedule';
      return {
        messages: [
          ...lead,
          {
            from: 'Holly',
            body: `That would run on ${reread.cadenceLabel}, without you here — so I need your say-so first.`,
            action: {
              kind: 'authorise',
              summary: `Run payroll on ${reread.cadenceLabel}, and bring anything uncertain to you`,
            },
          },
        ],
        state,
      };
    }

    if (reread.kind === 'run_payroll') {
      const period = {
        month: reread.month,
        year: reread.year,
        label: reread.periodLabel,
      };
      state.intent = 'run_payroll';
      state.period = period;

      const sources = await connectedSources(member.orgId);
      if (!sources.some((key) => ATTENDANCE_SOURCES.includes(key))) {
        state.awaiting = 'connection';
        return {
          messages: [...lead, askForConnection(period.label)],
          state,
        };
      }

      state.awaiting = null;
      return {
        messages: [...lead, ...(await executePayroll(member.orgId, period))],
        state,
      };
    }

    return {
      messages: lead.length
        ? lead
        : [{ from: 'Holly', body: "I'm not sure what you'd like me to do." }],
      state,
    };
  }

  if (intent.kind === 'run_payroll') {
    const period = {
      month: intent.month,
      year: intent.year,
      label: intent.periodLabel,
    };
    state.intent = 'run_payroll';
    state.period = period;

    const sources = await connectedSources(member.orgId);
    const hasAttendance = sources.some((key) =>
      ATTENDANCE_SOURCES.includes(key),
    );

    if (!hasAttendance) {
      state.awaiting = 'connection';
      return {
        messages: [
          { from: 'Holly', body: `Right — ${period.label} payroll.` },
          askForConnection(period.label),
        ],
        state,
      };
    }

    state.awaiting = null;
    return {
      messages: [
        { from: 'Holly', body: `On it — ${period.label} payroll.` },
        ...(await executePayroll(member.orgId, period)),
      ],
      state,
    };
  }

  if (intent.kind === 'schedule_payroll') {
    state.intent = 'schedule_payroll';
    state.scheduleDay = intent.day;
    state.recurrence = intent.recurrence;
    state.awaiting = 'schedule';

    return {
      messages: [
        {
          from: 'Holly',
          body: `I can run payroll on ${intent.cadenceLabel} without you having to ask. I'd gather attendance, work out pay and tax, and hold anything I'm unsure about for you rather than acting on it.`,
        },
        {
          from: 'Holly',
          body: "That runs when you may not be here, so I need your say-so before I set it up.",
          action: {
            kind: 'authorise',
            summary: `Run payroll on ${intent.cadenceLabel}, and bring anything uncertain to you`,
          },
        },
      ],
      state,
    };
  }

  if (intent.kind === 'status') {
    const [needsYou, comingUp] = await Promise.all([
      listNeedsYou(member.orgId),
      listComingUp(member.orgId),
    ]);

    if (needsYou.length === 0 && comingUp.length === 0) {
      return {
        messages: [
          {
            from: 'Holly',
            body: 'Nothing needs you and nothing is in flight. All quiet.',
          },
        ],
        state,
      };
    }

    const messages: ThreadMessage[] = [];

    if (comingUp.length > 0) {
      messages.push({
        from: 'Holly',
        body: `${pluralise(comingUp.length, 'job is', 'jobs are')} in flight, including ${dutyTypeLabel(comingUp[0].dutyType).toLowerCase()}.`,
      });
    }

    if (needsYou.length > 0) {
      messages.push({
        from: 'Holly',
        body: `${pluralise(needsYou.length, 'thing is', 'things are')} waiting on you. Here's the first.`,
      });
      for (const item of needsYou.slice(0, INLINE_DECISION_LIMIT)) {
        messages.push({
          from: 'Holly',
          body: item.conclusion,
          action: {
            kind: 'decide',
            exceptionId: item.id,
            about: item.personName ?? 'this',
          },
        });
      }
    }

    return { messages, state };
  }

  // Every remaining intent is handled above.
  return { messages: [], state };
}

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
    messages.push(...(await executePayroll(member.orgId, state.period)));
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
 * Nothing here executes on its own: the schedule records the intent, and each
 * run still brings its findings back for a decision.
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
        body: `Saved — it's on the calendar for the ${ordinal(day)} of each month, starting ${next.toLocaleDateString('en-IN', { day: 'numeric', month: 'long' })}. One thing to be straight about: nothing kicks it off automatically yet, so on the day you'll still need to tell me to go. I won't pay anyone without you either way.`,
      },
    ],
    state,
  };
}
