import type { ProviderField } from '@/lib/catalog/providers';

/**
 * The shape of a conversation with Holly.
 *
 * The chat is where work happens, not a place that points at other screens.
 * Anything Holly needs from a person — a token, an approval, permission to
 * schedule something — is asked for inline and answered inline. The navigation
 * is for looking back over things later, not for completing work.
 */

export type Awaiting = null | 'connection' | 'schedule' | 'period';

export interface ConversationState {
  /** What Holly is currently waiting on the person for. */
  awaiting: Awaiting;
  /** The goal being worked, kept so it can resume once the person answers. */
  intent: 'run_payroll' | 'schedule_payroll' | 'status' | null;
  period: { month: number; year: number; label: string } | null;
  /** For a recurring run: the day of the month it should happen on. */
  scheduleDay: number | null;
  recurrence: string | null;
}

export const EMPTY_STATE: ConversationState = {
  awaiting: null,
  intent: null,
  period: null,
  scheduleDay: null,
  recurrence: null,
};

export type InlineAction =
  /** Connect a data source without leaving the conversation. */
  | {
      kind: 'connect';
      providerKey: string;
      label: string;
      fields: ProviderField[];
      /** Other ways to satisfy the same need, offered as one-tap options. */
      alternatives: { providerKey: string; label: string }[];
    }
  /** Approve, reject or correct a finding, in the thread. */
  | {
      kind: 'decide';
      exceptionId: string;
      /** Short restatement so the buttons are never context-free. */
      about: string;
    }
  /** Permission for something that will run later without a person present. */
  | {
      kind: 'authorise';
      summary: string;
    }
  | {
      kind: 'choice';
      options: { value: string; label: string }[];
    }
  /** Only ever for looking at detail — never for completing work. */
  | {
      kind: 'link';
      href: string;
      label: string;
    };

export interface ThreadMessage {
  /** 'you', or a teammate's name — messages are attributed to whoever spoke. */
  from: string;
  body: string;
  action?: InlineAction;
}

export interface TurnResult {
  messages: ThreadMessage[];
  state: ConversationState;
}
