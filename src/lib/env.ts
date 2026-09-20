// Static references only — Next.js inlines NEXT_PUBLIC_* at build time,
// so these cannot be read through a computed key.
const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '';

const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  '';

export const env = {
  supabaseUrl,
  supabaseAnonKey,
  get supabaseServiceKey() {
    return (
      process.env.SUPABASE_SERVICE_ROLE_KEY ??
      process.env.SUPABASE_SECRET_KEY ??
      ''
    );
  },
  get openRouterKey() {
    return process.env.OPENROUTER_API_KEY ?? '';
  },
  get modelRoutine() {
    return (
      process.env.MODEL_ROUTINE ??
      'nvidia/nemotron-nano-9b-v2:free'
    );
  },
  get modelJudgment() {
    return (
      process.env.MODEL_JUDGMENT ??
      'nvidia/nemotron-nano-9b-v2:free'
    );
  },
  get remoteApiToken() {
    return process.env.REMOTE_API_TOKEN ?? '';
  },
  get remoteApiBase() {
    return process.env.REMOTE_API_BASE ?? 'https://gateway.remote-sandbox.com';
  },
};

export const supabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);
