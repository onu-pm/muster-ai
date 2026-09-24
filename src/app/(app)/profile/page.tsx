import { requireWorkspace } from '@/lib/data/session';
import { listOrgMembers } from '@/lib/data/members';
import { OrgNameField, SignOutButton } from '@/components/ProfileForm';
import { roleLabel } from '@/lib/copy/labels';
import { hueFor } from '@/lib/copy/hue';

export default async function ProfilePage() {
  const { org, user } = await requireWorkspace();
  const members = await listOrgMembers(org.id);

  return (
    <>
      <header className="pageHeader">
        <h1>Your account.</h1>
        <p className="sub">Your organisation, and who else is in it.</p>
      </header>

      <div className="stack-lg">
        <section className="card card-pad-lg">
          <OrgNameField initial={org.name} />

          <div style={{ marginTop: 22 }}>
            <div className="label">Your email</div>
            <p className="muted small">{user.email}</p>
            <p className="fieldHint">
              This is how you sign in, so it cannot be changed here.
            </p>
          </div>
        </section>

        <section>
          <div className="sectionHead">
            <div className="sectionTitle">People in {org.name}</div>
            <span className="tiny muted">{members.length}</span>
          </div>

          {members.length === 0 ? (
            <div className="empty">It&rsquo;s just you for now.</div>
          ) : (
            <div className="card" style={{ padding: '4px 20px' }}>
              {members.map((member) => (
                <div key={member.userId} className="listRow">
                  <span
                    className="avatar avatar-sm"
                    data-hue={hueFor(member.name)}
                    aria-hidden
                  >
                    {(member.name.trim()[0] ?? '?').toUpperCase()}
                  </span>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="strong">
                      {member.name}
                      {member.isYou ? (
                        <span className="tag tag-accent" style={{ marginLeft: 8 }}>
                          You
                        </span>
                      ) : null}
                    </div>
                    <div className="tiny muted truncate">{member.email}</div>
                  </div>
                  <span className="tag">{roleLabel(member.role)}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section>
          <hr className="divider" style={{ marginBottom: 20 }} />
          <div className="row-between wrap">
            <div>
              <div className="strong">Sign out of Muster</div>
              <p className="tiny muted">
                You&rsquo;ll need your email and password to get back in.
              </p>
            </div>
            <SignOutButton />
          </div>
        </section>
      </div>
    </>
  );
}
