import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * The generic shape every piece of work in Muster already has.
 *
 * This project's schema is domain-neutral where it matters: `duty_instances`
 * is a piece of work with a type, a state and an optional subject; `steps` is
 * what was done, with its input and output; `exceptions` is the queue of things
 * that stopped at a person; `artifacts` is a document that arrived. None of
 * those columns are enums, which is why records, benefits, reviews and exits
 * needed no new tables — they are new duty types on the same substrate.
 *
 * The rule that holds across all of them: a capability may open a duty and
 * record what it worked out, but anything irreversible is written as an
 * exception and waits for a named person. Nothing here closes that loop itself.
 */

export interface DutyRow {
  id: string;
  dutyType: string;
  state: string;
  subjectPersonId: string | null;
  openedAt: string;
  dueAt: string | null;
  closedAt: string | null;
}

export type DutyState = 'open' | 'in_progress' | 'blocked' | 'closed';

export async function openDuty(
  orgId: string,
  dutyType: string,
  options: {
    subjectPersonId?: string | null;
    state?: DutyState;
    dueAt?: string | null;
  } = {},
): Promise<string | null> {
  const { data, error } = await createAdminClient()
    .from('duty_instances')
    .insert({
      org_id: orgId,
      duty_type: dutyType,
      state: options.state ?? 'in_progress',
      subject_person_id: options.subjectPersonId ?? null,
      opened_at: new Date().toISOString(),
      due_at: options.dueAt ?? null,
    })
    .select('id')
    .single();

  if (error || !data) return null;
  return data.id as string;
}

/**
 * The duty for this subject if one is already running, so asking twice does not
 * open a second exit or a second enrolment for the same person.
 */
export async function findOpenDuty(
  orgId: string,
  dutyType: string,
  subjectPersonId?: string | null,
): Promise<DutyRow | null> {
  let query = createAdminClient()
    .from('duty_instances')
    .select('id, duty_type, state, subject_person_id, opened_at, due_at, closed_at')
    .eq('org_id', orgId)
    .eq('duty_type', dutyType)
    .neq('state', 'closed')
    .order('opened_at', { ascending: false })
    .limit(1);

  query = subjectPersonId
    ? query.eq('subject_person_id', subjectPersonId)
    : query.is('subject_person_id', null);

  const { data } = await query.maybeSingle();
  return data ? toDuty(data) : null;
}

export async function listDuties(
  orgId: string,
  dutyType: string,
  options: { includeClosed?: boolean } = {},
): Promise<DutyRow[]> {
  let query = createAdminClient()
    .from('duty_instances')
    .select('id, duty_type, state, subject_person_id, opened_at, due_at, closed_at')
    .eq('org_id', orgId)
    .eq('duty_type', dutyType)
    .order('opened_at', { ascending: false })
    .limit(200);

  if (!options.includeClosed) query = query.neq('state', 'closed');

  const { data } = await query;
  return (data ?? []).map(toDuty);
}

export async function setDutyState(
  dutyId: string,
  state: DutyState,
): Promise<void> {
  await createAdminClient()
    .from('duty_instances')
    .update({
      state,
      closed_at: state === 'closed' ? new Date().toISOString() : null,
    })
    .eq('id', dutyId);
}

/**
 * What a capability worked out, kept so it can be read back and so the standup
 * can say what happened without a model being asked to remember.
 *
 * `summary` is a human sentence by convention — the standup reads exactly that
 * key, so anything written here is already fit to show someone.
 */
export async function recordStep(
  dutyId: string,
  capability: string,
  input: Record<string, unknown>,
  output: Record<string, unknown> & { summary?: string },
): Promise<void> {
  await createAdminClient().from('steps').insert({
    duty_instance_id: dutyId,
    capability,
    input,
    output,
    at: new Date().toISOString(),
  });
}

export async function latestStep(
  dutyId: string,
  capability: string,
): Promise<Record<string, unknown> | null> {
  const { data } = await createAdminClient()
    .from('steps')
    .select('output')
    .eq('duty_instance_id', dutyId)
    .eq('capability', capability)
    .order('at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return (data?.output as Record<string, unknown> | undefined) ?? null;
}

/** Every duty's latest step of one capability, in one round trip. */
export async function latestStepsByDuty(
  dutyIds: string[],
  capability: string,
): Promise<Map<string, Record<string, unknown>>> {
  if (dutyIds.length === 0) return new Map();

  const { data } = await createAdminClient()
    .from('steps')
    .select('duty_instance_id, output, at')
    .in('duty_instance_id', dutyIds)
    .eq('capability', capability)
    .order('at', { ascending: false });

  const byDuty = new Map<string, Record<string, unknown>>();
  for (const row of data ?? []) {
    const id = row.duty_instance_id as string;
    // Ordered newest first, so the first one seen for a duty is the latest.
    if (!byDuty.has(id)) {
      byDuty.set(id, (row.output as Record<string, unknown>) ?? {});
    }
  }
  return byDuty;
}

/**
 * Hand something to a person.
 *
 * This is the only way an agent's work becomes an action: it describes what it
 * found and what it proposes, and stops. The duty goes to `blocked` so nothing
 * downstream treats it as settled, and it shows up on Catchup under whoever
 * owns that duty type.
 */
export async function raiseException(
  dutyId: string,
  exception: {
    kind: string;
    conclusion: string;
    /** How sure the agent is about its own finding, not about what to do. */
    confidence: number;
    payload?: Record<string, unknown>;
  },
): Promise<string | null> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from('exceptions')
    .insert({
      duty_instance_id: dutyId,
      kind: exception.kind,
      conclusion: exception.conclusion,
      confidence: exception.confidence,
      status: 'open',
      opened_at: new Date().toISOString(),
      payload: exception.payload ?? {},
    })
    .select('id')
    .single();

  if (error || !data) return null;

  await setDutyState(dutyId, 'blocked');
  return data.id as string;
}

/**
 * Raises something only if the same finding is not already waiting.
 *
 * A sweep runs every night. Without this, the same finding is added to the desk
 * every night until somebody acts on it, and a desk that grows on its own is a
 * desk nobody reads. The key is stored in the payload rather than matched on
 * the sentence, so rewording a conclusion does not produce a duplicate.
 *
 * Returns the exception id if one was raised, or null if it was already there.
 */
export async function raiseOnce(
  dutyId: string,
  dedupeKey: string,
  exception: {
    kind: string;
    conclusion: string;
    confidence: number;
    payload?: Record<string, unknown>;
  },
): Promise<string | null> {
  const { data } = await createAdminClient()
    .from('exceptions')
    .select('id, payload')
    .eq('duty_instance_id', dutyId)
    .eq('kind', exception.kind)
    .eq('status', 'open');

  for (const row of data ?? []) {
    const payload = (row.payload as Record<string, unknown> | null) ?? {};
    if (payload.dedupeKey === dedupeKey) return null;
  }

  return raiseException(dutyId, {
    ...exception,
    payload: { ...(exception.payload ?? {}), dedupeKey },
  });
}

/**
 * Withdraws an earlier proposal that a recomputation has replaced.
 *
 * Two open approvals for the same settlement is how somebody gets paid twice,
 * so a fresh proposal supersedes the one before it rather than queueing behind
 * it. The old row is kept and marked: it is resolved with no decision against
 * it, which is what distinguishes "withdrawn because it was recalculated" from
 * "a person decided this" — a decision always writes a row in `decisions`.
 */
export async function supersedeOpenExceptions(
  dutyId: string,
  kind: string,
  because: string,
): Promise<number> {
  const admin = createAdminClient();

  const { data } = await admin
    .from('exceptions')
    .select('id, payload')
    .eq('duty_instance_id', dutyId)
    .eq('kind', kind)
    .eq('status', 'open');

  const rows = data ?? [];
  if (rows.length === 0) return 0;

  const now = new Date().toISOString();

  for (const row of rows) {
    const payload = (row.payload as Record<string, unknown> | null) ?? {};
    await admin
      .from('exceptions')
      .update({
        status: 'resolved',
        resolved_at: now,
        payload: { ...payload, supersededAt: now, supersededBecause: because },
      })
      .eq('id', row.id as string);
  }

  return rows.length;
}

/** Whether anything on this duty is still waiting on a person. */
export async function openExceptionCount(dutyId: string): Promise<number> {
  const { count } = await createAdminClient()
    .from('exceptions')
    .select('id', { count: 'exact', head: true })
    .eq('duty_instance_id', dutyId)
    .eq('status', 'open');

  return count ?? 0;
}

export async function registerArtifact(
  artifact: {
    dutyInstanceId?: string | null;
    personId?: string | null;
    type: string;
    fileUrl?: string | null;
    source: string;
  },
): Promise<string | null> {
  const { data, error } = await createAdminClient()
    .from('artifacts')
    .insert({
      duty_instance_id: artifact.dutyInstanceId ?? null,
      person_id: artifact.personId ?? null,
      type: artifact.type,
      file_url: artifact.fileUrl ?? null,
      source: artifact.source,
      received_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error || !data) return null;
  return data.id as string;
}

export interface ArtifactRow {
  id: string;
  personId: string | null;
  type: string;
  source: string;
  receivedAt: string;
  fileUrl: string | null;
}

export async function listArtifactsFor(
  personIds: string[],
): Promise<ArtifactRow[]> {
  if (personIds.length === 0) return [];

  const { data } = await createAdminClient()
    .from('artifacts')
    .select('id, person_id, type, source, received_at, file_url')
    .in('person_id', personIds)
    .order('received_at', { ascending: false });

  return (data ?? []).map((row) => ({
    id: row.id as string,
    personId: (row.person_id as string | null) ?? null,
    type: (row.type as string) ?? 'unknown',
    source: (row.source as string) ?? 'unknown',
    receivedAt: (row.received_at as string) ?? '',
    fileUrl: (row.file_url as string | null) ?? null,
  }));
}

function toDuty(row: Record<string, unknown>): DutyRow {
  return {
    id: row.id as string,
    dutyType: row.duty_type as string,
    state: row.state as string,
    subjectPersonId: (row.subject_person_id as string | null) ?? null,
    openedAt: (row.opened_at as string) ?? '',
    dueAt: (row.due_at as string | null) ?? null,
    closedAt: (row.closed_at as string | null) ?? null,
  };
}
