-- 0007 — additive only.
--
-- The build brief expected this migration to create `connections` as well. It
-- does not: inspection of the live project found `connections` already present,
-- with RLS enabled and its own `connection_category` / `connection_status`
-- enums. Recreating it would have meant touching an existing table, so the
-- application was changed to match that table instead.
--
-- What is genuinely missing is the human label on `exceptions`, whose `kind`
-- column holds raw values like `lop_discrepancy`.
--
-- Safe to run more than once.

alter table public.exceptions
  add column if not exists kind_label text;

comment on column public.exceptions.kind_label is
  'Human-readable label for `kind`. `kind` stays the machine value; this is what a person reads. Agents write it when they raise the exception; src/lib/copy/labels.ts supplies the wording when it is null.';

-- Backfill the values already in the table, so nothing renders as a raw key.
update public.exceptions
set kind_label = case kind
  when 'lop_discrepancy' then 'Attendance and leave records disagree'
  when 'wage_definition_breach' then 'Basic pay is below half of total wages'
  when 'declaration_proof_ineligible' then 'A claimed proof does not qualify'
  when 'declaration_proof_unverified' then 'A proof could not be verified'
  when 'proposed_rule' then 'A new rule is waiting for your approval'
  else initcap(replace(kind, '_', ' '))
end
where kind_label is null;
