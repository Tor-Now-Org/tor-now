-- ---------------------------------------------------------------------------
-- Add-ons (ADR 0021): a Feature sold on its own, at one flat monthly price, on
-- top of any Plan — never more than two on sale at once. Owners add and cancel
-- their own; an administrator sells them, prices them, and stops selling them.
--
-- And what a Business owes beyond its monthly prices: the days before its next
-- payment when it adds back an Add-on it had, or moves up again to a Plan it
-- left. Only the first time is free until the next payment — otherwise adding,
-- cancelling and adding again would never pay for a day.
-- ---------------------------------------------------------------------------

-- A Feature on sale on its own. Stopping the sale keeps the row: those holding
-- it keep it, at their price, until they cancel.
create table addon_offer (
  feature            text        primary key check (app.is_feature(feature)),
  price_minor        integer     not null check (price_minor > 0),
  since              date        not null,
  stopped_on         date,
  -- A rise on its way to those who hold it: the price before it, the day it
  -- was announced, and the first and last renewals it reaches them at.
  rise_from_minor    integer     check (rise_from_minor > 0),
  rise_announced_on  date,
  rise_first_on      date,
  rise_last_on       date,
  created_at         timestamptz not null default now(),

  constraint addon_offer_rise_whole check (
    (rise_from_minor is null) = (rise_announced_on is null)
    and (rise_from_minor is null) = (rise_first_on is null)
    and (rise_from_minor is null) = (rise_last_on is null)
  )
);

-- Two on sale at most (ADR 0021). The domain refuses a third first; this
-- refuses whatever slips past it.
create or replace function app.addons_on_sale_within_limit()
returns trigger
language plpgsql
as $$
begin
  if (select count(*) from addon_offer where stopped_on is null) > 2 then
    raise exception 'No more than two Add-ons are on sale at once' using errcode = 'check_violation';
  end if;
  return null;
end;
$$;

create trigger addon_offer_within_limit
  after insert or update of stopped_on on addon_offer
  for each statement execute function app.addons_on_sale_within_limit();

-- One Business's hold of one Add-on. Kept after it ends: that it was held once
-- is what makes adding it back cost the days until the next payment.
create table addon_holding (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid        not null references business (id) on delete cascade,
  feature           text        not null check (app.is_feature(feature)),
  added_on          date        not null,
  -- The first renewal it is paid at.
  pays_from         date        not null,
  price_minor       integer     not null check (price_minor > 0),
  next_price_minor  integer     check (next_price_minor > 0),
  next_price_on     date,
  ends_on           date,
  ending            text        check (ending in ('CANCELLED', 'INCLUDED')),
  created_at        timestamptz not null default clock_timestamp(),

  constraint addon_holding_next_price_whole check ((next_price_minor is null) = (next_price_on is null)),
  constraint addon_holding_ending_whole check ((ends_on is null) = (ending is null))
);

-- At most one hold running on at a time; a cancelled one still running is
-- resumed rather than held twice.
create unique index addon_holding_one_running on addon_holding (business_id, feature) where ending is null;
create index addon_holding_by_business on addon_holding (business_id, created_at);
create index addon_holding_running on addon_holding (ends_on);

-- Days owed beyond a monthly price, settled by the payment they were part of.
create table days_owed (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid        not null references business (id) on delete cascade,
  kind          text        not null check (kind in ('ADDON_DAYS', 'PLAN_DAYS')),
  subject       text        not null,
  amount_minor  integer     not null check (amount_minor > 0),
  from_on       date        not null,
  through_on    date        not null,
  payment_id    uuid        references payment (id),
  created_at    timestamptz not null default clock_timestamp(),

  constraint days_owed_days check (through_on >= from_on),
  constraint days_owed_subject check (
    (kind = 'ADDON_DAYS' and app.is_feature(subject)) or (kind = 'PLAN_DAYS' and subject in ('SOLO', 'TEAM'))
  )
);

create index days_owed_unsettled on days_owed (business_id) where payment_id is null;

-- Every Plan a Business held while paying, or moved up to: moving up again to
-- one of them is paid from that day.
create table plan_held (
  business_id  uuid        not null references business (id) on delete cascade,
  plan         text        not null check (plan in ('SOLO', 'TEAM')),
  since        timestamptz not null default now(),
  primary key (business_id, plan)
);

-- Whoever has paid already holds the Plan they paid for.
insert into plan_held (business_id, plan)
select s.business_id, v.plan
from subscription s
join plan_version v on v.id = s.plan_version_id
where s.paid_through is not null
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Who may read and write what.
-- ---------------------------------------------------------------------------

alter table addon_offer    enable row level security;
alter table addon_holding  enable row level security;
alter table days_owed enable row level security;
alter table plan_held      enable row level security;

-- What is on sale is what the pricing page shows.
create policy addon_offer_readable_by_all on addon_offer
  for select to anon, authenticated using (true);

create policy addon_holding_readable_by_owner on addon_holding
  for select to authenticated using (app.owns(business_id));

create policy days_owed_readable_by_owner on days_owed
  for select to authenticated using (app.owns(business_id));

-- An owner's own act owes days — adding back an Add-on, moving up again — and
-- is written in their transaction. They can only ever add to what they owe,
-- never settle it: a payment is an administrator's to record.
create policy days_owed_owed_by_own_act on days_owed
  for insert to authenticated
  with check (app.owns(business_id) and payment_id is null);

create policy plan_held_readable_by_owner on plan_held
  for select to authenticated using (app.owns(business_id));

create policy plan_held_by_own_move on plan_held
  for insert to authenticated with check (app.owns(business_id));

revoke all on addon_holding, days_owed, plan_held from anon;
revoke update, delete, truncate on addon_holding, days_owed, plan_held from authenticated;
revoke insert on addon_holding from authenticated;
revoke insert, update, delete, truncate on addon_offer from anon, authenticated;

-- An owner adds an Add-on through here: at the price it is on sale for, never
-- one they name. When it applies and what is owed for it are the domain's.
create or replace function app.owner_adds_addon(
  p_business uuid,
  p_feature text,
  p_added_on date,
  p_pays_from date
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_price integer;
  v_id uuid;
begin
  if not app.owns(p_business) then
    raise exception 'Only the owner adds an Add-on' using errcode = 'insufficient_privilege';
  end if;
  select price_minor into v_price from addon_offer where feature = p_feature and stopped_on is null;
  if not found then
    raise exception 'This Add-on is not on sale' using errcode = 'check_violation';
  end if;
  insert into addon_holding (business_id, feature, added_on, pays_from, price_minor)
  values (p_business, p_feature, p_added_on, p_pays_from, v_price)
  returning id into v_id;
  return v_id;
end;
$$;

-- An owner ends their own: cancelling, or moving to a Plan that includes it.
create or replace function app.owner_ends_addon(
  p_business uuid,
  p_holding uuid,
  p_ends_on date,
  p_ending text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not app.owns(p_business) then
    raise exception 'Only the owner ends an Add-on' using errcode = 'insufficient_privilege';
  end if;
  update addon_holding
  set ends_on = p_ends_on, ending = p_ending
  where id = p_holding and business_id = p_business
    and (ending is null or (p_ending = 'INCLUDED' and ending = 'CANCELLED'));
  if not found then
    raise exception 'This Add-on is not running' using errcode = 'check_violation';
  end if;
end;
$$;

-- An owner withdraws their own cancellation, while the Add-on still runs.
create or replace function app.owner_resumes_addon(p_business uuid, p_holding uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not app.owns(p_business) then
    raise exception 'Only the owner resumes an Add-on' using errcode = 'insufficient_privilege';
  end if;
  update addon_holding
  set ends_on = null, ending = null
  where id = p_holding and business_id = p_business and ending = 'CANCELLED';
  if not found then
    raise exception 'This Add-on is not cancelled' using errcode = 'check_violation';
  end if;
end;
$$;

revoke all on function app.owner_adds_addon(uuid, text, date, date) from public;
revoke all on function app.owner_ends_addon(uuid, uuid, date, text) from public;
revoke all on function app.owner_resumes_addon(uuid, uuid) from public;
grant execute on function app.owner_adds_addon(uuid, text, date, date) to authenticated;
grant execute on function app.owner_ends_addon(uuid, uuid, date, text) to authenticated;
grant execute on function app.owner_resumes_addon(uuid, uuid) to authenticated;

-- What every Feature check needs now carries the Add-ons held, and — while
-- nothing has been paid — the Trial's end, because a Trial includes every
-- Add-on on sale. Still nothing else of the Subscription.
drop function app.entitlement_basis(uuid);

create function app.entitlement_basis(p_business uuid)
returns table (plan_version_id uuid, grants jsonb, addons jsonb, trial_ends_on date)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select s.plan_version_id,
         coalesce(
           (select jsonb_agg(jsonb_build_object('feature', g.feature, 'endsOn', g.ends_on))
            from feature_grant g
            where g.business_id = p_business),
           '[]'::jsonb),
         coalesce(
           (select jsonb_agg(jsonb_build_object('feature', h.feature, 'addedOn', h.added_on, 'endsOn', h.ends_on))
            from addon_holding h
            where h.business_id = p_business),
           '[]'::jsonb),
         case when s.paid_through is null then s.trial_ends_on end
  from subscription s
  where s.business_id = p_business;
$$;

revoke all on function app.entitlement_basis(uuid) from public;
grant execute on function app.entitlement_basis(uuid) to anon, authenticated;

-- An owner's own Add-on acts are told back to them in their transaction, as
-- their Plan changes are.
drop policy notice_written_for_own_act on notice;
create policy notice_written_for_own_act on notice
  for insert to authenticated
  with check (
    app.owns(business_id)
    and kind in (
      'TRIAL_STARTED', 'PLAN_CHANGED', 'MOVE_SCHEDULED', 'CALENDARS_RESUMED',
      'ADDON_ADDED', 'ADDON_CANCELLED', 'ADDON_INCLUDED'
    )
  );

alter table notice drop constraint notice_kind_check;
alter table notice add constraint notice_kind_check check (kind in (
  'TRIAL_STARTED', 'TRIAL_ENDING', 'PAYMENT_LATE', 'DEACTIVATED',
  'PAYMENT_RECORDED', 'PLAN_CHANGED', 'MOVE_SCHEDULED', 'MOVE_SOON',
  'MOVE_APPLIED', 'CALENDARS_PAUSED', 'CALENDARS_RESUMED',
  'FEATURES_GRANTED', 'GRANT_EXTENDED', 'GRANT_ENDING', 'GRANT_ENDED',
  'EDITION_ANNOUNCED', 'EDITION_SOON', 'EDITION_APPLIED', 'EDITION_CANCELLED',
  'PLAN_IMPROVED',
  'PREVIEW_STARTED', 'PREVIEW_EXTENDED', 'PREVIEW_KEPT', 'PREVIEW_LEAVING', 'PREVIEW_ENDING',
  'ADDON_OFFERED', 'ADDON_ADDED', 'ADDON_CANCELLED', 'ADDON_PRICE_RISING', 'ADDON_PRICE_SOON',
  'ADDON_RISE_CANCELLED', 'ADDON_PRICE_LOWERED', 'ADDON_INCLUDED'
));

comment on table addon_offer is
  'ADR 0021. A Feature on sale on its own, at one flat monthly price, on top of any Plan. Two at most.';
comment on table addon_holding is
  'ADR 0021. One Business''s hold of one Add-on. Kept after it ends: adding it back owes the days.';
comment on table days_owed is
  'Days owed beyond a monthly price, settled by the payment they were part of.';
comment on table plan_held is
  'Every Plan a Business held while paying, or moved up to. Moving up again owes the days.';
