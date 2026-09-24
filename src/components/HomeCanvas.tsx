'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { SendIcon, SpinnerIcon } from '@/components/Icons';
import { InlineActions } from '@/components/chat/InlineActions';
import {
  authoriseSchedule,
  connectFromChat,
  decideFromChat,
} from '@/app/actions/chat';
import {
  EMPTY_STATE,
  type ConversationState,
  type ThreadMessage,
  type TurnResult,
} from '@/lib/agents/conversation';

interface Props {
  userName: string;
  strip: React.ReactNode;
  happening: React.ReactNode;
}

/**
 * Home, and the conversation it becomes.
 *
 * Once someone starts a thread they should not have to leave it. Holly asks for
 * whatever she needs right here — a token, a decision, permission to schedule —
 * and the answer is given here. The column widens and the team strip collapses
 * so the conversation has room, but nothing navigates away.
 */
export function HomeCanvas({ userName, strip, happening }: Props) {
  const [goal, setGoal] = useState('');
  const [thread, setThread] = useState<ThreadMessage[]>([]);
  const [state, setState] = useState<ConversationState>(EMPTY_STATE);
  /** Indexes whose inline action has been used, so it cannot be used twice. */
  const [spent, setSpent] = useState<Set<number>>(new Set());
  const [pending, startTransition] = useTransition();
  /** A stream is in flight; separate from the inline actions' transitions. */
  const [streaming, setStreaming] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const active = thread.length > 0;

  useEffect(() => {
    if (active) endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [thread, pending, streaming, active]);

  function apply(result: TurnResult) {
    setThread((t) => [...t, ...result.messages]);
    setState(result.state);
  }

  function spend(index: number) {
    setSpent((s) => new Set(s).add(index));
  }

  /**
   * Typed messages go over a stream, so each teammate's line appears the moment
   * that step finishes rather than the whole exchange landing at the end.
   */
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = goal.trim();
    if (!text || streaming) return;

    const history = thread.map((m) => ({ from: m.from, body: m.body }));
    setThread((t) => [...t, { from: 'you', body: text }]);
    setGoal('');
    setStreaming(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, state, history }),
      });

      if (!response.body) throw new Error('No response');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Newline-delimited JSON: everything before the last newline is whole.
        let newline = buffer.indexOf('\n');
        while (newline !== -1) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (line) handleEvent(line);
          newline = buffer.indexOf('\n');
        }
      }
    } catch {
      setThread((t) => [
        ...t,
        {
          from: 'Holly',
          body: "I lost the connection there. Say that again?",
        },
      ]);
    } finally {
      setStreaming(false);
    }
  }

  function handleEvent(line: string) {
    let event: {
      type: string;
      message?: ThreadMessage;
      state?: ConversationState;
      error?: string;
    };

    try {
      event = JSON.parse(line);
    } catch {
      return;
    }

    if (event.type === 'message' && event.message) {
      setThread((t) => [...t, event.message!]);
    } else if (event.type === 'state' && event.state) {
      setState(event.state);
    } else if (event.type === 'error' && event.error) {
      setThread((t) => [...t, { from: 'Holly', body: event.error! }]);
    }
  }

  function handleConnect(
    index: number,
    providerKey: string,
    credentials: Record<string, string>,
  ) {
    spend(index);
    setThread((t) => [
      ...t,
      { from: 'you', body: 'Connecting that now.' },
    ]);
    startTransition(async () =>
      apply(await connectFromChat(providerKey, credentials, state)),
    );
  }

  function handleDecide(
    index: number,
    exceptionId: string,
    outcome: 'approved' | 'rejected' | 'corrected',
    note?: string,
  ) {
    spend(index);
    setThread((t) => [
      ...t,
      {
        from: 'you',
        body:
          outcome === 'corrected'
            ? (note ?? 'Correcting that.')
            : outcome === 'approved'
              ? 'Approve'
              : 'Reject',
      },
    ]);
    startTransition(async () =>
      apply(await decideFromChat(exceptionId, outcome, note, state)),
    );
  }

  function handleAuthorise(index: number) {
    spend(index);
    setThread((t) => [...t, { from: 'you', body: 'Yes, set it up.' }]);
    startTransition(async () => apply(await authoriseSchedule(state)));
  }

  function handleChoose(index: number, value: string) {
    spend(index);
    if (value === 'decline_schedule') {
      setThread((t) => [
        ...t,
        { from: 'you', body: 'Not now.' },
        {
          from: 'Holly',
          body: "No problem — nothing saved. Ask me whenever you want it running on its own.",
        },
      ]);
      setState((s) => ({ ...s, awaiting: null }));
      return;
    }

    // Any other choice is just words, so it goes back through the chat.
    setGoal(value);
  }

  return (
    <div className={active ? 'threadActive' : undefined}>
      <div className="teamStrip" data-collapsed={active}>
        {strip}
      </div>

      {active ? (
        <div className="threadPane">
          <div className="thread">
            {thread.map((msg, i) => (
              <div
                key={i}
                className={`msg ${msg.from === 'you' ? 'msg-user' : 'msg-agent'}`}
              >
                {msg.from !== 'you' ? (
                  <div className="msgWho">{msg.from}</div>
                ) : null}
                <div>{msg.body}</div>

                {msg.action ? (
                  <InlineActions
                    action={msg.action}
                    busy={pending || streaming}
                    spent={spent.has(i)}
                    onConnect={(key, creds) => handleConnect(i, key, creds)}
                    onDecide={(id, outcome, note) =>
                      handleDecide(i, id, outcome, note)
                    }
                    onAuthorise={() => handleAuthorise(i)}
                    onChoose={(value) => handleChoose(i, value)}
                  />
                ) : null}
              </div>
            ))}

            {pending || streaming ? (
              <div className="msg msg-agent">
                <div className="msgWho">Holly</div>
                <span className="row" style={{ gap: 8 }}>
                  <SpinnerIcon />
                  <span className="muted">Working on it…</span>
                </span>
              </div>
            ) : null}

            <div ref={endRef} />
          </div>
        </div>
      ) : null}

      <form onSubmit={submit} className={active ? 'goalDock' : undefined}>
        <div className="goalBox">
          <input
            className="goalInput"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            // Enter sends, the way it does in any chat. Some browsers don't
            // implicitly submit a single-input form, so don't rely on it.
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit(e);
              }
            }}
            placeholder={
              active
                ? `Anything else, ${userName}?`
                : 'Tell your team what you need — e.g. Run September payroll.'
            }
            aria-label="Tell your team what you need"
          />
          <button
            className="btn btn-primary"
            disabled={!goal.trim() || pending || streaming}
            aria-label="Send"
          >
            <SendIcon />
          </button>
        </div>
        {!active ? (
          <p className="tiny muted" style={{ marginTop: 10, paddingLeft: 4 }}>
            Whatever Holly needs from you, she&rsquo;ll ask right here.
          </p>
        ) : null}
      </form>

      {!active ? happening : null}
    </div>
  );
}
