-- ---------------------------------------------------------------------------
-- Waiting for a time
--
-- A Waiting Entry is a customer's standing request to be told when a Resource
-- has time for one Service on one date, in the parts of the day they chose.
--
-- It holds no time. A Slot is computed on demand and never stored, and an
-- Appointment exists only in a confirmed state — so a waiting list that
-- reserved an hour for somebody would be a provisional Appointment by another
-- name. What is stored is the question; the answer is recomputed by the same
-- availability code that answers every other "when is this Resource free?",
-- which is how Minimum Notice, Buffers, the Booking Horizon, Blocks and Date
-- Overrides are obeyed here without being restated.
--
-- See docs/adr/0018-waiting-list.md.
-- ---------------------------------------------------------------------------

create table waiting_entry (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid        not null references business (id) on delete cascade,
  customer_id      uuid        not null references app_user (id),
  service_id       uuid        not null references service (id) on delete cascade,
  -- One date. A range would need a lifetime policy, an expiry sweep and a rule
  -- for partial matches; a single date needs none of the three, because it
  -- expires by being over.
  on_date          date        not null,
  -- MORNING / NOON / EVENING, in the Business's own zone. Wanting all three is
  -- what "any time" means — an empty set would have to mean "all of them" by
  -- convention, and a convention like that is read backwards exactly once
  -- before it notifies everybody.
  parts            text[]      not null,
  created_at       timestamptz not null default now(),
  -- The last time an opening was enqueued for this entry. ADR 0013's trick: a
  -- stamp on the row, not a query over the outbox, is what makes the job safe
  -- to run twice, late, or after a crash. It also spaces out a day that frees
  -- up repeatedly, so one entry cannot become a stream of messages.
  last_notified_at timestamptz,
  -- Withdrawn by the customer, or closed because they booked what they were
  -- waiting for. Either way it stops being considered; nothing is deleted, so
  -- "did we message this person" stays answerable.
  closed_at        timestamptz,

  constraint waiting_entry_parts_present check (cardinality(parts) between 1 and 3),
  constraint waiting_entry_parts_known check (
    parts <@ array['MORNING', 'NOON', 'EVENING']::text[]
  )
);

-- One open entry per customer, service and date. Asking twice is the same ask,
-- and two rows would mean two messages for one opening.
create unique index waiting_entry_one_per_customer_and_day
  on waiting_entry (business_id, customer_id, service_id, on_date)
  where closed_at is null;

-- How the job finds work: everything still open on a date.
create index waiting_entry_open_by_date
  on waiting_entry (on_date)
  where closed_at is null;

create index waiting_entry_by_customer on waiting_entry (customer_id, on_date);

-- Which calendars the entry will accept: one, several, or all of them. A child
-- table rather than an array of ids, so a Resource that goes away takes its
-- half of the entry with it.
create table waiting_entry_resource (
  entry_id    uuid not null references waiting_entry (id) on delete cascade,
  resource_id uuid not null references resource (id) on delete cascade,
  primary key (entry_id, resource_id)
);

create index waiting_entry_resource_by_resource
  on waiting_entry_resource (resource_id);

-- ---------------------------------------------------------------------------
-- Look again at this date
--
-- Time frees in more ways than a cancellation: an Appointment rescheduled
-- away, a Block lifted, a Date Override widened, a working day made longer.
-- Hooking only the obvious one would leave the other four silently ignored.
--
-- So anything that changes what a Resource has on a date leaves a mark here,
-- in the same transaction as the change, and a job drains the marks by asking
-- the real availability question. The primary key collapses a busy morning's
-- worth of edits into one piece of work.
-- ---------------------------------------------------------------------------

create table waiting_recheck (
  resource_id uuid        not null references resource (id) on delete cascade,
  on_date     date        not null,
  created_at  timestamptz not null default now(),

  primary key (resource_id, on_date)
);

create index waiting_recheck_oldest_first on waiting_recheck (created_at);

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- A Waiting Entry belongs to the customer who wrote it and to nobody else. The
-- Business deliberately cannot read the list: the owner's only involvement is
-- deciding whether a cancelled hour is published, which is a decision about
-- their own time rather than a report on who is waiting for it.
-- ---------------------------------------------------------------------------

alter table waiting_entry enable row level security;
alter table waiting_entry_resource enable row level security;
alter table waiting_recheck enable row level security;

create policy waiting_entry_read_own on waiting_entry
  for select to authenticated
  using (customer_id = app.current_user_id());

create policy waiting_entry_written_by_customer on waiting_entry
  for insert to authenticated
  with check (
    customer_id = app.current_user_id()
    and exists (
      select 1 from business
      where business.id = waiting_entry.business_id and business.active
    )
  );

-- Withdrawing, and closing an entry whose wait is over. An update cannot move
-- the entry to somebody else: the check repeats the ownership the using clause
-- established.
create policy waiting_entry_closed_by_customer on waiting_entry
  for update to authenticated
  using (customer_id = app.current_user_id())
  with check (customer_id = app.current_user_id());

create policy waiting_entry_resource_read_own on waiting_entry_resource
  for select to authenticated
  using (exists (select 1 from waiting_entry
                  where waiting_entry.id = waiting_entry_resource.entry_id
                    and waiting_entry.customer_id = app.current_user_id()));

create policy waiting_entry_resource_written_by_customer on waiting_entry_resource
  for insert to authenticated
  with check (exists (select 1 from waiting_entry
                       where waiting_entry.id = waiting_entry_resource.entry_id
                         and waiting_entry.customer_id = app.current_user_id()));

-- Changing one's mind about which calendars will do replaces the set, so the
-- old rows go. Without this the delete would remove nothing and say nothing —
-- the entry would quietly keep waiting on a calendar the customer had just
-- taken off it.
create policy waiting_entry_resource_replaced_by_customer on waiting_entry_resource
  for delete to authenticated
  using (exists (select 1 from waiting_entry
                  where waiting_entry.id = waiting_entry_resource.entry_id
                    and waiting_entry.customer_id = app.current_user_id()));

-- A mark says only that a calendar's date is worth looking at again. Anybody
-- who can change a schedule leaves one — a customer cancelling their own
-- appointment as much as the owner — and nobody but the job ever reads them.
--
-- Which is why it is a function rather than a policy. `on conflict (cols) do
-- nothing` has to consult the arbiter index, and under Row Level Security a
-- row nobody may select is a row the statement cannot see, which Postgres
-- reports as a check violation rather than as a conflict. Granting everybody
-- select on the marks to work around that would hand any signed-in user a
-- listing of which calendars changed and when. So the write runs with the
-- table owner's rights, the table itself admits nobody, and the only way to
-- leave a mark is this function.
--
-- It authorizes nothing on purpose: a mark causes a recomputation and reveals
-- nothing to whoever left it. Every caller has already had the action that
-- freed the time authorized — cancelling, rescheduling, lifting a blockage —
-- and the worst a spurious mark can do is make the job look at a day.
create or replace function app.mark_for_recheck(p_resource_id uuid, p_on_date date)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into waiting_recheck (resource_id, on_date)
  values (p_resource_id, p_on_date)
  on conflict (resource_id, on_date) do nothing;
$$;

revoke all on function app.mark_for_recheck(uuid, date) from public;
grant execute on function app.mark_for_recheck(uuid, date) to authenticated;

comment on table waiting_entry is
  'A customer''s standing request to be told when a Resource has time for one '
  'Service on one date. Holds no time and is not an Appointment.';
comment on table waiting_recheck is
  'A calendar date whose availability changed and has not been re-examined. '
  'Drained by the waiting-list job.';
