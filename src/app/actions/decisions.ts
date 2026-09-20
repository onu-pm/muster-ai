'use server';

import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { resolveMemberOrg } from '@/lib/data/guard';

export type Outcome = 'approved' | 'rejected' | 'corrected';

export interface DecisionResult {
  ok: boolean;
  error?: string;
}

/**
 * Records a human decision on an exception.
 *
 * A correction also writes a Fact, linked back to the decision that produced
 * it, so the next run can consult it. The exception is only marked resolved
 * once the decision — and the fact, when there is one — are safely written: if
 * a write fails part way the item stays on the desk rather than disappearing
 * with no record. PostgREST cannot span these tables in one transaction.
 */
export async function decideOnException(
  exceptionId: string,
  outcome: Outcome,
  correctionNote?: string,
): Promise<DecisionResult> {
  if (outcome === 'corrected' && !correctionNote?.trim()) {
    return { ok: false, error: 'Tell Holly what was wrong, in a line.' };
  }

  const member = await resolveMemberOrg();
  if (!member.ok) return { ok: false, error: member.error };

  // Confirm the exception belongs to the caller's organisation before writing.
  const supabase = await createClient();
  const { data: exception } = await supabase
    .from('exceptions')
    .select('id, status, kind, conclusion, payload, duty_instances!inner ( org_id )')
    .eq('id', exceptionId)
    .eq('duty_instances.org_id', member.orgId)
    .maybeSingle();

  if (!exception) {
    return { ok: false, error: 'That item is no longer on your desk.' };
  }
  if (exception.status === 'resolved') {
    return { ok: false, error: 'Someone has already dealt with this one.' };
  }

  const admin = createAdminClient();
  const now = new Date().toISOString();

  const { data: decision, error: decisionError } = await admin
    .from('decisions')
    .insert({
      exception_id: exceptionId,
      human_user_id: member.userId,
      outcome,
      correction_note: correctionNote?.trim() || null,
      at: now,
    })
    .select('id')
    .single();

  if (decisionError || !decision) {
    return {
      ok: false,
      error: decisionError?.message ?? 'Could not record that decision.',
    };
  }

  if (outcome === 'corrected') {
    const { error: factError } = await admin.from('facts').insert({
      org_id: member.orgId,
      statement: correctionNote!.trim(),
      evidence: [{ at: now, from_decision: decision.id }],
      confirmed: true,
      created_from_decision: decision.id,
    });

    if (factError) {
      // Leave the exception open — the decision is recorded, but Holly has not
      // learned anything yet, so the item should stay visible.
      return {
        ok: false,
        error:
          'Your decision was saved, but Holly could not record what she learned. The item is still on your desk.',
      };
    }
  }

  // Approving a proposed rule is what actually puts it into use.
  if (outcome === 'approved' && exception.kind === 'proposed_rule') {
    const payload = (exception.payload ?? {}) as Record<string, unknown>;
    const definition = payload.definition;

    if (!definition || typeof definition !== 'object') {
      return {
        ok: false,
        error: 'That proposal has no figures in it, so it cannot be put to use.',
      };
    }

    const { error: ruleError } = await admin.from('rules').insert({
      org_id: member.orgId,
      rule_key: (payload.rule_key as string | null) ?? null,
      label: (payload.label as string | null) ?? null,
      scope: (payload.scope as string) ?? 'policy',
      jurisdiction: (payload.jurisdiction as string) ?? 'IN-national',
      effective_from:
        (payload.effective_from as string | null) ?? now.slice(0, 10),
      definition,
      source: 'Your calculation sheet, confirmed by you',
      confirmed: true,
      confirmed_at: now,
    });

    if (ruleError) {
      return {
        ok: false,
        error:
          'Your approval was recorded, but the rule could not be put into use. It is still on your desk.',
      };
    }
  }

  const { error: closeError } = await admin
    .from('exceptions')
    .update({ status: 'resolved', resolved_at: now })
    .eq('id', exceptionId);

  if (closeError) return { ok: false, error: closeError.message };

  revalidatePath('/catchup');
  revalidatePath('/home');
  revalidatePath('/team/holly');
  return { ok: true };
}
