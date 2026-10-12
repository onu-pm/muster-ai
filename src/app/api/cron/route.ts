import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { runInput } from '@/lib/agents/input';
import { runStructure } from '@/lib/agents/structure';
import { runTax } from '@/lib/agents/tax';
import { listFullPeopleAsService } from '@/lib/data/people-records';
import { sweepRecords } from '@/lib/agents/mira';
import { sweepBenefits } from '@/lib/agents/dev';
import { sweepReviews } from '@/lib/agents/sana';
import { sweepExits } from '@/lib/agents/noor';

/**
 * The scheduled runner.
 *
 * Vercel calls this daily (see vercel.json). Two things happen, in order:
 *
 *  1. Any payroll schedule due today is run for its organisation, and moved on.
 *  2. Every organisation gets a sweep: Mira checks the files, Dev looks for
 *     people eligible for cover who are not on it, Sana finds the reviews that
 *     have slipped, and Noor closes the exits whose settlement has been
 *     approved and whose last day has passed.
 *
 * Nothing here decides anything. A sweep gathers and puts what it cannot settle
 * on the desk, exactly as it does when somebody asks in the chat. Nobody is
 * paid, nothing is filed, nobody is added to or taken off an insurance policy,
 * and nobody is moved off the roster while money is still owed to them.
 *
 * No model is called from this path at all. Every sweep runs on the tested rule
 * code, which is what makes it safe to run while nobody is watching.
 */

export const maxDuration = 300;

function previousMonth(now: Date): { year: number; month: number } {
  const at = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return { year: at.getFullYear(), month: at.getMonth() + 1 };
}

function nextOccurrence(from: Date, recurrence: string | null): Date {
  const next = new Date(from);
  if (recurrence === 'weekly') next.setDate(next.getDate() + 7);
  else next.setMonth(next.getMonth() + 1);
  return next;
}

export async function GET(request: NextRequest) {
  /*
   * Fails closed, deliberately.
   *
   * Vercel attaches `Authorization: Bearer $CRON_SECRET` to a scheduled
   * request, but only when CRON_SECRET is set. This check used to be skipped
   * entirely when it was unset, which meant that on a deployment without the
   * variable configured the endpoint ran a payroll month and every sweep for
   * every organisation for anyone who sent it a GET. That is exactly what it
   * was written to prevent.
   *
   * So an unset secret now refuses rather than runs. The schedule stops and
   * says why, which is a visible problem; the alternative was an invisible one.
   */
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    return NextResponse.json(
      {
        error:
          'CRON_SECRET is not set, so this endpoint cannot tell a scheduled request from anyone else and refuses to run.',
      },
      { status: 503 },
    );
  }

  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Not authorised' }, { status: 401 });
  }

  const admin = createAdminClient();
  const today = new Date().toISOString().slice(0, 10);

  const { data: due, error } = await admin
    .from('deadlines')
    .select('id, org_id, date, recurrence, status')
    .eq('status', 'scheduled')
    .lte('date', today);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const period = previousMonth(new Date());
  const ran: Record<string, unknown>[] = [];

  /* ---- 1. Payroll schedules that fall due today ---- */

  for (const schedule of due ?? []) {
    const orgId = schedule.org_id as string;

    try {
      const input = await runInput(orgId, period.year, period.month);

      if (input.ok && input.dutyInstanceId) {
        await Promise.all([
          runStructure(orgId, input.dutyInstanceId),
          runTax(orgId, input.dutyInstanceId),
        ]);
      }

      ran.push({
        orgId,
        ok: input.ok,
        people: input.peopleCount,
        raised: input.raised,
        error: input.error,
      });
    } catch (runError) {
      ran.push({
        orgId,
        ok: false,
        error: runError instanceof Error ? runError.message : 'Run failed.',
      });
    }

    // Move the schedule on regardless: a failed month should not make it fire
    // again every day until someone notices.
    await admin
      .from('deadlines')
      .update({
        date: nextOccurrence(
          new Date(schedule.date as string),
          schedule.recurrence as string | null,
        )
          .toISOString()
          .slice(0, 10),
      })
      .eq('id', schedule.id);
  }

  /* ---- 2. The daily sweep, for every organisation ---- */

  const { data: orgs } = await admin
    .from('org_teams')
    .select('org_id, enabled, teams!inner ( key )')
    .eq('enabled', true);

  /*
   * A teammate only sweeps for an organisation that has switched them on.
   * Deactivating somebody has to actually stop them picking up new work, or
   * the control on their page means nothing.
   */
  const switchedOn = new Map<string, Set<string>>();
  for (const row of orgs ?? []) {
    const joined = row.teams as { key: string } | { key: string }[] | null;
    const key = Array.isArray(joined) ? joined[0]?.key : joined?.key;
    if (!key) continue;
    const orgId = row.org_id as string;
    const set = switchedOn.get(orgId) ?? new Set<string>();
    set.add(key);
    switchedOn.set(orgId, set);
  }

  const swept: Record<string, unknown>[] = [];

  for (const [orgId, teams] of switchedOn) {
    const result: Record<string, unknown> = { orgId };

    try {
      const people = await listFullPeopleAsService(orgId);
      result.people = people.length;

      if (teams.has('records_documents')) {
        result.records = await sweepRecords(orgId, people);
      }
      if (teams.has('benefits_insurance')) {
        result.benefits = await sweepBenefits(orgId, people);
      }
      if (teams.has('performance_reviews')) {
        result.reviews = await sweepReviews(orgId, people);
      }
      if (teams.has('exits_settlement')) {
        result.exits = await sweepExits(orgId, people);
      }
    } catch (sweepError) {
      result.error =
        sweepError instanceof Error ? sweepError.message : 'Sweep failed.';
    }

    swept.push(result);
  }

  return NextResponse.json({
    checked: due?.length ?? 0,
    period: `${period.year}-${String(period.month).padStart(2, '0')}`,
    ran,
    swept,
  });
}
