'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setTeammateEnabled } from '@/app/actions/team';

interface Props {
  teamKey: string;
  name: string;
  active: boolean;
  /** Whether this teammate exists yet at all. */
  live: boolean;
}

export function TeammateToggle({ teamKey, name, active, live }: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  if (!live) {
    return <span className="tag">Coming soon</span>;
  }

  function apply(enabled: boolean) {
    setError(null);
    startTransition(async () => {
      const result = await setTeammateEnabled(teamKey, enabled);
      if (!result.ok) {
        setError(result.error ?? 'That did not work.');
        return;
      }
      setConfirming(false);
      router.refresh();
    });
  }

  if (!active) {
    return (
      <div className="stack-sm">
        <button
          className="btn btn-primary btn-sm"
          disabled={pending}
          onClick={() => apply(true)}
        >
          {pending ? 'Adding…' : `Add ${name} to your team`}
        </button>
        {error ? <p className="errorText">{error}</p> : null}
      </div>
    );
  }

  if (confirming) {
    return (
      <div className="stack-sm">
        <p className="tiny muted">
          {name} will stop picking up new work. Nothing already done is lost.
        </p>
        <div className="row wrap">
          <button
            className="btn btn-danger btn-sm"
            disabled={pending}
            onClick={() => apply(false)}
          >
            {pending ? 'Standing down…' : `Stand ${name} down`}
          </button>
          <button
            className="btn btn-quiet btn-sm"
            disabled={pending}
            onClick={() => setConfirming(false)}
          >
            Keep them on
          </button>
        </div>
        {error ? <p className="errorText">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="row wrap">
      <span className="tag tag-live">
        <span className="statusDot statusDot-live" />
        On the desk
      </span>
      <button
        className="btn btn-quiet btn-sm"
        onClick={() => setConfirming(true)}
      >
        Stand down
      </button>
    </div>
  );
}
