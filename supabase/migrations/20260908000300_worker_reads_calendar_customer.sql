-- 20260907000200_team_role_policies.sql widened appointment_readable (and the
-- schedule tables) to app.staffs, so a WORKER can see the appointments on
-- their own calendar. It also swapped app_user_readable's inner test from
-- app.manages to... nothing, since app_user_readable never went through
-- app.manages at all — it read `membership` directly in a plain subquery.
-- `membership` carries its own RLS (membership_readable), which a WORKER only
-- passes for their own row, so that subquery always came back empty for a
-- customer's row and the calendar showed "—" for every name (ADR 0016: a
-- WORKER reads their own calendars, and a customer's name is part of that).
--
-- The fix mirrors 20260901000600_row_level_security.sql's own answer to this:
-- app.owned_businesses() reads `membership` from inside a SECURITY DEFINER
-- function, so it isn't filtered by membership's policies. app_user_readable
-- needs the same escape hatch, widened to staffing rather than ownership.

create or replace function app.staffed_businesses()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select business_id from membership
  where user_id = app.current_user_id()
    and role in ('OWNER', 'MANAGER', 'WORKER');
$$;

revoke all on function app.staffed_businesses() from public;
grant execute on function app.staffed_businesses() to anon, authenticated;

drop policy app_user_readable on app_user;
create policy app_user_readable on app_user
  for select to authenticated
  using (
    id = app.current_user_id()
    or exists (
      select 1 from membership
      where membership.user_id = app_user.id
        and membership.business_id in (select app.staffed_businesses())
    )
  );
