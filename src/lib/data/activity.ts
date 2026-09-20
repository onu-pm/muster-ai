import { createClient } from '@/lib/supabase/server';

/**
 * Reverse-chronological record of what Holly did and what you decided.
 *
 * `steps` are her work; `decisions` are yours. Both hang off a duty instance,
 * which is where the organisation and subject person live.
 */

export interface ActivityEntry {
  id: string;
  at: string;
  kind: 'step' | 'decision';
  /** Plain-language line describing what happened. */
  summary: string;
  personName: string | null;
  dutyType: string | null;
  /** `capability` for a step, `outcome` for a decision. */
  raw: string;
  note: string | null;
}

const one = <T>(v: T | T[] | null | undefined): T | null =>
  Array.isArray(v) ? (v[0] ?? null) : (v ?? null);

interface DutyRef {
  org_id: string;
  duty_type: string;
  subject_person_id: string | null;
  people: { full_name: string } | { full_name: string }[] | null;
}

function personFrom(
  duty: DutyRef | null,
  payload?: Record<string, unknown> | null,
): string | null {
  const fromPayload = payload?.personName;
  if (typeof fromPayload === 'string') return fromPayload;
  const p = duty ? one(duty.people) : null;
  return p?.full_name ?? null;
}

export async function listActivity(
  orgId: string,
  limit = 200,
): Promise<ActivityEntry[]> {
  const supabase = await createClient();

  const [stepsRes, decisionsRes] = await Promise.all([
    supabase
      .from('steps')
      .select(
        `id, capability, input, output, at,
         duty_instances!inner ( org_id, duty_type, subject_person_id,
           people:subject_person_id ( full_name ) )`,
      )
      .eq('duty_instances.org_id', orgId)
      .order('at', { ascending: false })
      .limit(limit),
    supabase
      .from('decisions')
      .select(
        `id, outcome, correction_note, at,
         exceptions!inner ( kind, conclusion, payload,
           duty_instances!inner ( org_id, duty_type, subject_person_id,
             people:subject_person_id ( full_name ) ) )`,
      )
      .order('at', { ascending: false })
      .limit(limit),
  ]);

  const entries: ActivityEntry[] = [];

  for (const row of (stepsRes.data ?? []) as unknown as (Record<
    string,
    unknown
  > & { duty_instances: DutyRef | DutyRef[] })[]) {
    const duty = one(row.duty_instances);
    const output = (row.output as Record<string, unknown>) ?? {};
    entries.push({
      id: `step-${String(row.id)}`,
      at: String(row.at ?? ''),
      kind: 'step',
      summary:
        typeof output.summary === 'string'
          ? output.summary
          : typeof output.conclusion === 'string'
            ? output.conclusion
            : '',
      personName: personFrom(duty, output),
      dutyType: duty?.duty_type ?? null,
      raw: String(row.capability ?? ''),
      note: null,
    });
  }

  for (const row of (decisionsRes.data ?? []) as unknown as Record<
    string,
    unknown
  >[]) {
    const exception = one(
      row.exceptions as Record<string, unknown> | Record<string, unknown>[],
    );
    const duty = exception
      ? one(exception.duty_instances as DutyRef | DutyRef[])
      : null;

    // decisions has no org column of its own; drop anything outside this org.
    if (!duty || duty.org_id !== orgId) continue;

    entries.push({
      id: `decision-${String(row.id)}`,
      at: String(row.at ?? ''),
      kind: 'decision',
      summary:
        typeof exception?.conclusion === 'string' ? exception.conclusion : '',
      personName: personFrom(
        duty,
        (exception?.payload as Record<string, unknown>) ?? null,
      ),
      dutyType: duty.duty_type,
      raw: String(row.outcome ?? ''),
      note: (row.correction_note as string | null) ?? null,
    });
  }

  return entries.sort((a, b) => b.at.localeCompare(a.at));
}
