/**
 * Read-only. Prints what the existing Supabase project actually contains so the
 * 0001–0006 schema can be confirmed rather than assumed.
 */
import { connect } from './db.mjs';

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

const client = await connect();

const { rows: tables } = await client.query(`
  select table_name
  from information_schema.tables
  where table_schema = 'public' and table_type = 'BASE TABLE'
  order by table_name
`);
const present = tables.map((t) => t.table_name);

const { rows: columns } = await client.query(`
  select table_name, column_name, data_type, is_nullable, column_default
  from information_schema.columns
  where table_schema = 'public'
  order by table_name, ordinal_position
`);

const { rows: rls } = await client.query(`
  select c.relname as table_name, c.relrowsecurity as rls_enabled,
         count(p.policyname)::int as policy_count
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  left join pg_policies p on p.tablename = c.relname and p.schemaname = 'public'
  where n.nspname = 'public' and c.relkind = 'r'
  group by c.relname, c.relrowsecurity
  order by c.relname
`);

const { rows: enums } = await client.query(`
  select t.typname, string_agg(e.enumlabel, ', ' order by e.enumsortorder) as values
  from pg_type t
  join pg_enum e on e.enumtypid = t.oid
  join pg_namespace n on n.oid = t.typnamespace
  where n.nspname = 'public'
  group by t.typname
  order by t.typname
`);

const { rows: counts } = await client.query(
  present
    .map((t) => `select '${t}' as table_name, count(*)::int from public."${t}"`)
    .join(' union all ') || 'select null::text, null::int where false',
);

console.log('=== TABLES PRESENT (public) ===');
console.log(present.join(', ') || '(none)');

const missing = EXPECTED.filter((t) => !present.includes(t));
const extra = present.filter((t) => !EXPECTED.includes(t));
console.log('\n=== AGAINST EXPECTED 0001–0006 ===');
console.log('missing :', missing.length ? missing.join(', ') : 'none');
console.log('extra   :', extra.length ? extra.join(', ') : 'none');

console.log('\n=== COLUMNS ===');
let current = '';
for (const c of columns) {
  if (c.table_name !== current) {
    current = c.table_name;
    console.log(`\n[${current}]`);
  }
  const nullable = c.is_nullable === 'YES' ? 'null' : 'NOT NULL';
  const def = c.column_default ? ` default ${c.column_default}` : '';
  console.log(`  ${c.column_name} : ${c.data_type} ${nullable}${def}`);
}

console.log('\n=== ENUM TYPES ===');
if (!enums.length) console.log('(none — enum-like columns are plain text)');
for (const e of enums) console.log(`  ${e.typname}: ${e.values}`);

console.log('\n=== ROW LEVEL SECURITY ===');
for (const r of rls) {
  const flag = r.rls_enabled ? 'on ' : 'OFF';
  console.log(`  ${flag} ${r.table_name} (${r.policy_count} policies)`);
}

console.log('\n=== ROW COUNTS ===');
for (const c of counts) console.log(`  ${c.table_name}: ${c.count}`);

await client.end();
