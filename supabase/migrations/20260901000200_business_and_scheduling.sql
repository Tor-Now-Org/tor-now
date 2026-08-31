-- ---------------------------------------------------------------------------
-- Business, and the Memberships that authorize against it
-- ---------------------------------------------------------------------------

create table business (
  id                       uuid primary key default gen_random_uuid(),
  name                     text        not null,
  phone                    text        not null,
  time_zone                text        not null default 'Asia/Jerusalem',
  description              text,
  address                  text,
  -- ADR 0011: true on registration. There is no approval queue; an
  -- administrator deactivates reactively, and Billing on a lapsed Subscription.
  active                   boolean     not null default true,
  default_buffer_minutes   integer     not null default 0,
  -- ADR 0012: sixty minutes' notice, sixty days ahead.
  minimum_notice_minutes   integer     not null default 60,
  booking_horizon_days     integer     not null default 60,
  cancellation_window_hours integer    not null default 24,
  created_at               timestamptz not null default now(),

  constraint business_name_present check (length(btrim(name)) > 0),
  constraint business_phone_e164 check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  constraint business_buffer_sane check (default_buffer_minutes between 0 and 240),
  constraint business_notice_sane check (minimum_notice_minutes between 0 and 43200),
  constraint business_horizon_sane check (booking_horizon_days between 1 and 365),
  constraint business_cancellation_sane check (cancellation_window_hours between 0 and 720)
);

-- ADR 0011: trigram matching over a GIN index, which behaves identically in
-- Hebrew and English because it operates on characters rather than words.
create index business_name_trgm on business using gin (name gin_trgm_ops);
create index business_active on business (active) where active;

-- The relationship between one User and one Business, carrying the role held
-- there. Authorization is the existence of this row.
create table membership (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid        not null references app_user (id) on delete cascade,
  business_id uuid        not null references business (id) on delete cascade,
  role        text        not null check (role in ('OWNER', 'CUSTOMER')),
  created_at  timestamptz not null default now(),

  unique (user_id, business_id)
);

create index membership_by_business on membership (business_id, role);

comment on table membership is
  'CONTEXT.md: the same User may own one Business and be a customer of another. Uniqueness is per pair, so a role is not a property of the User.';

-- ---------------------------------------------------------------------------
-- Resources, Services
-- ---------------------------------------------------------------------------

create table resource (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid        not null references business (id) on delete cascade,
  name        text        not null,
  active      boolean     not null default true,
  created_at  timestamptz not null default now(),

  constraint resource_name_present check (length(btrim(name)) > 0),
  -- ADR 0007 carries business_id on every tenant-scoped table so policies never
  -- join. This composite key is what lets children prove the two agree.
  unique (id, business_id)
);

create index resource_by_business on resource (business_id);

create table service (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid        not null references business (id) on delete cascade,
  name             text        not null,
  duration_minutes integer     not null,
  price_minor      integer     not null,
  -- Null falls back to the Business default (CONTEXT.md: "Buffer").
  buffer_minutes   integer,
  active           boolean     not null default true,
  created_at       timestamptz not null default now(),

  constraint service_name_present check (length(btrim(name)) > 0),
  constraint service_duration_sane check (duration_minutes between 5 and 1440),
  constraint service_price_sane check (price_minor >= 0),
  constraint service_buffer_sane check (buffer_minutes is null or buffer_minutes between 0 and 240),
  unique (id, business_id)
);

create index service_by_business on service (business_id);

-- ---------------------------------------------------------------------------
-- The three schedule layers of ADR 0002
-- ---------------------------------------------------------------------------

-- Local Times are stored as minutes from midnight, matching the domain's
-- representation exactly. 1440 is a legal end: it denotes the end of the day
-- rather than the start of the next one.
create domain local_minute as smallint
  check (value between 0 and 1440);

-- Layer one, recurring. Several rows per weekday express several ranges, and
-- the gaps between them are the Resource's breaks — there is no break entity.
create table working_hours (
  id          uuid primary key default gen_random_uuid(),
  resource_id uuid        not null,
  business_id uuid        not null,
  day_of_week smallint    not null check (day_of_week between 0 and 6),
  start_local local_minute not null,
  end_local   local_minute not null,

  constraint working_hours_ordered check (end_local > start_local),
  foreign key (resource_id, business_id)
    references resource (id, business_id) on delete cascade
);

create index working_hours_by_resource on working_hours (resource_id, day_of_week);

-- Layer two, per date. The presence of this row is what replaces the weekday's
-- recurring rows; a row with no ranges is a day off. That is why the date and
-- its ranges are two tables rather than one with nullable times — ADR 0002
-- refuses polymorphic columns.
create table date_override (
  id          uuid primary key default gen_random_uuid(),
  resource_id uuid not null,
  business_id uuid not null,
  on_date     date not null,
  note        text,

  unique (resource_id, on_date),
  foreign key (resource_id, business_id)
    references resource (id, business_id) on delete cascade
);

create index date_override_by_resource on date_override (resource_id, on_date);

create table date_override_range (
  id               uuid primary key default gen_random_uuid(),
  date_override_id uuid        not null references date_override (id) on delete cascade,
  business_id      uuid        not null,
  start_local      local_minute not null,
  end_local        local_minute not null,

  constraint date_override_range_ordered check (end_local > start_local)
);

create index date_override_range_by_override on date_override_range (date_override_id);

-- Layer three, ad-hoc. Held as instants because a Block is something that
-- happens, not a recurring rule.
create table block (
  id          uuid primary key default gen_random_uuid(),
  resource_id uuid        not null,
  business_id uuid        not null,
  start_at    timestamptz not null,
  end_at      timestamptz not null,
  reason      text        not null default '',

  constraint block_ordered check (end_at > start_at),
  foreign key (resource_id, business_id)
    references resource (id, business_id) on delete cascade
);

create index block_by_resource on block (resource_id, start_at);
