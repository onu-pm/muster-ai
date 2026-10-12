import type { Factsheet } from './factsheet';
import type { SmallTalk } from './fast-path';
import { pluralise } from '@/lib/copy/labels';

/**
 * Replies written by hand rather than by a model.
 *
 * Used for small talk, and whenever the day's model quota is gone. They are
 * built from the same factsheet a model would have been given, so they say
 * something true and specific rather than apologising — the facts were already
 * gathered from the database before any model was going to be asked.
 */

/** What the team could usefully do next, given what is actually on file. */
function nudge(facts: Factsheet): string {
  if (!facts.hasAttendanceSource) {
    return "Nothing's connected for me to read attendance from yet — say the word and I'll walk you through it.";
  }
  if (facts.openItems.length > 0) {
    return `${pluralise(facts.openItems.length, 'thing is', 'things are')} waiting on a decision from you whenever you have a minute.`;
  }
  if (facts.peopleWithoutStructure > 0) {
    return `${pluralise(facts.peopleWithoutStructure, 'person has', 'people have')} no salary structure on file, so they wouldn't be picked up in a run.`;
  }
  return 'Nothing needs you at the moment.';
}

export function scriptedSmallTalk(
  kind: SmallTalk,
  facts: Factsheet,
): string[] {
  switch (kind) {
    case 'greeting':
      return [`Morning, ${facts.userName}.`, nudge(facts)];
    case 'thanks':
      return ['Any time.'];
    case 'goodbye':
      return ["Right you are — I'll keep an eye on things."];
    case 'capabilities':
      return [
        'There are six of us. I run payroll and the statutory side — attendance and leave, pay structures, tax. Hansel does hiring, from a CV to a first day that works.',
        'Mira keeps the files complete and tells you what each gap actually stops. Dev looks after group cover. Sana runs reviews and shows you which ones have slipped. Noor works an exit through notice, gratuity and the final settlement.',
        'You never have to pick one of us — say what you need and whoever owns it picks it up, pulling the others in as they go. None of us pays anyone, files anything or sends anything to an insurer without you approving it first.',
      ];
  }
}

/**
 * What to say when the day's model allowance is gone.
 *
 * Still answers from the factsheet, because everything in it was read from the
 * database, not generated. Only the phrasing would have needed a model.
 */
export function scriptedWhenOutOfQuota(facts: Factsheet): string[] {
  const lines = [
    "I've used up today's allowance on the free model tier, so I can't talk things through properly until it resets.",
    `Here's where things stand though: ${facts.peopleTotal} on the roster, ${facts.confirmedRules.length === 0 ? 'no rules confirmed yet' : `${pluralise(facts.confirmedRules.length, 'rule', 'rules')} in use`}. ${nudge(facts)}`,
  ];

  lines.push(
    'Running a month, looking someone up, the roster, the hiring pipeline, what is missing from the files, who is covered, which reviews have slipped and every exit all still work — none of those need it.',
  );

  return lines;
}
