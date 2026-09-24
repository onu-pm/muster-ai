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
        "I run payroll and keep the statutory side straight — attendance and leave, pay structures, tax declarations. Hansel handles hiring: CVs, offers, getting a joiner onto the books.",
        'Ask for a month to be run, ask about a person, or ask what we know. Neither of us pays anyone or files anything without you.',
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
    'Running a month, looking someone up, the roster and the hiring pipeline all still work — none of those need it.',
  );

  return lines;
}
