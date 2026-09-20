import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { runInput } from '@/lib/agents/input';
import { runStructure } from '@/lib/agents/structure';
import { runTax } from '@/lib/agents/tax';

/**
 * The scheduled runner.
 *
 * Vercel calls this daily (see vercel.json). It finds schedules due today and
 * runs the month for each organisation, then moves the schedule on.
 *
 * It does not decide anything. A run gathers, reconciles and projects, and puts
 * whatever it cannot settle on the desk — exactly as it does when someone asks
 * in the chat. Nobody is paid and nothing is filed without a person.
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
  // Vercel signs cron requests; refuse anything else so this cannot be
  // triggered by whoever finds the URL.
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization');

  if (secret && auth !== `Bearer ${secret}`) {
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
        error:
          runError instanceof Error ? runError.message : 'Run failed.',
      });
    }

    // Move the schedule on regardless: a failed month should not make it fire
    // again every day until someone notices.
    await admin
      .from('deadlines')
      .update({
        date: nextOccurrence(new Date(schedule.date as string), schedule.recurrence as string | null)
          .toISOString()
          .slice(0, 10),
      })
      .eq('id', schedule.id);
  }

  return NextResponse.json({
    checked: due?.length ?? 0,
    period: `${period.year}-${String(period.month).padStart(2, '0')}`,
    ran,
  });
}
