import 'server-only';
import type { ThreadMessage } from './conversation';

/**
 * What each teammate can do, and how one reaches another.
 *
 * The handoff shape is adapted from openai/openai-agents-python (MIT), where an
 * agent exposes named handoffs to other agents rather than one orchestrator
 * knowing everybody's internals. Muster's version is narrower on purpose:
 * capabilities are a fixed, declared set, so a teammate can only ever invoke
 * work that has been written down here — a model never names a function.
 *
 * The rule across every capability: a teammate may read another's data and ask
 * another to prepare work, but anything irreversible still stops at a person.
 */

export interface CapabilityContext {
  orgId: string;
  userName: string;
  /** Lets a capability call another teammate's capability. */
  invoke: (key: string, input: CapabilityInput) => Promise<CapabilityResult>;
}

export type CapabilityInput = Record<string, unknown>;

export interface CapabilityResult {
  ok: boolean;
  /** What the person sees. Each message is attributed to its teammate. */
  messages: ThreadMessage[];
  /** Structured output another capability can consume. */
  data?: Record<string, unknown>;
  error?: string;
}

export interface Capability {
  key: string;
  /** Which teammate owns this, and therefore whose name is on the message. */
  teammate: string;
  /** Plain language, used when explaining who is doing what. */
  describe: string;
  run: (
    ctx: CapabilityContext,
    input: CapabilityInput,
  ) => Promise<CapabilityResult>;
}

const REGISTRY = new Map<string, Capability>();

export function register(capability: Capability): void {
  REGISTRY.set(capability.key, capability);
}

export function getCapability(key: string): Capability | undefined {
  return REGISTRY.get(key);
}

export function listCapabilities(): Capability[] {
  return [...REGISTRY.values()];
}

export function capabilitiesFor(teammate: string): Capability[] {
  return listCapabilities().filter((c) => c.teammate === teammate);
}

/** Depth guard: a handoff chain that loops is a bug, not a conversation. */
const MAX_DEPTH = 4;

export function createContext(
  orgId: string,
  userName: string,
  depth = 0,
): CapabilityContext {
  return {
    orgId,
    userName,
    async invoke(key, input) {
      if (depth >= MAX_DEPTH) {
        return {
          ok: false,
          error: 'Too many handoffs in one go.',
          messages: [],
        };
      }

      const capability = getCapability(key);
      if (!capability) {
        return {
          ok: false,
          error: `No one here does "${key}".`,
          messages: [],
        };
      }

      return capability.run(
        createContext(orgId, userName, depth + 1),
        input,
      );
    },
  };
}
