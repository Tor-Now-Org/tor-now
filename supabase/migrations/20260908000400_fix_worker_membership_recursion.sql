-- 20260908000300_worker_reads_calendar_customer.sql moved the SECURITY DEFINER
-- escape hatch to "which businesses do I staff" (app.staffed_businesses()), but
-- left app_user_readable's EXISTS doing a plain, RLS-filtered read of the
-- *target* user's membership row:
--
--   exists (select 1 from membership where membership.user_id = app_user.id
--           and membership.business_id in (select app.staffed_businesses()))
--
-- That inner `select ... from membership` is still subject to
-- membership_readable (user_id = self OR app.manages(business_id)), and
-- app.manages is OWNER/MANAGER only. A WORKER passes app.staffed_businesses()
-- for themselves but can never see the *customer's* membership row, so the
-- EXISTS is always false and the policy still denies the read. An OWNER's
-- request only ever looked like it worked because app.manages(business_id) is
-- membership_readable's own admit condition, not because the policy was
-- correct.
--
-- The whole check — is target_user a member of a business I staff — has to run
-- inside one SECURITY DEFINER function, not split across a definer function
-- and a raw subquery.

create or replace function app.shares_staffed_business_with(target_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from membership target
    where target.user_id = target_user
      and target.business_id in (select app.staffed_businesses())
  );
$$;

revoke all on function app.shares_staffed_business_with(uuid) from public;
grant execute on function app.shares_staffed_business_with(uuid) to anon, authenticated;

drop policy app_user_readable on app_user;
create policy app_user_readable on app_user
  for select to authenticated
  using (
    id = app.current_user_id()
    or app.shares_staffed_business_with(id)
  );
