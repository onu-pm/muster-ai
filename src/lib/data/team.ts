import { createClient } from '@/lib/supabase/server';
import { TEAMMATES, type Teammate } from '@/lib/catalog/team-agents';

/** The `teams.key` values this organisation has switched on. */
export async function enabledTeamKeys(orgId: string): Promise<Set<string>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('org_teams')
    .select('enabled, teams ( key )')
    .eq('org_id', orgId)
    .eq('enabled', true);

  if (error || !data) return new Set();

  const keys = new Set<string>();
  for (const row of data) {
    const team = row.teams as { key: string } | { key: string }[] | null;
    const key = Array.isArray(team) ? team[0]?.key : team?.key;
    if (key) keys.add(key);
  }
  return keys;
}

export interface TeammateWithState extends Teammate {
  /** Live in the catalogue *and* switched on for this organisation. */
  active: boolean;
}

export async function listTeammates(
  orgId: string,
): Promise<TeammateWithState[]> {
  const enabled = await enabledTeamKeys(orgId);
  return TEAMMATES.map((t) => ({
    ...t,
    active: Boolean(t.live && t.dbTeamKey && enabled.has(t.dbTeamKey)),
  }));
}

export async function getTeammateWithState(
  orgId: string,
  key: string,
): Promise<TeammateWithState | null> {
  const all = await listTeammates(orgId);
  return all.find((t) => t.key === key) ?? null;
}
