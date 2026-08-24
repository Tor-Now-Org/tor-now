# 2. Three schedule layers, resolved into Free Intervals

Date: 2026-08-22

## Status

Accepted

## Context

The product specification defined four overlapping ways to express when a
business is open: recurring hours, breaks (recurring *or* date-specific via a
single polymorphic `dayOfWeek / date` column), date overrides with a type, and
ad-hoc blocked hours with a reason.

This admitted two representations of the same lunch break — a break row, or two
recurring ranges with a gap — and the polymorphic break column could not be
constrained in the database or queried without branching.

## Decision

Model availability as three layers, each with exactly one meaning:

- **Working Hours** (recurring): `resourceId, dayOfWeek, startLocal, endLocal`.
  Several rows per weekday express several ranges. Breaks are the gaps between
  ranges; there is no break entity.
- **Date Override** (per date): `resourceId, date, startLocal, endLocal`. If any
  rows exist for a date, they *replace* that weekday's recurring rows entirely.
  A date marked closed with no ranges is a day off.
- **Block** (ad-hoc): `resourceId, startAt, endAt, reason`. An interval subtracted
  from whatever the layers above produced.

Constraint gathering resolves them in order — take the date's Overrides if any
exist, else the weekday's Working Hours; subtract Blocks; subtract occupied
Appointments — yielding Free Intervals.

## Consequences

- One representation per concept. A lunch break is a gap, a day off is a closed
  Override, a one-off absence is a Block.
- No polymorphic columns; every table has a single, constrainable shape.
- Overrides replace rather than add, which makes "closed on this date" expressible
  without a separate mechanism, at the cost of requiring an owner who wants extra
  hours on a date to restate the whole day.
- Slot generation sees only Free Intervals and never learns about any of these
  layers, so new constraint types can be added without touching it.
