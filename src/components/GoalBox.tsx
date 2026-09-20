'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { SendIcon, SpinnerIcon } from '@/components/Icons';
import { runGoal, type ThreadMessage } from '@/app/actions/goal';

export function GoalBox({ userName }: { userName: string }) {
  const [goal, setGoal] = useState('');
  const [thread, setThread] = useState<ThreadMessage[]>([]);
  const [pending, startTransition] = useTransition();

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

  if (thread.length === 0) {
    return (
      <form onSubmit={submit}>
        <div className="goalBox">
          <input
            className="goalInput"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="Tell your team what you need — e.g. Run September payroll."
            aria-label="Tell your team what you need"
          />
          <button
            className="btn btn-primary"
            disabled={!goal.trim()}
            aria-label="Send"
          >
            <SendIcon />
          </button>
        </div>
        <p className="tiny muted" style={{ marginTop: 10, paddingLeft: 4 }}>
          Holly picks it up from here and brings back anything she can&rsquo;t
          settle on her own.
        </p>
      </form>
    );
  }

  return (
    <div className="stack">
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
                <Link className="btn btn-secondary btn-sm" href={msg.link.href}>
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
      </div>

      <form onSubmit={submit}>
        <div className="goalBox">
          <input
            className="goalInput"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder={`Anything else, ${userName}?`}
            aria-label="Send another message"
          />
          <button
            className="btn btn-primary"
            disabled={!goal.trim() || pending}
            aria-label="Send"
          >
            <SendIcon />
          </button>
        </div>
      </form>
    </div>
  );
}
