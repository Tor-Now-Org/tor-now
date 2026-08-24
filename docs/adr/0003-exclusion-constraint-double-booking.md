# 3. Prevent double booking with a Postgres exclusion constraint

Date: 2026-08-22

## Status

Accepted

## Context

Two customers confirming the same time within the same moment must not both
succeed. The product specification described a check-then-insert sequence inside
a transaction.

That sequence is not sufficient at PostgreSQL's default `READ COMMITTED`
isolation. Two transactions can each run the conflict check, each see zero
overlapping rows because the other has not committed, and each then insert. Row
locking does not help: `SELECT ... FOR UPDATE` locks rows it finds, and the
conflict check finds nothing. There is no row to lock, because the conflict is
with a row that does not exist yet.

Making check-then-insert correct requires either `SERIALIZABLE` isolation plus a
retry loop on every write path, or a lock on an existing row such as the Resource.
Appointments are written from at least three paths — customer booking, owner
manual creation, and rescheduling — with admin tooling and migrations likely to
follow.

## Decision

Store each Appointment's occupied span as a `tstzrange` covering
`[start, end + buffer)` and enforce non-overlap in the database:

```sql
CREATE EXTENSION btree_gist;

ALTER TABLE appointment ADD CONSTRAINT no_overlap
  EXCLUDE USING gist (
    resource_id WITH =,
    occupied    WITH &&
  ) WHERE (status = 'CONFIRMED');
```

Application code attempts the insert and translates a constraint violation into
the user-facing message from the specification's error-state section.

PostgreSQL is therefore a hard dependency, not an interchangeable choice.

## Consequences

- The invariant is a property of the data, not of a code path. No write path can
  forget it, including future services, admin tools and migrations.
- Buffer enforcement comes free: because the stored range already includes the
  buffer, an appointment that would violate the gap overlaps an existing range and
  is refused by the same constraint.
- The application needs no retry loop and no elevated isolation level.
- Cancelled appointments are excluded by the partial predicate, so a cancelled
  slot is immediately rebookable.
- Appointments are created directly as `CONFIRMED`. Slots are not held while a
  customer authenticates, so a customer may lose a slot between selecting it and
  confirming; the constraint violation is translated into a recoverable error that
  re-renders availability in place.
- Availability is fetched on demand — when a Service or date is chosen, when the
  customer returns from verification, and again at confirmation. Nothing polls and
  nothing subscribes. Correctness rests entirely on the constraint and on
  re-validation at confirmation, so background refreshing would only reduce how
  often a customer meets the error, at the cost of a request per client per
  interval. This supersedes the specification's suggestion of polling.
- The owner's calendar is fetched the same way, on open and on refresh. The
  specification's promise that a new booking appears there immediately is not
  kept: an owner sees the current state when they ask for it. Supabase Realtime
  could deliver it, since an owner may read their own Business's Appointments
  under RLS, and is deliberately not used — the case it buys is a calendar left
  open unattended.
- Changing a Service's buffer does not retroactively alter existing appointments'
  stored ranges. This is intentional — booked appointments keep the terms they
  were booked under — but means the buffer is a snapshot, not a live reference.
