import 'server-only';
import { env } from '@/lib/env';

/**
 * Every model call in this codebase goes through here.
 *
 * Models read unstructured text and draft language. They never produce a figure
 * that reaches a payslip — anything arithmetic is computed by the rule code in
 * `src/lib/rules`, which is unit-tested. Extraction returns what a document
 * says; whether that is correct, and what it is worth, is decided elsewhere.
 *
 * The free Nemotron tier returns its chain of thought in a separate `reasoning`
 * field and intermittently refuses with an upstream capacity error, so calls
 * retry with backoff and only ever read `content`.
 */

export class ModelUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelUnavailableError';
  }
}

interface CompleteOptions {
  system: string;
  user: string;
  model?: string;
  maxTokens?: number;
  attempts?: number;
}

const UPSTREAM_TROUBLE =
  /upstream error|resourceexhausted|temporarily overloaded|rate.?limit|capacity/i;

export async function complete({
  system,
  user,
  model,
  maxTokens = 900,
  attempts = 3,
}: CompleteOptions): Promise<string> {
  if (!env.openRouterKey) {
    throw new ModelUnavailableError('OPENROUTER_API_KEY is not set.');
  }

  const chosen = model ?? env.modelRoutine;
  let lastProblem = 'No response from the model.';

  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 900 * 2 ** (attempt - 1)));
    }

    let response: Response;
    try {
      response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.openRouterKey}`,
          'Content-Type': 'application/json',
          'X-Title': 'Muster',
        },
        body: JSON.stringify({
          model: chosen,
          temperature: 0,
          max_tokens: maxTokens,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
      });
    } catch (error) {
      lastProblem = error instanceof Error ? error.message : 'Network error.';
      continue;
    }

    if (!response.ok) {
      lastProblem = `The model service returned ${response.status}.`;
      continue;
    }

    const body = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
      error?: { message?: string };
    };

    const content = body.choices?.[0]?.message?.content?.trim() ?? '';

    // A 200 can still carry an upstream capacity failure as the message body.
    if (!content || UPSTREAM_TROUBLE.test(content)) {
      lastProblem =
        body.error?.message ?? content ?? 'The model service was busy.';
      continue;
    }

    return content;
  }

  throw new ModelUnavailableError(lastProblem);
}

/**
 * Pulls the first JSON object or array out of a model reply. Reasoning models
 * sometimes wrap output in prose or a code fence even when told not to.
 */
export function parseJson<T>(raw: string): T {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : raw).trim();

  try {
    return JSON.parse(candidate) as T;
  } catch {
    // fall through
  }

  const start = candidate.search(/[[{]/);
  if (start !== -1) {
    const opener = candidate[start];
    const closer = opener === '{' ? '}' : ']';
    const end = candidate.lastIndexOf(closer);
    if (end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1)) as T;
      } catch {
        // fall through
      }
    }
  }

  throw new Error('The model did not return readable JSON.');
}

export async function completeJson<T>(options: CompleteOptions): Promise<T> {
  return parseJson<T>(await complete(options));
}
