-- ---------------------------------------------------------------------------
-- Fix: a WORKER reads the customers of the business they staff, again.
--
-- 20260908000400 established why this check cannot be written as a plain
-- subquery: the inner read of the *target* user's membership row is itself
-- subject to membership_readable (user_id = self OR app.manages(business_id)),
-- and app.manages is OWNER/MANAGER only — so a WORKER's EXISTS is always
-- false and the policy denies the read. The whole question has to be asked
-- inside one SECURITY DEFINER function, which is what
-- app.shares_staffed_business_with() is for.
--
-- 20260912000100 needed something real: a manager inviting by phone has to be
-- able to find a User who signed up elsewhere and holds no Membership here. It
-- added that correctly — but rewrote the staff clause back into the raw
-- subquery 20260908000400 had just removed, and with it went the worker's
-- ability to read anybody. Their day screen answers with appointments whose
-- customer it cannot name.
--
-- The three cases, each asked in a way that can answer truthfully:
--   1. yourself, always — your own row;
--   2. anyone holding a Membership at a business you staff, any role, through
--      the definer function, because the caller cannot see that row directly;
--   3. anyone at all, if you manage a business somewhere — the invitation
--      lookup. Its subquery reads only the caller's *own* membership rows,
--      which membership_readable admits on `user_id = self`, so this one is
--      answerable directly.
-- ---------------------------------------------------------------------------

create or replace function app.manages_any_business()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from membership
    where user_id = app.current_user_id()
      and role in ('OWNER', 'MANAGER')
  );
$$;

revoke all on function app.manages_any_business() from public;
grant execute on function app.manages_any_business() to anon, authenticated;

drop policy app_user_readable on app_user;
create policy app_user_readable on app_user
  for select to authenticated
  using (
    id = app.current_user_id()
    or app.shares_staffed_business_with(id)
    or app.manages_any_business()
  );
