-- 0007 — additive only. No existing table is recreated or altered in shape.
--
-- The build brief expected this migration to create `connections`. It does not:
-- inspection of the live project found `connections` already present, with its
-- own `connection_category` / `connection_status` enums and RLS enabled. The
-- application was changed to match that table rather than replace it.
--
-- Two things are genuinely missing, and this migration adds them:
--
--   1. `exceptions.kind_label` — a human string beside the raw `kind` value.
--
--   2. Write policies on `connections` and `org_teams`. RLS is enabled on both
--      and members can read, but neither has an INSERT policy, so connecting a
--      data source or switching a teammate on fails with error 42501 for every
--      signed-in user. Reads were policied; writes were not. These policies use
--      the project's own `is_org_member(check_org_id)` helper, so the posture
--      matches the rest of the schema.
--
-- Safe to run more than once.

-- 1. A readable label alongside exceptions.kind -------------------------------

alter table public.exceptions
  add column if not exists kind_label text;

comment on column public.exceptions.kind_label is
  'Human-readable label for `kind`. `kind` stays the machine value; this is what a person reads. Agents write it when they raise the exception; src/lib/copy/labels.ts supplies the wording when it is null.';

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

-- 2. Write policies, scoped to org membership ---------------------------------

do $$
begin
  -- connections: a member of the org may connect, re-connect and disconnect.
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'connections'
      and policyname = 'connections_insert_org_member'
  ) then
    create policy connections_insert_org_member on public.connections
      for insert to authenticated
      with check (public.is_org_member(org_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'connections'
      and policyname = 'connections_update_org_member'
  ) then
    create policy connections_update_org_member on public.connections
      for update to authenticated
      using (public.is_org_member(org_id))
      with check (public.is_org_member(org_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'connections'
      and policyname = 'connections_delete_org_member'
  ) then
    create policy connections_delete_org_member on public.connections
      for delete to authenticated
      using (public.is_org_member(org_id));
  end if;

  -- org_teams: a member of the org may switch a teammate on or off.
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'org_teams'
      and policyname = 'org_teams_insert_org_member'
  ) then
    create policy org_teams_insert_org_member on public.org_teams
      for insert to authenticated
      with check (public.is_org_member(org_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'org_teams'
      and policyname = 'org_teams_update_org_member'
  ) then
    create policy org_teams_update_org_member on public.org_teams
      for update to authenticated
      using (public.is_org_member(org_id))
      with check (public.is_org_member(org_id));
  end if;
end
$$;
