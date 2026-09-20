'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { renameOrganisation } from '@/app/actions/profile';

export function OrgNameField({ initial }: { initial: string }) {
  const router = useRouter();
  const [name, setName] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const dirty = name.trim() !== initial.trim();

  function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);

    startTransition(async () => {
      const result = await renameOrganisation(name);
      if (!result.ok) {
        setError(result.error ?? 'Could not save that.');
        return;
      }
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <form onSubmit={save}>
      <label className="label" htmlFor="org-name">
        Organisation name
      </label>
      <div className="row" style={{ gap: 10 }}>
        <input
          id="org-name"
          className="input"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setSaved(false);
          }}
        />
        <button className="btn btn-primary" disabled={!dirty || pending}>
          {pending ? 'Saving…' : 'Save'}
        </button>
      </div>
      {error ? (
        <div className="banner banner-error" style={{ marginTop: 10 }}>
          {error}
        </div>
      ) : null}
      {saved && !dirty ? <p className="fieldHint">Saved.</p> : null}
    </form>
  );
}

export function SignOutButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function signOut() {
    startTransition(async () => {
      await createClient().auth.signOut();
      router.push('/sign-in');
      router.refresh();
    });
  }

  return (
    <button className="btn btn-danger" onClick={signOut} disabled={pending}>
      {pending ? 'Signing out…' : 'Sign out'}
    </button>
  );
}
