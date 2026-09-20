/**
 * Applies every migration in supabase/migrations in filename order.
 *
 * This repo only carries 0007 onward — 0001–0006 already live in the Supabase
 * project and are never re-run. Each file here is written to be idempotent.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { connect } from './db.mjs';

const dir = resolve(process.cwd(), 'supabase/migrations');
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.sql'))
  .sort();

if (!files.length) {
  console.log('No migrations to apply.');
  process.exit(0);
}

const client = await connect();

for (const file of files) {
  const sql = readFileSync(resolve(dir, file), 'utf8');
  process.stdout.write(`applying ${file} … `);
  try {
    await client.query('begin');
    await client.query(sql);
    await client.query('commit');
    console.log('ok');
  } catch (error) {
    await client.query('rollback');
    console.log('FAILED');
    console.error(error.message);
    await client.end();
    process.exit(1);
  }
}

await client.end();
console.log(`\n${files.length} migration(s) applied.`);
