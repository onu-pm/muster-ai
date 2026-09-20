'use client';

import { useMemo, useState } from 'react';
import type { ComingUpItem } from '@/lib/data/catchup';
import {
  dutyStateLabel,
  dutyTypeLabel,
  pluralise,
  relativeDay,
} from '@/lib/copy/labels';
import { ArrowRightIcon } from '@/components/Icons';

type DateFilter = 'all' | 'overdue' | 'week';

export function ComingUpList({
  items,
  onJumpTo,
}: {
  items: ComingUpItem[];
  /** Called when a blocked row jumps to the item holding it up. */
  onJumpTo?: (exceptionId: string) => void;
}) {
  const [type, setType] = useState<string>('all');
  const [state, setState] = useState<string>('all');
  const [when, setWhen] = useState<DateFilter>('all');

  const types = useMemo(
    () => [...new Set(items.map((i) => i.dutyType))],
    [items],
  );
  const states = useMemo(
    () => [...new Set(items.map((i) => i.state))],
    [items],
  );

  const filtered = items.filter((item) => {
    if (type !== 'all' && item.dutyType !== type) return false;
    if (state !== 'all' && item.state !== state) return false;
    if (when !== 'all') {
      if (!item.dueAt) return false;
      const due = new Date(item.dueAt).getTime();
      if (when === 'overdue' && due >= Date.now()) return false;
      if (
        when === 'week' &&
        (due < Date.now() || due > Date.now() + 7 * 86_400_000)
      ) {
        return false;
      }
    }
    return true;
  });

  return (
    <>
      <div className="chipRow" style={{ marginBottom: 14 }}>
        <button
          className="chip"
          data-active={type === 'all' && state === 'all' && when === 'all'}
          onClick={() => {
            setType('all');
            setState('all');
            setWhen('all');
          }}
        >
          Everything
        </button>
        {types.map((t) => (
          <button
            key={t}
            className="chip"
            data-active={type === t}
            onClick={() => setType(type === t ? 'all' : t)}
          >
            {dutyTypeLabel(t)}
          </button>
        ))}
        {states.map((s) => (
          <button
            key={s}
            className="chip"
            data-active={state === s}
            onClick={() => setState(state === s ? 'all' : s)}
          >
            {dutyStateLabel(s)}
          </button>
        ))}
        <button
          className="chip"
          data-active={when === 'overdue'}
          onClick={() => setWhen(when === 'overdue' ? 'all' : 'overdue')}
        >
          Past due
        </button>
        <button
          className="chip"
          data-active={when === 'week'}
          onClick={() => setWhen(when === 'week' ? 'all' : 'week')}
        >
          Next 7 days
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="empty">
          <div className="emptyTitle">Nothing matches those filters.</div>
          Try clearing one of them.
        </div>
      ) : (
        <div className="card" style={{ padding: '4px 20px' }}>
          {filtered.map((item) => {
            const blocked = item.state === 'blocked';
            const target = item.blockingExceptionId
              ? `#item-${item.blockingExceptionId}`
              : null;

            const body = (
              <>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="strong">{dutyTypeLabel(item.dutyType)}</div>
                  <div className="tiny muted">
                    {item.personName ?? 'Everyone'}
                    {item.openExceptions > 0
                      ? ` · ${pluralise(item.openExceptions, 'item', 'items')} waiting on you`
                      : ''}
                  </div>
                </div>

                <span className={`tag ${blocked ? 'tag-warn' : ''}`}>
                  {dutyStateLabel(item.state)}
                </span>

                <span
                  className="tiny muted"
                  style={{ minWidth: 88, textAlign: 'right' }}
                >
                  {item.dueAt ? relativeDay(item.dueAt) : 'No date set'}
                </span>

                {/* A blocked row must say what unblocks it, and go there. */}
                {target ? (
                  <span className="row tiny strong" style={{ gap: 4, color: 'var(--accent)' }}>
                    Review
                    <ArrowRightIcon size={13} />
                  </span>
                ) : null}
              </>
            );

            return target ? (
              <a
                key={item.id}
                href={target}
                className="listRow blockedRow"
                onClick={() => onJumpTo?.(item.blockingExceptionId!)}
              >
                {body}
              </a>
            ) : (
              <div key={item.id} className="listRow">
                {body}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
