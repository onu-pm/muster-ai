import { redirect } from 'next/navigation';
import { getWorkspace } from '@/lib/data/session';
import { listConnections } from '@/lib/data/connections';
import { OnboardingFlow } from './OnboardingFlow';

export default async function OnboardingPage() {
  const workspace = await getWorkspace();
  if (!workspace) redirect('/sign-in');

  const connections = workspace.org
    ? await listConnections(workspace.org.id)
    : [];

  return (
    <OnboardingFlow
      existingOrgId={workspace.org?.id ?? null}
      existingOrgName={workspace.org?.name ?? ''}
      connections={connections}
    />
  );
}
