import 'server-only';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';

/**
 * Service-role client. Bypasses Row Level Security, so it is used for exactly
 * one thing: creating an organisation and its first membership row.
 *
 * That bootstrap cannot go through the user's own client — every policy on this
 * project is scoped to `is_org_member(org_id)`, and the first member of a brand
 * new organisation is by definition not a member of it yet.
 *
 * Every other read and write in the app uses the request-scoped client in
 * `server.ts` so RLS stays in force.
 */
export function createAdminClient() {
  if (!env.supabaseServiceKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set.');
  }

  return createSupabaseClient(env.supabaseUrl, env.supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
