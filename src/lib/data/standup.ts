import { createClient } from '@/lib/supabase/server';
import { listFullPeople } from './people-records';
import { getConfirmedRule } from './rules';
import { auditRecords } from '@/lib/rules/records';
import {
  DEFAULT_BENEFIT_POLICY,
  eligibilityFor,
} from '@/lib/rules/benefits';
import { dueReviews, reviewPolicyFrom } from '@/lib/rules/review-cycle';
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
  records_audit: 'mira',
  benefit_enrolment: 'dev',
  benefits_review: 'dev',
  review_cycle: 'sana',
  performance_review: 'sana',
  exit: 'noor',
  final_settlement: 'noor',
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

  /*
   * What the newer teammates would say if asked. Read here rather than in each
   * capability, so a standup is one pass over the data and not six.
   */
  const [records, reviews, covered, exits] = await Promise.all([
    listFullPeople(orgId),
    getConfirmedRule(orgId, 'review_policy'),
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
    (covered.data ?? []).map((row) => row.subject_person_id as string),
  );

  const employeeRecords = records.filter((p) => p.type === 'employee');
  const recordGaps = auditRecords(employeeRecords).blocked;
  const benefitPolicy = DEFAULT_BENEFIT_POLICY;
  const uncovered = employeeRecords.filter(
    (person) =>
      !onCover.has(person.id) &&
      eligibilityFor(person, benefitPolicy).eligible.length > 0,
  );
  const exitsInFlight = (exits.data ?? []).length;
  const undated = employeeRecords.filter((p) => !p.doj).length;

  const reviewsDue = dueReviews({
    people: employeeRecords.map((p) => ({
      id: p.id,
      fullName: p.fullName,
      type: p.type,
      doj: p.doj,
      // A review recorded against them closes its own duty, which the
      // capability reads properly. Here the question is only "is one due".
      lastReviewedOn: null,
    })),
    policy: reviewPolicyFrom(reviews?.definition),
  });

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

    /*
     * A teammate with no duty rows yet still has something true to say, worked
     * out from what is actually on file. Standing mute reads as broken, and
     * inventing activity would be worse — so each line below is computed.
     */
    if (next.length === 0) {
      const line = fallbackNext(mate.key, {
        withoutStructure: withoutStructure.length,
        candidates: candidates.length,
        employees: employees.length,
        recordGaps: recordGaps.length,
        reviewsDue: reviewsDue.length,
        uncovered: uncovered.length,
        exitsInFlight: exitsInFlight,
        undated: undated,
      });
      if (line) next.push(line);
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

/**
 * What a teammate says when no duty row has their name on it yet.
 *
 * Every line is read off what is actually on file. A teammate with nothing to
 * report says so plainly rather than inventing activity to look busy.
 */
function fallbackNext(
  key: string,
  facts: {
    withoutStructure: number;
    candidates: number;
    employees: number;
    recordGaps: number;
    reviewsDue: number;
    uncovered: number;
    exitsInFlight: number;
    undated: number;
  },
): string | null {
  switch (key) {
    case 'holly':
      return facts.withoutStructure > 0
        ? `Waiting on salary structures for ${pluralise(facts.withoutStructure, 'person', 'people')} before anyone can be paid`
        : 'Nothing in flight — next month when you want it';

    case 'hansel':
      return facts.candidates > 0
        ? `${pluralise(facts.candidates, 'candidate', 'candidates')} in the pipeline to move along`
        : 'Nothing in the pipeline — paste a CV and I will start one';

    case 'mira':
      if (facts.employees === 0) return 'No files to go through yet';
      return facts.recordGaps > 0
        ? `${pluralise(facts.recordGaps, 'file', 'files')} short of something that stops them being paid`
        : 'Every file is complete enough to pay from';

    case 'dev':
      if (facts.employees === 0) return 'Nobody to cover yet';
      return facts.uncovered > 0
        ? `${pluralise(facts.uncovered, 'person', 'people')} eligible for cover and not on it`
        : 'Everyone eligible is on the cover';

    case 'sana':
      if (facts.employees === 0) return 'Nobody to review yet';
      // A cycle counts from the joining date. Without one, "no reviews due" is
      // a lie dressed as good news.
      if (facts.undated === facts.employees) {
        return 'No joining dates on file, so I cannot say who is due';
      }
      return facts.reviewsDue > 0
        ? `${pluralise(facts.reviewsDue, 'review is', 'reviews are')} due`
        : 'No reviews due';

    case 'noor':
      return facts.exitsInFlight > 0
        ? `${pluralise(facts.exitsInFlight, 'exit', 'exits')} to work through`
        : 'No exits in flight';

    default:
      return null;
  }
}
