-- A mutable search_path on a function referenced by RLS policies is a
-- privilege-escalation seam: a caller who can set search_path chooses which
-- `membership` the policy sees. Pin it.
create or replace function app.current_user_id()
returns uuid
language sql
stable
set search_path = public, pg_temp
as $$
  select nullif(
    current_setting('request.jwt.claims', true)::jsonb ->> 'sub',
    ''
  )::uuid;
$$;

-- `public.rls_auto_enable` is Supabase's own event trigger that enables RLS on
-- newly created tables. It is never meant to be called directly, and being in
-- `public` it is otherwise exposed over PostgREST as an RPC.
revoke execute on function public.rls_auto_enable() from anon, authenticated, public;

-- Extensions do not belong in the schema PostgREST exposes.
alter extension pg_trgm set schema extensions;
alter extension btree_gist set schema extensions;
