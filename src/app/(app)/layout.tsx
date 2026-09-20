import { redirect } from 'next/navigation';
import { Sidebar } from '@/components/Sidebar';
import { getWorkspace } from '@/lib/data/session';
import { countNeedsYou } from '@/lib/data/catchup';

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const workspace = await getWorkspace();
  if (!workspace) redirect('/sign-in');
  if (!workspace.org) redirect('/onboarding');

  const needsYouCount = await countNeedsYou(workspace.org.id);

  return (
    <div className="appShell">
      <Sidebar
        orgName={workspace.org.name}
        userEmail={workspace.user.email ?? ''}
        needsYouCount={needsYouCount}
      />
      <main className="mainArea">
        <div className="contentWrap">{children}</div>
      </main>
    </div>
  );
}
