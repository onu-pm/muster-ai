'use client';

import { useMemo, useState } from 'react';
import type { ActivityEntry } from '@/lib/data/activity';
import {
  capabilityLabel,
  decisionLabel,
  dutyTypeLabel,
  formatDateTime,
} from '@/lib/copy/labels';

type Range = 'all' | '7' | '30';

export function ActivityTab({ entries }: { entries: ActivityEntry[] }) {
  const [person, setPerson] = useState('all');
  const [range, setRange] = useState<Range>('all');

  const people = useMemo(
    () =>
      [...new Set(entries.map((e) => e.personName).filter(Boolean))] as string[],
    [entries],
  );

  const filtered = entries.filter((entry) => {
    if (person !== 'all' && entry.personName !== person) return false;
    if (range !== 'all') {
      const cutoff = Date.now() - Number(range) * 86_400_000;
      if (new Date(entry.at).getTime() < cutoff) return false;
    }
    return true;
  });

  function exportCsv() {
    const header = ['When', 'Who', 'What', 'Detail', 'Note'];
    const rows = filtered.map((e) => [
      formatDateTime(e.at),
      e.personName ?? '',
      e.kind === 'step' ? capabilityLabel(e.raw) : decisionLabel(e.raw),
      e.summary || dutyTypeLabel(e.dutyType),
      e.note ?? '',
    ]);

    const csv = [header, ...rows]
      .map((row) =>
        row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','),
      )
      .join('\n');

    const url = URL.createObjectURL(
      new Blob([csv], { type: 'text/csv;charset=utf-8;' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = `muster-activity-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <div className="row-between wrap" style={{ marginBottom: 14 }}>
        <div className="chipRow">
          <button
            className="chip"
            data-active={person === 'all'}
            onClick={() => setPerson('all')}
          >
            Everyone
          </button>
          {people.map((name) => (
            <button
              key={name}
              className="chip"
              data-active={person === name}
              onClick={() => setPerson(name)}
            >
              {name}
            </button>
          ))}
          <button
            className="chip"
            data-active={range === '7'}
            onClick={() => setRange(range === '7' ? 'all' : '7')}
          >
            Last 7 days
          </button>
          <button
            className="chip"
            data-active={range === '30'}
            onClick={() => setRange(range === '30' ? 'all' : '30')}
          >
            Last 30 days
          </button>
        </div>

        <button
          className="btn btn-secondary btn-sm"
          onClick={exportCsv}
          disabled={filtered.length === 0}
        >
          Export
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="empty">
          <div className="emptyTitle">Nothing here yet.</div>
          Everything Holly does, and every decision you make, is recorded here.
        </div>
      ) : (
        <div className="card" style={{ padding: '4px 20px' }}>
          {filtered.map((entry) => (
            <div key={entry.id} className="listRow">
              <span
                className={`statusDot ${entry.kind === 'decision' ? 'statusDot-busy' : 'statusDot-live'}`}
              />
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="small">
                  {entry.summary || dutyTypeLabel(entry.dutyType)}
                </div>
                <div className="tiny muted" style={{ marginTop: 2 }}>
                  {entry.kind === 'step'
                    ? capabilityLabel(entry.raw)
                    : `You ${decisionLabel(entry.raw).toLowerCase()} this`}
                  {entry.personName ? ` · ${entry.personName}` : ''}
                  {entry.note ? ` · “${entry.note}”` : ''}
                </div>
              </div>
              <span className="tiny muted" style={{ textAlign: 'right' }}>
                {formatDateTime(entry.at)}
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
