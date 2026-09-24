import type { NextRequest } from 'next/server';
import { resolveMemberOrg } from '@/lib/data/guard';
import { buildFactsheet } from '@/lib/agents/factsheet';
import { plan } from '@/lib/agents/router';
import { streamAnswer } from '@/lib/agents/converse';
import { createContext, listCapabilities } from '@/lib/agents/registry';
import { readMoney, readPersonName } from '@/lib/agents/parse-input';
import { readIntent } from '@/lib/agents/intent';
import { matchFastPath } from '@/lib/agents/fast-path';
import {
  EMPTY_STATE,
  type ConversationState,
  type ThreadMessage,
} from '@/lib/agents/conversation';
import { runPayrollTurn, scheduleTurn, statusTurn } from '@/lib/agents/turns';

/**
 * The chat, streamed.
 *
 * Work is reported as it happens: each teammate's message goes out the moment
 * that step finishes, rather than the whole exchange landing at once after
 * twenty seconds of silence. Events are newline-delimited JSON, which is enough
 * for this and avoids a protocol nobody needs.
 */

export const maxDuration = 120;

type Event =
  | { type: 'message'; message: ThreadMessage }
  /** Transient: what is happening right now, replaced when the result lands. */
  | { type: 'status'; from: string; body: string }
  | { type: 'state'; state: ConversationState }
  | { type: 'error'; error: string };

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    text?: string;
    state?: ConversationState;
    history?: { from: string; body: string }[];
  };

  const text = String(body.text ?? '').trim();
  const incoming = body.state ?? EMPTY_STATE;
  const history = body.history ?? [];

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: Event) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));

      const say = (from: string, bodyText: string, action?: ThreadMessage['action']) =>
        send({ type: 'message', message: { from, body: bodyText, action } });

      /** Named work in progress, so a wait says what it is waiting for. */
      const status = (from: string, bodyText: string) =>
        send({ type: 'status', from, body: bodyText });

      try {
        const member = await resolveMemberOrg();
        if (!member.ok) {
          say('Holly', member.error);
          send({ type: 'state', state: EMPTY_STATE });
          return;
        }

        const state: ConversationState = { ...incoming };
        const intent = readIntent(text);

        // Commands run deterministically — a model is not in this path.
        if (intent.kind === 'run_payroll') {
          await runPayrollTurn(member.orgId, intent, state, say);
          send({ type: 'state', state });
          return;
        }

        if (intent.kind === 'schedule_payroll') {
          scheduleTurn(intent, state, say);
          send({ type: 'state', state });
          return;
        }

        if (intent.kind === 'status') {
          await statusTurn(member.orgId, say);
          send({ type: 'state', state });
          return;
        }

        /*
         * Most questions are patterned, and routing them through a model costs
         * a whole round trip to learn what a regex already knows.
         */
        const fast = matchFastPath(text);

        if (fast) {
          const owner = listCapabilities().find((c) => c.key === fast.capability);
          status(owner?.teammate ?? 'Holly', 'Checking…');

          const ctx = createContext(member.orgId, member.userName);
          const result = await ctx.invoke(fast.capability, {
            ...fast.input,
            text,
          });

          if (result.ok && result.messages.length > 0) {
            for (const message of result.messages) {
              send({ type: 'message', message });
            }
            send({ type: 'state', state });
            return;
          }
          // A fast path that came back empty falls through to the planner.
        }

        const facts = await buildFactsheet(
          member.orgId,
          member.orgName,
          member.userName,
        );

        status('Holly', 'Working out who picks this up…');

        // Is there work to do, possibly across several teammates?
        const planned = await plan(text, facts, history);

        if (planned && planned.steps.length > 0) {
          if (planned.opening && planned.steps.length > 1) {
            const owner = listCapabilities().find(
              (c) => c.key === planned.steps[0].capability,
            );
            say(owner?.teammate ?? 'Holly', planned.opening);
          }

          const ctx = createContext(member.orgId, member.userName);
          const money = readMoney(text);
          const person = readPersonName(text);

          for (const step of planned.steps) {
            const input: Record<string, unknown> = { ...step.input, text };
            if (money !== null) input.annualCtc = money;
            if (person) input.name = person;

            const owner = listCapabilities().find(
              (c) => c.key === step.capability,
            );
            if (owner) status(owner.teammate, `${owner.describe}…`);

            const result = await ctx.invoke(step.capability, input);

            // Straight out as each step lands, not batched at the end.
            for (const message of result.messages) {
              send({ type: 'message', message });
            }

            if (!result.ok) break;
          }

          send({ type: 'state', state });
          return;
        }

        // No work to do: answer, a paragraph at a time.
        status('Holly', 'Thinking…');
        for await (const paragraph of streamAnswer(text, facts, history)) {
          say('Holly', paragraph);
        }

        send({ type: 'state', state });
      } catch (error) {
        send({
          type: 'error',
          error:
            error instanceof Error
              ? error.message
              : 'Something went wrong on my side.',
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
