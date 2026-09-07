-- ---------------------------------------------------------------------------
-- Row Level Security for the team roles (ADR 0016)
--
-- Mirrors 20260901000600_row_level_security.sql: a SECURITY DEFINER helper so a
-- policy on `membership` never reads `membership` through its own policies, and
-- business-scoped policies that never join.
-- ---------------------------------------------------------------------------

-- Everyone who administers a Business day to day. `app.owns` stays the narrower
-- test, for the destructive and financial actions an OWNER keeps alone.
create or replace function app.manages(target_business uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from membership
    where business_id = target_business
      and user_id = app.current_user_id()
      and role in ('OWNER', 'MANAGER')
  );
$$;

-- Everyone who works here, as against everyone with a Membership: a CUSTOMER is
-- a member too, so `app.is_member_of` is the wrong test for anything a customer
-- must not touch.
create or replace function app.staffs(target_business uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from membership
    where business_id = target_business
      and user_id = app.current_user_id()
      and role in ('OWNER', 'MANAGER', 'WORKER')
  );
$$;

revoke all on function app.manages(uuid) from public;
revoke all on function app.staffs(uuid) from public;
grant execute on function app.manages(uuid) to anon, authenticated;
grant execute on function app.staffs(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Users. Inviting by phone means the invited User may not exist yet, so the
-- person inviting creates the row (ADR 0016) — and then has to be able to read
-- it back, which an OWNER could and a MANAGER could not.
-- ---------------------------------------------------------------------------

drop policy app_user_readable on app_user;
create policy app_user_readable on app_user
  for select to authenticated
  using (
    id = app.current_user_id()
    or exists (
      select 1 from membership
      where membership.user_id = app_user.id
        and app.manages(membership.business_id)
    )
  );

-- Whoever administers any Business may create a User: that is an invitation to
-- a number that has never signed in. Reading `membership` here is safe from
-- recursion — the rows tested are the caller's own, which
-- `membership_readable` grants without consulting this table.
create policy app_user_created_by_manager on app_user
  for insert to authenticated
  with check (
    exists (
      select 1 from membership
      where user_id = app.current_user_id()
        and role in ('OWNER', 'MANAGER')
    )
  );

-- ---------------------------------------------------------------------------
-- Membership: a MANAGER may staff the Business, but only an OWNER makes an
-- OWNER. That keeps one trapdoor no MANAGER can walk through.
-- ---------------------------------------------------------------------------

drop policy membership_readable on membership;
create policy membership_readable on membership
  for select to authenticated
  using (user_id = app.current_user_id() or app.manages(business_id));

drop policy membership_created on membership;
create policy membership_created on membership
  for insert to authenticated
  with check (
    (role = 'CUSTOMER' and user_id = app.current_user_id())
    or (role <> 'OWNER' and app.manages(business_id))
    or app.owns(business_id)
    or (
      role = 'OWNER'
      and user_id = app.current_user_id()
      and not exists (
        select 1 from membership existing
        where existing.business_id = membership.business_id
          and existing.role = 'OWNER'
      )
    )
  );

-- Re-inviting someone who is already here changes their role rather than
-- inserting a second row, so the update path needs the same rule as the insert.
-- This subsumes membership_blocked_by_owner, which blocked a customer: a
-- MANAGER may now do that too, and the rest of the rule is unchanged.
drop policy membership_blocked_by_owner on membership;
create policy membership_updated on membership
  for update to authenticated
  using (app.manages(business_id))
  with check (role <> 'OWNER' or app.owns(business_id));

drop policy membership_removed on membership;
create policy membership_removed on membership
  for delete to authenticated
  using (
    app.owns(business_id)
    or (role <> 'OWNER' and app.manages(business_id))
  );

-- ---------------------------------------------------------------------------
-- membership_resource: the Business's administrators write it; a WORKER may
-- read their own rows, which is how the frontend knows which calendars to show.
-- ---------------------------------------------------------------------------

alter table membership_resource enable row level security;

create policy membership_resource_readable on membership_resource
  for select to authenticated
  using (
    app.manages(business_id)
    or exists (
      select 1 from membership
      where membership.id = membership_resource.membership_id
        and membership.user_id = app.current_user_id()
    )
  );

create policy membership_resource_written_by_manager on membership_resource
  for all to authenticated
  using (app.manages(business_id))
  with check (app.manages(business_id));

-- ---------------------------------------------------------------------------
-- What a MANAGER now administers alongside the OWNER. Billing (subscription,
-- payment) is deliberately absent: those policies stay on `app.owns`.
-- ---------------------------------------------------------------------------

drop policy business_updated_by_owner on business;
create policy business_updated_by_manager on business
  for update to authenticated
  using (app.manages(id))
  with check (app.manages(id));

drop policy resource_written_by_owner on resource;
create policy resource_written_by_manager on resource
  for all to authenticated
  using (app.manages(business_id))
  with check (app.manages(business_id));

drop policy service_written_by_owner on service;
create policy service_written_by_manager on service
  for all to authenticated
  using (app.manages(business_id))
  with check (app.manages(business_id));

-- The schedule layers, which a WORKER also writes — for their own Resources
-- only. The application layer holds that line (requireResourceAccess); RLS
-- bounds them to the Business, as it does for everyone who works there.
drop policy working_hours_written_by_owner on working_hours;
create policy working_hours_written_by_member on working_hours
  for all to authenticated
  using (app.staffs(business_id))
  with check (app.staffs(business_id));

drop policy date_override_written_by_owner on date_override;
create policy date_override_written_by_member on date_override
  for all to authenticated
  using (app.staffs(business_id))
  with check (app.staffs(business_id));

drop policy date_override_range_written_by_owner on date_override_range;
create policy date_override_range_written_by_member on date_override_range
  for all to authenticated
  using (app.staffs(business_id))
  with check (app.staffs(business_id));

drop policy block_owned on block;
create policy block_written_by_member on block
  for all to authenticated
  using (app.staffs(business_id))
  with check (app.staffs(business_id));

-- A WORKER works their calendar, which means reading and changing the
-- Appointments on it.
drop policy appointment_readable on appointment;
create policy appointment_readable on appointment
  for select to authenticated
  using (customer_id = app.current_user_id() or app.staffs(business_id));

drop policy appointment_booked on appointment;
create policy appointment_booked on appointment
  for insert to authenticated
  with check (
    (customer_id = app.current_user_id() and status = 'CONFIRMED')
    or app.staffs(business_id)
  );

drop policy appointment_changed on appointment;
create policy appointment_changed on appointment
  for update to authenticated
  using (customer_id = app.current_user_id() or app.staffs(business_id))
  with check (customer_id = app.current_user_id() or app.staffs(business_id));
