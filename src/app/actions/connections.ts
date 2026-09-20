'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getProvider } from '@/lib/catalog/providers';
import { requireWorkspace } from '@/lib/data/session';

export interface ConnectResult {
  ok: boolean;
  error?: string;
}

/**
 * One row per org per provider. Marketplace, onboarding step 3 and Holly's
 * Data sources tab all write through here, so the three views cannot disagree.
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

  const { org } = await requireWorkspace();
  const supabase = await createClient();

  const { error } = await supabase.from('connections').upsert(
    {
      org_id: org.id,
      category: provider.category,
      provider_key: provider.key,
      label: provider.label,
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
  return { ok: true };
}

export async function disconnectProvider(
  providerKey: string,
): Promise<ConnectResult> {
  const { org } = await requireWorkspace();
  const supabase = await createClient();

  const { error } = await supabase
    .from('connections')
    .delete()
    .eq('org_id', org.id)
    .eq('provider_key', providerKey);

  if (error) return { ok: false, error: error.message };

  revalidatePath('/marketplace');
  revalidatePath('/team/holly');
  return { ok: true };
}
