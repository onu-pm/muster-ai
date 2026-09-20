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

The Supabase project is pre-existing and already carries migrations `0001`–`0006`.
This repo does not contain them and never re-runs them. It adds only:

- `0007` — `exceptions.kind_label`, the `connections` table, and RLS on
  `connections` scoped to org membership.

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
