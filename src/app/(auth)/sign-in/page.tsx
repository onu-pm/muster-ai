'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      setError(
        signInError.message === 'Invalid login credentials'
          ? 'That email and password did not match. Try again.'
          : signInError.message,
      );
      setBusy(false);
      return;
    }

    router.push('/');
    router.refresh();
  }

  return (
    <main className="centeredPage">
      <div className="card" style={{ width: '100%', maxWidth: 400, padding: 28 }}>
        <div className="stack-sm" style={{ marginBottom: 20 }}>
          <div className="wordmark" style={{ padding: 0 }}>
            Muster
          </div>
          <p className="muted small">Welcome back. Sign in to your team.</p>
        </div>

        <form onSubmit={onSubmit} className="stack">
          <div>
            <label className="label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              className="input"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
            />
          </div>

          <div>
            <label className="label" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              className="input"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>

          {error ? <div className="banner banner-error">{error}</div> : null}

          <button className="btn btn-primary btn-full" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="muted small" style={{ marginTop: 18, textAlign: 'center' }}>
          New here?{' '}
          <Link href="/sign-up" style={{ color: 'var(--accent)', fontWeight: 600 }}>
            Create an account
          </Link>
        </p>
      </div>
    </main>
  );
}
