import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { getCredentials } from '@/lib/data/connections';
import {
  attendanceFromLeave,
  fetchEmployments,
  fetchLeaveDays,
  RemoteConnectorError,
  type RemoteEmployment,
} from '@/lib/connectors/remote';
import {
  daysInMonth,
  reconcileLop,
  type AttendanceRecord,
  type LeaveDay,
  type LopLine,
} from '@/lib/rules/lop';

/**
 * Input — attendance and leave.
 *
 * Produces one loss-of-pay figure per person and raises an exception for
 * anything it cannot explain. The figures come from `src/lib/rules/lop.ts`;
 * this file only gathers data, consults confirmed facts, and records what it
 * found. Nothing here is auto-applied to pay.
 */

export interface InputRunResult {
  ok: boolean;
  error?: string;
  dutyInstanceId?: string;
  peopleCount: number;
  lines: LopLine[];
  raised: number;
  explainedByFact: number;
  source: 'remote_com' | 'csv_import' | null;
  /** False when only one record was available, so nothing could be compared. */
  crossChecked: boolean;
}

interface GatherResult {
  attendance: AttendanceRecord[];
  leave: LeaveDay[];
  source: 'remote_com' | 'csv_import';
  /**
   * Whether attendance and leave came from genuinely different records.
   *
   * Remote holds time off, not attendance, so days present are derived from the
   * same rows the leave figures come from. That derivation can never disagree
   * with itself, so a clean reconciliation over one source means "nothing to
   * compare", not "everything checks out" — and must not be reported as the
   * latter.
   */
  crossChecked: boolean;
}

export async function gatherFromRemote(
  orgId: string,
  year: number,
  month: number,
): Promise<GatherResult | null> {
  const credentials = await getCredentials(orgId, 'remote_com');
  const token = credentials?.token;
  if (!token) return null;

  const [people, leave] = await Promise.all([
    fetchEmployments(token),
    fetchLeaveDays(token, year, month),
  ]);

  await syncRoster(orgId, people);

  return {
    attendance: attendanceFromLeave(people, leave, year, month),
    leave,
    source: 'remote_com',
    crossChecked: false,
  };
}

/** Remote's employment types that sit on payroll. Contractors do not. */
const PAYROLL_TYPES = new Set([
  'employee',
  'direct_employee',
  'global_payroll_employee',
]);

/**
 * Brings the roster into `people` so the rest of Holly's work has someone to
 * act on. Matched on name, since Remote's employment id is not stored on the
 * row; an existing person is left untouched rather than overwritten, so a
 * salary structure entered here is never clobbered by a sync.
 */
async function syncRoster(
  orgId: string,
  employments: RemoteEmployment[],
): Promise<void> {
  const onPayroll = employments.filter((e) => PAYROLL_TYPES.has(e.type));
  if (onPayroll.length === 0) return;

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from('people')
    .select('full_name')
    .eq('org_id', orgId);

  const known = new Set(
    (existing ?? []).map((row) => String(row.full_name ?? '').toLowerCase()),
  );

  const toAdd = onPayroll.filter(
    (e) => !known.has(e.fullName.trim().toLowerCase()),
  );
  if (toAdd.length === 0) return;

  await admin.from('people').insert(
    toAdd.map((e) => ({
      org_id: orgId,
      type: 'employee',
      full_name: e.fullName,
      // Remote does not expose compensation on this endpoint, so the structure
      // is left empty rather than invented. Structure and Tax skip anyone
      // without one and say so.
      salary_structure: {},
    })),
  );
}

/**
 * Runs the month's reconciliation and puts anything unexplained on the desk.
 *
 * `attendance`/`leave` may be supplied directly (a spreadsheet import); when
 * they are not, the connected source is read.
 */
export async function runInput(
  orgId: string,
  year: number,
  month: number,
  supplied?: GatherResult,
): Promise<InputRunResult> {
  const empty: InputRunResult = {
    ok: false,
    peopleCount: 0,
    lines: [],
    raised: 0,
    explainedByFact: 0,
    source: null,
    crossChecked: false,
  };

  let gathered: GatherResult | null = supplied ?? null;

  if (!gathered) {
    try {
      gathered = await gatherFromRemote(orgId, year, month);
    } catch (error) {
      return {
        ...empty,
        error:
          error instanceof RemoteConnectorError
            ? error.message
            : 'Could not read from the connected source.',
      };
    }
  }

  if (!gathered) {
    return {
      ...empty,
      error:
        'Nothing is connected that has attendance in it. Connect Remote.com or upload a sheet.',
    };
  }

  const lines = reconcileLop(gathered.attendance, gathered.leave);
  const admin = createAdminClient();
  const now = new Date().toISOString();

  // Confirmed facts can explain a discrepancy that would otherwise be raised.
  const { data: factRows } = await admin
    .from('facts')
    .select('statement')
    .eq('org_id', orgId)
    .eq('confirmed', true);

  const facts = (factRows ?? []).map((f) => String(f.statement ?? ''));

  const needsReview = lines.filter((line) => line.needsReview);
  const stillUnexplained = needsReview.filter(
    (line) => !factExplains(facts, line.personName),
  );
  const explainedByFact = needsReview.length - stillUnexplained.length;

  const { data: duty, error: dutyError } = await admin
    .from('duty_instances')
    .insert({
      org_id: orgId,
      duty_type: 'payroll_input_pack',
      state: stillUnexplained.length > 0 ? 'blocked' : 'closed',
      opened_at: now,
      closed_at: stillUnexplained.length > 0 ? null : now,
    })
    .select('id')
    .single();

  if (dutyError || !duty) {
    return { ...empty, error: dutyError?.message ?? 'Could not start the run.' };
  }

  await admin.from('steps').insert({
    duty_instance_id: duty.id,
    capability: 'reconcile',
    input: {
      period: `${year}-${String(month).padStart(2, '0')}`,
      source: gathered.source,
      peopleCount: lines.length,
      daysInMonth: daysInMonth(year, month),
      crossChecked: gathered.crossChecked,
    },
    output: {
      summary: gathered.crossChecked
        ? `Checked attendance against leave for ${lines.length} ${
            lines.length === 1 ? 'person' : 'people'
          }. ${stillUnexplained.length} could not be explained.`
        : `Read leave for ${lines.length} ${
            lines.length === 1 ? 'person' : 'people'
          } from one source, so there was no second record to check it against.`,
      lines: lines.map((line) => ({
        person: line.personName,
        lopDays: line.lopDays,
        unexplainedDays: line.unexplainedDays,
      })),
    },
    at: now,
  });

  if (stillUnexplained.length > 0) {
    await admin.from('exceptions').insert(
      stillUnexplained.map((line) => ({
        duty_instance_id: duty.id,
        kind: 'lop_discrepancy',
        conclusion: `${line.personName}: ${line.unexplainedDays} ${
          line.unexplainedDays === 1 ? 'day' : 'days'
        } between attendance and leave records that nothing on file explains.`,
        // Deliberately low: an unexplained gap is exactly what Holly is unsure about.
        confidence: 0.35,
        status: 'open',
        opened_at: now,
        payload: {
          personName: line.personName,
          personRef: line.personRef,
          period: `${year}-${String(month).padStart(2, '0')}`,
          evidence: {
            daysInMonth: line.daysInMonth,
            daysPresent: line.daysPresent,
            paidLeaveDays: line.paidLeaveDays,
            unpaidLeaveDays: line.unpaidLeaveDays,
            unexplainedDays: line.unexplainedDays,
          },
          proposedLopDays: line.lopDays,
          source: gathered.source,
          ruleApplied:
            'Loss of pay is only applied when attendance and the leave ledger agree.',
        },
      })),
    );
  }

  return {
    ok: true,
    dutyInstanceId: duty.id as string,
    peopleCount: lines.length,
    lines,
    raised: stillUnexplained.length,
    explainedByFact,
    source: gathered.source,
    crossChecked: gathered.crossChecked,
  };
}

/**
 * Whether a confirmed fact names this person.
 *
 * Deliberately a name match and nothing cleverer: a fact that merely mentions
 * someone is treated as a reason to look, and the exception is only suppressed
 * because a person already confirmed that fact. No model decides this.
 */
function factExplains(facts: string[], personName: string): boolean {
  const first = personName.trim().split(/\s+/)[0]?.toLowerCase();
  if (!first || first.length < 3) return false;
  return facts.some((statement) => statement.toLowerCase().includes(first));
}
