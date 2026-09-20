'use client';

import { useState, useTransition } from 'react';
import type { Provider } from '@/lib/catalog/providers';
import { connectProvider, disconnectProvider } from '@/app/actions/connections';
import { CheckIcon } from '@/components/Icons';

export interface ConnectionState {
  providerKey: string;
  status: string;
  connectedAt: string | null;
}

interface Props {
  provider: Provider;
  connection: ConnectionState | null;
  /** Onboarding shows a per-card "I'll do this later"; the Marketplace does not. */
  showLater?: boolean;
  onDone?: () => void;
}

export function ProviderCard({
  provider,
  connection,
  showLater = false,
  onDone,
}: Props) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [later, setLater] = useState(false);
  const [pending, startTransition] = useTransition();

  const connected = connection?.status === 'connected';

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await connectProvider(provider.key, values);
      if (!result.ok) {
        setError(result.error ?? 'That did not work. Try again.');
        return;
      }
      setOpen(false);
      setValues({});
      onDone?.();
    });
  }

  function connectWithoutForm() {
    setError(null);
    startTransition(async () => {
      const result = await connectProvider(provider.key, {});
      if (!result.ok) {
        setError(result.error ?? 'That did not work. Try again.');
        return;
      }
      onDone?.();
    });
  }

  function remove() {
    startTransition(async () => {
      await disconnectProvider(provider.key);
      onDone?.();
    });
  }

  const statusTag = connected ? (
    <span className="tag tag-live">
      <CheckIcon size={12} />
      Connected
    </span>
  ) : provider.available ? (
    <span className="tag">Available</span>
  ) : (
    <span className="tag">Coming soon</span>
  );

  return (
    <div className={`card ${provider.available ? '' : 'card-dim'}`}>
      <div className="row-between" style={{ alignItems: 'flex-start' }}>
        <div className="cardTitle">{provider.label}</div>
        {statusTag}
      </div>

      <p className="cardBody" style={{ marginTop: 8 }}>
        {provider.description}
      </p>

      {!provider.available && provider.comingSoonNote ? (
        <p className="tiny muted" style={{ marginTop: 8 }}>
          {provider.comingSoonNote}
        </p>
      ) : null}

      <div className="row" style={{ marginTop: 14, flexWrap: 'wrap' }}>
        <span className="tag tag-accent">{provider.usedBy} uses this</span>
        <span className="grow" />

        {!provider.available ? (
          <button className="btn btn-secondary btn-sm" disabled>
            Connect
          </button>
        ) : connected ? (
          <button
            className="btn btn-quiet btn-sm"
            onClick={remove}
            disabled={pending}
          >
            Disconnect
          </button>
        ) : later ? (
          <span className="tiny muted">You can come back to this any time.</span>
        ) : (
          <>
            {showLater ? (
              <button
                className="btn btn-quiet btn-sm"
                onClick={() => setLater(true)}
                disabled={pending}
              >
                I&rsquo;ll do this later
              </button>
            ) : null}
            <button
              className="btn btn-primary btn-sm"
              disabled={pending}
              onClick={() =>
                provider.connectForm === 'none'
                  ? connectWithoutForm()
                  : setOpen((v) => !v)
              }
            >
              {pending ? 'Connecting…' : 'Connect'}
            </button>
          </>
        )}
      </div>

      {open && provider.available ? (
        <form onSubmit={submit} className="stack" style={{ marginTop: 16 }}>
          <hr className="divider" />
          {provider.fields.map((field) => (
            <div key={field.name}>
              <label className="label" htmlFor={`${provider.key}-${field.name}`}>
                {field.label}
              </label>
              <input
                id={`${provider.key}-${field.name}`}
                className="input"
                type={field.secret ? 'password' : 'text'}
                placeholder={field.placeholder}
                value={values[field.name] ?? ''}
                onChange={(e) =>
                  setValues((v) => ({ ...v, [field.name]: e.target.value }))
                }
              />
              {field.hint ? <p className="fieldHint">{field.hint}</p> : null}
            </div>
          ))}

          {error ? <div className="banner banner-error">{error}</div> : null}

          <div className="row">
            <button className="btn btn-primary btn-sm" disabled={pending}>
              {pending ? 'Saving…' : 'Save connection'}
            </button>
            <button
              type="button"
              className="btn btn-quiet btn-sm"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      {!open && error ? (
        <div className="banner banner-error" style={{ marginTop: 12 }}>
          {error}
        </div>
      ) : null}
    </div>
  );
}
