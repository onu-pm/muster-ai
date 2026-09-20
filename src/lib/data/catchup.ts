import { createClient } from '@/lib/supabase/server';

/**
 * Selects are deliberately `*` and reads are defensive: this schema was built by
 * an earlier project and column naming varies between tables. Anything missing
 * degrades to a sensible blank rather than throwing on a page render.
 */

export const OPEN_STATUSES = ['open', 'pending', 'proposed'] as const;
export const RESOLVED_STATUSES = [
  'approved',
  'rejected',
  'corrected',
  'resolved',
  'dismissed',
  'auto_resolved',
] as const;

type Row = Record<string, unknown>;

const str = (row: Row, ...keys: string[]): string | null => {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === 'string' && v.trim()) return v;
  }
  return null;
};

const num = (row: Row, ...keys: string[]): number | null => {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === 'number') return v;
    if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) {
      return Number(v);
    }
  }
  return null;
};

const obj = (row: Row, ...keys: string[]): Record<string, unknown> => {
  for (const k of keys) {
    const v = row[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return v as Record<string, unknown>;
    }
  }
  return {};
};

export interface CatchupItem {
  id: string;
  kind: string | null;
  kindLabel: string | null;
  status: string | null;
  personId: string | null;
  personName: string | null;
  /** What was found, in the agent's own words. */
  finding: string | null;
  /** The conclusion it reached. */
  conclusion: string | null;
  /** The rule it leaned on, in one line. */
  ruleLine: string | null;
  confidence: number | null;
  createdAt: string | null;
  resolvedAt: string | null;
  details: Record<string, unknown>;
}

function toItem(row: Row, personNames: Map<string, string>): CatchupItem {
  const details = obj(row, 'details', 'payload', 'data', 'context', 'metadata');
  const personId = str(row, 'person_id', 'subject_person_id', 'employee_id');

  return {
    id: String(row.id ?? ''),
    kind: str(row, 'kind', 'type', 'category'),
    kindLabel: str(row, 'kind_label'),
    status: str(row, 'status', 'state'),
    personId,
    personName: personId ? (personNames.get(personId) ?? null) : null,
    finding:
      str(row, 'finding', 'summary', 'description', 'message') ??
      str(details as Row, 'finding', 'summary', 'description'),
    conclusion:
      str(row, 'conclusion', 'proposal', 'recommendation', 'resolution') ??
      str(details as Row, 'conclusion', 'proposal', 'recommendation'),
    ruleLine:
      str(row, 'rule_line', 'rule_applied', 'rule_label', 'rule_key') ??
      str(details as Row, 'rule_line', 'rule_applied', 'rule_label', 'rule_key'),
    confidence:
      num(row, 'confidence', 'confidence_score') ??
      num(details as Row, 'confidence'),
    createdAt: str(row, 'created_at', 'inserted_at'),
    resolvedAt: str(row, 'resolved_at', 'updated_at'),
    details,
  };
}

async function namesFor(
  orgId: string,
  ids: (string | null)[],
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (!unique.length) return new Map();

  const supabase = await createClient();
  const { data } = await supabase
    .from('people')
    .select('*')
    .eq('org_id', orgId)
    .in('id', unique);

  const map = new Map<string, string>();
  for (const row of (data ?? []) as Row[]) {
    const id = typeof row.id === 'string' ? row.id : null;
    if (!id) continue;
    const name =
      str(row, 'full_name', 'name', 'display_name') ??
      [str(row, 'first_name'), str(row, 'last_name')].filter(Boolean).join(' ');
    if (name) map.set(id, name);
  }
  return map;
}

export async function countNeedsYou(orgId: string): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from('exceptions')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .in('status', [...OPEN_STATUSES]);

  if (error) return 0;
  return count ?? 0;
}

export async function listNeedsYou(orgId: string): Promise<CatchupItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('exceptions')
    .select('*')
    .eq('org_id', orgId)
    .in('status', [...OPEN_STATUSES])
    .order('created_at', { ascending: false });

  if (error || !data) return [];
  const rows = data as Row[];
  const names = await namesFor(
    orgId,
    rows.map((r) => str(r, 'person_id', 'subject_person_id', 'employee_id')),
  );
  return rows.map((r) => toItem(r, names));
}

export async function listRecentlyResolved(
  orgId: string,
  days = 7,
): Promise<CatchupItem[]> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('exceptions')
    .select('*')
    .eq('org_id', orgId)
    .in('status', [...RESOLVED_STATUSES])
    .gte('updated_at', since)
    .order('updated_at', { ascending: false })
    .limit(40);

  if (error || !data) return [];
  const rows = data as Row[];
  const names = await namesFor(
    orgId,
    rows.map((r) => str(r, 'person_id', 'subject_person_id', 'employee_id')),
  );
  return rows.map((r) => toItem(r, names));
}

export interface ComingUpItem {
  id: string;
  title: string;
  personName: string | null;
  stage: string | null;
  status: string | null;
  dueDate: string | null;
  kind: string | null;
}

export async function listComingUp(orgId: string): Promise<ComingUpItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('duty_instances')
    .select('*')
    .eq('org_id', orgId)
    .order('due_date', { ascending: true, nullsFirst: false })
    .limit(50);

  if (error || !data) return [];
  const rows = data as Row[];
  const names = await namesFor(
    orgId,
    rows.map((r) => str(r, 'person_id', 'subject_person_id')),
  );

  return rows
    .filter((r) => {
      const status = str(r, 'status', 'state');
      return !status || !['completed', 'complete', 'done', 'cancelled'].includes(status);
    })
    .map((r) => {
      const personId = str(r, 'person_id', 'subject_person_id');
      return {
        id: String(r.id ?? ''),
        title:
          str(r, 'title', 'name', 'label', 'duty_key', 'kind') ?? 'Scheduled work',
        personName: personId ? (names.get(personId) ?? null) : null,
        stage: str(r, 'stage', 'current_step', 'phase'),
        status: str(r, 'status', 'state'),
        dueDate: str(r, 'due_date', 'due_at', 'deadline_at', 'scheduled_for'),
        kind: str(r, 'duty_key', 'kind', 'type'),
      };
    });
}
