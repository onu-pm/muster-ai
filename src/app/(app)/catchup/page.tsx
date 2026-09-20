import { requireWorkspace } from '@/lib/data/session';
import {
  listComingUp,
  listNeedsYou,
  listRecentlyResolved,
} from '@/lib/data/catchup';
import { CatchupCard } from '@/components/CatchupCard';
import { ComingUpList } from '@/components/ComingUpList';
import { HashFocus } from '@/components/HashFocus';
import { countLine, exceptionKindLabel, relativeDay } from '@/lib/copy/labels';

export default async function CatchupPage() {
  const { org } = await requireWorkspace();

  const [needsYou, comingUp, resolved] = await Promise.all([
    listNeedsYou(org.id),
    listComingUp(org.id),
    listRecentlyResolved(org.id),
  ]);

  return (
    <>
      <HashFocus />
      <header className="pageHeader">
        <h1>Catchup</h1>
        <p className="sub">{countLine(needsYou.length)}</p>
      </header>

      <div className="stack-lg">
        <section>
          <div className="sectionHead">
            <div className="sectionTitle">Needs you now</div>
            {needsYou.length > 0 ? (
              <span className="tiny muted">
                Holly has done the work — these need a person.
              </span>
            ) : null}
          </div>

          {needsYou.length === 0 ? (
            <div className="empty">
              <div className="emptyTitle">You&rsquo;re all caught up.</div>
              Holly will put anything she&rsquo;s unsure about right here.
            </div>
          ) : (
            <div className="stack">
              {needsYou.map((item) => (
                <CatchupCard key={item.id} item={item} />
              ))}
            </div>
          )}
        </section>

        <section>
          <div className="sectionHead">
            <div className="sectionTitle">Coming up</div>
          </div>

          {comingUp.length === 0 ? (
            <div className="empty">
              <div className="emptyTitle">Nothing in flight.</div>
              Ask Holly for something on Home and it will show up here.
            </div>
          ) : (
            <ComingUpList items={comingUp} />
          )}
        </section>

        <section>
          <div className="sectionHead">
            <div className="sectionTitle">Recently resolved</div>
            <span className="tiny muted">Last 7 days</span>
          </div>

          {resolved.length === 0 ? (
            <div className="empty">Nothing resolved in the last week.</div>
          ) : (
            <div
              className="card"
              style={{ padding: '4px 20px', background: 'rgba(255,255,255,.6)' }}
            >
              {resolved.map((item) => (
                <div key={item.id} className="listRow">
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="small truncate">
                      {item.personName ? `${item.personName} — ` : ''}
                      {exceptionKindLabel(item.kind, item.kindLabel)}
                    </div>
                  </div>
                  <span className="tiny muted">
                    {relativeDay(item.resolvedAt)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
