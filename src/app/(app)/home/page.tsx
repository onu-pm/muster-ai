import Link from 'next/link';
import { requireWorkspace } from '@/lib/data/session';
import { listTeammates } from '@/lib/data/team';
import { listComingUp, listNeedsYou } from '@/lib/data/catchup';
import { listConnections } from '@/lib/data/connections';
import { listFullPeople } from '@/lib/data/people-records';
import { auditRecords } from '@/lib/rules/records';
import { PROVIDERS } from '@/lib/catalog/providers';
import { ownerOf } from '@/lib/catalog/ownership';
import { HomeCanvas } from '@/components/HomeCanvas';
import { ArrowRightIcon } from '@/components/Icons';
import {
  dutyStateLabel,
  dutyTypeLabel,
  exceptionKindLabel,
  pluralise,
} from '@/lib/copy/labels';
import { hueFor } from '@/lib/copy/hue';
import { suggestionsFor } from '@/lib/copy/suggestions';

export default async function HomePage() {
  const { org, displayName } = await requireWorkspace();

  const [teammates, needsYou, comingUp, connections, people] =
    await Promise.all([
      listTeammates(org.id),
      listNeedsYou(org.id),
      listComingUp(org.id),
      listConnections(org.id),
      listFullPeople(org.id),
    ]);

  /* ---------- Who is doing what ---------- */

  /*
   * Each teammate's own work. This used to take the first in-flight duty in
   * the organisation and print it on every card, so all six reported whatever
   * one of them happened to be doing.
   */
  const inFlightByOwner = new Map<string, string>();
  for (const duty of comingUp) {
    if (duty.state !== 'in_progress') continue;
    const owner = ownerOf(duty.dutyType);
    if (!inFlightByOwner.has(owner)) {
      inFlightByOwner.set(
        owner,
        `Working on ${dutyTypeLabel(duty.dutyType).toLowerCase()}`,
      );
    }
  }

  const waitingByOwner = new Map<string, number>();
  for (const item of needsYou) {
    const owner = ownerOf(item.dutyType);
    waitingByOwner.set(owner, (waitingByOwner.get(owner) ?? 0) + 1);
  }

  function statusFor(key: string): { text: string; busy: boolean } {
    const working = inFlightByOwner.get(key);
    if (working) return { text: working, busy: true };

    const waiting = waitingByOwner.get(key) ?? 0;
    if (waiting > 0) {
      return {
        text: `${pluralise(waiting, 'thing', 'things')} need you`,
        busy: true,
      };
    }
    return { text: 'On the desk, nothing in flight', busy: false };
  }

  const team = (
    <section className="railPanel">
      <div className="railHead">
        <span className="railTitle">Your team</span>
        <Link href="/team" className="railLink">
          Manage
        </Link>
      </div>

      {teammates.map((mate) => {
        const status = mate.active
          ? statusFor(mate.key)
          : { text: 'Not switched on', busy: false };

        const body = (
          <>
            <span
              className={`avatar avatar-sm ${mate.active ? '' : 'avatar-muted'}`}
              data-hue={hueFor(mate.name)}
              aria-hidden
            >
              {mate.initial}
            </span>
            <span className="mateBody">
              <span className="mateName">{mate.name}</span>
              <span className="mateWhat">{status.text}</span>
            </span>
            {mate.active ? (
              <span
                className={`statusDot mateDot ${
                  status.busy ? 'statusDot-busy' : 'statusDot-live'
                }`}
                aria-hidden
              />
            ) : null}
          </>
        );

        return mate.active ? (
          <Link key={mate.key} href={`/team/${mate.key}`} className="mateRow">
            {body}
          </Link>
        ) : (
          <div key={mate.key} className="mateRow">
            {body}
          </div>
        );
      })}
    </section>
  );

  /* ---------- What is connected ---------- */

  const connected = new Set(
    connections.filter((c) => c.status === 'connected').map((c) => c.providerKey),
  );

  // Connected first, then whatever could be connected next. Anything that is
  // not available yet belongs on the Marketplace, not on this list.
  const connectable = PROVIDERS.filter((p) => p.available);
  const shown = [
    ...connectable.filter((p) => connected.has(p.key)),
    ...connectable.filter((p) => !connected.has(p.key)),
  ].slice(0, 5);

  const sources = (
    <section className="railPanel">
      <div className="railHead">
        <span className="railTitle">Connected</span>
        <Link href="/marketplace" className="railLink">
          Add
        </Link>
      </div>

      {shown.map((provider) => {
        const on = connected.has(provider.key);
        return (
          <div key={provider.key} className="connRow">
            <span
              className={`statusDot ${on ? 'statusDot-live' : 'statusDot-idle'}`}
              aria-hidden
            />
            <span className="connName truncate">{provider.label}</span>
            <span className="connState" data-on={on}>
              {on ? 'Connected' : 'Not yet'}
            </span>
          </div>
        );
      })}

      {connected.size === 0 ? (
        <p className="tiny muted" style={{ marginTop: 9 }}>
          Nothing connected yet, so the team is working from what you tell them
          and what is already on file.
        </p>
      ) : null}
    </section>
  );

  /* ---------- What is happening ---------- */

  const happeningRows = [
    ...needsYou.slice(0, 3).map((item) => ({
      key: `x-${item.id}`,
      href: `/catchup#item-${item.id}`,
      text: item.personName
        ? `${item.personName} — ${exceptionKindLabel(item.kind, item.kindLabel).toLowerCase()}`
        : exceptionKindLabel(item.kind, item.kindLabel),
      meta: 'Waiting on you',
      warn: true,
    })),
    ...comingUp.slice(0, 3).map((duty) => ({
      key: `d-${duty.id}`,
      href: duty.blockingExceptionId
        ? `/catchup#item-${duty.blockingExceptionId}`
        : '/catchup',
      text: dutyTypeLabel(duty.dutyType),
      meta: dutyStateLabel(duty.state),
      warn: false,
    })),
  ].slice(0, 5);

  const happening = (
    <section className="railPanel">
      <div className="railHead">
        <span className="railTitle">What&rsquo;s happening</span>
        {happeningRows.length > 0 ? (
          <Link href="/catchup" className="railLink">
            See all
          </Link>
        ) : null}
      </div>

      {happeningRows.length === 0 ? (
        <p className="tiny muted">
          Nothing in flight and nothing waiting on you.
        </p>
      ) : (
        happeningRows.map((row) => (
          <Link key={row.key} href={row.href} className="railRow">
            <span
              className={`statusDot ${row.warn ? 'statusDot-busy' : 'statusDot-live'}`}
              aria-hidden
            />
            <span className="grow truncate">{row.text}</span>
            <span className="railMeta">{row.meta}</span>
            <ArrowRightIcon size={13} />
          </Link>
        ))
      )}
    </section>
  );

  /* ---------- Things worth asking, given what is actually on file ---------- */

  const employees = people.filter((p) => p.type === 'employee');
  const audit = auditRecords(employees);

  const suggestions = suggestionsFor({
    blockedRecords: audit.blocked.length,
    needsYou: needsYou.length,
    candidates: people.filter((p) => p.type === 'candidate').length,
    withoutStructure: employees.filter((p) => p.monthlyGross <= 0).length,
    hasConnection: connected.size > 0,
  });

  return (
    <div className="homeGrid">
      <div className="homeMain">
        <header className="pageHeader">
          <h1>Hi {displayName}, good to see you.</h1>
          <p className="sub">
            Your team is on the desk. Tell them what you need and whoever owns
            it will pick it up.
          </p>
        </header>

        <HomeCanvas userName={displayName} suggestions={suggestions} />
      </div>

      <aside className="homeRail">
        {team}
        {happening}
        {sources}
      </aside>
    </div>
  );
}
