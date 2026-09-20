'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

export default function SignUpPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);

    const supabase = createClient();
    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: name.trim() },
        emailRedirectTo:
          typeof window !== 'undefined'
            ? `${window.location.origin}/auth/callback`
            : undefined,
      },
    });

    if (signUpError) {
      setError(signUpError.message);
      setBusy(false);
      return;
    }

    // Email confirmation on: no session comes back, so say so plainly.
    if (!data.session) {
      setNotice(
        'Check your email for a confirmation link, then come back and sign in.',
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
          <p className="muted small">
            Set up your account. You will name your organisation next.
          </p>
        </div>

        <form onSubmit={onSubmit} className="stack">
          <div>
            <label className="label" htmlFor="name">
              Your name
            </label>
            <input
              id="name"
              className="input"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Priya Menon"
            />
          </div>

          <div>
            <label className="label" htmlFor="email">
              Work email
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
              autoComplete="new-password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
            />
          </div>

          {error ? <div className="banner banner-error">{error}</div> : null}
          {notice ? <div className="banner banner-success">{notice}</div> : null}

          <button className="btn btn-primary btn-full" disabled={busy}>
            {busy ? 'Creating your account…' : 'Create account'}
          </button>
        </form>

        <p className="muted small" style={{ marginTop: 18, textAlign: 'center' }}>
          Already have an account?{' '}
          <Link href="/sign-in" style={{ color: 'var(--accent)', fontWeight: 600 }}>
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
