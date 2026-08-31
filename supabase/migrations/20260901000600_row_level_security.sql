-- ---------------------------------------------------------------------------
-- ADR 0007: isolation is enforced twice, deliberately. Row Level Security is
-- the authority and survives a forgotten predicate in application code; the
-- domain layer additionally checks Membership explicitly to produce meaningful
-- errors rather than silently missing rows.
--
-- These policies bind the `anon` and `authenticated` roles. Administrator
-- access runs over the service_role connection, which bypasses RLS entirely —
-- ADR 0010 is what bounds that path, and ADR 0006 audits it.
-- ---------------------------------------------------------------------------

grant usage on schema app to anon, authenticated;

-- Membership lookups from inside a policy must not themselves be filtered by
-- the policies on `membership`, which would recurse. SECURITY DEFINER breaks
-- that cycle; the functions are narrow enough to be safe on their own terms.
create or replace function app.is_member_of(target_business uuid)
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
  );
$$;

create or replace function app.owns(target_business uuid)
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
      and role = 'OWNER'
  );
$$;

-- The Businesses the caller owns. Used to scope an owner's view of Users.
create or replace function app.owned_businesses()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select business_id from membership
  where user_id = app.current_user_id() and role = 'OWNER';
$$;

revoke all on function app.is_member_of(uuid) from public;
revoke all on function app.owns(uuid) from public;
revoke all on function app.owned_businesses() from public;
grant execute on function app.is_member_of(uuid) to anon, authenticated;
grant execute on function app.owns(uuid) to anon, authenticated;
grant execute on function app.owned_businesses() to anon, authenticated;

-- ---------------------------------------------------------------------------

alter table app_user                enable row level security;
alter table administrator_allowlist enable row level security;
alter table business                enable row level security;
alter table membership              enable row level security;
alter table resource                enable row level security;
alter table service                 enable row level security;
alter table working_hours           enable row level security;
alter table date_override           enable row level security;
alter table date_override_range     enable row level security;
alter table block                   enable row level security;
alter table appointment             enable row level security;
alter table subscription            enable row level security;
alter table payment                 enable row level security;
alter table audit_log               enable row level security;
alter table notification_outbox     enable row level security;
alter table verification_code       enable row level security;

-- Tables with no policy at all are readable by nobody but service_role. That
-- is the intent for these three, and stating it here stops a later reader
-- wondering whether the policies were forgotten.
comment on table audit_log is
  'ADR 0006. RLS enabled with no policy: reachable only over the service_role connection.';
comment on table verification_code is
  'ADR 0004. RLS enabled with no policy: only the Edge Function may issue or check a code.';
comment on table notification_outbox is
  'ADR 0005. RLS enabled with no policy: written by the domain layer, drained by the worker.';

-- ---------------------------------------------------------------------------
-- Users
-- ---------------------------------------------------------------------------

-- A User sees themselves. An owner additionally sees the Users who hold a
-- Membership with a Business they own — that is what a customer record is.
create policy app_user_readable on app_user
  for select to authenticated
  using (
    id = app.current_user_id()
    or exists (
      select 1 from membership
      where membership.user_id = app_user.id
        and membership.business_id in (select app.owned_businesses())
    )
  );

create policy app_user_updates_self on app_user
  for update to authenticated
  using (id = app.current_user_id())
  with check (id = app.current_user_id());

-- ---------------------------------------------------------------------------
-- Business and Membership
-- ---------------------------------------------------------------------------

-- ADR 0011: a Business is discoverable the moment it registers. An inactive
-- one stays visible to its own members so an owner can still see it.
create policy business_readable on business
  for select to anon, authenticated
  using (active or app.is_member_of(id));

create policy business_created_by_anyone on business
  for insert to authenticated
  with check (true);

create policy business_updated_by_owner on business
  for update to authenticated
  using (app.owns(id))
  with check (app.owns(id));

create policy membership_readable on membership
  for select to authenticated
  using (user_id = app.current_user_id() or app.owns(business_id));

-- A customer relationship is created by the customer in the act of booking; an
-- owner may also add one. The OWNER role is not self-grantable except on a
-- Business with no owner yet, which is how registration works.
create policy membership_created on membership
  for insert to authenticated
  with check (
    (role = 'CUSTOMER' and user_id = app.current_user_id())
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

create policy membership_removed on membership
  for delete to authenticated
  using (app.owns(business_id));

-- ---------------------------------------------------------------------------
-- Resources, Services and the schedule layers
--
-- Read access is public for everything a customer needs in order to see when a
-- Business is free. Write access is the owner's alone.
-- ---------------------------------------------------------------------------

create policy resource_readable on resource
  for select to anon, authenticated
  using (exists (select 1 from business where business.id = resource.business_id
                   and (business.active or app.is_member_of(business.id))));

create policy resource_written_by_owner on resource
  for all to authenticated
  using (app.owns(business_id))
  with check (app.owns(business_id));

create policy service_readable on service
  for select to anon, authenticated
  using (exists (select 1 from business where business.id = service.business_id
                   and (business.active or app.is_member_of(business.id))));

create policy service_written_by_owner on service
  for all to authenticated
  using (app.owns(business_id))
  with check (app.owns(business_id));

create policy working_hours_readable on working_hours
  for select to anon, authenticated
  using (true);

create policy working_hours_written_by_owner on working_hours
  for all to authenticated
  using (app.owns(business_id))
  with check (app.owns(business_id));

create policy date_override_readable on date_override
  for select to anon, authenticated
  using (true);

create policy date_override_written_by_owner on date_override
  for all to authenticated
  using (app.owns(business_id))
  with check (app.owns(business_id));

create policy date_override_range_readable on date_override_range
  for select to anon, authenticated
  using (true);

create policy date_override_range_written_by_owner on date_override_range
  for all to authenticated
  using (app.owns(business_id))
  with check (app.owns(business_id));

-- ADR 0007: the browser never reads `block`. A Block carries a reason, which is
-- the owner's business and not a customer's. Availability reaches the customer
-- as start times only, with the Block already subtracted.
create policy block_owned on block
  for all to authenticated
  using (app.owns(business_id))
  with check (app.owns(business_id));

-- ---------------------------------------------------------------------------
-- Appointments
--
-- ADR 0007: the browser never reads this table either. These policies bound
-- the Edge Function's own connection, which is the only thing that touches it.
-- ---------------------------------------------------------------------------

create policy appointment_readable on appointment
  for select to authenticated
  using (customer_id = app.current_user_id() or app.owns(business_id));

create policy appointment_booked on appointment
  for insert to authenticated
  with check (
    (customer_id = app.current_user_id() and status = 'CONFIRMED')
    or app.owns(business_id)
  );

-- Cancelling is an update. A customer may always cancel their own (the
-- Cancellation Window governs visibility, not permission); an owner may
-- cancel, reschedule or mark a no show.
create policy appointment_changed on appointment
  for update to authenticated
  using (customer_id = app.current_user_id() or app.owns(business_id))
  with check (customer_id = app.current_user_id() or app.owns(business_id));

-- ---------------------------------------------------------------------------
-- Billing. An owner may see what they owe; only an administrator, over
-- service_role, may record a Payment or change a plan.
-- ---------------------------------------------------------------------------

create policy subscription_readable_by_owner on subscription
  for select to authenticated
  using (app.owns(business_id));

create policy payment_readable_by_owner on payment
  for select to authenticated
  using (app.owns(business_id));
