-- ---------------------------------------------------------------------------
-- What Businesses and the platform cost (ADR 0023): Fair Use Limits, the Cost
-- Calculator's saved Reference Businesses, and the running costs no Business
-- causes. Whether a Business is over a limit is never stored — it is read from
-- the usage whenever an administrator looks — so nothing here is a status.
-- Written by administrators over the service connection only.
-- ---------------------------------------------------------------------------

-- One row per limit. A cause a Business can run up has a limit in agorot per
-- Business per month; sign-in codes have one for the whole platform per day.
create table fair_use_limit (
  source              text primary key
    check (source in ('BOOKING', 'REMINDERS', 'WAITING_LIST', 'SIGN_IN')),
  business_month_minor integer check (business_month_minor between 1 and 10000000),
  codes_per_day        integer check (codes_per_day between 1 and 1000000),
  updated_at           timestamptz not null default now(),

  -- Exactly the kind of limit its cause takes.
  constraint fair_use_limit_kind check (
    (source = 'SIGN_IN') = (codes_per_day is not null)
    and (source = 'SIGN_IN') = (business_month_minor is null)
  )
);

-- Well above a busy Business (ADR 0023): about three times what the design's
-- busy example spent on each, and a platform-wide 300 codes a day.
insert into fair_use_limit (source, business_month_minor, codes_per_day) values
  ('BOOKING', 12000, null),
  ('REMINDERS', 10000, null),
  ('WAITING_LIST', 1000, null),
  ('SIGN_IN', null, 300);

-- A Business saved as an example to price from: a month of its messages per
-- cause, in the units a provider bills, and its calendars. The measured
-- examples (the actual average, the most expensive) are read from usage and
-- never stored.
create table reference_business (
  id         uuid primary key default gen_random_uuid(),
  -- The order they were saved in: two saved in one transaction share a
  -- timestamp, and a uuid is no order at all.
  position   bigint generated always as identity,
  name       text        not null check (length(btrim(name)) between 2 and 30),
  calendars  integer     not null check (calendars between 1 and 100),
  -- { "BOOKING": { "whatsapp": n, "sms": n }, ... } — checked by the domain on
  -- the way in and on the way out.
  usage      jsonb       not null check (jsonb_typeof(usage) = 'object'),
  saved_on   date        not null,
  saved_by   uuid references app_user (id),
  created_at timestamptz not null default now()
);

create unique index reference_business_name on reference_business (lower(btrim(name)));

-- Eight at most. The domain refuses a ninth first; this refuses whatever slips past it.
create or replace function app.reference_businesses_within_limit()
returns trigger
language plpgsql
as $$
begin
  if (select count(*) from reference_business) > 8 then
    raise exception 'No more than eight Reference Businesses are kept' using errcode = 'check_violation';
  end if;
  return null;
end;
$$;

create trigger reference_business_within_limit
  after insert on reference_business
  for each statement execute function app.reference_businesses_within_limit();

insert into reference_business (name, calendars, usage, saved_on) values
  ('בינוני', 1,
   '{"BOOKING":{"whatsapp":205,"sms":2},"REMINDERS":{"whatsapp":178,"sms":2},"WAITING_LIST":{"whatsapp":10,"sms":0},"BILLING":{"whatsapp":2,"sms":0}}',
   '2026-09-29'),
  ('עמוס', 4,
   '{"BOOKING":{"whatsapp":1051,"sms":11},"REMINDERS":{"whatsapp":891,"sms":9},"WAITING_LIST":{"whatsapp":59,"sms":1},"BILLING":{"whatsapp":2,"sms":0}}',
   '2026-09-29');

-- What the platform pays every month whatever the Businesses do: hosting, the
-- website, a phone number. A cost is a name; what it came to is a series of
-- dated amounts with their evidence, like a Unit Rate. Zero from a day is how
-- one stops, and what it was stays.
create table running_cost (
  id         uuid primary key default gen_random_uuid(),
  position   bigint generated always as identity,
  name       text        not null check (length(btrim(name)) between 2 and 60),
  created_at timestamptz not null default now()
);

create unique index running_cost_name on running_cost (lower(btrim(name)));

create table running_cost_amount (
  running_cost_id uuid        not null references running_cost (id) on delete cascade,
  effective_from  date        not null,
  amount_minor    integer     not null check (amount_minor between 0 and 10000000),
  source          text        not null check (length(btrim(source)) between 3 and 500),
  entered_by      uuid references app_user (id),
  entered_at      timestamptz not null default now(),

  primary key (running_cost_id, effective_from)
);

alter table fair_use_limit      enable row level security;
alter table reference_business  enable row level security;
alter table running_cost        enable row level security;
alter table running_cost_amount enable row level security;

comment on table fair_use_limit is
  'Internal ceilings that only alert (ADR 0023). RLS enabled with no policy: service_role only.';
comment on table reference_business is
  'The Cost Calculator''s saved examples, shared by administrators. RLS enabled with no policy: service_role only.';
comment on table running_cost is
  'A cost the platform pays that no Business causes. RLS enabled with no policy: service_role only.';
comment on table running_cost_amount is
  'A running cost''s monthly amount from a day, with its evidence. RLS enabled with no policy: service_role only.';
