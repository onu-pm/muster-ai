import { createClient } from '@/lib/supabase/server';
import type { ConnectionState } from '@/components/ProviderCard';

export async function listConnections(
  orgId: string,
): Promise<ConnectionState[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('connections')
    .select('provider_key, status, connected_at')
    .eq('org_id', orgId);

  if (error || !data) return [];

  return data.map((row) => ({
    providerKey: row.provider_key as string,
    status: (row.status as string) ?? 'connected',
    connectedAt: (row.connected_at as string | null) ?? null,
  }));
}

export function connectionMap(
  connections: ConnectionState[],
): Map<string, ConnectionState> {
  return new Map(connections.map((c) => [c.providerKey, c]));
}

/** Credentials for a single provider. Server-side only — never sent to the client. */
export async function getCredentials(
  orgId: string,
  providerKey: string,
): Promise<Record<string, string> | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('connections')
    .select('credentials, status')
    .eq('org_id', orgId)
    .eq('provider_key', providerKey)
    .maybeSingle();

  if (error || !data || data.status !== 'connected') return null;
  return (data.credentials as Record<string, string>) ?? {};
}
