'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { InlineAction } from '@/lib/agents/conversation';

/**
 * The controls that appear inside Holly's messages.
 *
 * Everything a person needs to answer is here, in the thread. The only link
 * offered is to look at detail — never to finish something started in the chat.
 */

interface Props {
  action: InlineAction;
  busy: boolean;
  onConnect: (providerKey: string, credentials: Record<string, string>) => void;
  onDecide: (
    exceptionId: string,
    outcome: 'approved' | 'rejected' | 'corrected',
    note?: string,
  ) => void;
  onAuthorise: () => void;
  onChoose: (value: string) => void;
  /** True once this message's action has been used, so it stops accepting input. */
  spent: boolean;
}

export function InlineActions({
  action,
  busy,
  onConnect,
  onDecide,
  onAuthorise,
  onChoose,
  spent,
}: Props) {
  if (action.kind === 'link') {
    return (
      <div className="msgActions">
        <Link className="btn btn-secondary btn-sm" href={action.href}>
          {action.label}
        </Link>
      </div>
    );
  }

  if (spent) return null;

  if (action.kind === 'connect') {
    return (
      <ConnectInline action={action} busy={busy} onConnect={onConnect} />
    );
  }

  if (action.kind === 'decide') {
    return (
      <DecideInline
        exceptionId={action.exceptionId}
        busy={busy}
        onDecide={onDecide}
      />
    );
  }

  if (action.kind === 'authorise') {
    return (
      <div className="msgActions" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
        <div className="authoriseBox">{action.summary}</div>
        <div className="row wrap" style={{ marginTop: 10 }}>
          <button
            className="btn btn-primary btn-sm"
            disabled={busy}
            onClick={onAuthorise}
          >
            Yes, set it up
          </button>
          <button
            className="btn btn-quiet btn-sm"
            disabled={busy}
            onClick={() => onChoose('decline_schedule')}
          >
            Not now
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="msgActions">
      {action.options.map((option) => (
        <button
          key={option.value}
          className="btn btn-secondary btn-sm"
          disabled={busy}
          onClick={() => onChoose(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function ConnectInline({
  action,
  busy,
  onConnect,
}: {
  action: Extract<InlineAction, { kind: 'connect' }>;
  busy: boolean;
  onConnect: (providerKey: string, credentials: Record<string, string>) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const complete = action.fields.every((f) => values[f.name]?.trim());

  return (
    <form
      className="msgActions"
      style={{ flexDirection: 'column', alignItems: 'stretch' }}
      onSubmit={(e) => {
        e.preventDefault();
        if (complete) onConnect(action.providerKey, values);
      }}
    >
      {action.fields.map((field) => (
        <div key={field.name}>
          <label className="label" htmlFor={`chat-${field.name}`}>
            {field.label}
          </label>
          <input
            id={`chat-${field.name}`}
            className="input"
            type={field.secret ? 'password' : 'text'}
            placeholder={field.placeholder}
            autoComplete="off"
            value={values[field.name] ?? ''}
            onChange={(e) =>
              setValues((v) => ({ ...v, [field.name]: e.target.value }))
            }
          />
          {field.hint ? <p className="fieldHint">{field.hint}</p> : null}
        </div>
      ))}

      <div className="row wrap" style={{ marginTop: 4 }}>
        <button className="btn btn-primary btn-sm" disabled={busy || !complete}>
          {busy ? 'Connecting…' : `Connect ${action.label}`}
        </button>
        {action.alternatives.map((alt) => (
          <button
            key={alt.providerKey}
            type="button"
            className="btn btn-quiet btn-sm"
            disabled={busy}
            onClick={() => onConnect(alt.providerKey, {})}
          >
            {alt.label}
          </button>
        ))}
      </div>
    </form>
  );
}

function DecideInline({
  exceptionId,
  busy,
  onDecide,
}: {
  exceptionId: string;
  busy: boolean;
  onDecide: (
    exceptionId: string,
    outcome: 'approved' | 'rejected' | 'corrected',
    note?: string,
  ) => void;
}) {
  const [correcting, setCorrecting] = useState(false);
  const [note, setNote] = useState('');

  if (correcting) {
    return (
      <div className="msgActions" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
        <textarea
          className="textarea"
          style={{ minHeight: 76 }}
          autoFocus
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Tell me what I got wrong, in a line."
        />
        <div className="row wrap" style={{ marginTop: 8 }}>
          <button
            className="btn btn-primary btn-sm"
            disabled={busy || !note.trim()}
            onClick={() => onDecide(exceptionId, 'corrected', note)}
          >
            Save correction
          </button>
          <button
            className="btn btn-quiet btn-sm"
            disabled={busy}
            onClick={() => setCorrecting(false)}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="msgActions">
      <button
        className="btn btn-primary btn-sm"
        disabled={busy}
        onClick={() => onDecide(exceptionId, 'approved')}
      >
        Approve
      </button>
      <button
        className="btn btn-secondary btn-sm"
        disabled={busy}
        onClick={() => onDecide(exceptionId, 'rejected')}
      >
        Reject
      </button>
      <button
        className="btn btn-quiet btn-sm"
        disabled={busy}
        onClick={() => setCorrecting(true)}
      >
        That&rsquo;s not right
      </button>
    </div>
  );
}
