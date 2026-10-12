import 'server-only';
import { listConnections } from '@/lib/data/connections';
import { listFullPeople } from '@/lib/data/people-records';
import { createClient } from '@/lib/supabase/server';
import { auditRecords } from '@/lib/rules/records';
import { DEFAULT_BENEFIT_POLICY, eligibilityFor } from '@/lib/rules/benefits';
import { DEFAULT_REVIEW_POLICY, dueReviews } from '@/lib/rules/review-cycle';
import { listComingUp, listNeedsYou } from '@/lib/data/catchup';
import { listConfirmedRules } from '@/lib/data/rules';
import { listPeople, listDeadlines } from '@/lib/data/knowledge';
import { providerLabel } from '@/lib/catalog/providers';
import { dutyTypeLabel, ruleLabel } from '@/lib/copy/labels';

/**
 * Everything Holly actually knows, gathered deterministically.
 *
 * This is the only material the language model is given when it answers a
 * question. Every figure in it is read from the database or computed by the
 * rule code — the model's job is to put it into words, never to work anything
 * out. If a fact is not here, Holly does not know it, and the prompt tells her
 * to say so rather than fill the gap.
 */

export interface Factsheet {
  orgName: string;
  userName: string;
  peopleTotal: number;
  peopleWithStructure: number;
  peopleWithoutStructure: number;
  connectedSources: string[];
  hasAttendanceSource: boolean;
  confirmedRules: string[];
  openItems: { id: string; about: string; conclusion: string }[];
  inFlight: { what: string; state: string }[];
  schedules: { date: string; recurrence: string | null }[];
  /** Mira's, Dev's, Sana's and Noor's headline figures. */
  recordsBlocked: number;
  coverGaps: number;
  reviewsOverdue: number;
  exitsInFlight: number;
}

export async function buildFactsheet(
  orgId: string,
  orgName: string,
  userName: string,
): Promise<Factsheet> {
  const [people, connections, rules, open, comingUp, deadlines, records] =
    await Promise.all([
      listPeople(orgId),
      listConnections(orgId),
      listConfirmedRules(orgId),
      listNeedsYou(orgId),
      listComingUp(orgId),
      listDeadlines(orgId),
      listFullPeople(orgId),
    ]);

  /*
   * The other four teammates' headline figures, read the same way Holly's are.
   * Without these the model has no idea the work exists, and routes everything
   * it does not recognise to payroll. Defaults are used rather than each
   * organisation's confirmed rules: this is a count for routing, not a figure
   * anybody is paid from.
   */
  const supabase = await createClient();
  const employeeRecords = records.filter((p) => p.type === 'employee');

  const [enrolments, exits] = await Promise.all([
    supabase
      .from('duty_instances')
      .select('subject_person_id')
      .eq('org_id', orgId)
      .eq('duty_type', 'benefit_enrolment')
      .neq('state', 'closed'),
    supabase
      .from('duty_instances')
      .select('id')
      .eq('org_id', orgId)
      .eq('duty_type', 'exit')
      .neq('state', 'closed'),
  ]);

  const onCover = new Set(
    (enrolments.data ?? []).map((row) => row.subject_person_id as string),
  );

  const recordsBlocked = auditRecords(employeeRecords).blocked.length;

  const coverGaps = employeeRecords.filter(
    (person) =>
      !onCover.has(person.id) &&
      eligibilityFor(person, DEFAULT_BENEFIT_POLICY).eligible.length > 0,
  ).length;

  const reviewsOverdue = dueReviews({
    people: employeeRecords.map((p) => ({
      id: p.id,
      fullName: p.fullName,
      type: p.type,
      doj: p.doj,
      lastReviewedOn: null,
    })),
    policy: DEFAULT_REVIEW_POLICY,
  }).filter((r) => r.overdueDays > 0).length;

  const withStructure = people.filter((p) =>
    Object.values(p.salaryStructure).some((v) => Number(v) > 0),
  ).length;

  const connected = connections
    .filter((c) => c.status === 'connected')
    .map((c) => c.providerKey);

  return {
    orgName,
    userName,
    peopleTotal: people.length,
    peopleWithStructure: withStructure,
    peopleWithoutStructure: people.length - withStructure,
    connectedSources: connected.map(providerLabel),
    hasAttendanceSource: connected.some((k) =>
      ['remote_com', 'csv_import'].includes(k),
    ),
    confirmedRules: rules.map((r) => ruleLabel(r.ruleKey, r.label)),
    openItems: open.slice(0, 6).map((item) => ({
      id: item.id,
      about: item.personName ?? 'the organisation',
      conclusion: item.conclusion,
    })),
    inFlight: comingUp.slice(0, 5).map((duty) => ({
      what: dutyTypeLabel(duty.dutyType),
      state: duty.state,
    })),
    schedules: deadlines.map((d) => ({
      date: d.date,
      recurrence: d.recurrence,
    })),
    recordsBlocked,
    coverGaps,
    reviewsOverdue,
    exitsInFlight: (exits.data ?? []).length,
  };
}

/**
 * A short version, for routing rather than answering.
 *
 * Choosing which capability to run needs to know what exists, not every detail
 * of it. The full sheet made the planning call the slowest thing in the turn,
 * and nothing could be said until it returned.
 */
export function describeFactsheetBrief(facts: Factsheet): string {
  return [
    `People on the roster: ${facts.peopleTotal} (${facts.peopleWithoutStructure} without a salary structure)`,
    `Employees who cannot be paid yet because their file is short of something: ${facts.recordsBlocked}`,
    `People eligible for group cover and not on it: ${facts.coverGaps}`,
    `Reviews past their window: ${facts.reviewsOverdue}`,
    `Exits in flight: ${facts.exitsInFlight}`,
    `Can read attendance: ${facts.hasAttendanceSource ? 'yes' : 'no'}`,
    `Confirmed rules: ${facts.confirmedRules.length}`,
    `Waiting on a decision: ${facts.openItems.length}`,
    `Work in flight: ${facts.inFlight.length}`,
  ].join('\n');
}

/** Rendered for the prompt. Plain lines, so the model has nothing to parse. */
export function describeFactsheet(facts: Factsheet): string {
  const lines: string[] = [
    `Organisation: ${facts.orgName}`,
    `Person you are talking to: ${facts.userName}`,
    `People on the roster: ${facts.peopleTotal}`,
    `People with a salary structure on file: ${facts.peopleWithStructure}`,
    `People with no salary structure: ${facts.peopleWithoutStructure}`,
    `Connected data sources: ${
      facts.connectedSources.length ? facts.connectedSources.join(', ') : 'none'
    }`,
    `Can read attendance: ${facts.hasAttendanceSource ? 'yes' : 'no'}`,
    `Confirmed rules in use: ${
      facts.confirmedRules.length ? facts.confirmedRules.join('; ') : 'none'
    }`,
    `Employees who cannot be paid yet because their file is incomplete: ${facts.recordsBlocked}`,
    `People eligible for group cover who are not on it: ${facts.coverGaps}`,
    `Reviews that have gone past their window: ${facts.reviewsOverdue}`,
    `Exits being worked through: ${facts.exitsInFlight}`,
  ];

  if (facts.openItems.length) {
    lines.push('Waiting on a decision from this person:');
    for (const item of facts.openItems) {
      lines.push(`  - ${item.conclusion}`);
    }
  } else {
    lines.push('Waiting on a decision from this person: nothing');
  }

  if (facts.inFlight.length) {
    lines.push('Work in flight:');
    for (const duty of facts.inFlight) {
      lines.push(`  - ${duty.what} (${duty.state})`);
    }
  } else {
    lines.push('Work in flight: nothing');
  }

  if (facts.schedules.length) {
    lines.push('Saved schedules:');
    for (const s of facts.schedules) {
      lines.push(`  - next on ${s.date}, repeating ${s.recurrence ?? 'once'}`);
    }
  } else {
    lines.push('Saved schedules: none');
  }

  return lines.join('\n');
}
