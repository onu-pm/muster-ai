import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { listPeople, listFacts } from '@/lib/data/knowledge';
import { listConfirmedRules } from '@/lib/data/rules';
import { buildStandup } from '@/lib/data/standup';
import { register } from './registry';
import { MONTHS } from './intent';
import { formatMoney, pluralise, ruleLabel } from '@/lib/copy/labels';

/**
 * Questions people actually ask.
 *
 * These read from the database and answer in full sentences. They exist so a
 * question gets a real answer rather than a model's impression of one — every
 * figure below is read, not generated.
 */

const HOLLY = 'Holly';
const HANSEL = 'Hansel';

/** "attendance of August" -> 8. Deterministic; no model reads the period. */
export function readMonth(text: string): { month: number; label: string } | null {
  const lower = text.toLowerCase();
  const index = MONTHS.findIndex((m) => lower.includes(m));
  if (index === -1) return null;
  return {
    month: index + 1,
    label: MONTHS[index].replace(/^./, (c) => c.toUpperCase()),
  };
}

register({
  key: 'payroll.attendance_summary',
  teammate: HOLLY,
  describe: 'what attendance and leave look like for a month',
  async run(ctx, input) {
    const asked = String(input.month ?? input.period ?? '');
    const period = readMonth(asked) ?? readMonth(String(input.text ?? ''));

    const admin = createAdminClient();
    const { data } = await admin
      .from('steps')
      .select('input, output, at, duty_instances!inner ( org_id )')
      .eq('duty_instances.org_id', ctx.orgId)
      .eq('capability', 'reconcile')
      .order('at', { ascending: false })
      .limit(20);

    const runs = (data ?? []) as unknown as {
      input: Record<string, unknown>;
      output: Record<string, unknown>;
      at: string;
    }[];

    const wanted = period
      ? runs.find((r) =>
          String(r.input?.period ?? '').endsWith(
            `-${String(period.month).padStart(2, '0')}`,
          ),
        )
      : runs[0];

    if (!wanted) {
      return {
        ok: true,
        messages: [
          {
            from: HOLLY,
            body: period
              ? `I haven't gathered attendance for ${period.label} yet. Say the word and I'll pull it now.`
              : "I haven't gathered attendance for any month yet.",
          },
        ],
        data: { found: false },
      };
    }

    const count = Number(wanted.input?.peopleCount ?? 0);
    const crossChecked = Boolean(wanted.input?.crossChecked);
    const lines = Array.isArray(wanted.output?.lines)
      ? (wanted.output.lines as { person: string; lopDays: number }[])
      : [];

    const withLop = lines.filter((l) => Number(l.lopDays) > 0);

    const messages = [
      {
        from: HOLLY,
        body: `For ${period?.label ?? 'the last month I ran'} I have ${pluralise(count, 'person', 'people')} on record.`,
      },
      {
        from: HOLLY,
        body:
          withLop.length === 0
            ? 'Nobody has loss of pay against them.'
            : `${pluralise(withLop.length, 'person has', 'people have')} loss of pay: ${withLop
                .slice(0, 5)
                .map((l) => `${l.person} (${l.lopDays}d)`)
                .join(', ')}.`,
      },
    ];

    if (!crossChecked) {
      messages.push({
        from: HOLLY,
        body: 'That came from one source, so treat it as leave records rather than verified attendance.',
      });
    }

    return { ok: true, messages, data: { peopleCount: count } };
  },
});

register({
  key: 'payroll.roster',
  teammate: HOLLY,
  describe: 'who is on the payroll and what they are paid',
  async run(ctx) {
    const people = await listPeople(ctx.orgId);
    const employees = people.filter((p) => p.type === 'employee');
    const paid = employees.filter((p) =>
      Object.values(p.salaryStructure).some((v) => Number(v) > 0),
    );

    const total = paid.reduce(
      (sum, p) =>
        sum +
        Object.values(p.salaryStructure).reduce(
          (s, v) => s + (Number(v) || 0),
          0,
        ),
      0,
    );

    const messages = [
      {
        from: HOLLY,
        body: `${pluralise(employees.length, 'person is', 'people are')} on the roster as employees.`,
      },
    ];

    messages.push({
      from: HOLLY,
      body:
        paid.length === 0
          ? "None of them have a salary structure on file, so nothing would go out in a run."
          : `${pluralise(paid.length, 'has', 'have')} a structure on file, ${formatMoney(total)} a month between them.`,
    });

    return {
      ok: true,
      messages,
      data: { employees: employees.length, payable: paid.length },
    };
  },
});

register({
  key: 'payroll.what_i_know',
  teammate: HOLLY,
  describe: 'the rules and facts payroll is working from',
  async run(ctx) {
    const [rules, facts] = await Promise.all([
      listConfirmedRules(ctx.orgId),
      listFacts(ctx.orgId),
    ]);

    const messages = [
      {
        from: HOLLY,
        body:
          rules.length === 0
            ? "I'm running on the statutory defaults — you haven't confirmed any rules of your own yet."
            : `I'm using ${pluralise(rules.length, 'rule', 'rules')} you've confirmed: ${rules
                .map((r) => ruleLabel(r.ruleKey, r.label))
                .join(', ')}.`,
      },
    ];

    if (facts.length > 0) {
      messages.push({
        from: HOLLY,
        body: `I've also remembered ${pluralise(facts.length, 'thing', 'things')} from when you corrected me.`,
      });
    }

    return { ok: true, messages, data: { rules: rules.length } };
  },
});

register({
  key: 'hiring.candidate_list',
  teammate: HANSEL,
  describe: 'who is in the hiring pipeline',
  async run(ctx) {
    const people = await listPeople(ctx.orgId);
    const candidates = people.filter((p) => p.type === 'candidate');

    return {
      ok: true,
      messages: [
        {
          from: HANSEL,
          body:
            candidates.length === 0
              ? "Nobody's in the pipeline at the moment. Paste a CV and I'll start one."
              : `${pluralise(candidates.length, 'candidate', 'candidates')} in the pipeline: ${candidates
                  .map((c) => c.fullName)
                  .slice(0, 8)
                  .join(', ')}.`,
        },
      ],
      data: { candidates: candidates.length },
    };
  },
});

register({
  key: 'team.standup',
  teammate: HOLLY,
  describe: 'what the whole team is working on and what they need',
  async run(ctx) {
    const standup = await buildStandup(ctx.orgId);
    const messages: { from: string; body: string }[] = [];

    /*
     * One source of truth with the Catchup page. The chat version is the same
     * standup said out loud: each teammate speaks for themselves, in order,
     * and a quiet one says so rather than being left out — a teammate missing
     * from a standup reads as a teammate who is broken.
     */
    for (const mate of standup.teammates) {
      if (mate.quiet) {
        messages.push({ from: mate.name, body: 'Nothing from me today.' });
        continue;
      }

      if (mate.did.length > 0) {
        messages.push({ from: mate.name, body: mate.did[0] });
      }

      if (mate.needsYou.length > 0) {
        messages.push({
          from: mate.name,
          body: `${pluralise(mate.needsYou.length, 'thing needs', 'things need')} a decision from you — ${mate.needsYou[0].conclusion}`,
        });
      }

      if (mate.next.length > 0 && mate.did.length === 0) {
        messages.push({ from: mate.name, body: mate.next[0] });
      }
    }

    if (messages.length === 0) {
      messages.push({
        from: HOLLY,
        body: 'Quiet across the whole team — nothing in flight and nothing waiting on you.',
      });
    }

    return {
      ok: true,
      messages,
      data: {
        needsYou: standup.totalNeedsYou,
        teammates: standup.teammates.length,
      },
    };
  },
});
