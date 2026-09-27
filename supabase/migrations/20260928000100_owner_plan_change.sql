-- ---------------------------------------------------------------------------
-- Owners change their own Plan (ADR 0020).
--
-- The Subscription still has no update policy: an owner must not be able to
-- write their own billing terms. What they may do is narrow — move to a current
-- edition of a Plan, schedule such a move, or withdraw one — and this function
-- is the only door for it. The domain works out whether a move applies now or
-- at the renewal; this authorizes it and writes it.
-- ---------------------------------------------------------------------------

create or replace function app.is_current_version(p_version uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from plan_version v
    where v.id = p_version
      and v.number = (select max(w.number) from plan_version w where w.plan = v.plan)
  );
$$;

create or replace function app.owner_sets_plan(
  p_business uuid,
  p_plan_version uuid,
  p_scheduled_version uuid,
  p_scheduled_on date
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_held uuid;
begin
  if not app.owns(p_business) then
    raise exception 'Only the owner changes the plan' using errcode = 'insufficient_privilege';
  end if;

  select plan_version_id into v_held from subscription where business_id = p_business;

  -- Staying on the edition already held is always allowed, however old it is;
  -- anything else must be what a new Business would join today.
  if p_plan_version <> v_held and not app.is_current_version(p_plan_version) then
    raise exception 'A Plan is changed to its current edition' using errcode = 'check_violation';
  end if;
  if p_scheduled_version is not null and not app.is_current_version(p_scheduled_version) then
    raise exception 'A move is scheduled to a current edition' using errcode = 'check_violation';
  end if;

  update subscription
  set plan_version_id = p_plan_version,
      scheduled_version_id = p_scheduled_version,
      scheduled_on = p_scheduled_on
  where business_id = p_business;
end;
$$;

revoke all on function app.owner_sets_plan(uuid, uuid, uuid, date) from public;
grant execute on function app.owner_sets_plan(uuid, uuid, uuid, date) to authenticated;

-- The calendars an owner chose not to keep when scheduling a move to a Plan
-- with fewer: they pause on the day the move applies, and not before.
alter table resource add column pause_on date;

comment on column resource.pause_on is
  'The day this calendar pauses, set when its owner schedules a move to a smaller Plan.';
