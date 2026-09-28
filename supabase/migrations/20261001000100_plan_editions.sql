-- ---------------------------------------------------------------------------
-- Editing Plans (ADR 0020, ADR 0021). A change that takes value away becomes a
-- new edition, which new Businesses join at once and existing ones move to at
-- their renewal after thirty days' Notice. Until the first of them moves, it
-- can be cancelled: the edition is then withdrawn, and never current again.
-- ---------------------------------------------------------------------------

alter table plan_version
  -- Set when a pending edition is cancelled. A withdrawn edition is kept, as
  -- the audit log and anyone's history point at it, but nobody is on it.
  add column withdrawn_at timestamptz,
  -- The first day an existing Business moves onto this edition. Cancelling is
  -- possible only before it.
  add column first_move_on date;

comment on column plan_version.withdrawn_at is
  'When a pending edition was cancelled. Never current again; nobody is on it.';
comment on column plan_version.first_move_on is
  'The first day an existing Business moves onto this edition; it can be cancelled until then.';

-- The edition a Plan's new Businesses join: its highest-numbered one that was
-- not withdrawn. One definition, used by everything below.
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
      and v.withdrawn_at is null
      and v.number = (
        select max(w.number) from plan_version w
        where w.plan = v.plan and w.withdrawn_at is null
      )
  );
$$;

create or replace function app.create_default_subscription()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into subscription (business_id, plan_version_id)
  values (
    new.id,
    (select id from plan_version
     where plan = 'SOLO' and withdrawn_at is null
     order by number desc limit 1)
  );
  return new;
end;
$$;

create or replace function app.start_subscription(
  p_business uuid,
  p_plan_version uuid,
  p_trial_ends_on date
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not app.owns(p_business) then
    raise exception 'Only the owner starts a Subscription' using errcode = 'insufficient_privilege';
  end if;

  if not exists (select 1 from business where id = p_business and created_at = now()) then
    raise exception 'A Subscription is started only when its Business opens'
      using errcode = 'insufficient_privilege';
  end if;

  if not app.is_current_version(p_plan_version) then
    raise exception 'A new Business joins a current Plan Version' using errcode = 'check_violation';
  end if;

  if p_trial_ends_on is not null then
    if p_trial_ends_on > current_date + 31 then
      raise exception 'A Trial is thirty days' using errcode = 'check_violation';
    end if;
    update app_user set trial_taken_on = current_date
    where id = app.current_user_id() and trial_taken_on is null;
    if not found then
      raise exception 'This owner has had their Trial' using errcode = 'check_violation';
    end if;
  end if;

  update subscription
  set plan_version_id = p_plan_version,
      trial_ends_on = p_trial_ends_on
  where business_id = p_business;
end;
$$;

-- An owner is told when their Plan changes for the worse, reminded before it
-- lands, told when it lands or is cancelled, and told when it gets better.
alter table notice drop constraint notice_kind_check;
alter table notice add constraint notice_kind_check check (kind in (
  'TRIAL_STARTED', 'TRIAL_ENDING', 'PAYMENT_LATE', 'DEACTIVATED',
  'PAYMENT_RECORDED', 'PLAN_CHANGED', 'MOVE_SCHEDULED', 'MOVE_SOON',
  'MOVE_APPLIED', 'CALENDARS_PAUSED', 'CALENDARS_RESUMED',
  'FEATURES_GRANTED', 'GRANT_EXTENDED', 'GRANT_ENDING', 'GRANT_ENDED',
  'EDITION_ANNOUNCED', 'EDITION_SOON', 'EDITION_APPLIED', 'EDITION_CANCELLED',
  'PLAN_IMPROVED'
));
