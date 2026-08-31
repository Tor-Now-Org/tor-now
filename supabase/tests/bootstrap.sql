-- What Supabase provides before any of our migrations run, recreated so the
-- same migrations apply unchanged to a plain Postgres — a CI service container
-- or a developer's laptop. Nothing here is part of the application schema; it
-- exists so the tests exercise the real migrations rather than a variant.

-- The two roles every RLS policy is written against.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
end $$;

-- Supabase keeps extensions out of the schema PostgREST exposes, and migration
-- 0007 relocates them there. Without this schema that migration steps aside and
-- the trigram search would then be looking in the wrong place.
create schema if not exists extensions;
grant usage on schema extensions to anon, authenticated;

-- The connecting role must be able to become either of the above, which is how
-- ADR 0007 re-establishes the caller's identity per transaction.
do $$
begin
  execute format('grant anon, authenticated to %I', current_user);
exception when others then
  raise notice 'could not grant anon/authenticated to %: %', current_user, sqlerrm;
end $$;
