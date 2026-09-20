import Link from 'next/link';
import { requireWorkspace } from '@/lib/data/session';
import { listTeammates } from '@/lib/data/team';

export default async function TeamPage() {
  const { org } = await requireWorkspace();
  const teammates = await listTeammates(org.id);

  return (
    <>
      <header className="pageHeader">
        <h1>Your team.</h1>
        <p className="sub">
          Each teammate owns a desk end to end. More of them open up over time.
        </p>
      </header>

      <div className="grid-2">
        {teammates.map((mate) => {
          const card = (
            <div
              className={`card ${mate.live ? 'card-hover' : 'card-dim'}`}
              style={{ height: '100%' }}
            >
              <div className="row">
                <span className={`avatar ${mate.active ? '' : 'avatar-muted'}`}>
                  {mate.initial}
                </span>
                <div style={{ minWidth: 0 }}>
                  <div className="cardTitle">{mate.name}</div>
                  <div className="tiny muted truncate">{mate.role}</div>
                </div>
              </div>

              <p className="cardBody" style={{ marginTop: 12 }}>
                {mate.desk}
              </p>

              <div style={{ marginTop: 14 }}>
                {mate.active ? (
                  <span className="tag tag-live">
                    <span className="statusDot statusDot-live" />
                    On the desk
                  </span>
                ) : mate.live ? (
                  <span className="tag tag-accent">Ready to add</span>
                ) : (
                  <span className="tag">Coming soon</span>
                )}
              </div>
            </div>
          );

          // Anyone who exists can be opened — that is where you add them.
          return mate.live ? (
            <Link key={mate.key} href={`/team/${mate.key}`}>
              {card}
            </Link>
          ) : (
            <div key={mate.key} aria-disabled>
              {card}
            </div>
          );
        })}
      </div>
    </>
  );
}
