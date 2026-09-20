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

## Holly's agents

Holly answers for the whole team. Nobody using this has to know there are four
separate agents behind her.

| Agent | What it does | Where its figures come from |
| --- | --- | --- |
| **Input** | Reads Remote.com or a spreadsheet, brings the roster into `people`, reconciles leave into one loss-of-pay figure per person, consults confirmed facts before raising anything | `src/lib/rules/lop.ts` |
| **Structure** | Applies the 50% wage-definition test, reading a confirmed `wage_definition` rule before its own default | `src/lib/rules/wage-definition.ts` |
| **Tax** | Caps verified proofs and projects monthly TDS, reading a confirmed `proof_category_cap` rule before the statutory caps | `src/lib/rules/tax.ts` |
| **Pursue** | Drafts a follow-up and records the intent. Always returns `sent: false` | — |

`npm test` covers the rule code: 54 tests across the wage test, loss of pay,
tax, deduction caps, EPF/ESI, CSV parsing and intent reading. Models are used to
read a pasted rule sheet and to draft language. No model output is ever treated
as a number.

### Two things the first real run got wrong

Both are fixed, and both are the kind of error worth naming:

1. **Remote holds time off, not attendance.** Days present were derived by
   subtracting leave from the month, then "reconciled" against the same leave —
   which can never disagree. Holly was reporting "everything reconciled cleanly"
   when the truth was "I only have one record, so there is nothing to compare".
   `crossChecked` now carries that distinction and she says so.
2. **No salary structure is not a pass.** People with nothing on file were
   scoring `passed: true` on the wage test because zero remuneration cannot fall
   below half of itself. They are now reported as untestable, separately from
   those that genuinely pass.

## The chat is where work happens

Holly plans before she acts, and anything she needs from a person is asked for
and answered inside the thread. Nobody is ever sent to another screen to finish
something they started in the chat.

- **Asked to run a month with nothing connected**, she asks for a Remote.com
  token inline, offers "I keep it in a spreadsheet" as an alternative, takes the
  answer inline, connects, and resumes the run she was already on. The original
  goal is held in `ConversationState` so nothing has to be retyped.
- **Findings she cannot settle** come back as messages with Approve / Reject /
  That's not right attached. Answering one offers the next. A correction still
  writes a Fact linked to the decision that produced it.
- **Recurring work needs permission.** "Run payroll every month on the 25th" is
  read as a schedule, not a run: Holly states what she would do unattended,
  shows it in a summary box, and saves nothing until someone says yes.

Links inside the thread exist only for looking at detail — never for completing
work. Catchup and the Marketplace remain as places to review things later.

## Where the statutory figures came from

The brief asked for an open reference checked against primary sources. Each
table in `src/lib/rules/tax-tables.ts` carries its provenance inline. Summary:

| Figures | Status |
| --- | --- |
| ESI 0.75% employee / 3.25% employer, in force 1 Jul 2019, ₹176 daily-wage exemption | **Verified** against [esic.gov.in/contribution](https://www.esic.gov.in/contribution) |
| EPF 12% employer, 8.33% to EPS, 0.5% EDLI, ₹15,000 wage ceiling | **Verified** against EPFO's published material on [epfo.gov.in](https://www.epfo.gov.in). The contribution-rate PDF itself could not be parsed, so the 0.5% admin charge is the least certain figure here |
| ESI ₹21,000 coverage ceiling | **Not verified** — not stated on the ESIC page that was reachable |
| Income tax slabs, standard deduction, 87A rebate, cess, surcharge, 80C/80D/24(b) caps | **Not verified against a primary source.** incometaxindia.gov.in refuses automated access (HTTP 403). Corroborated only across independent tax publishers. **Re-check these before any real filing.** |

## Two deliberate departures from the brief

- **Palette.** The brief fixed a warm terracotta set (`--accent:#c1704a`,
  `--surface-2:#f5efe8`). Those beiges read dusty next to the type, so on the
  owner's call the palette moved to deep forest green on warm paper
  (`--accent:#1f6f4a`, `--surface-2:#f4f4f1`). Radii, font and the token
  structure are unchanged, so reverting is a matter of editing `:root`.
- **Home's goal box.** The spec says the thread appears "in place". It does, and
  it also widens the column to 1120px and collapses the team strip to single-line
  pills, so a long conversation is not squeezed into an 880px column. The spec's
  Catchup cards still exist, but they are no longer the only way to decide
  something — the same decision is offered in the chat where it arose.

## Performance

Supabase is hosted in Chennai; Vercel functions default to Washington DC, so
every query crossed the planet and each page made several sequential round
trips — 1.8s to 3.4s per page. `vercel.json` pins functions to `bom1` (Mumbai)
and every route has a loading skeleton. Measured from outside India that is now
0.8s to 1.2s; from inside India both hops are short, so it is faster again.

## Deployment

Deployed on Vercel at **https://muster-phi-ruby.vercel.app**, pointed at the
same Supabase project. Production and development environment variables are set;
preview environments are not, so preview builds will fail until those are added.

## Build progress

- [x] Foundation: auth, onboarding, shell, design tokens, catalogs, migration 0007
- [x] Holly's agents, on tested deterministic rule code
- [x] The five screens, built to the layout spec
- [x] Deployed
- [ ] Migration 0007 applied (needs a Postgres connection string)
