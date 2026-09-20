'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { SendIcon, SpinnerIcon } from '@/components/Icons';
import { InlineActions } from '@/components/chat/InlineActions';
import {
  authoriseSchedule,
  connectFromChat,
  decideFromChat,
  sendGoal,
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
  const endRef = useRef<HTMLDivElement>(null);

  const active = thread.length > 0;

  useEffect(() => {
    if (active) endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [thread, pending, active]);

  function apply(result: TurnResult) {
    setThread((t) => [...t, ...result.messages]);
    setState(result.state);
  }

  function spend(index: number) {
    setSpent((s) => new Set(s).add(index));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = goal.trim();
    if (!text || pending) return;

    const history = thread.map((m) => ({ from: m.from, body: m.body }));
    setThread((t) => [...t, { from: 'you', body: text }]);
    setGoal('');
    startTransition(async () => apply(await sendGoal(text, state, history)));
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
    startTransition(async () => apply(await sendGoal(value, state)));
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
                    busy={pending}
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

            {pending ? (
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
            disabled={!goal.trim() || pending}
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
