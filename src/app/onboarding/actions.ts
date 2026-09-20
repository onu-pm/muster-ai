'use server';

import { createClient } from '@/lib/supabase/server';
import { getTeammate } from '@/lib/catalog/team-agents';

export interface ActionResult {
  ok: boolean;
  error?: string;
  orgId?: string;
}

/** Step 1 — name the organisation, and put the signed-in user in it as owner. */
export async function createOrganisation(name: string): Promise<ActionResult> {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: 'Give your organisation a name.' };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: 'Your session has expired. Sign in again.' };
  }

  // plan and data_region are NOT NULL on this table; every existing row uses
  // these values, so new organisations match rather than relying on a default.
  const { data: org, error: orgError } = await supabase
    .from('organisations')
    .insert({ name: trimmed, plan: 'pilot', data_region: 'ap-south-1' })
    .select('id')
    .single();

  if (orgError || !org) {
    return {
      ok: false,
      error: orgError?.message ?? 'Could not create the organisation.',
    };
  }

  const { error: memberError } = await supabase.from('org_members').insert({
    org_id: org.id,
    user_id: user.id,
    role: 'hr_admin',
  });

  if (memberError) return { ok: false, error: memberError.message };

  return { ok: true, orgId: org.id as string };
}

/** Step 2 — switch a teammate on for this organisation. */
export async function activateTeammate(
  orgId: string,
  teamKey: string,
): Promise<ActionResult> {
  const teammate = getTeammate(teamKey);
  if (!teammate) return { ok: false, error: 'That teammate does not exist.' };
  if (!teammate.live || !teammate.dbTeamKey) {
    return { ok: false, error: `${teammate.name} is not available yet.` };
  }

  const supabase = await createClient();

  const { data: team } = await supabase
    .from('teams')
    .select('id')
    .eq('key', teammate.dbTeamKey)
    .maybeSingle();

  if (!team) {
    return {
      ok: false,
      error: `${teammate.name}'s team row is missing from this project.`,
    };
  }

  const { error } = await supabase.from('org_teams').upsert(
    {
      org_id: orgId,
      team_id: team.id,
      enabled: true,
      enabled_at: new Date().toISOString(),
    },
    { onConflict: 'org_id,team_id' },
  );

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
