'use server';

import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { getProvider } from '@/lib/catalog/providers';
import { resolveMemberOrg } from '@/lib/data/guard';

export interface ConnectResult {
  ok: boolean;
  error?: string;
}

/**
 * One row per org per provider. Marketplace, onboarding step 3 and Holly's
 * Data sources tab all write through here, so the three views cannot disagree.
 *
 * The organisation is resolved from the signed-in user's own membership, never
 * from an argument, so this cannot touch another organisation's connections.
 */
export async function connectProvider(
  providerKey: string,
  credentials: Record<string, string>,
): Promise<ConnectResult> {
  const provider = getProvider(providerKey);
  if (!provider) return { ok: false, error: 'Unknown data source.' };
  if (!provider.available) {
    return { ok: false, error: `${provider.label} is not available yet.` };
  }

  for (const field of provider.fields) {
    if (!credentials[field.name]?.trim()) {
      return { ok: false, error: `${field.label} is required.` };
    }
  }

  const member = await resolveMemberOrg();
  if (!member.ok) return { ok: false, error: member.error };

  const { error } = await createAdminClient()
    .from('connections')
    .upsert(
      {
        org_id: member.orgId,
        category: provider.category,
        provider_key: provider.key,
        status: 'connected',
        credentials,
        connected_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'org_id,provider_key' },
    );

  if (error) return { ok: false, error: error.message };

  revalidatePath('/marketplace');
  revalidatePath('/team/holly');
  revalidatePath('/onboarding');
  return { ok: true };
}

export async function disconnectProvider(
  providerKey: string,
): Promise<ConnectResult> {
  const member = await resolveMemberOrg();
  if (!member.ok) return { ok: false, error: member.error };

  const { error } = await createAdminClient()
    .from('connections')
    .delete()
    .eq('org_id', member.orgId)
    .eq('provider_key', providerKey);

  if (error) return { ok: false, error: error.message };

  revalidatePath('/marketplace');
  revalidatePath('/team/holly');
  revalidatePath('/onboarding');
  return { ok: true };
}
