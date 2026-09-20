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
  if (!user) return { ok: false, error: 'Your session has expired. Sign in again.' };

  const { data: org, error: orgError } = await supabase
    .from('organisations')
    .insert({ name: trimmed })
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
    role: 'owner',
  });

  if (memberError) {
    return { ok: false, error: memberError.message };
  }

  return { ok: true, orgId: org.id as string };
}

/** Step 2 — activate a teammate for this organisation. */
export async function activateTeammate(
  orgId: string,
  teamKey: string,
): Promise<ActionResult> {
  const teammate = getTeammate(teamKey);
  if (!teammate) return { ok: false, error: 'That teammate does not exist.' };
  if (!teammate.live) {
    return { ok: false, error: `${teammate.name} is not available yet.` };
  }

  const supabase = await createClient();

  const { data: team } = await supabase
    .from('teams')
    .select('id, key')
    .eq('key', teamKey)
    .maybeSingle();

  if (!team) {
    return {
      ok: false,
      error: `${teammate.name} is missing from the teams table in this project.`,
    };
  }

  const { error } = await supabase
    .from('org_teams')
    .upsert(
      { org_id: orgId, team_id: team.id, status: 'active' },
      { onConflict: 'org_id,team_id' },
    );

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
