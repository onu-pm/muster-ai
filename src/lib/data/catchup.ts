import { createClient } from '@/lib/supabase/server';

/**
 * `exceptions` carries no org_id of its own — it hangs off `duty_instances`,
 * which is where org scoping and the subject person live. Every read here goes
 * through that join, which is also what RLS keys off.
 */

interface DutyJoin {
  id: string;
  org_id: string;
  duty_type: string;
  state: string;
  due_at: string | null;
  opened_at: string | null;
  subject_person_id: string | null;
  people: { full_name: string } | { full_name: string }[] | null;
}

interface ExceptionRow {
  id: string;
  duty_instance_id: string;
  kind: string;
  kind_label?: string | null;
  conclusion: string;
  confidence: number;
  status: string;
  opened_at: string;
  resolved_at: string | null;
  payload: Record<string, unknown> | null;
  duty_instances: DutyJoin | DutyJoin[] | null;
}

export interface CatchupItem {
  id: string;
  kind: string;
  kindLabel: string | null;
  status: string;
  dutyInstanceId: string;
  dutyType: string | null;
  personName: string | null;
  /** Holly's own sentence about what she found. Already human-readable. */
  conclusion: string;
  confidence: number;
  /** The rule she leaned on, in one line. */
  ruleLine: string | null;
  openedAt: string;
  resolvedAt: string | null;
  payload: Record<string, unknown>;
}

const one = <T>(v: T | T[] | null): T | null =>
  Array.isArray(v) ? (v[0] ?? null) : v;

const EXCEPTION_SELECT = `
  id, duty_instance_id, kind, kind_label, conclusion, confidence, status,
  opened_at, resolved_at, payload,
  duty_instances!inner (
    id, org_id, duty_type, state, due_at, opened_at, subject_person_id,
    people:subject_person_id ( full_name )
  )
`;

/**
 * `kind_label` is added by migration 0007. Until that has run the column does
 * not exist and PostgREST rejects the whole select, so the first failure drops
 * it and the labels module supplies the wording instead.
 */
let kindLabelColumnExists = true;

function selectList(): string {
  return kindLabelColumnExists
    ? EXCEPTION_SELECT
    : EXCEPTION_SELECT.replace('kind_label, ', '');
}

function toItem(row: ExceptionRow): CatchupItem {
  const duty = one(row.duty_instances);
  const person = duty ? one(duty.people) : null;
  const payload = row.payload ?? {};

  // The subject is usually carried in the payload rather than on the duty row:
  // duty_instances.subject_person_id is null for whole-payroll runs.
  const payloadPerson =
    typeof payload.personName === 'string' ? payload.personName : null;

  const ruleFromPayload =
    typeof payload.ruleApplied === 'string'
      ? payload.ruleApplied
      : typeof payload.rule_label === 'string'
        ? payload.rule_label
        : null;

  return {
    id: row.id,
    kind: row.kind,
    kindLabel: row.kind_label ?? null,
    status: row.status,
    dutyInstanceId: row.duty_instance_id,
    dutyType: duty?.duty_type ?? null,
    personName: payloadPerson ?? person?.full_name ?? null,
    conclusion: row.conclusion,
    confidence: Number(row.confidence ?? 0),
    ruleLine: ruleFromPayload,
    openedAt: row.opened_at,
    resolvedAt: row.resolved_at,
    payload,
  };
}

async function queryExceptions(
  orgId: string,
  status: 'open' | 'resolved',
): Promise<CatchupItem[]> {
  const supabase = await createClient();

  const run = async () =>
    supabase
      .from('exceptions')
      .select(selectList())
      .eq('duty_instances.org_id', orgId)
      .eq('status', status)
      .order(status === 'open' ? 'opened_at' : 'resolved_at', {
        ascending: false,
      });

  let { data, error } = await run();

  if (error && kindLabelColumnExists && /kind_label/.test(error.message)) {
    kindLabelColumnExists = false;
    ({ data, error } = await run());
  }

  if (error || !data) return [];
  return (data as unknown as ExceptionRow[]).map(toItem);
}

export async function countNeedsYou(orgId: string): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from('exceptions')
    .select('id, duty_instances!inner(org_id)', { count: 'exact', head: true })
    .eq('duty_instances.org_id', orgId)
    .eq('status', 'open');

  if (error) return 0;
  return count ?? 0;
}

export async function listNeedsYou(orgId: string): Promise<CatchupItem[]> {
  return queryExceptions(orgId, 'open');
}

export async function listRecentlyResolved(
  orgId: string,
  days = 7,
): Promise<CatchupItem[]> {
  const since = Date.now() - days * 86_400_000;
  const all = await queryExceptions(orgId, 'resolved');
  return all
    .filter((item) => {
      if (!item.resolvedAt) return false;
      return new Date(item.resolvedAt).getTime() >= since;
    })
    .slice(0, 40);
}

export interface ComingUpItem {
  id: string;
  dutyType: string;
  personName: string | null;
  state: string;
  dueAt: string | null;
  openedAt: string;
  openExceptions: number;
}

export async function listComingUp(orgId: string): Promise<ComingUpItem[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('duty_instances')
    .select(
      `id, duty_type, state, due_at, opened_at, subject_person_id,
       people:subject_person_id ( full_name ),
       exceptions ( id, status )`,
    )
    .eq('org_id', orgId)
    .neq('state', 'closed')
    .order('due_at', { ascending: true, nullsFirst: false });

  if (error || !data) return [];

  return (data as unknown as (DutyJoin & {
    exceptions: { id: string; status: string }[] | null;
  })[]).map((row) => {
    const person = one(row.people);
    return {
      id: row.id,
      dutyType: row.duty_type,
      personName: person?.full_name ?? null,
      state: row.state,
      dueAt: row.due_at,
      openedAt: row.opened_at ?? '',
      openExceptions: (row.exceptions ?? []).filter((e) => e.status === 'open')
        .length,
    };
  });
}
