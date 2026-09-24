import 'server-only';
import { listConnections } from '@/lib/data/connections';
import { listComingUp, listNeedsYou } from '@/lib/data/catchup';
import { getProvider } from '@/lib/catalog/providers';
import { runInput } from './input';
import { runStructure } from './structure';
import { runTax } from './tax';
import type { ConversationState, ThreadMessage } from './conversation';
import type { PayrollIntent, SchedulePayrollIntent } from './intent';
import { dutyTypeLabel, pluralise } from '@/lib/copy/labels';

/**
 * The turns that run without a model in the loop.
 *
 * Each takes a `say` so it can report as it goes: a payroll run takes half a
 * minute, and the person should watch it happen rather than stare at a spinner.
 */

export type Say = (
  from: string,
  body: string,
  action?: ThreadMessage['action'],
) => void;

const ATTENDANCE_SOURCES = ['remote_com', 'csv_import'];
const INLINE_DECISION_LIMIT = 3;

/** Asks for a data source without sending anyone to the Marketplace. */
export function askForConnection(say: Say, periodLabel: string): void {
  const remote = getProvider('remote_com');
  say(
    'Holly',
    `Before I can start on ${periodLabel}, I need somewhere to read attendance and leave from. Paste a Remote.com token and I'll carry on from here.`,
    {
      kind: 'connect',
      providerKey: 'remote_com',
      label: remote?.label ?? 'Remote.com',
      fields: remote?.fields ?? [],
      alternatives: [
        { providerKey: 'csv_import', label: 'I keep it in a spreadsheet' },
      ],
    },
  );
}

/** Brings open findings to the person, inline, one at a time. */
export async function offerDecisions(
  orgId: string,
  say: Say,
  lead: string,
): Promise<number> {
  const open = await listNeedsYou(orgId);
  if (open.length === 0) return 0;

  say('Holly', lead);

  for (const item of open.slice(0, INLINE_DECISION_LIMIT)) {
    say('Holly', item.conclusion, {
      kind: 'decide',
      exceptionId: item.id,
      about: item.personName ?? 'this',
    });
  }

  if (open.length > INLINE_DECISION_LIMIT) {
    say(
      'Holly',
      `There are ${open.length - INLINE_DECISION_LIMIT} more like this. We can work through them here, or you can look at the whole list.`,
      { kind: 'link', href: '/catchup', label: 'See the full list' },
    );
  }

  return open.length;
}

export async function executePayroll(
  orgId: string,
  period: { month: number; year: number; label: string },
  say: Say,
): Promise<void> {
  const input = await runInput(orgId, period.year, period.month);

  if (!input.ok) {
    say('Holly', input.error ?? "I couldn't read the attendance data just now.");
    return;
  }

  say(
    'Holly',
    input.crossChecked
      ? `Checked attendance against leave for ${pluralise(input.peopleCount, 'person', 'people')}.` +
          (input.explainedByFact > 0
            ? ` ${pluralise(input.explainedByFact, 'gap was', 'gaps were')} explained by what you've already told me.`
            : '')
      : `Read leave for ${pluralise(input.peopleCount, 'person', 'people')} from Remote. That's my only record of the month, so there's nothing to cross-check it against yet.`,
  );

  if (input.dutyInstanceId) {
    const [structure, tax] = await Promise.all([
      runStructure(orgId, input.dutyInstanceId),
      runTax(orgId, input.dutyInstanceId),
    ]);

    if (structure.checked > 0) {
      say(
        'Holly',
        (structure.breaches > 0
          ? `${pluralise(structure.breaches, 'person is', 'people are')} below the statutory half on basic pay. I haven't changed anyone's split.`
          : `Pay structures all pass the 50% wage test${structure.usedConfirmedRule ? ', using your own wage definition' : ''}.`) +
          (structure.withoutStructure > 0
            ? ` ${pluralise(structure.withoutStructure, 'person has', 'people have')} no salary structure on record, so I couldn't test them either way.`
            : ''),
      );
    } else if (structure.withoutStructure > 0) {
      say(
        'Holly',
        `I have ${pluralise(structure.withoutStructure, 'person', 'people')} on the roster but no salary structure for any of them, so there's nothing to pay yet.`,
      );
    }

    if (tax.projected > 0) {
      say(
        'Holly',
        `Projected this month's tax for ${pluralise(tax.projected, 'person', 'people')}.` +
          (tax.trimmedClaims > 0
            ? ` ${pluralise(tax.trimmedClaims, 'claim was', 'claims were')} above the cap, so I allowed the cap only.`
            : ''),
      );
    }
  }

  const open = await offerDecisions(
    orgId,
    say,
    "Let's deal with what's left here.",
  );

  if (open === 0) {
    say(
      'Holly',
      "Nothing needs a decision from you. I'll come back if that changes.",
    );
  }
}

export async function runPayrollTurn(
  orgId: string,
  intent: PayrollIntent,
  state: ConversationState,
  say: Say,
): Promise<void> {
  const period = {
    month: intent.month,
    year: intent.year,
    label: intent.periodLabel,
  };

  state.intent = 'run_payroll';
  state.period = period;

  const connections = await listConnections(orgId);
  const hasAttendance = connections.some(
    (c) => c.status === 'connected' && ATTENDANCE_SOURCES.includes(c.providerKey),
  );

  if (!hasAttendance) {
    state.awaiting = 'connection';
    say('Holly', `Right — ${period.label} payroll.`);
    askForConnection(say, period.label);
    return;
  }

  state.awaiting = null;
  say('Holly', `On it — ${period.label} payroll.`);
  await executePayroll(orgId, period, say);
}

export function scheduleTurn(
  intent: SchedulePayrollIntent,
  state: ConversationState,
  say: Say,
): void {
  state.intent = 'schedule_payroll';
  state.scheduleDay = intent.day;
  state.recurrence = intent.recurrence;
  state.awaiting = 'schedule';

  say(
    'Holly',
    `I can run payroll on ${intent.cadenceLabel} without you having to ask. I'd gather attendance, work out pay and tax, and hold anything I'm unsure about for you rather than acting on it.`,
  );

  say(
    'Holly',
    'That runs when you may not be here, so I need your say-so before I set it up.',
    {
      kind: 'authorise',
      summary: `Run payroll on ${intent.cadenceLabel}, and bring anything uncertain to you`,
    },
  );
}

export async function statusTurn(orgId: string, say: Say): Promise<void> {
  const [needsYou, comingUp] = await Promise.all([
    listNeedsYou(orgId),
    listComingUp(orgId),
  ]);

  if (needsYou.length === 0 && comingUp.length === 0) {
    say('Holly', 'Nothing needs you and nothing is in flight. All quiet.');
    return;
  }

  if (comingUp.length > 0) {
    say(
      'Holly',
      `${pluralise(comingUp.length, 'job is', 'jobs are')} in flight, including ${dutyTypeLabel(comingUp[0].dutyType).toLowerCase()}.`,
    );
  }

  if (needsYou.length > 0) {
    await offerDecisions(orgId, say, "Here's what's waiting on you.");
  }
}
