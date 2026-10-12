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
- **A claims channel for Dev.** He tracks group cover and prepares additions
  and removals, but chasing an insurer on a live claim needs an insurer
  connected, and there is no sandbox for one. The agent is listed and marked as
  needing a connection rather than hidden.
- **A leave ledger.** Leave arrives from whatever is connected, a month at a
  time, so there is no running balance to read. Noor therefore asks for the
  encashable days rather than assuming a zero — a missing encashment looks
  exactly like a correct one on a payslip.
- **An editable Org Brain.** "What Holly knows" is read-only. Facts are written
  by correcting her in the flow where the mistake appeared, which keeps every
  fact attached to the evidence that produced it. A free-text editor over the
  same data would let facts drift away from their evidence.
- **Statutory filing.** Holly computes EPFO, ESIC and TDS figures but cannot
  file them. Those portals are listed as coming soon.

## Four new desks on the existing schema

Records, benefits, reviews and exits added no tables. The schema was already
domain-neutral where it counts: `duty_instances` is a piece of work with a type,
a state and an optional subject; `steps` is what was done, with its input and
output; `exceptions` is the queue of what stopped at a person; `artifacts` is a
document that arrived. None of those type columns are enums — they are `text` —
so a new domain is a new duty type on the same substrate rather than a
migration. `src/lib/data/duties.ts` is the shared surface, and
`src/lib/data/duty-lifecycle.ts` says what a duty becomes once somebody decides.

That last file exists because of a bug worth recording. Resolving the last open
exception on a duty used to close the duty, which is right nearly everywhere and
wrong in two places. A benefit enrolment duty *is* the cover — blocked means
proposed, in progress means live, closed means off the policy — so approving an
enrolment closed the duty and took the person off the cover at the exact moment
somebody said to put them on it. An exit has the same shape: it has to stay open
after the settlement is agreed, because the person is on the roster until their
last day passes. Both are pinned by tests now.

### The settlement is the sharp end

A final settlement is the last money an employer ever sends someone. There is no
next month to catch an error in it, and the person receiving it has usually lost
the standing to argue. So `src/lib/rules/settlement.ts` composes it from parts
that are each separately tested — salary to the last day, leave encashment,
gratuity under the Act, notice recovery, anything still owed — and Noor never
contributes a figure of his own. It leaves itemised, with the basis for every
line and every assumption named, and waits:

> **you** — work out the final settlement for Priya Nair
> **Noor** — Priya Nair, last day 20 Jun 2024, 10 years and 2 months of service.
> **Noor** — Salary for the final part month: ₹40,000 — 20 of 30 days worked, over a 30-day month.
> **Noor** — Leave encashment: ₹17,000 — 17 encashable days of a 17-day balance, on basic and dearness allowance over a 30-day month.
> **Noor** — Gratuity: ₹1,73,077 — 10 completed years of service at fifteen days' wages a year.
> **Noor** — That comes to ₹2,30,077 before tax, of which ₹1,73,077 is exempt.
> **Noor** — The leave entitlement and encashment cap are the common private-sector defaults, not a rule you have confirmed. Confirm your own and I will use it instead.
> **Noor** — Nothing goes out until you approve it. *[Approve / Reject / Tell me what's wrong]*

Asking again recomputes and **withdraws the earlier proposal** rather than
queueing beside it. Two open approvals for one settlement is how somebody gets
paid twice.

### Saying "I can't tell" instead of "nothing to report"

Three places where the honest answer is harder than the reassuring one:

- Sana will not say "no reviews due" when nobody has a joining date on file. A
  cycle counts from that date, so without it she cannot tell, and says so —
  naming Mira, who collects them.
- Noor leaves leave encashment out entirely rather than computing it as zero,
  and says why.
- Mira reports a gap by *pattern*, not per person. Sixty-nine people missing the
  same three fields is one finding — usually an import that did not carry those
  columns — and raising it sixty-nine times buries everything else on the desk
  under one problem. Every name still travels in the payload.

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

## The team, and how they work together

| Teammate | Desk | Agents |
| --- | --- | --- |
| **Holly** | Payroll and statutory compliance | Attendance and leave, Pay structure, Tax and declarations, Follow-ups |
| **Hansel** | Hiring and onboarding | Applications, Offers, Onboarding |
| **Mira** | Records and documents | File checks, Documents, Statutory registers |
| **Dev** | Benefits and insurance | Eligibility, Additions and removals, Claims |
| **Sana** | Performance and reviews | Review cycles, What has slipped, Probation confirmations |
| **Noor** | Exits and final settlement | Notice and dates, Full and final, Clearance |

Nobody using Muster picks a teammate. A goal goes to `src/lib/agents/router.ts`,
which works out which *capabilities* it needs — often spanning both people —
and they hand off to each other from there. Ask for an offer and Hansel adds the
candidate, then asks Holly for the pay split, because pay is her desk and he
does no salary arithmetic at all:

> **you** — prepare an offer for Rahul Menon at 18 lakh as a backend engineer
> **Hansel** — Rahul Menon is on the list as a candidate.
> **Hansel** — Offer for Rahul Menon at ₹18,00,000 a year. The split is Holly's call, not mine — passing it to her.
> **Holly** — On ₹18,00,000 a year, that's ₹75,000 basic, ₹30,000 HRA and ₹45,000 special allowance a month.
> **Holly** — Basic is 50% of wages, so it clears the statutory half.

A model chooses *which* registered capability runs. It can never invent one, and
it never supplies a figure: the package above is parsed from the person's own
words by `readMoney` in `src/lib/agents/parse-input.ts`, and the split comes
from `src/lib/rules/structure.ts`.

## Streaming, and what the AI SDK could and could not do

The chat streams. `/api/chat` emits newline-delimited events and each
teammate's message goes out the moment that step finishes, so a payroll run
reads as it progresses instead of appearing whole after twenty seconds.

Built on the **Vercel AI SDK** (Apache-2.0) via the **OpenRouter provider**
(Apache-2.0). Worth recording what did not work:

- **`streamText` works.** It carries all prose, released a paragraph at a time
  so tokens never render mid-word.
- **`generateObject` does not work on the free Nemotron tier.** Measured over
  six attempts: five failed with an upstream error, a timeout or "no object
  generated", and the one that returned produced a malformed object. These
  models do not support the provider-side structured-output mode it needs.
  Adopting it silently broke capability routing — the planner fell through to
  conversation, so "Find the salary of Rahul" stopped reaching
  `payroll.person_summary`.

So structured output asks for JSON in the prompt, parses it leniently, and
validates against the same zod schema afterwards. The contract is unchanged;
what enforces it no longer depends on provider support these models lack.
Failover between the two usable free models stays ours — the SDK does not do it.

## Open-source code used, and licences checked

Every dependency here was licence-checked before use, because a copyleft licence
in this codebase would change what Muster itself has to be.

| Project | Licence | What was taken |
| --- | --- | --- |
| [perminder-klair/resume-parser](https://github.com/perminder-klair/resume-parser) | **MIT** ✓ | The section-heading dictionary and dictionary-driven extraction approach, rewritten in TypeScript in `src/lib/hiring/cv.ts`. Its network profile-scraping was deliberately dropped — Muster does not fetch a candidate's public profiles. |
| [Vercel AI SDK](https://github.com/vercel/ai) + [OpenRouter provider](https://github.com/OpenRouterTeam/ai-sdk-provider) | **Apache-2.0** ✓ | Transport and `streamText`. `generateObject` unusable here — see above. |
| [openai/openai-agents-python](https://github.com/openai/openai-agents-python) | **MIT** ✓ | The handoff pattern — agents exposing named handoffs rather than one orchestrator knowing everyone's internals — adapted in `src/lib/agents/registry.ts`. Narrower here: capabilities are a fixed declared set, so a model can never name a function. |
| [urlaubsverwaltung/urlaubsverwaltung](https://github.com/urlaubsverwaltung/urlaubsverwaltung) | **Apache-2.0** ✓ | The leave-balance model from `VacationDaysLeft` and `ExpiredRemainingVacationDays`: this year's entitlement held separately from the carry-forward, and the carry-forward split into the part that expires and the part that does not. Rewritten in `src/lib/rules/leave-balance.ts`. One flat "balance" cannot answer the question that matters at an exit, which is how much of it is still live. |
| [OfficeDev/microsoft-teams-apps-newemployeeonboarding](https://github.com/OfficeDev/microsoft-teams-apps-newemployeeonboarding) | **MIT** ✓ | The checklist taxonomy — grouping a joiner's file into identity, pay details and statutory enrolment rather than one flat list, and separating what the employer needs from what the joiner must supply. Shapes `src/lib/rules/records.ts`. |
| [stepanogil/autonomous-hr-chatbot](https://github.com/stepanogil/autonomous-hr-chatbot) | **MIT** ✓ | Read as a reference for the tool-calling HR agent shape. Nothing was copied: its pattern lets the model compose the answer from retrieved policy text, which is the opposite of what Muster needs — here the model never contributes a figure. Recorded because it was evaluated, not because code came from it. |

**Rejected on licence grounds**, despite being the better parsers:

- [xitanggg/open-resume](https://github.com/xitanggg/open-resume) — **AGPL-3.0**. Copying it would oblige Muster to be AGPL too.
- [OmkarPathak/pyresparser](https://github.com/OmkarPathak/pyresparser) — **GPL-3.0**. Same problem.
- Whole-product HR systems are all copyleft and cannot be absorbed:
  [OrangeHRM](https://github.com/orangehrm/orangehrm) GPL-3.0,
  [Frappe HRMS](https://github.com/frappe/hrms) GPL-3.0,
  [Kimai](https://github.com/kimai/kimai) AGPL-3.0,
  [Documenso](https://github.com/documenso/documenso) AGPL-3.0.
- [Mastra](https://github.com/mastra-ai/mastra) — LICENSE.md splits the repo;
  not uniformly permissive.
- [minthcm/minthcm](https://github.com/minthcm/minthcm) — **AGPL-3.0**. The
  closest thing to an open-source HCM with agents in it, and unusable for
  exactly that reason.
- [zero8dotdev/avkash](https://github.com/zero8dotdev/avkash) — **AGPL-3.0**.
  An open-core leave and attendance API; the domain model was the appealing
  part and `urlaubsverwaltung` provided it permissively instead.

## Where the statutory figures came from

The brief asked for an open reference checked against primary sources. Each
table in `src/lib/rules/tax-tables.ts` carries its provenance inline. Summary:

| Figures | Status |
| --- | --- |
| ESI 0.75% employee / 3.25% employer, in force 1 Jul 2019, ₹176 daily-wage exemption | **Verified** against [esic.gov.in/contribution](https://www.esic.gov.in/contribution) |
| EPF 12% employer, 8.33% to EPS, 0.5% EDLI, ₹15,000 wage ceiling | **Verified** against EPFO's published material on [epfo.gov.in](https://www.epfo.gov.in). The contribution-rate PDF itself could not be parsed, so the 0.5% admin charge is the least certain figure here |
| ESI ₹21,000 coverage ceiling | **Not verified** — not stated on the ESIC page that was reachable |
| Income tax slabs, standard deduction, 87A rebate, cess, surcharge, 80C/80D/24(b) caps | **Not verified against a primary source.** incometaxindia.gov.in refuses automated access (HTTP 403). Corroborated only across independent tax publishers. **Re-check these before any real filing.** |
| Gratuity: five years' continuous service, 15/26 formula, six-month rounding, ₹20,00,000 ceiling | **Cited to the statute** in `src/lib/rules/gratuity.ts` section by section — Payment of Gratuity Act 1972 ss.2(s), 4(1), 4(2) and its proviso, 4(3); the ceiling raised by notification S.O. 1420(E) of 29 March 2018. Not re-verified against the gazette, for the same HTTP 403 reason |
| ESI ₹21,000 and EPF ₹15,000 wage ceilings used for records and benefits eligibility | Same status as above — the ESI ceiling remains the least certain figure in the codebase |
| Leave entitlement, carry-forward caps, encashment, notice periods, review cadence, group cover | **Not statutory, and not claimed to be.** Earned leave is set per state under the Shops and Establishments Acts and the Factories Act 1948 s.79; notice is contractual; reviews and group cover are entirely policy. Every one of these is a *policy input* read from a confirmed rule, with a documented default, and anything a person reads says which was used. See `leave-balance.ts`, `notice.ts`, `review-cycle.ts`, `benefits.ts` |

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
- [x] All six teammates, with real capabilities on tested rule code
- [x] A cron worker that sweeps records, cover, reviews and exits daily — and calls no model at all, which is what makes it safe to run unattended
- [ ] Migration 0007 applied (needs a Postgres connection string). Nothing
      depends on it: the four new desks needed no schema change, and `kind_label`
      degrades to the labels module.
