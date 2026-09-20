-- 0007 — additive only.
--
-- Adds nothing to, and recreates nothing of, migrations 0001–0006. Two changes:
--   1. exceptions.kind_label — a human string beside the raw `kind` value.
--   2. connections — per-org data-source connections behind the Marketplace.
--
-- Safe to run more than once.

-- 1. A readable label alongside exceptions.kind -------------------------------

alter table public.exceptions
  add column if not exists kind_label text;

comment on column public.exceptions.kind_label is
  'Human-readable label for `kind`. `kind` stays the machine value; this is what a person reads.';

-- 2. Per-org data-source connections ------------------------------------------

create table if not exists public.connections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  category text not null,
  provider_key text not null,
  label text not null,
  status text not null default 'connected',
  credentials jsonb not null default '{}'::jsonb,
  connected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.connections is
  'A data source an organisation has connected. One row per org per provider.';

-- One connection per provider per org; reconnecting updates the existing row.
create unique index if not exists connections_org_provider_key
  on public.connections (org_id, provider_key);

create index if not exists connections_org_id_idx
  on public.connections (org_id);

-- 3. Row Level Security, scoped to org membership ------------------------------

alter table public.connections enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'connections'
      and policyname = 'connections_select_own_org'
  ) then
    create policy connections_select_own_org on public.connections
      for select
      using (
        exists (
          select 1 from public.org_members m
          where m.org_id = connections.org_id
            and m.user_id = auth.uid()
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'connections'
      and policyname = 'connections_insert_own_org'
  ) then
    create policy connections_insert_own_org on public.connections
      for insert
      with check (
        exists (
          select 1 from public.org_members m
          where m.org_id = connections.org_id
            and m.user_id = auth.uid()
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'connections'
      and policyname = 'connections_update_own_org'
  ) then
    create policy connections_update_own_org on public.connections
      for update
      using (
        exists (
          select 1 from public.org_members m
          where m.org_id = connections.org_id
            and m.user_id = auth.uid()
        )
      )
      with check (
        exists (
          select 1 from public.org_members m
          where m.org_id = connections.org_id
            and m.user_id = auth.uid()
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'connections'
      and policyname = 'connections_delete_own_org'
  ) then
    create policy connections_delete_own_org on public.connections
      for delete
      using (
        exists (
          select 1 from public.org_members m
          where m.org_id = connections.org_id
            and m.user_id = auth.uid()
        )
      );
  end if;
end
$$;
