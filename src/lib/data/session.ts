import { cache } from 'react';
import type { User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';

export interface Organisation {
  id: string;
  name: string;
}

export interface Workspace {
  user: User;
  org: Organisation | null;
  role: string | null;
  /** First name where we have one, otherwise the part of the email before the @. */
  displayName: string;
}

function nameFor(user: User): string {
  const meta = user.user_metadata as Record<string, unknown> | null;
  const full = typeof meta?.full_name === 'string' ? meta.full_name.trim() : '';
  if (full) return full.split(/\s+/)[0];
  const email = user.email ?? '';
  const local = email.split('@')[0] ?? 'there';
  return local.replace(/[._-]+/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

/** Deduped per request — the shell and the page both need it. */
export const getWorkspace = cache(async (): Promise<Workspace | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: membership } = await supabase
    .from('org_members')
    .select('role, org_id, organisations ( id, name )')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  const joined = membership?.organisations as
    | { id: string; name: string }
    | { id: string; name: string }[]
    | null
    | undefined;

  const org = Array.isArray(joined) ? (joined[0] ?? null) : (joined ?? null);

  return {
    user,
    org: org ? { id: org.id, name: org.name } : null,
    role: membership?.role ?? null,
    displayName: nameFor(user),
  };
});

/** For pages inside the app shell: guarantees a user and an organisation. */
export async function requireWorkspace(): Promise<
  Workspace & { org: Organisation }
> {
  const workspace = await getWorkspace();
  if (!workspace) throw new Error('Not signed in');
  if (!workspace.org) throw new Error('No organisation yet');
  return workspace as Workspace & { org: Organisation };
}
