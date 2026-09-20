'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { TEAMMATES, getTeammate, requiredCategories } from '@/lib/catalog/team-agents';
import { PROVIDERS, CATEGORY_LABELS } from '@/lib/catalog/providers';
import { ProviderCard, type ConnectionState } from '@/components/ProviderCard';
import { createOrganisation, activateTeammate } from './actions';

interface Props {
  existingOrgId: string | null;
  existingOrgName: string;
  connections: ConnectionState[];
}

export function OnboardingFlow({
  existingOrgId,
  existingOrgName,
  connections,
}: Props) {
  const router = useRouter();
  const [step, setStep] = useState(existingOrgId ? 2 : 1);
  const [orgId, setOrgId] = useState<string | null>(existingOrgId);
  const [orgName, setOrgName] = useState(existingOrgName);
  const [picked, setPicked] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const teammate = picked ? getTeammate(picked) : null;

  function submitOrg(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await createOrganisation(orgName);
      if (!result.ok || !result.orgId) {
        setError(result.error ?? 'Could not save that. Try again.');
        return;
      }
      setOrgId(result.orgId);
      setStep(2);
    });
  }

  function submitTeammate() {
    if (!orgId || !picked) return;
    setError(null);
    startTransition(async () => {
      const result = await activateTeammate(orgId, picked);
      if (!result.ok) {
        setError(result.error ?? 'Could not add that teammate.');
        return;
      }
      setStep(3);
      router.refresh();
    });
  }

  function finish() {
    router.push('/home');
    router.refresh();
  }

  const needed = teammate ? requiredCategories(teammate) : [];
  const neededProviders = PROVIDERS.filter((p) => needed.includes(p.category));
  const byCategory = needed.map((category) => ({
    category,
    providers: neededProviders.filter((p) => p.category === category),
  }));

  return (
    <main className="centeredPage">
      <div style={{ width: '100%', maxWidth: step === 1 ? 460 : 760 }}>
        <div className="row" style={{ marginBottom: 20, justifyContent: 'center' }}>
          <span className="wordmark" style={{ padding: 0 }}>
            Muster
          </span>
        </div>

        <div className="card" style={{ padding: 28 }}>
          <p className="tiny muted" style={{ marginBottom: 6 }}>
            Step {step} of 3
          </p>

          {step === 1 ? (
            <>
              <h1>What should we call your organisation?</h1>
              <p className="muted small" style={{ marginTop: 8 }}>
                This is the name your team will see.
              </p>

              <form onSubmit={submitOrg} className="stack" style={{ marginTop: 20 }}>
                <input
                  className="input"
                  required
                  autoFocus
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  placeholder="Acme Technologies"
                />
                {error ? <div className="banner banner-error">{error}</div> : null}
                <button className="btn btn-primary" disabled={pending}>
                  {pending ? 'Saving…' : 'Continue'}
                </button>
              </form>
            </>
          ) : null}

          {step === 2 ? (
            <>
              <h1>Pick your first teammate</h1>
              <p className="muted small" style={{ marginTop: 8 }}>
                You can add more later, as they become available.
              </p>

              <div className="grid-2" style={{ marginTop: 20 }}>
                {TEAMMATES.map((t) => {
                  const selected = picked === t.key;
                  return (
                    <button
                      key={t.key}
                      type="button"
                      disabled={!t.live}
                      onClick={() => t.live && setPicked(t.key)}
                      className={`card ${t.live ? '' : 'card-dim'}`}
                      style={{
                        textAlign: 'left',
                        cursor: t.live ? 'pointer' : 'not-allowed',
                        borderColor: selected ? 'var(--accent)' : undefined,
                        background: selected ? 'var(--accent-soft)' : undefined,
                      }}
                    >
                      <div className="row">
                        <span
                          className={`avatar ${t.live ? '' : 'avatar-muted'}`}
                        >
                          {t.initial}
                        </span>
                        <span style={{ minWidth: 0 }}>
                          <span className="cardTitle" style={{ display: 'block' }}>
                            {t.name}
                          </span>
                          <span className="tiny muted">{t.role}</span>
                        </span>
                      </div>
                      <p className="cardBody" style={{ marginTop: 10 }}>
                        {t.desk}
                      </p>
                      {!t.live ? (
                        <span className="tag" style={{ marginTop: 10 }}>
                          Coming soon
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>

              {error ? (
                <div className="banner banner-error" style={{ marginTop: 16 }}>
                  {error}
                </div>
              ) : null}

              <button
                className="btn btn-primary"
                style={{ marginTop: 20 }}
                disabled={!picked || pending}
                onClick={submitTeammate}
              >
                {pending ? 'Adding…' : 'Continue'}
              </button>
            </>
          ) : null}

          {step === 3 && teammate ? (
            <>
              <h1>Connect what {teammate.name} needs</h1>
              <p className="muted small" style={{ marginTop: 8 }}>
                {teammate.name} works from your existing records. Connect one now,
                or skip and do it when you are ready.
              </p>

              <div className="stack-lg" style={{ marginTop: 22 }}>
                {byCategory.map(({ category, providers }) => (
                  <section key={category}>
                    <div className="sectionTitle" style={{ marginBottom: 10 }}>
                      {CATEGORY_LABELS[category]}
                    </div>
                    <div className="grid-2">
                      {providers.map((p) => (
                        <ProviderCard
                          key={p.key}
                          provider={p}
                          connection={
                            connections.find((c) => c.providerKey === p.key) ?? null
                          }
                          showLater
                          onDone={() => router.refresh()}
                        />
                      ))}
                    </div>
                  </section>
                ))}
              </div>

              <div className="row" style={{ marginTop: 24 }}>
                <button className="btn btn-primary" onClick={finish}>
                  {neededProviders.some((p) =>
                    connections.some(
                      (c) => c.providerKey === p.key && c.status === 'connected',
                    ),
                  )
                    ? 'Finish setup'
                    : 'Skip for now'}
                </button>
                <span className="tiny muted">
                  You can connect anything else from the Marketplace later.
                </span>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </main>
  );
}
