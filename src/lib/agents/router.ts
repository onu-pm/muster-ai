import 'server-only';
import { z } from 'zod';
import { generateStructured, ModelUnavailableError } from '@/lib/ai/openrouter';
import { createContext, listCapabilities } from './registry';
import type { ThreadMessage } from './conversation';
import type { Factsheet } from './factsheet';
import { describeFactsheetBrief } from './factsheet';
import { readMoney, readPersonName } from './parse-input';

export { readMoney, readPersonName } from './parse-input';

// Importing these registers their capabilities.
import './holly-capabilities';
import './hansel';
import './query-capabilities';

/**
 * Who picks a goal up, and in what order.
 *
 * A person says what they want. They never choose a teammate, and they are
 * never asked to. The router works out which capabilities the goal needs —
 * which may span more than one teammate — and the capabilities hand off to each
 * other from there.
 *
 * The model may only choose from the registered capability keys and may only
 * fill in arguments the person actually supplied. It cannot invent a capability
 * and it cannot invent a figure: anything numeric is parsed out of the person's
 * own words here, not generated.
 */

export interface Plan {
  steps: { capability: string; input: Record<string, unknown> }[];
  /** Said before the work starts, so the thread is never silent. */
  opening: string | null;
}

/**
 * The shape a plan must fit. Validated by the SDK, so a reply that does not
 * match is rejected outright rather than half-read.
 */
const PlanSchema = z.object({
  opening: z.string().describe('One short line from whoever picks it up first'),
  steps: z
    .array(
      z.object({
        capability: z.string().describe('Exactly one of the listed keys'),
        input: z.record(z.string(), z.unknown()).default({}),
      }),
    )
    .max(4),
});

function capabilityMenu(): string {
  return listCapabilities()
    .map((c) => `- ${c.key} (${c.teammate}): ${c.describe}`)
    .join('\n');
}

const SYSTEM = `You route a request to the people who can do it. The person speaking does not know which teammate owns what, and must never be asked to choose.

Pick the capabilities needed, in order. A request often needs more than one, and they may belong to different teammates — that is normal and expected.

Rules:
- "capability" must be one of the listed keys, exactly. Never invent one.
- Only fill "input" with values the person actually said. Never invent a name, a salary, a date or a skill.
- Leave a value out entirely rather than guessing it.
- If nothing listed fits, return an empty "steps" array.
- "opening" is one short line from whoever picks it up first, in their voice. No greeting, no restating the request.`;

export async function plan(
  text: string,
  facts: Factsheet,
  history: { from: string; body: string }[],
): Promise<Plan | null> {
  // Two turns is enough to resolve "and onboard her too"; more is just latency.
  const recent = history
    .slice(-2)
    .map((m) => `${m.from}: ${m.body.slice(0, 160)}`)
    .join('\n');

  try {
    const raw = await generateStructured({
      schema: PlanSchema,
      shapeHint:
        '{"opening": "one short line", "steps": [{"capability": "exact.key", "input": {"name": "...", "roleTitle": "..."}}]}',
      system: SYSTEM,
      prompt: [
        `CAPABILITIES\n${capabilityMenu()}`,
        '',
        `WHAT IS ON FILE\n${describeFactsheetBrief(facts)}`,
        '',
        recent ? `RECENT CONVERSATION\n${recent}` : '',
        '',
        `They just said: ${text}`,
      ]
        .filter(Boolean)
        .join('\n'),
      temperature: 0.1,
    });

    const known = new Set(listCapabilities().map((c) => c.key));
    const steps = raw.steps
      .filter((s) => known.has(s.capability))
      .map((s) => ({ capability: s.capability, input: s.input ?? {} }));

    return { steps, opening: raw.opening.trim() || null };
  } catch (error) {
    if (error instanceof ModelUnavailableError) return null;
    return null;
  }
}

/**
 * Runs a plan, with figures and names taken from the person's own words rather
 * than from the model's reading of them.
 */
export async function runPlan(
  planned: Plan,
  orgId: string,
  userName: string,
  originalText: string,
): Promise<ThreadMessage[]> {
  const ctx = createContext(orgId, userName);
  const messages: ThreadMessage[] = [];

  const money = readMoney(originalText);
  const person = readPersonName(originalText);

  for (const step of planned.steps) {
    const input = { ...step.input };

    // Overwrite anything the model may have filled in for these.
    if (money !== null) input.annualCtc = money;
    if (person) input.name = person;
    // Query capabilities read the period out of the original wording themselves.
    input.text = originalText;

    const result = await ctx.invoke(step.capability, input);
    messages.push(...result.messages);

    // A failed step stops the chain — the next one would be working on sand.
    if (!result.ok) break;
  }

  return messages;
}
