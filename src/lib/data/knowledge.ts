import { createClient } from '@/lib/supabase/server';

/** Everything behind the "What Holly knows" tab. Read-only by design. */

export interface KnownPerson {
  id: string;
  fullName: string;
  type: string;
  taxRegime: string | null;
  salaryStructure: Record<string, number>;
  doj: string | null;
}

export interface KnownFact {
  id: string;
  statement: string;
  confirmed: boolean;
  createdAt: string;
  /** One line describing where this came from. */
  evidenceLine: string | null;
}

export interface KnownDeadline {
  id: string;
  date: string;
  recurrence: string | null;
  owner: string | null;
  status: string;
}

export async function listPeople(orgId: string): Promise<KnownPerson[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('people')
    .select('id, full_name, type, tax_regime, salary_structure, doj')
    .eq('org_id', orgId)
    .order('full_name', { ascending: true });

  if (error || !data) return [];

  return data.map((row) => ({
    id: row.id as string,
    fullName: (row.full_name as string) ?? 'Unnamed',
    type: (row.type as string) ?? 'employee',
    taxRegime: (row.tax_regime as string | null) ?? null,
    salaryStructure:
      (row.salary_structure as Record<string, number> | null) ?? {},
    doj: (row.doj as string | null) ?? null,
  }));
}

export async function listFacts(orgId: string): Promise<KnownFact[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('facts')
    .select('id, statement, confirmed, created_at, evidence')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false });

  if (error || !data) return [];

  return data.map((row) => {
    const evidence = row.evidence as unknown;
    let line: string | null = null;

    const first = Array.isArray(evidence) ? evidence[0] : evidence;
    if (first && typeof first === 'object') {
      const e = first as Record<string, unknown>;
      if (typeof e.from_decision === 'string') {
        line = 'Recorded when you corrected Holly on this.';
      } else if (typeof e.source === 'string') {
        line = String(e.source);
      }
    }

    return {
      id: row.id as string,
      statement: (row.statement as string) ?? '',
      confirmed: Boolean(row.confirmed),
      createdAt: (row.created_at as string) ?? '',
      evidenceLine: line,
    };
  });
}

export async function listDeadlines(orgId: string): Promise<KnownDeadline[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('deadlines')
    .select('id, date, recurrence, owner, status')
    .eq('org_id', orgId)
    .order('date', { ascending: true });

  if (error || !data) return [];

  return data.map((row) => ({
    id: row.id as string,
    date: (row.date as string) ?? '',
    recurrence: (row.recurrence as string | null) ?? null,
    owner: (row.owner as string | null) ?? null,
    status: (row.status as string) ?? 'open',
  }));
}
