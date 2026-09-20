import 'server-only';
import { listConnections } from '@/lib/data/connections';
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
}

export async function buildFactsheet(
  orgId: string,
  orgName: string,
  userName: string,
): Promise<Factsheet> {
  const [people, connections, rules, open, comingUp, deadlines] =
    await Promise.all([
      listPeople(orgId),
      listConnections(orgId),
      listConfirmedRules(orgId),
      listNeedsYou(orgId),
      listComingUp(orgId),
      listDeadlines(orgId),
    ]);

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
  };
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
