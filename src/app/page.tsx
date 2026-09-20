import { redirect } from 'next/navigation';
import { getWorkspace } from '@/lib/data/session';

export default async function RootPage() {
  const workspace = await getWorkspace();
  if (!workspace) redirect('/sign-in');
  if (!workspace.org) redirect('/onboarding');
  redirect('/home');
}
