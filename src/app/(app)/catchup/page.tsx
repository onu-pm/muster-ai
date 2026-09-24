import { requireWorkspace } from '@/lib/data/session';
import { listComingUp, listRecentlyResolved } from '@/lib/data/catchup';
import { buildStandup } from '@/lib/data/standup';
import { CatchupCard } from '@/components/CatchupCard';
import { ComingUpList } from '@/components/ComingUpList';
import { HashFocus } from '@/components/HashFocus';
import { countLine, exceptionKindLabel, relativeDay } from '@/lib/copy/labels';
import { hueFor } from '@/lib/copy/hue';

export default async function CatchupPage() {
  const { org } = await requireWorkspace();

  const [standup, comingUp, resolved] = await Promise.all([
    buildStandup(org.id),
    listComingUp(org.id),
    listRecentlyResolved(org.id),
  ]);

  return (
    <>
      <HashFocus />
      <header className="pageHeader">
        <h1>Catchup</h1>
        <p className="sub">
          {countLine(standup.totalNeedsYou)} Everyone&rsquo;s reporting in
          below — what they&rsquo;ve done, what they need from you, what&rsquo;s
          next.
        </p>
      </header>

      <div className="stack-lg">
        {standup.teammates.map((mate) => (
          <section key={mate.key}>
            <div className="row" style={{ gap: 11, marginBottom: 14 }}>
              <span className="avatar avatar-sm" data-hue={hueFor(mate.name)}>
                {mate.initial}
              </span>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="sectionTitle">{mate.name}</div>
                <div className="tiny muted">{mate.role}</div>
              </div>
              {mate.needsYou.length > 0 ? (
                <span className="tag tag-warn">
                  {mate.needsYou.length} for you
                </span>
              ) : (
                <span className="tag tag-live">Clear</span>
              )}
            </div>

            <div className="standupBody">
              {mate.did.length > 0 ? (
                <div className="card-flat" style={{ marginBottom: 12 }}>
                  <div className="eyebrow" style={{ marginBottom: 6 }}>
                    Since we last spoke
                  </div>
                  {mate.did.map((line, i) => (
                    <p key={i} className="small" style={{ marginTop: 2 }}>
                      {line}
                    </p>
                  ))}
                </div>
              ) : null}

              {mate.needsYou.length > 0 ? (
                <div className="stack" style={{ marginBottom: 12 }}>
                  {mate.needsYou.map((item) => (
                    <CatchupCard key={item.id} item={item} />
                  ))}
                </div>
              ) : null}

              {mate.next.length > 0 ? (
                <div className="card-flat">
                  <div className="eyebrow" style={{ marginBottom: 6 }}>
                    Next
                  </div>
                  {mate.next.map((line, i) => (
                    <p key={i} className="small" style={{ marginTop: 2 }}>
                      {line}
                    </p>
                  ))}
                </div>
              ) : null}

              {mate.quiet ? (
                <div className="empty" style={{ padding: '20px 18px' }}>
                  Nothing to report.
                </div>
              ) : null}
            </div>
          </section>
        ))}

        <section>
          <div className="sectionHead">
            <div className="sectionTitle">Everything in flight</div>
          </div>

          {comingUp.length === 0 ? (
            <div className="empty">
              <div className="emptyTitle">Nothing in flight.</div>
              Ask for something on Home and it will show up here.
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
