import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export interface OrgMember {
  userId: string;
  name: string;
  email: string;
  role: string;
  isYou: boolean;
}

/**
 * Members of the organisation, with names and emails.
 *
 * `org_members` only stores user ids; names and emails live in `auth.users`,
 * which no user-facing client can read. The membership list is read first
 * through the user's own RLS-scoped client, and only those ids are then looked
 * up — so this never discloses anyone outside the caller's organisation.
 */
export async function listOrgMembers(orgId: string): Promise<OrgMember[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: rows, error } = await supabase
    .from('org_members')
    .select('user_id, role, created_at')
    .eq('org_id', orgId)
    .order('created_at', { ascending: true });

  if (error || !rows?.length) return [];

  const ids = new Set(rows.map((r) => r.user_id as string));

  let directory = new Map<string, { email: string; name: string }>();
  try {
    const admin = createAdminClient();
    const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
    directory = new Map(
      (data?.users ?? [])
        .filter((u) => ids.has(u.id))
        .map((u) => {
          const meta = u.user_metadata as Record<string, unknown> | null;
          const full =
            typeof meta?.full_name === 'string' ? meta.full_name.trim() : '';
          return [u.id, { email: u.email ?? '', name: full }];
        }),
    );
  } catch {
    // No service key configured — fall back to ids only rather than failing.
  }

  return rows.map((row) => {
    const id = row.user_id as string;
    const found = directory.get(id);
    const email = found?.email ?? '';
    const fallback = email ? email.split('@')[0] : 'Team member';
    return {
      userId: id,
      name: found?.name || fallback,
      email,
      role: (row.role as string) ?? 'member',
      isYou: id === user?.id,
    };
  });
}
