-- ---------------------------------------------------------------------------
-- Appointments
-- ---------------------------------------------------------------------------

create table appointment (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid        not null references business (id) on delete cascade,
  resource_id  uuid        not null,
  service_id   uuid        not null,
  customer_id  uuid        not null references app_user (id),

  start_at       timestamptz not null,
  -- The end of the service itself, without the Buffer.
  end_at         timestamptz not null,
  -- The end of the time the Resource is actually consumed for, Buffer
  -- included. Held as a column rather than derived from end_at and
  -- buffer_minutes because `timestamptz + interval` is only STABLE, and a
  -- generated column demands an immutable expression.
  occupied_until timestamptz not null,

  -- ADR 0003: the range the exclusion constraint checks. Generated, so no
  -- write path can store a range that disagrees with its own columns.
  occupied     tstzrange   not null
    generated always as (tstzrange(start_at, occupied_until, '[)')) stored,

  status       text        not null default 'CONFIRMED'
    check (status in ('CONFIRMED', 'CANCELLED', 'NO_SHOW', 'COMPLETED')),

  -- Snapshots taken at booking time: an Appointment keeps the terms it was
  -- booked under, so changing a Service later never rewrites history.
  service_name     text    not null,
  price_minor      integer not null,
  duration_minutes integer not null,
  buffer_minutes   integer not null,

  customer_note    text,
  cancelled_at     timestamptz,
  cancelled_by     text check (cancelled_by in ('CUSTOMER', 'BUSINESS')),
  -- A customer cancellation made inside the Cancellation Window. Recorded and
  -- visible to the Business, but never blocked.
  late_cancellation boolean not null default false,
  created_at       timestamptz not null default now(),

  constraint appointment_ordered check (end_at > start_at),
  constraint appointment_occupies_at_least_its_duration check (occupied_until >= end_at),
  constraint appointment_buffer_sane check (buffer_minutes between 0 and 240),
  constraint appointment_cancelled_consistently check (
    (status = 'CANCELLED') = (cancelled_at is not null)
    and (cancelled_at is null) = (cancelled_by is null)
  ),
  foreign key (resource_id, business_id)
    references resource (id, business_id) on delete cascade,
  foreign key (service_id, business_id)
    references service (id, business_id)
);

-- ADR 0003. The invariant is a property of the data, not of a code path: no
-- write path can forget it, including future services, admin tools and
-- migrations. Buffer enforcement comes free, because the stored range already
-- includes it. Cancelled appointments are excluded by the predicate, so a
-- cancelled slot is immediately rebookable.
alter table appointment
  add constraint appointment_no_overlap
  exclude using gist (
    resource_id with =,
    occupied    with &&
  ) where (status = 'CONFIRMED');

create index appointment_by_customer on appointment (customer_id, start_at desc);
create index appointment_by_business on appointment (business_id, start_at);
create index appointment_by_resource_day on appointment (resource_id, start_at)
  where status = 'CONFIRMED';
