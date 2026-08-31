-- Availability needs to know when a Resource is busy. Row Level Security shows
-- a customer only their own Appointments, so reading the table directly would
-- make every other customer's booking look like free time — a slot offered,
-- then refused by the exclusion constraint at the last moment.
--
-- Widening the policy is not the answer: that would expose who booked what.
-- These functions hand over exactly the timestamps the scheduler needs and
-- nothing that identifies anybody, which is what makes ADR 0007's promise —
-- that only free start times cross the wire — structural rather than a habit of
-- the serialisation layer.
--
-- The predicate is the same one ADR 0003 puts on the exclusion constraint, so
-- availability and the database can never disagree about which rows occupy
-- time. A cancelled Appointment is absent from both.
create or replace function app.occupied_spans(
  p_resource_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns table (appointment_id uuid, start_at timestamptz, occupied_until timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select a.id, a.start_at, a.occupied_until
  from appointment a
  where a.resource_id = p_resource_id
    and a.status = 'CONFIRMED'
    and a.start_at < p_to
    and a.occupied_until > p_from
  order by a.start_at;
$$;

revoke all on function app.occupied_spans(uuid, timestamptz, timestamptz) from public;
grant execute on function app.occupied_spans(uuid, timestamptz, timestamptz)
  to anon, authenticated;

comment on function app.occupied_spans(uuid, timestamptz, timestamptz) is
  'ADR 0007: availability reads busy intervals, never Appointments. Returns no customer, service or price.';

-- Blocks are subtracted from availability too, and carry a reason that is the
-- owner's business. Same treatment: the interval, without the reason.
create or replace function app.blocked_spans(
  p_resource_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns table (block_id uuid, start_at timestamptz, end_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select b.id, b.start_at, b.end_at
  from block b
  where b.resource_id = p_resource_id
    and b.start_at < p_to
    and b.end_at > p_from
  order by b.start_at;
$$;

revoke all on function app.blocked_spans(uuid, timestamptz, timestamptz) from public;
grant execute on function app.blocked_spans(uuid, timestamptz, timestamptz)
  to anon, authenticated;
