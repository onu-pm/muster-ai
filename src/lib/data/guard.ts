import { createClient } from '@/lib/supabase/server';

/**
 * Resolves the organisation the signed-in user actually belongs to.
 *
 * The org id is never taken from the caller. It is read back through the user's
 * own RLS-scoped client, so a request cannot name an organisation the user is
 * not a member of — which is the same guarantee `is_org_member(org_id)` gives
 * at the database level, enforced here because this project's `connections` and
 * `org_teams` tables have read policies but no INSERT policy.
 *
 * Writes that follow this check use the service-role client. See
 * supabase/migrations/0007_exception_kind_label.sql: once those policies are
 * applied, these writes can move back onto the user's own client.
 */
export async function resolveMemberOrg(): Promise<
  { ok: true; orgId: string; userId: string } | { ok: false; error: string }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: 'Your session has expired. Sign in again.' };
  }

  const { data: membership } = await supabase
    .from('org_members')
    .select('org_id')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!membership?.org_id) {
    return { ok: false, error: 'You are not part of an organisation yet.' };
  }

  return { ok: true, orgId: membership.org_id as string, userId: user.id };
}
