import { createClient } from '@/lib/supabase/server';
import { listTeammates } from './team';
import { listComingUp, listNeedsYou, type CatchupItem } from './catchup';
import { listPeople } from './knowledge';
import { dutyTypeLabel, pluralise, relativeDay } from '@/lib/copy/labels';

/**
 * Catchup as a standup.
 *
 * Each teammate reports their own: what they did, what they need from you, and
 * what is next. The old flat list could not say who was speaking, which made a
 * two-person team read like one anonymous queue.
 */

export interface TeammateStandup {
  key: string;
  name: string;
  initial: string;
  role: string;
  /** What they've been doing. */
  did: string[];
  /** Things that need a decision, each actionable in place. */
  needsYou: CatchupItem[];
  /** What they'll pick up next. */
  next: string[];
  /** Nothing to report at all. */
  quiet: boolean;
}

export interface Standup {
  teammates: TeammateStandup[];
  totalNeedsYou: number;
}

/** Which duty types belong to whom. */
const OWNERSHIP: Record<string, string> = {
  payroll_input_pack: 'holly',
  salary_structure_review: 'holly',
  tax_declaration_review: 'holly',
  rules_setup: 'holly',
  hiring_screen: 'hansel',
  hiring_offer: 'hansel',
  hiring_onboard: 'hansel',
};

function ownerOf(dutyType: string | null): string {
  return dutyType ? (OWNERSHIP[dutyType] ?? 'holly') : 'holly';
}

export async function buildStandup(orgId: string): Promise<Standup> {
  const [teammates, needsYou, comingUp, people] = await Promise.all([
    listTeammates(orgId),
    listNeedsYou(orgId),
    listComingUp(orgId),
    listPeople(orgId),
  ]);

  const active = teammates.filter((t) => t.active);
  const supabase = await createClient();

  // What each teammate has actually done recently.
  const { data: steps } = await supabase
    .from('steps')
    .select('capability, output, at, duty_instances!inner ( org_id, duty_type )')
    .eq('duty_instances.org_id', orgId)
    .order('at', { ascending: false })
    .limit(30);

  const recent = (steps ?? []) as unknown as {
    output: Record<string, unknown>;
    at: string;
    duty_instances: { duty_type: string } | { duty_type: string }[];
  }[];

  const candidates = people.filter((p) => p.type === 'candidate');
  const employees = people.filter((p) => p.type === 'employee');
  const withoutStructure = employees.filter(
    (p) => !Object.values(p.salaryStructure).some((v) => Number(v) > 0),
  );

  const report: TeammateStandup[] = active.map((mate) => {
    const did: string[] = [];
    const next: string[] = [];

    for (const step of recent) {
      const duty = Array.isArray(step.duty_instances)
        ? step.duty_instances[0]
        : step.duty_instances;
      if (ownerOf(duty?.duty_type ?? null) !== mate.key) continue;

      const summary = step.output?.summary;
      if (typeof summary === 'string' && summary && did.length < 3) {
        did.push(summary);
      }
    }

    const theirs = needsYou.filter(
      (item) => ownerOf(item.dutyType) === mate.key,
    );

    for (const duty of comingUp) {
      if (ownerOf(duty.dutyType) !== mate.key) continue;
      if (next.length >= 2) break;
      next.push(
        `${dutyTypeLabel(duty.dutyType)}${
          duty.dueAt ? ` — due ${relativeDay(duty.dueAt).toLowerCase()}` : ''
        }`,
      );
    }

    // A teammate with nothing recorded still has something honest to say.
    if (mate.key === 'holly' && next.length === 0) {
      if (withoutStructure.length > 0) {
        next.push(
          `Waiting on salary structures for ${pluralise(withoutStructure.length, 'person', 'people')} before anyone can be paid`,
        );
      }
    }

    if (mate.key === 'hansel' && next.length === 0) {
      next.push(
        candidates.length > 0
          ? `${pluralise(candidates.length, 'candidate', 'candidates')} in the pipeline to move along`
          : 'Nothing in the pipeline — paste a CV and I&rsquo;ll start one',
      );
    }

    return {
      key: mate.key,
      name: mate.name,
      initial: mate.initial,
      role: mate.role,
      did,
      needsYou: theirs,
      next,
      quiet: did.length === 0 && theirs.length === 0 && next.length === 0,
    };
  });

  return { teammates: report, totalNeedsYou: needsYou.length };
}
