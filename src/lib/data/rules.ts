import { createClient } from '@/lib/supabase/server';

export interface RuleRow {
  id: string;
  ruleKey: string | null;
  label: string | null;
  scope: string;
  jurisdiction: string;
  confirmed: boolean;
  confirmedAt: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  source: string | null;
  definition: Record<string, unknown>;
  createdAt: string;
}

function toRule(row: Record<string, unknown>): RuleRow {
  return {
    id: String(row.id),
    ruleKey: (row.rule_key as string | null) ?? null,
    label: (row.label as string | null) ?? null,
    scope: (row.scope as string) ?? 'policy',
    jurisdiction: (row.jurisdiction as string) ?? '',
    confirmed: Boolean(row.confirmed),
    confirmedAt: (row.confirmed_at as string | null) ?? null,
    effectiveFrom: (row.effective_from as string) ?? '',
    effectiveTo: (row.effective_to as string | null) ?? null,
    source: (row.source as string | null) ?? null,
    definition: (row.definition as Record<string, unknown>) ?? {},
    createdAt: (row.created_at as string) ?? '',
  };
}

export async function listRules(orgId: string): Promise<RuleRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('rules')
    .select('*')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false });

  if (error || !data) return [];
  return data.map(toRule);
}

export async function listConfirmedRules(orgId: string): Promise<RuleRow[]> {
  return (await listRules(orgId)).filter((r) => r.confirmed);
}

/**
 * A confirmed rule by key. Agents call this before falling back to their own
 * default, so an organisation's own policy always wins.
 */
export async function getConfirmedRule(
  orgId: string,
  ruleKey: string,
): Promise<RuleRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('rules')
    .select('*')
    .eq('org_id', orgId)
    .eq('rule_key', ruleKey)
    .eq('confirmed', true)
    .order('effective_from', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return toRule(data);
}
