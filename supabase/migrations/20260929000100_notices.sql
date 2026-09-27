-- ---------------------------------------------------------------------------
-- Notices (docs/billing/CONTEXT.md, ADR 0020): what the platform tells a
-- Business about what its Subscription grants or costs. Every one is kept in
-- the owner's list; the ones that need a look stand as a banner until the
-- owner acknowledges them, and the ones about paying also go out on WhatsApp
-- through the outbox.
--
-- A row holds the facts of what happened, not a sentence: the owner reads it in
-- their language, WhatsApp in Hebrew, from the same facts.
-- ---------------------------------------------------------------------------

create table notice (
  id          uuid        primary key default gen_random_uuid(),
  business_id uuid        not null references business (id) on delete cascade,
  kind        text        not null check (kind in (
    'TRIAL_STARTED', 'TRIAL_ENDING', 'PAYMENT_LATE', 'DEACTIVATED',
    'PAYMENT_RECORDED', 'PLAN_CHANGED', 'MOVE_SCHEDULED', 'MOVE_SOON',
    'MOVE_APPLIED', 'CALENDARS_PAUSED', 'CALENDARS_RESUMED'
  )),
  facts       jsonb       not null check (facts ->> 'kind' = kind),
  -- The same situation seen again by the daily run is the same Notice. Null
  -- for an event, which happens once by its nature; nulls never collide.
  dedupe_key  text,
  created_at  timestamptz not null default now(),
  read_at     timestamptz,
  -- When its banner stopped standing: acknowledged, or made moot by what
  -- followed (a payment ends "payment is late").
  cleared_at  timestamptz,

  unique (business_id, dedupe_key)
);

create index notice_by_business on notice (business_id, created_at desc);

alter table notice enable row level security;

create policy notice_readable_by_owner on notice
  for select to authenticated
  using (app.owns(business_id));

-- An owner's own acts are told back to them in the same transaction: the Trial
-- their new Business starts, the Plan they chose, the calendars an upgrade
-- brought back. Everything about paying, and everything an administrator or
-- the daily run does, is written over service_role only.
create policy notice_written_for_own_act on notice
  for insert to authenticated
  with check (
    app.owns(business_id)
    and kind in ('TRIAL_STARTED', 'PLAN_CHANGED', 'MOVE_SCHEDULED', 'CALENDARS_RESUMED')
  );

-- Reading the list and acknowledging a banner. The column grant below keeps it
-- to exactly those two columns: what a Notice said is never rewritten.
create policy notice_acknowledged_by_owner on notice
  for update to authenticated
  using (app.owns(business_id))
  with check (app.owns(business_id));

revoke all on notice from anon;
revoke update, delete, truncate on notice from authenticated;
grant update (read_at, cleared_at) on notice to authenticated;

comment on table notice is
  'What the platform told a Business about its Subscription. Owners read and acknowledge their own.';

-- Telling an owner about paying costs a WhatsApp message, recorded like any other.
alter table usage_record drop constraint usage_record_source_check;
alter table usage_record add constraint usage_record_source_check check (
  source in ('BOOKING', 'SIGN_IN', 'BILLING') or app.is_feature(source)
);

-- The Businesses that opened before Notices existed are told their Trial has
-- started, as a Business opened today is — with its real end date.
insert into notice (business_id, kind, facts, dedupe_key)
select s.business_id,
       'TRIAL_STARTED',
       jsonb_build_object('kind', 'TRIAL_STARTED', 'plan', v.plan, 'trialEndsOn', s.trial_ends_on),
       'TRIAL_STARTED'
from subscription s
join plan_version v on v.id = s.plan_version_id
join business b on b.id = s.business_id
where b.active
  and s.paid_through is null
  and s.trial_ends_on is not null
  and s.trial_ends_on >= current_date
on conflict do nothing;
