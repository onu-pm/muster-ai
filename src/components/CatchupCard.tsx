'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { CatchupItem } from '@/lib/data/catchup';
import { decideOnException } from '@/app/actions/decisions';
import {
  confidenceLabel,
  exceptionKindLabel,
  exceptionRuleLine,
  relativeDay,
} from '@/lib/copy/labels';

export function CatchupCard({ item }: { item: CatchupItem }) {
  const router = useRouter();
  const [correcting, setCorrecting] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const title = exceptionKindLabel(item.kind, item.kindLabel);
  const rule = exceptionRuleLine(item.kind, item.ruleLine);

  function decide(outcome: 'approved' | 'rejected' | 'corrected') {
    setError(null);
    startTransition(async () => {
      const result = await decideOnException(
        item.id,
        outcome,
        outcome === 'corrected' ? note : undefined,
      );
      if (!result.ok) {
        setError(result.error ?? 'That did not work. Try again.');
        return;
      }
      setCorrecting(false);
      setNote('');
      router.refresh();
    });
  }

  return (
    <article className="card card-pad-lg">
      <div className="row-between wrap" style={{ alignItems: 'flex-start' }}>
        <div className="row" style={{ gap: 10, minWidth: 0 }}>
          {item.personName ? (
            <span className="avatar avatar-sm" aria-hidden>
              {item.personName.trim()[0]?.toUpperCase()}
            </span>
          ) : null}
          <div style={{ minWidth: 0 }}>
            <div className="cardTitle">{item.personName ?? title}</div>
            <div className="tiny muted">
              {item.personName ? title : relativeDay(item.openedAt)}
            </div>
          </div>
        </div>
        <span className="tag tag-warn">{confidenceLabel(item.confidence)}</span>
      </div>

      <p style={{ marginTop: 14, fontSize: 14.5, lineHeight: 1.6 }}>
        {item.conclusion}
      </p>

      {rule ? (
        <p
          className="tiny muted"
          style={{
            marginTop: 12,
            paddingLeft: 11,
            borderLeft: '2px solid var(--border)',
          }}
        >
          {rule}
        </p>
      ) : null}

      {error ? (
        <div className="banner banner-error" style={{ marginTop: 14 }}>
          {error}
        </div>
      ) : null}

      {correcting ? (
        <div className="stack" style={{ marginTop: 16 }}>
          <div>
            <label className="label" htmlFor={`note-${item.id}`}>
              What should Holly have known?
            </label>
            <textarea
              id={`note-${item.id}`}
              className="textarea"
              style={{ minHeight: 84 }}
              autoFocus
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Priya took an approved unpaid day that hasn't reached the leave ledger yet."
            />
            <p className="fieldHint">
              Holly remembers this and uses it next time.
            </p>
          </div>
          <div className="row wrap">
            <button
              className="btn btn-primary btn-sm"
              disabled={pending || !note.trim()}
              onClick={() => decide('corrected')}
            >
              {pending ? 'Saving…' : 'Save correction'}
            </button>
            <button
              className="btn btn-quiet btn-sm"
              disabled={pending}
              onClick={() => {
                setCorrecting(false);
                setError(null);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="row wrap" style={{ marginTop: 18 }}>
          <button
            className="btn btn-primary btn-sm"
            disabled={pending}
            onClick={() => decide('approved')}
          >
            Approve
          </button>
          <button
            className="btn btn-secondary btn-sm"
            disabled={pending}
            onClick={() => decide('rejected')}
          >
            Reject
          </button>
          <button
            className="btn btn-quiet btn-sm"
            disabled={pending}
            onClick={() => setCorrecting(true)}
          >
            Tell us what&rsquo;s wrong
          </button>
        </div>
      )}
    </article>
  );
}
