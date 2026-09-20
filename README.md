# Muster

An HR team you hire rather than software you configure. Holly is the first
teammate: she runs monthly payroll and keeps statutory compliance straight.

Next.js (App Router, TypeScript) on an existing Supabase Postgres project.

## Running it

```bash
cp .env.example .env.local   # fill in the values
npm install
npm run db:inspect           # read-only: confirms what the Supabase project holds
npm run db:migrate           # applies 0007 onward, idempotently
npm run dev
```

| Script            | What it does                                                  |
| ----------------- | ------------------------------------------------------------- |
| `npm run dev`     | Local dev server                                               |
| `npm run build`   | Production build                                               |
| `npm test`        | Vitest — the deterministic rule code                           |
| `npm run db:inspect` | Prints tables, columns, enums, RLS state and row counts     |
| `npm run db:migrate` | Applies `supabase/migrations/*.sql` in order                |

## Ground rules this codebase holds to

- **No model call ever produces a number that reaches someone's pay.** Every
  amount is computed by deterministic, unit-tested rule code. Models are used to
  read unstructured input and to draft language, never to do arithmetic that
  lands in a payslip.
- **Nothing irreversible happens on its own.** An agent prepares a decision in
  full; a named person approves it.
- **No raw key ever reaches a person's eyes.** Every enum, status and category
  goes through `src/lib/copy/labels.ts`, which falls back to a humanised string
  so an unmapped value still reads as words.
- **Row Level Security from table one**, scoped to organisation membership.
- **OpenRouter only**, on the free Nemotron tier.

## Database

The Supabase project is pre-existing. Inspecting it (`npm run db:inspect`, or
`node scripts/inspect-rest.mjs` when no connection string is available) found it
differs from what the brief described:

- **`connections` already exists**, with its own `connection_category`
  (`people_data｜messaging｜government`) and `connection_status` enums, and no
  `label` column. The application matches that table; nothing was recreated.
  Display names come from `src/lib/catalog/providers.ts`, which is a better
  single source of truth than a column that can drift.
- **Three tables exist beyond `0006`**: `loans`, `salary_revisions`,
  `tax_declarations`.
- **`exceptions` has no `org_id`.** It scopes through
  `duty_instance_id → duty_instances.org_id`; the subject person is carried in
  `payload.personName`.
- **`teams` holds one row, keyed `payroll_compliance`.** Holly is a persona over
  that team, mapped by `dbTeamKey` in the catalogue.

`0007` therefore adds only what is genuinely missing: `exceptions.kind_label`
(with a backfill), and INSERT/UPDATE/DELETE policies on `connections` and
`org_teams`.

### A note on Row Level Security

RLS is enabled on all 20 tables, and members can read. But `connections` and
`org_teams` have **no INSERT policy**, so every signed-in user gets error
`42501` when connecting a data source or switching a teammate on. That is what
`0007` fixes.

Applying `0007` needs a Postgres connection string, which this project has not
been given. Until it is applied, those two writes go through the service-role
client in `src/lib/supabase/admin.ts`, guarded by `resolveMemberOrg()` in
`src/lib/data/guard.ts`: the organisation is resolved from the signed-in user's
own membership through their RLS-scoped client and is never accepted as an
argument, so a request cannot reach an organisation the user does not belong to.
The check is the same one `is_org_member(org_id)` makes, enforced a layer up.
**Once `0007` is applied, those writes should move back onto the user's own
client** and the service role should be left to organisation bootstrap alone —
creating an organisation and its first membership row, which cannot pass a
membership check by definition.

## What is deliberately not built

- **Pursue's real channel.** Holly drafts follow-up messages and records the
  intent, but nothing is sent — there is no WhatsApp Business account behind it.
  The Marketplace shows the channel as coming soon rather than hiding it.
- **The other five teammates.** Arjun, Mira, Dev, Sana and Noor exist in the
  catalogue with real desks so the team strip and grid are honest about where
  this is going, but they are dimmed and not selectable.
- **An editable Org Brain.** "What Holly knows" is read-only. Facts are written
  by correcting her in the flow where the mistake appeared, which keeps every
  fact attached to the evidence that produced it. A free-text editor over the
  same data would let facts drift away from their evidence.
- **Statutory filing.** Holly computes EPFO, ESIC and TDS figures but cannot
  file them. Those portals are listed as coming soon.

## Build progress

- [x] Phase 1 — foundation: auth, onboarding, shell, design tokens, catalogs,
      migration 0007
- [ ] Phase 2 — the agents behind Holly
- [ ] Phase 3 — the five screens
