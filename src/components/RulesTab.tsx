'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { proposeRuleFromSheet } from '@/app/actions/rules';

export interface ConfirmedRuleView {
  id: string;
  label: string;
  description: string;
  scope: string;
  where: string;
  from: string;
}

interface Props {
  mateName: string;
  confirmed: ConfirmedRuleView[];
  waitingCount: number;
}

export function RulesTab({ mateName, confirmed, waitingCount }: Props) {
  const router = useRouter();
  const [sheet, setSheet] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(null);

    startTransition(async () => {
      const result = await proposeRuleFromSheet(sheet);
      if (!result.ok) {
        setError(result.error ?? 'That did not work. Try again.');
        return;
      }
      setSheet('');
      setDone(result.message ?? 'Sent for your approval.');
      router.refresh();
    });
  }

  return (
    <div className="stack-lg">
      <section>
        <form onSubmit={submit} className="card card-pad-lg">
          <div className="cardTitle">Teach {mateName} a rule</div>
          <p className="cardBody" style={{ marginTop: 6, marginBottom: 14 }}>
            Paste a slab table or a section of your calculation sheet. She reads
            only what it actually says, then asks you to confirm it before using
            it.
          </p>

          <textarea
            className="textarea"
            value={sheet}
            onChange={(e) => setSheet(e.target.value)}
            placeholder={
              'Professional Tax — Karnataka\nUp to 24,999: nil\n25,000 and above: 200 per month'
            }
          />

          {error ? (
            <div className="banner banner-error" style={{ marginTop: 12 }}>
              {error}
            </div>
          ) : null}
          {done ? (
            <div className="banner banner-success" style={{ marginTop: 12 }}>
              {done}
            </div>
          ) : null}

          <div className="row wrap" style={{ marginTop: 14 }}>
            <button
              className="btn btn-primary"
              disabled={pending || sheet.trim().length < 12}
            >
              {pending ? `${mateName} is reading it…` : 'Send to Holly'}
            </button>
            {waitingCount > 0 ? (
              <Link href="/catchup" className="btn btn-quiet btn-sm">
                {waitingCount === 1
                  ? '1 rule waiting for your approval'
                  : `${waitingCount} rules waiting for your approval`}
              </Link>
            ) : null}
          </div>
        </form>
      </section>

      <section>
        <div className="sectionHead">
          <div className="sectionTitle">Rules she uses today</div>
          {confirmed.length > 0 ? (
            <span className="tiny muted">{confirmed.length}</span>
          ) : null}
        </div>

        {confirmed.length === 0 ? (
          <div className="empty">
            <div className="emptyTitle">No rules confirmed yet.</div>
            Until you confirm one, {mateName} falls back to the statutory
            default.
          </div>
        ) : (
          <div className="stack">
            {confirmed.map((rule) => (
              <div key={rule.id} className="card">
                <div className="row-between wrap">
                  <div className="cardTitle">{rule.label}</div>
                  <span className="tag tag-live">In use</span>
                </div>
                <p className="cardBody" style={{ marginTop: 6 }}>
                  {rule.description}
                </p>
                <div className="row wrap" style={{ marginTop: 12, gap: 8 }}>
                  <span className="tag tag-outline">{rule.scope}</span>
                  <span className="tag tag-outline">{rule.where}</span>
                  <span className="tiny muted">In effect from {rule.from}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
