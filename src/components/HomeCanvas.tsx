'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { SendIcon, SpinnerIcon } from '@/components/Icons';
import { runGoal, type ThreadMessage } from '@/app/actions/goal';

interface Props {
  userName: string;
  /** Server-rendered team strip and "what's happening" list. */
  strip: React.ReactNode;
  happening: React.ReactNode;
}

/**
 * Home, and the conversation it turns into.
 *
 * Submitting a goal does not navigate anywhere: the column widens, the team
 * strip shrinks to a single line, and the thread grows to fill the space with
 * the input pinned beneath it. Nothing is lost, and Home is still Home.
 */
export function HomeCanvas({ userName, strip, happening }: Props) {
  const [goal, setGoal] = useState('');
  const [thread, setThread] = useState<ThreadMessage[]>([]);
  const [pending, startTransition] = useTransition();
  const endRef = useRef<HTMLDivElement>(null);

  const active = thread.length > 0;

  useEffect(() => {
    if (active) endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [thread, pending, active]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = goal.trim();
    if (!text || pending) return;

    setThread((t) => [...t, { from: 'you', body: text }]);
    setGoal('');

    startTransition(async () => {
      const replies = await runGoal(text);
      setThread((t) => [...t, ...replies]);
    });
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
                {msg.link ? (
                  <div className="msgActions">
                    <Link
                      className="btn btn-secondary btn-sm"
                      href={msg.link.href}
                    >
                      {msg.link.label}
                    </Link>
                  </div>
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
            Holly picks it up from here and brings back anything she can&rsquo;t
            settle on her own.
          </p>
        ) : null}
      </form>

      {!active ? happening : null}
    </div>
  );
}
