# Muster — Layout Spec

## Global shell

Left sidebar, fixed ~220px: "Muster" wordmark top, then 5 nav items stacked vertically (Home, Catchup, Team Members, Marketplace) each with a simple icon + label, current page highlighted with `--accent-soft` background. Profile pinned to the bottom of the sidebar (small avatar/initial circle + org name), acting as both a nav entry and account access. Main content area: max-width ~880px, centered, 24px padding, consistent 16px-radius cards throughout on the warm off-white background.

## Home

- Greeting header: "Hi [name], good to see you."
- Team strip: horizontal row of teammate cards. Holly's card — avatar/initial circle, name, one-line role, a small live-status dot + short status text ("All caught up" / "Working on September payroll"). Other teammates — same card shape, visually dimmed, "Coming soon" tag, not clickable.
- Goal box below the strip: large rounded input, placeholder "Tell your team what you need — e.g. Run September payroll." On submit, it becomes a conversation thread in place — agent messages left-aligned, your message right-aligned or otherwise visually distinct; any message needing a decision carries inline buttons right there in the thread.
- Below or beside the thread (collapsible on narrow screens): a short "what's happening" strip, 2-3 lines pulled from Catchup, each clickable through to it.

## Catchup

- Header: "Catchup" + one-line count, e.g. "3 things need you."
- Three stacked sections:
  - **Needs you now**: cards, each showing who/what it's about, what was found, the conclusion stated in plain words with confidence shown as secondary/small (not a lone percentage), the rule applied in one line, three buttons — Approve / Reject / Tell us what's wrong.
  - **Coming up**: a filterable list (type/status/date chips above it) — what's in flight, who it's about, its stage in plain words, due date.
  - **Recently resolved**: compact, muted, last 7 days, read-only.

## Team Members

- Header: "Your team."
- Card grid, 2-3 per row: avatar/initial, name, one-line desk description, status. Live → clickable; coming-soon → dimmed, no click.
- Detail page (e.g. Holly): header (name, avatar, role restated) → horizontal tab bar (Overview / Data sources / Rules / What Holly knows / Activity) → tab content.
  - **Overview**: a short paragraph on her role, then a row of small cards, one per agent (Input/Structure/Tax), each a plain-language line on what it does.
  - **Data sources**: same card style as Marketplace, filtered to what she needs, connect state shown inline.
  - **Rules**: paste-a-sheet textarea + submit, with her currently confirmed rules listed below by label and short description — never a raw key.
  - **What Holly knows**: sectioned read-only view — Structure / Rules / Calendar / Learned facts — each item with its evidence in one line.
  - **Activity**: reverse-chronological list, filterable by person and date range, with an export action.

## Marketplace

- Header: "Connect your data."
- Three labeled sections (People & attendance data / Messaging / Government & statutory), each a card grid: provider name, one short description, status tag (Connected / Available / Coming soon), a small tag naming which teammate uses it, a Connect button (opens a short form, e.g. paste a token) or a disabled state for coming-soon entries.

## Profile

Simple stacked layout: organisation name (editable), your email (read-only), a list of org members (name, email, role), sign-out at the bottom, visually set apart as a destructive-toned action.

## Onboarding

(pre-Home — full-bleed centered card, same background, no sidebar yet)

- Step 1: "What should we call your organisation?" — one field, continue.
- Step 2: "Pick your first teammate" — same card grid as Team Members; continue enables once Holly's picked.
- Step 3: "Connect what Holly needs" — Marketplace filtered to her required categories, Connect or "I'll do this later" per card, plus a prominent "Skip for now" that always continues regardless.
- Lands on Home; the sidebar appears from here on, not before.
