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
  temperature?: number;
}

const UPSTREAM_TROUBLE =
  /upstream error|resourceexhausted|temporarily overloaded|rate.?limit|capacity/i;

/**
 * The free Nemotron tier refuses a large share of requests with an upstream
 * capacity error, so a single model is not dependable enough to talk through.
 * Each attempt moves to the next model in the chain before backing off — all
 * free Nemotron, as the brief requires.
 */
const FALLBACK_CHAIN = [
  // ~2.7s, clean JSON.
  'nvidia/nemotron-3-super-120b-a12b:free',
  // ~4s, clean JSON.
  'nvidia/nemotron-3-ultra-550b-a55b:free',
];

/*
 * Deliberately not in the chain, both measured on this account:
 *   nemotron-3.5-lightning:free — ~40s, too slow to converse through.
 *   nemotron-3-nano-omni:free   — returns its reasoning and an empty content.
 */

/**
 * A model that stalls must not hold up a reply, but this has to sit above how
 * long a real answer takes: measured on this account, a full prompt against
 * nemotron-3-super lands in roughly 10-15s. A tighter bound aborted healthy
 * calls and made every reply slower, not faster.
 */
const REQUEST_TIMEOUT_MS = 30_000;

function modelChain(preferred: string): string[] {
  return [preferred, ...FALLBACK_CHAIN.filter((m) => m !== preferred)];
}

export async function complete({
  system,
  user,
  model,
  maxTokens = 900,
  attempts = 2,
  temperature = 0,
}: CompleteOptions): Promise<string> {
  if (!env.openRouterKey) {
    throw new ModelUnavailableError('OPENROUTER_API_KEY is not set.');
  }

  const chain = modelChain(model ?? env.modelRoutine);
  let lastProblem = 'No response from the model.';

  for (let attempt = 0; attempt < attempts; attempt++) {
    const chosen = chain[attempt % chain.length];

    // Only wait once the whole chain has been tried.
    if (attempt >= chain.length) {
      await new Promise((r) =>
        setTimeout(r, 700 * 2 ** (attempt - chain.length)),
      );
    }

    let response: Response;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS);

    try {
      response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        signal: abort.signal,
        headers: {
          Authorization: `Bearer ${env.openRouterKey}`,
          'Content-Type': 'application/json',
          'X-Title': 'Muster',
        },
        body: JSON.stringify({
          model: chosen,
          temperature,
          max_tokens: maxTokens,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
      });
    } catch (error) {
      lastProblem =
        error instanceof Error && error.name === 'AbortError'
          ? `${chosen} did not answer in time.`
          : error instanceof Error
            ? error.message
            : 'Network error.';
      continue;
    } finally {
      clearTimeout(timer);
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
