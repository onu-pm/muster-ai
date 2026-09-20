# Muster — Build Prompt (for Claude Code)

Build Muster from scratch — a new Next.js (App Router, TypeScript) repo, fresh GitHub, no code carried over from any earlier attempt. The Supabase project is NOT fresh — it's the same one from the earlier build, already carrying migrations `0001` through `0006` (organisations, org_members, entities, locations, people, rules, deadlines, duty_instances, steps, artifacts, verdicts, exceptions, decisions, facts, teams, org_teams — plus `rules.rule_key`/`label`). I'll give you its URL and keys as env vars; don't regenerate or reset anything there. Follow the `muster-layout-spec.md` and `muster-user-journeys.md` documents given alongside this prompt as the source of truth for structure and behavior — don't improvise screen composition or flows; where something isn't covered, make the smallest reasonable HR-friendly choice and note it in your report at the end.

## Constraints

- OpenRouter for every model call, free Nemotron tier (`MODEL_ROUTINE`/`MODEL_JUDGMENT` env vars) — no paid API, no other provider.
- Postgres + Row Level Security from table one, scoped to org membership.
- Never compute an amount that reaches an employee outside tested, deterministic rule code — no LLM call ever produces a number that lands in someone's pay.
- Every irreversible action is prepared completely by an agent and approved by a named human — never auto-executed.
- Nothing snake_case, no raw enum or database key, ever renders as literal text to the user — every status/category/label gets a human-written string.
- I have a Remote.com sandbox token (`ra_test_`) for testing the connector — use it, don't touch any production account. Comes in as an env var.
- Design tokens: `--bg:#fcfaf7` `--surface:#ffffff` `--surface-2:#f5efe8` `--text:#2b2420` `--muted:#8a7d6f` `--accent:#c1704a` `--accent-hover:#a85c3a` `--accent-soft:#f0d9c8` `--border:#e8e1d8` `--error:#c0392b`, `--radius-card:16px`, `--radius-control:10px`. Font: Plus Jakarta Sans, self-hosted via `next/font/google`.

## Build order

Commit after each phase (build passes, previous phases still work).

### Phase 1 — Foundation

First, connect to the existing Supabase project with the env vars I give you and inspect what's actually there (query `information_schema`, or list tables another way) — confirm it matches the `0001`–`0006` schema described above rather than assuming. Report any mismatch before proceeding rather than working around it silently.

Then add ONLY what's genuinely new, as additive migrations starting at `0007` — do not touch or recreate any existing table:
- `exceptions.kind_label` (text, nullable) — a human-readable label alongside the existing `kind` column, since `kind` today is only a raw value like `lop_discrepancy`.
- `connections` (org_id, category, provider_key, label, status, credentials jsonb, connected_at) — per-org data-source connections for the new Marketplace.
- Row Level Security on `connections`, scoped to org membership, same posture as every existing table.

Supabase email auth, sign-up/sign-in, the onboarding flow from the Layout spec, all built fresh in the new codebase against the existing tables. Design tokens and font wired in exactly as specified. Static catalogs (not DB, no migration needed): `src/lib/catalog/providers.ts` (every Marketplace entry) and `src/lib/catalog/team-agents.ts` (per team: its agents, and what provider categories each agent needs).

### Phase 2 — The agents behind Holly

Input (reconciles attendance/leave via Remote.com connector or generic CSV import — build both; one LOP figure per person; flags what it can't resolve), Structure (salary structure, the 50% wage-definition test as tested code, reads a confirmed `wage_definition` rule before its own default), Tax (declarations, proof verification, monthly TDS projection, reads a confirmed `proof_category_cap` rule the same way), Pursue (stub — logs intent, returns unsent, no WhatsApp account exists), the rules-setup extraction flow, and the correction-to-Fact loop in the same transaction as any decision.

For the Tax agent's rate tables (TDS slabs, standard deduction, Section 80C/80D/24(b) caps, EPFO/ESIC rates): before inventing these from your own training data, look for and use an open, freely-licensed reference — the earlier build used [`openaccountants`'s `india-payroll` reference material](https://github.com/openaccountants) (MIT/AGPL) as a starting point, then checked the actual figures used in code against incometaxindia.gov.in, EPFO, and ESIC's own sites. Do the same: find a suitable open-source/free reference on GitHub, use it as a draft, and verify the figures that actually land in code against primary government sources — note in your report which figures were independently checked and which weren't, the way the earlier build's README did.

### Phase 3 — The five screens

Home, Catchup, Team Members (with Holly's five tabs), Marketplace, Profile, plus the onboarding flow — built exactly to the Layout spec's composition and exercised against every journey in the User journeys document.

## After each phase

Run `npm run build` clean, then walk through the relevant journeys yourself and report what felt confusing or broken — not just that the build passed. Keep a README describing what's built and what's deliberately not (Pursue's real channel, the other five teammates, editable Org Brain) and why.
