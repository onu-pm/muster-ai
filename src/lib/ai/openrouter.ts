import 'server-only';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { generateObject, streamText, type LanguageModel } from 'ai';
import type { z } from 'zod';
import { env } from '@/lib/env';

/**
 * Every model call in this codebase goes through here.
 *
 * Models read unstructured text and draft language. They never produce a figure
 * that reaches a payslip — anything arithmetic is computed by the rule code in
 * `src/lib/rules`, which is unit-tested.
 *
 * Built on the Vercel AI SDK (Apache-2.0) through the OpenRouter provider
 * (Apache-2.0). The SDK gives schema-validated structured output and token
 * streaming; what it does not give is failover between models, and the free
 * Nemotron tier refuses a large share of requests, so that part stays ours.
 */

export class ModelUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelUnavailableError';
  }
}

/**
 * Both measured on this account: super ~2.7s, ultra ~4s, both returning clean
 * structured output. Deliberately excluded — lightning (~40s, too slow to
 * converse through) and nano-omni (returns reasoning and an empty body).
 */
const FALLBACK_CHAIN = [
  'nvidia/nemotron-3-super-120b-a12b:free',
  'nvidia/nemotron-3-ultra-550b-a55b:free',
];

function chainFrom(preferred: string): string[] {
  return [preferred, ...FALLBACK_CHAIN.filter((m) => m !== preferred)];
}

function provider() {
  if (!env.openRouterKey) {
    throw new ModelUnavailableError('OPENROUTER_API_KEY is not set.');
  }
  return createOpenRouter({ apiKey: env.openRouterKey });
}

function model(id: string): LanguageModel {
  return provider()(id);
}

/** Capacity failures come back as ordinary errors, so they are matched by text. */
const UPSTREAM_TROUBLE =
  /upstream|resourceexhausted|overloaded|rate.?limit|capacity|timeout|aborted/i;

interface StructuredOptions<T> {
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  preferred?: string;
  temperature?: number;
}

/**
 * Structured output, validated against a schema before it is returned.
 *
 * This replaces hand-rolled JSON extraction: a reply that does not fit the
 * schema is a failure and moves to the next model, rather than being half-read.
 */
export async function generateStructured<T>({
  system,
  prompt,
  schema,
  preferred,
  temperature = 0.1,
}: StructuredOptions<T>): Promise<T> {
  const chain = chainFrom(preferred ?? env.modelRoutine);
  let lastProblem = 'No usable response from the model.';

  for (let attempt = 0; attempt < chain.length + 1; attempt++) {
    const id = chain[attempt % chain.length];

    if (attempt >= chain.length) {
      await new Promise((r) => setTimeout(r, 800));
    }

    try {
      const { object } = await generateObject({
        model: model(id),
        schema,
        system,
        prompt,
        temperature,
        abortSignal: AbortSignal.timeout(30_000),
      });
      return object;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown model error.';
      lastProblem = message;

      // A schema mismatch on one model is worth retrying on another; a missing
      // key is not going to fix itself.
      if (error instanceof ModelUnavailableError) throw error;
      if (!UPSTREAM_TROUBLE.test(message) && attempt >= chain.length - 1) {
        break;
      }
    }
  }

  throw new ModelUnavailableError(lastProblem);
}

interface StreamOptions {
  system: string;
  prompt: string;
  preferred?: string;
  temperature?: number;
}

/**
 * Prose, streamed.
 *
 * Yields text as it arrives so a reply appears while it is being written
 * instead of after a silent wait. Failover happens before the first token: once
 * streaming has started, switching models mid-sentence would garble the reply,
 * so a mid-stream failure ends the stream and the caller keeps what arrived.
 */
export async function* streamProse({
  system,
  prompt,
  preferred,
  temperature = 0.6,
}: StreamOptions): AsyncGenerator<string> {
  const chain = chainFrom(preferred ?? env.modelRoutine);
  let lastProblem = 'No response from the model.';

  for (const id of chain) {
    let started = false;

    try {
      const result = streamText({
        model: model(id),
        system,
        prompt,
        temperature,
        abortSignal: AbortSignal.timeout(45_000),
      });

      for await (const chunk of result.textStream) {
        if (!chunk) continue;
        started = true;
        yield chunk;
      }

      if (started) return;
      lastProblem = `${id} returned nothing.`;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown model error.';
      lastProblem = message;
      if (started) return;
    }
  }

  throw new ModelUnavailableError(lastProblem);
}
