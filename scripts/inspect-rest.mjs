/**
 * Read-only schema inspection over PostgREST's OpenAPI document.
 *
 * Used when SUPABASE_DB_URL is not available: `information_schema` is not
 * reachable through the REST API, but PostgREST publishes every exposed table
 * and column at the API root. Row counts come from `Prefer: count=exact`, and
 * RLS is probed by comparing an anonymous read against a service-role read.
 */
import { loadEnv } from './db.mjs';

loadEnv();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
const anonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!url || !serviceKey) {
  console.error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
  process.exit(1);
}

const EXPECTED = [
  'organisations',
  'org_members',
  'entities',
  'locations',
  'people',
  'rules',
  'deadlines',
  'duty_instances',
  'steps',
  'artifacts',
  'verdicts',
  'exceptions',
  'decisions',
  'facts',
  'teams',
  'org_teams',
];

const spec = await fetch(`${url}/rest/v1/`, {
  headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
}).then((r) => r.json());

const definitions = spec.definitions ?? spec.components?.schemas ?? {};
const present = Object.keys(definitions).sort();

console.log('=== TABLES EXPOSED (public) ===');
console.log(present.join(', ') || '(none)');

const missing = EXPECTED.filter((t) => !present.includes(t));
const extra = present.filter((t) => !EXPECTED.includes(t));
console.log('\n=== AGAINST EXPECTED 0001-0006 ===');
console.log('missing :', missing.length ? missing.join(', ') : 'none');
console.log('extra   :', extra.length ? extra.join(', ') : 'none');

console.log('\n=== COLUMNS ===');
for (const table of present) {
  const def = definitions[table];
  const props = def.properties ?? {};
  const required = new Set(def.required ?? []);
  console.log(`\n[${table}]`);
  for (const [name, meta] of Object.entries(props)) {
    const bits = [meta.format ?? meta.type ?? '?'];
    if (required.has(name)) bits.push('NOT NULL');
    if (meta.enum) bits.push(`enum(${meta.enum.join('|')})`);
    const desc = (meta.description ?? '').split('\n')[0].trim();
    if (desc) bits.push(desc);
    console.log(`  ${name} : ${bits.join(' ')}`);
  }
}

console.log('\n=== ROW COUNTS (service role, RLS bypassed) ===');
for (const table of present) {
  const res = await fetch(`${url}/rest/v1/${table}?select=*&limit=0`, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      Prefer: 'count=exact',
    },
  });
  const range = res.headers.get('content-range') ?? '?';
  console.log(`  ${table}: ${range.split('/')[1] ?? '?'}`);
}

if (anonKey) {
  console.log('\n=== RLS PROBE (anonymous read; "blocked" = RLS doing its job) ===');
  for (const table of present) {
    const res = await fetch(`${url}/rest/v1/${table}?select=*&limit=1`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
    });
    if (!res.ok) {
      console.log(`  blocked  ${table} (${res.status})`);
      continue;
    }
    const rows = await res.json();
    console.log(
      `  ${rows.length === 0 ? 'empty   ' : 'READABLE'} ${table}` +
        (rows.length ? '  <-- anonymous can read rows' : ''),
    );
  }
}
