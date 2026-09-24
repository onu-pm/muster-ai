import Link from 'next/link';
import { requireWorkspace } from '@/lib/data/session';
import { listTeammates } from '@/lib/data/team';
import { listComingUp, listNeedsYou } from '@/lib/data/catchup';
import { HomeCanvas } from '@/components/HomeCanvas';
import { ArrowRightIcon } from '@/components/Icons';
import {
  dutyStateLabel,
  dutyTypeLabel,
  exceptionKindLabel,
  pluralise,
} from '@/lib/copy/labels';
import { hueFor } from '@/lib/copy/hue';

export default async function HomePage() {
  const { org, displayName } = await requireWorkspace();

  const [teammates, needsYou, comingUp] = await Promise.all([
    listTeammates(org.id),
    listNeedsYou(org.id),
    listComingUp(org.id),
  ]);

  const working = comingUp.find((d) => d.state === 'in_progress');
  const hollyStatus = working
    ? `Working on ${dutyTypeLabel(working.dutyType).toLowerCase()}`
    : needsYou.length > 0
      ? `${pluralise(needsYou.length, 'thing', 'things')} need you`
      : 'All caught up';

  const strip = teammates.map((mate) => {
    const card = (
      <div className={`card teamCard ${mate.active ? 'card-hover' : 'card-dim'}`}>
        <div className="row teamCardHead">
          <span
            className={`avatar ${mate.active ? '' : 'avatar-muted'}`}
            data-hue={hueFor(mate.name)}
          >
            {mate.initial}
          </span>
          <div style={{ minWidth: 0 }}>
            <div className="cardTitle truncate">{mate.name}</div>
            <div className="tiny muted truncate teamCardRole">{mate.role}</div>
          </div>
        </div>

        {mate.active ? (
          <div className="row teamCardStatus">
            <span
              className={`statusDot ${working ? 'statusDot-busy' : 'statusDot-live'}`}
            />
            <span className="tiny strong">{hollyStatus}</span>
          </div>
        ) : (
          <span className="tag teamCardTag">Coming soon</span>
        )}
      </div>
    );

    return mate.active ? (
      <Link key={mate.key} href={`/team/${mate.key}`}>
        {card}
      </Link>
    ) : (
      <div key={mate.key} aria-disabled>
        {card}
      </div>
    );
  });

  const happeningRows = [
    ...needsYou.slice(0, 2).map((item) => ({
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
  ].slice(0, 3);

  const happening =
    happeningRows.length > 0 ? (
      <section>
        <div className="sectionHead">
          <div className="sectionTitle">What&rsquo;s happening</div>
          <Link
            href="/catchup"
            className="tiny strong"
            style={{ color: 'var(--accent)' }}
          >
            See all
          </Link>
        </div>

        <div className="card" style={{ padding: '4px 20px' }}>
          {happeningRows.map((row) => (
            <Link key={row.key} href={row.href} className="listRow">
              <span
                className={`statusDot ${row.warn ? 'statusDot-busy' : 'statusDot-live'}`}
              />
              <span className="grow truncate">{row.text}</span>
              <span className="tiny muted">{row.meta}</span>
              <ArrowRightIcon size={14} />
            </Link>
          ))}
        </div>
      </section>
    ) : null;

  return (
    <>
      <header className="pageHeader">
        <h1>Hi {displayName}, good to see you.</h1>
        <p className="sub">
          Your team is on the desk. Tell them what you need, or look at what
          needs you.
        </p>
      </header>

      <HomeCanvas
        userName={displayName}
        strip={strip}
        happening={happening}
      />
    </>
  );
}
