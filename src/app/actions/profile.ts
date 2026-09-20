'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { resolveMemberOrg } from '@/lib/data/guard';

export interface ProfileResult {
  ok: boolean;
  error?: string;
}

/** Renaming the organisation. `organisations` already allows members to update. */
export async function renameOrganisation(name: string): Promise<ProfileResult> {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: 'Your organisation needs a name.' };
  if (trimmed.length > 120) {
    return { ok: false, error: 'That name is too long.' };
  }

  const member = await resolveMemberOrg();
  if (!member.ok) return { ok: false, error: member.error };

  const supabase = await createClient();
  const { error } = await supabase
    .from('organisations')
    .update({ name: trimmed })
    .eq('id', member.orgId);

  if (error) return { ok: false, error: error.message };

  revalidatePath('/profile');
  revalidatePath('/home');
  return { ok: true };
}
