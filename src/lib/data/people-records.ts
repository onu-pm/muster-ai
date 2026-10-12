import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { PersonRecord } from '@/lib/rules/records';

/**
 * The whole of a person's file, not just the parts payroll needs.
 *
 * `listPeople` selects the handful of columns the payroll path uses. Records,
 * benefits and exits need the statutory identifiers as well, so they read
 * through here instead of widening that select for everyone.
 *
 * Two entry points on purpose. The chat reads through the signed-in user's own
 * client, so RLS decides what comes back. The scheduled runner has no user, so
 * it reads with the service role and must pass the organisation explicitly —
 * which is why the org id is a required argument and never inferred.
 */

const COLUMNS =
  'id, full_name, type, pan, uan, esic_no, bank_account, bank_ifsc, doj, doe, entity_id, location_id, salary_structure, tax_regime';

export interface FullPerson extends PersonRecord {
  doe: string | null;
  taxRegime: string | null;
  salaryStructure: Record<string, number>;
  /** Basic and dearness allowance only — what gratuity and encashment use. */
  basicAndDa: number;
}

function toPerson(row: Record<string, unknown>): FullPerson {
  const structure =
    (row.salary_structure as Record<string, number> | null) ?? {};

  const monthlyGross = Object.values(structure).reduce(
    (sum, value) => sum + (Number(value) || 0),
    0,
  );

  // Gratuity and leave encashment run on basic and dearness allowance, not on
  // gross. Anything else in the structure is excluded by statute.
  const basicAndDa =
    (Number(structure.basic) || 0) +
    (Number(structure.da) || 0) +
    (Number(structure.dearnessAllowance) || 0);

  return {
    id: row.id as string,
    fullName: (row.full_name as string) ?? 'Unnamed',
    type: (row.type as string) ?? 'employee',
    pan: (row.pan as string | null) ?? null,
    uan: (row.uan as string | null) ?? null,
    esicNo: (row.esic_no as string | null) ?? null,
    bankAccount: (row.bank_account as string | null) ?? null,
    bankIfsc: (row.bank_ifsc as string | null) ?? null,
    doj: (row.doj as string | null) ?? null,
    doe: (row.doe as string | null) ?? null,
    entityId: (row.entity_id as string | null) ?? null,
    locationId: (row.location_id as string | null) ?? null,
    taxRegime: (row.tax_regime as string | null) ?? null,
    salaryStructure: structure,
    monthlyGross,
    basicAndDa,
  };
}

export async function listFullPeople(orgId: string): Promise<FullPerson[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('people')
    .select(COLUMNS)
    .eq('org_id', orgId)
    .order('full_name', { ascending: true });

  if (error || !data) return [];
  return data.map((row) => toPerson(row as Record<string, unknown>));
}

/** For the scheduled runner, which has no signed-in user to scope by. */
export async function listFullPeopleAsService(
  orgId: string,
): Promise<FullPerson[]> {
  const { data, error } = await createAdminClient()
    .from('people')
    .select(COLUMNS)
    .eq('org_id', orgId)
    .order('full_name', { ascending: true });

  if (error || !data) return [];
  return data.map((row) => toPerson(row as Record<string, unknown>));
}

/**
 * Finds the person somebody meant.
 *
 * Exact match wins over a partial one, so "Rahul" does not land on "Rahul
 * Menon" when there is also a plain "Rahul". An ambiguous name returns every
 * match, because picking one for somebody would be guessing at whose pay or
 * whose exit this is.
 */
export function matchPeople<T extends { fullName: string }>(
  people: T[],
  name: string,
): T[] {
  const wanted = name.trim().toLowerCase();
  if (!wanted) return [];

  const exact = people.filter((p) => p.fullName.toLowerCase() === wanted);
  if (exact.length > 0) return exact;

  const startsWith = people.filter((p) =>
    p.fullName.toLowerCase().startsWith(wanted),
  );
  if (startsWith.length > 0) return startsWith;

  return people.filter((p) => p.fullName.toLowerCase().includes(wanted));
}

export interface OutstandingLoan {
  kind: string;
  outstanding: number;
  installmentAmount: number;
}

export async function outstandingLoansFor(
  orgId: string,
  personId: string,
): Promise<OutstandingLoan[]> {
  const { data } = await createAdminClient()
    .from('loans')
    .select('kind, outstanding, installment_amount, status')
    .eq('org_id', orgId)
    .eq('person_id', personId)
    .eq('status', 'active');

  return (data ?? [])
    .map((row) => ({
      kind: (row.kind as string) ?? 'loan',
      outstanding: Number(row.outstanding ?? 0),
      installmentAmount: Number(row.installment_amount ?? 0),
    }))
    .filter((loan) => loan.outstanding > 0);
}
