'use server';

import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolveMemberOrg } from '@/lib/data/guard';
import { completeJson, ModelUnavailableError } from '@/lib/ai/openrouter';
import { RULE_LABELS } from '@/lib/copy/labels';

export interface ProposeResult {
  ok: boolean;
  error?: string;
  message?: string;
}

interface ExtractedRule {
  rule_key: string | null;
  label: string | null;
  scope: 'statutory' | 'policy' | null;
  jurisdiction: string | null;
  effective_from: string | null;
  definition: Record<string, unknown> | null;
  unreadable?: string | null;
}

const SYSTEM = `You read a fragment of an Indian payroll calculation sheet and turn it into a structured rule.

Rules you must follow:
- Extract ONLY what the text literally states. Never infer a figure, a state, a date or a threshold that is not written down.
- If something is not stated, use null. Do not guess.
- Never invent slabs, caps or rates from your own knowledge of Indian tax law.
- Reply with a single JSON object and nothing else.

Shape:
{
  "rule_key": one of ${Object.keys(RULE_LABELS)
    .map((k) => `"${k}"`)
    .join(', ')} or null if none fits,
  "label": a short human title taken from the text,
  "scope": "statutory" if it restates a law, "policy" if it is this company's own choice, else null,
  "jurisdiction": "IN-<state code>" if a state is named, "IN-national" if explicitly nationwide, else null,
  "effective_from": "YYYY-MM-DD" only if a date is stated, else null,
  "definition": the figures exactly as stated, as JSON,
  "unreadable": a short sentence naming anything you could not read, else null
}`;

export async function proposeRuleFromSheet(
  sheet: string,
): Promise<ProposeResult> {
  const text = sheet.trim();
  if (text.length < 12) {
    return { ok: false, error: 'Paste a bit more so Holly has something to read.' };
  }
  if (text.length > 6000) {
    return {
      ok: false,
      error: 'That is a lot at once. Paste one table or section at a time.',
    };
  }

  const member = await resolveMemberOrg();
  if (!member.ok) return { ok: false, error: member.error };

  let extracted: ExtractedRule;
  try {
    extracted = await completeJson<ExtractedRule>({
      system: SYSTEM,
      user: text,
    });
  } catch (error) {
    if (error instanceof ModelUnavailableError) {
      return {
        ok: false,
        error:
          'Holly could not read that just now — the free model service is busy. Try again in a moment.',
      };
    }
    return {
      ok: false,
      error: 'Holly could not make sense of that. Try pasting just the table.',
    };
  }

  if (!extracted.definition || Object.keys(extracted.definition).length === 0) {
    return {
      ok: false,
      error:
        extracted.unreadable ??
        'Holly could not find any figures in that. Try pasting the table itself.',
    };
  }

  const admin = createAdminClient();

  // A proposed rule is an ordinary approval: it goes to Catchup as an exception
  // on its own duty instance, and only becomes a confirmed rule once approved.
  const { data: duty, error: dutyError } = await admin
    .from('duty_instances')
    .insert({
      org_id: member.orgId,
      duty_type: 'rules_setup',
      state: 'blocked',
      opened_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (dutyError || !duty) {
    return { ok: false, error: dutyError?.message ?? 'Could not save that.' };
  }

  const label = extracted.label?.trim() || 'A rule from your sheet';
  const conclusion = extracted.unreadable
    ? `From your sheet: ${label}. ${extracted.unreadable}`
    : `From your sheet: ${label}. Confirm it and I'll use it from the next run.`;

  const { error: exceptionError } = await admin.from('exceptions').insert({
    duty_instance_id: duty.id,
    // kind_label is deliberately not written here: migration 0007 adds that
    // column and has not been applied. labels.ts supplies the wording meanwhile.
    kind: 'proposed_rule',
    conclusion,
    confidence: extracted.unreadable ? 0.6 : 0.95,
    status: 'open',
    opened_at: new Date().toISOString(),
    payload: {
      rule_key: extracted.rule_key,
      label,
      scope: extracted.scope ?? 'policy',
      jurisdiction: extracted.jurisdiction ?? 'IN-national',
      effective_from: extracted.effective_from,
      definition: extracted.definition,
      ruleApplied: 'A rule takes effect only once you confirm it.',
      source_text: text.slice(0, 2000),
    },
  });

  if (exceptionError) {
    await admin.from('duty_instances').delete().eq('id', duty.id);
    return { ok: false, error: exceptionError.message };
  }

  revalidatePath('/catchup');
  revalidatePath('/home');
  revalidatePath('/team/holly');

  return {
    ok: true,
    message: `Holly read it and sent “${label}” to Catchup for your approval.`,
  };
}
