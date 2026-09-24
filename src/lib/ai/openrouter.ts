import 'server-only';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { generateText, streamText, type LanguageModel } from 'ai';
import type { z } from 'zod';
import { env } from '@/lib/env';
import { isQuotaMessage } from './quota';

/**
 * Every model call in this codebase goes through here.
 *
 * Models read unstructured text and draft language. They never produce a figure
 * that reaches a payslip — anything arithmetic is computed by the rule code in
 * `src/lib/rules`, which is unit-tested.
 *
 * Built on the Vercel AI SDK (Apache-2.0) through the OpenRouter provider
 * (Apache-2.0), for transport and streaming.
 *
 * Two things the SDK cannot do here, both measured on this account:
 *
 *   - `generateObject` does not work on the free Nemotron tier. Five of six
 *     attempts failed with an upstream error, a timeout, or "no object
 *     generated"; the one that succeeded returned a malformed object. These
 *     models do not support the provider-side structured-output mode it needs.
 *     So JSON is asked for in the prompt, parsed leniently, and validated
 *     against the same zod schema afterwards — the guarantee is kept, the
 *     dependency on provider support is not.
 *   - Failover between models. The free tier refuses a large share of requests,
 *     so that stays ours too.
 *
 * `streamText` does work, and carries all the prose.
 */

export class ModelUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelUnavailableError';
  }
}

/**
 * Ordered by measured reliability, not by name.
 *
 * Benchmarked on this account over repeated runs, asking for the same routing
 * JSON and the same short answer:
 *
 *   nex-n2.5-mini   6/6 JSON, ~1.8s, stream first token 586ms
 *   dots-3-note     6/6 JSON, ~1.4s, stream first token 649ms
 *   nemotron-super  swung between 1/4 and 6/6, and failed streaming outright
 *
 * Nemotron stays in the chain because the brief asks for it, but it cannot go
 * first: every one of its refusals costs a whole extra round trip, which is
 * where the old 8-20s replies came from.
 */
const FALLBACK_CHAIN = [
  'nex-agi/nex-n2.5-mini:free',
  'dots-studio/dots-3-note-preview:free',
  'nvidia/nemotron-3-super-120b-a12b:free',
];

/**
 * These are reasoning models and reasoning is on unless asked otherwise, which
 * spent 350-650 hidden tokens before a word appeared. Measured: first token
 * 2556ms with it on, 375ms with it off, for the same reply.
 *
 * Nothing here needs a visible chain of thought — the decisions that matter are
 * made by rule code, not by the model.
 */
const NO_REASONING = { reasoning: { enabled: false } } as const;

function chainFrom(preferred: string): string[] {
  return [preferred, ...FALLBACK_CHAIN.filter((m) => m !== preferred)];
}

function provider() {
  if (!env.openRouterKey) {
    throw new ModelUnavailableError('OPENROUTER_API_KEY is not set.');
  }
  return createOpenRouter({
    apiKey: env.openRouterKey,
    extraBody: NO_REASONING,
  });
}

function model(id: string): LanguageModel {
  return provider()(id);
}

/** Capacity failures come back as ordinary errors, so they are matched by text. */
const UPSTREAM_TROUBLE =
  /upstream|resourceexhausted|overloaded|rate.?limit|capacity|timeout|aborted/i;

/**
 * The daily free-model quota, which is a different thing from a busy model:
 * no amount of retrying or failing over to another model will clear it, since
 * it is counted per account per day across all free models.
 */
export function isQuotaError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return isQuotaMessage(message);
}

/*
 * The SDK retries three times with backoff on its own. Stacked on top of the
 * failover below that is nine attempts for one reply, which is how a dead
 * quota turned into a 47-second wait before the error surfaced. Failover is
 * handled here, so the SDK should try once and hand back.
 */
const NO_SDK_RETRIES = 0;

interface StructuredOptions<T> {
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  /** Shown to the model so it knows the shape to produce. */
  shapeHint: string;
  preferred?: string;
  temperature?: number;
}

/**
 * Pulls the first JSON object or array out of a reply. Reasoning models wrap
 * output in prose or a code fence even when told not to.
 */
export function parseJson(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : raw).trim();

  try {
    return JSON.parse(candidate);
  } catch {
    // fall through
  }

  const start = candidate.search(/[[{]/);
  if (start === -1) throw new Error('No JSON in the reply.');

  const opener = candidate[start];
  const closer = opener === '{' ? '}' : ']';
  const end = candidate.lastIndexOf(closer);
  if (end <= start) throw new Error('No JSON in the reply.');

  return JSON.parse(candidate.slice(start, end + 1));
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
  shapeHint,
  preferred,
  temperature = 0.1,
}: StructuredOptions<T>): Promise<T> {
  const chain = chainFrom(preferred ?? env.modelRoutine);
  let lastProblem = 'No usable response from the model.';

  const instructed = `${system}\n\nReply with a single JSON object and nothing else, in exactly this shape:\n${shapeHint}`;

  for (let attempt = 0; attempt < chain.length + 1; attempt++) {
    const id = chain[attempt % chain.length];
    if (attempt >= chain.length) await new Promise((r) => setTimeout(r, 800));

    try {
      const { text } = await generateText({
        model: model(id),
        system: instructed,
        prompt,
        temperature,
        maxRetries: NO_SDK_RETRIES,
        abortSignal: AbortSignal.timeout(20_000),
      });

      if (!text?.trim() || UPSTREAM_TROUBLE.test(text)) {
        lastProblem = text?.trim() || `${id} returned nothing.`;
        continue;
      }

      // The schema is still the contract; only who enforces it has changed.
      return schema.parse(parseJson(text));
    } catch (error) {
      lastProblem =
        error instanceof Error ? error.message : 'Unknown model error.';
      if (error instanceof ModelUnavailableError) throw error;
      // The quota is per account, so the next model has nothing left either.
      if (isQuotaError(error)) break;
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

    /*
     * streamText does not throw from the iteration — it reports failures
     * through onError and simply ends the stream. Relying on try/catch here
     * silently swallowed the real message and left the default one, which is
     * why a spent daily quota surfaced as "the tier is busy, try again" when
     * trying again could not possibly work.
     */
    let captured: unknown = null;

    try {
      const result = streamText({
        model: model(id),
        system,
        prompt,
        temperature,
        maxRetries: NO_SDK_RETRIES,
        abortSignal: AbortSignal.timeout(30_000),
        onError: ({ error }) => {
          captured = error;
        },
      });

      for await (const chunk of result.textStream) {
        if (!chunk) continue;
        started = true;
        yield chunk;
      }
    } catch (error) {
      captured = error;
    }

    if (started) return;

    if (captured) {
      lastProblem =
        captured instanceof Error ? captured.message : String(captured);
      // The quota is per account, so the next model has nothing left either.
      if (isQuotaError(captured)) break;
    } else {
      lastProblem = `${id} returned nothing.`;
    }
  }

  throw new ModelUnavailableError(lastProblem);
}
