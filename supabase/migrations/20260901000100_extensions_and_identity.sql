-- Extensions this schema depends on. btree_gist is required by ADR 0003's
-- exclusion constraint (it lets a scalar equality sit beside a range overlap
-- in one GiST index); pg_trgm backs the business discovery of ADR 0011.
create extension if not exists btree_gist;
create extension if not exists pg_trgm;
create extension if not exists pgcrypto;

-- Application helpers live in their own schema so they are never confused with
-- Supabase's `auth` helpers, and so a policy referring to one is obvious.
create schema if not exists app;

-- ---------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------

-- A person with an identity on the platform, identified by a verified phone
-- number (ADR 0004). Holds no relationship to any Business on its own.
create table app_user (
  id                uuid primary key default gen_random_uuid(),
  phone             text        not null unique,
  name              text        not null,
  birth_date        date,
  -- ADR 0008: deletion hides the row rather than removing it.
  deleted_at        timestamptz,
  -- ADR 0010: set only by another administrator, and audited.
  is_administrator  boolean     not null default false,
  created_at        timestamptz not null default now(),

  constraint app_user_phone_e164 check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  constraint app_user_name_present check (length(btrim(name)) > 0)
);

comment on table app_user is
  'A User (CONTEXT.md). Phone is the unique identity key; ADR 0008 notes that a soft-deleted row retains it, so that number cannot register again.';

-- ADR 0010: administrator login additionally requires the phone number to
-- appear on an explicit allowlist, so a stolen session or a mistakenly set
-- flag is not sufficient on its own.
create table administrator_allowlist (
  phone      text        primary key,
  note       text,
  added_by   uuid        references app_user (id),
  added_at   timestamptz not null default now(),

  constraint administrator_allowlist_e164 check (phone ~ '^\+[1-9][0-9]{7,14}$')
);

comment on table administrator_allowlist is
  'ADR 0010. Operational state: an administrator who changes their number is locked out until this is updated.';

-- ---------------------------------------------------------------------------
-- Identity helpers used by every policy below
-- ---------------------------------------------------------------------------

-- The caller, as re-established per transaction by the Edge Function
-- (ADR 0007). Returns null for the service_role connection, which carries no
-- claims and is not subject to these policies anyway.
create or replace function app.current_user_id()
returns uuid
language sql
stable
as $$
  select nullif(
    current_setting('request.jwt.claims', true)::jsonb ->> 'sub',
    ''
  )::uuid;
$$;

comment on function app.current_user_id() is
  'ADR 0007: identity is re-established per transaction via set_config, so this resolves correctly inside a real transaction on a pooled connection.';
