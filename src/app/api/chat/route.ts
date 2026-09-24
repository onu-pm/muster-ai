import type { NextRequest } from 'next/server';
import { resolveMemberOrg } from '@/lib/data/guard';
import { buildFactsheet } from '@/lib/agents/factsheet';
import { plan } from '@/lib/agents/router';
import { streamAnswer } from '@/lib/agents/converse';
import { createContext, listCapabilities } from '@/lib/agents/registry';
import { readMoney, readPersonName } from '@/lib/agents/parse-input';
import { readIntent } from '@/lib/agents/intent';
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

        const facts = await buildFactsheet(
          member.orgId,
          member.orgName,
          member.userName,
        );

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
