'use server';

import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { resolveMemberOrg } from '@/lib/data/guard';
import { getTeammate } from '@/lib/catalog/team-agents';

export interface TeamResult {
  ok: boolean;
  error?: string;
}

/**
 * Switching a teammate on or off.
 *
 * Deactivating never deletes anything — the work a teammate has already done
 * stays on the record. It only stops them picking up anything new.
 */
export async function setTeammateEnabled(
  teamKey: string,
  enabled: boolean,
): Promise<TeamResult> {
  const teammate = getTeammate(teamKey);
  if (!teammate) return { ok: false, error: 'No such teammate.' };
  if (!teammate.live || !teammate.dbTeamKey) {
    return { ok: false, error: `${teammate.name} is not available yet.` };
  }

  const member = await resolveMemberOrg();
  if (!member.ok) return { ok: false, error: member.error };

  const supabase = await createClient();
  const { data: team } = await supabase
    .from('teams')
    .select('id')
    .eq('key', teammate.dbTeamKey)
    .maybeSingle();

  if (!team) {
    return { ok: false, error: `${teammate.name}'s team row is missing.` };
  }

  const { error } = await createAdminClient()
    .from('org_teams')
    .upsert(
      {
        org_id: member.orgId,
        team_id: team.id,
        enabled,
        enabled_at: new Date().toISOString(),
      },
      { onConflict: 'org_id,team_id' },
    );

  if (error) return { ok: false, error: error.message };

  revalidatePath('/team');
  revalidatePath(`/team/${teamKey}`);
  revalidatePath('/home');
  revalidatePath('/catchup');
  return { ok: true };
}
