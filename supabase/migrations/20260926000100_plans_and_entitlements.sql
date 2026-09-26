-- ---------------------------------------------------------------------------
-- Plans, Plan Versions and Entitlements (ADRs 0019, 0020, 0021).
--
-- A Subscription stops naming a plan and stops carrying its own price: it
-- points at one fixed edition of a Plan's terms, and the price is that
-- edition's. Billing becomes monthly only, a Trial replaces the free plan, and
-- the Trial is remembered on the owner so that it is given once per person
-- rather than once per Business.
-- ---------------------------------------------------------------------------

-- The closed list of Features lives in code (packages/domain billing/feature.ts).
-- The database repeats it only to refuse a value no code could have written.
create or replace function app.is_feature(value text)
returns boolean
language sql
immutable
as $$
  select value in ('REMINDERS', 'CUSTOMER_HISTORY', 'CUSTOMER_BLOCKING', 'TEAM_ROLES', 'WAITING_LIST');
$$;

create or replace function app.are_features(candidates text[])
returns boolean
language sql
immutable
as $$
  select coalesce(bool_and(value is not null and app.is_feature(value)), true)
  from unnest(candidates) as value;
$$;

-- One fixed edition of a Plan's terms. The edition new Businesses join is the
-- highest-numbered one of its Plan.
create table plan_version (
  id                  uuid primary key default gen_random_uuid(),
  plan                text        not null check (plan in ('SOLO', 'TEAM')),
  number              integer     not null check (number >= 1),
  features            text[]      not null default '{}',
  resource_allowance  integer     not null check (resource_allowance >= 1),
  price_minor         integer     not null check (price_minor >= 0),
  created_at          timestamptz not null default now(),

  unique (plan, number),
  constraint plan_version_features_known check (app.are_features(features))
);

-- A Feature offered on every Plan until a stated day, not yet placed.
create table feature_preview (
  feature     text        primary key check (app.is_feature(feature)),
  ends_on     date        not null,
  created_at  timestamptz not null default now()
);

-- One Feature for one Business beyond its Plan Version, with a reason and an
-- end. Never permanent (ADR 0021).
create table feature_grant (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid        not null references business (id) on delete cascade,
  feature     text        not null check (app.is_feature(feature)),
  reason      text        not null check (length(btrim(reason)) > 0),
  ends_on     date        not null,
  granted_by  uuid        not null references app_user (id),
  created_at  timestamptz not null default now()
);

create index feature_grant_by_business on feature_grant (business_id, ends_on);

-- The owner's Trial, remembered on the person: opening a second Business does
-- not start another.
alter table app_user add column trial_taken_on date;

-- The first editions. Prices are the pricing page's placeholders; an
-- administrator sets the real ones through the Catalogue.
insert into plan_version (plan, number, features, resource_allowance, price_minor) values
  ('SOLO', 1, array['REMINDERS'], 1, 4900),
  ('TEAM', 1, array['REMINDERS', 'CUSTOMER_HISTORY', 'CUSTOMER_BLOCKING', 'TEAM_ROLES'], 5, 8900);

-- New, never promised, and of unknown cost: the waiting list starts as a
-- sixty-day Preview on both Plans rather than being placed on a guess.
insert into feature_preview (feature, ends_on) values ('WAITING_LIST', current_date + 59);

-- ---------------------------------------------------------------------------
-- The Subscription's new shape.
-- ---------------------------------------------------------------------------

alter table subscription
  add column plan_version_id      uuid references plan_version (id),
  add column trial_ends_on        date,
  add column scheduled_version_id uuid references plan_version (id),
  add column scheduled_on         date,
  add constraint subscription_move_whole check (
    (scheduled_version_id is null) = (scheduled_on is null)
  ),
  -- Null until the first Payment: a Trial is not paid time.
  alter column paid_through drop not null,
  alter column paid_through drop default;

-- Every existing Business opens a thirty-day Trial on Team from today, so none
-- starts out over its Resource Allowance. One that has ever paid keeps what it
-- paid for and is put on Team with no Trial.
update subscription set plan_version_id =
  (select id from plan_version where plan = 'TEAM' and number = 1);

update subscription s
set trial_ends_on = current_date + 29,
    paid_through = null
where not exists (select 1 from payment p where p.subscription_id = s.id);

-- …and the owners of those Businesses have had their Trial.
update app_user u
set trial_taken_on = current_date
where exists (
  select 1 from membership m
  join subscription s on s.business_id = m.business_id
  where m.user_id = u.id and m.role = 'OWNER' and s.trial_ends_on is not null
);

alter table subscription
  alter column plan_version_id set not null,
  drop column plan,
  drop column amount_minor,
  drop column billing_period;

-- A Business opened by any path gets a Subscription on the cheapest current
-- edition with neither Trial nor payment — lapsed until the registration path
-- decides otherwise in the same transaction. Failing closed: a path that
-- forgets to grant a Trial deactivates a Business, it never gives one away.
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
    (select id from plan_version where plan = 'SOLO' order by number desc limit 1)
  );
  return new;
end;
$$;

-- A Trial once taken stays taken. Nothing in the product clears it, and a
-- guarantee in the database outlives any promise the application makes.
create or replace function app.keep_trial_taken()
returns trigger
language plpgsql
as $$
begin
  if old.trial_taken_on is not null
     and new.trial_taken_on is distinct from old.trial_taken_on then
    raise exception 'A Trial once taken cannot be given back'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger app_user_trial_stays_taken
  before update of trial_taken_on on app_user
  for each row execute function app.keep_trial_taken();

-- Setting a new Business's Plan and Trial, which its owner may not otherwise
-- write: the Subscription has no update policy, so that an owner cannot set
-- their own billing terms.
--
-- It works only inside the transaction that created the Business — `now()` is
-- the transaction's start, and so is the Business's `created_at` — so it cannot
-- be called later to start a second Trial. The dates are the domain's to work
-- out; this only authorizes and writes them, and claims the owner's one Trial
-- atomically, so two registrations racing cannot both receive it.
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

  if not exists (
    select 1 from plan_version v
    where v.id = p_plan_version
      and v.number = (select max(w.number) from plan_version w where w.plan = v.plan)
  ) then
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

revoke all on function app.start_subscription(uuid, uuid, date) from public;
grant execute on function app.start_subscription(uuid, uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- Who may read what.
-- ---------------------------------------------------------------------------

alter table plan_version    enable row level security;
alter table feature_preview enable row level security;
alter table feature_grant   enable row level security;

-- The Catalogue is what the public pricing page shows; there is nothing in it
-- to hide from anyone.
create policy plan_version_readable_by_all on plan_version
  for select to anon, authenticated using (true);
create policy feature_preview_readable_by_all on feature_preview
  for select to anon, authenticated using (true);

-- A Grant's reason is between the platform and the owner.
create policy feature_grant_readable_by_owner on feature_grant
  for select to authenticated
  using (app.owns(business_id));

-- Every Grant is returned, lapsed ones included: whether one still applies is
-- decided against the Business's own today, in the domain, not the server's.
--
-- What every Feature check needs, and who makes one: a manager adding a
-- calendar, a customer joining a waiting list. None of them may read the
-- Subscription or a Grant's reason, so the Entitlement's inputs come through
-- here and nothing else does.
create or replace function app.entitlement_basis(p_business uuid)
returns table (plan_version_id uuid, grants jsonb)
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
           '[]'::jsonb)
  from subscription s
  where s.business_id = p_business;
$$;

revoke all on function app.entitlement_basis(uuid) from public;
grant execute on function app.entitlement_basis(uuid) to anon, authenticated;

comment on table plan_version is
  'ADR 0020. One fixed edition of a Plan''s terms. Additions are carried onto '
  'older editions; anything taken away becomes a new edition.';
comment on table feature_preview is
  'ADR 0020. A Feature offered on every Plan until ends_on, not yet placed.';
comment on table feature_grant is
  'ADR 0021. One Feature for one Business beyond its Plan Version, until ends_on.';
comment on column app_user.trial_taken_on is
  'The day this person''s one Trial began, as the owner of some Business.';
