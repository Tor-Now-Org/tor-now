# 12. A per-Business booking window: sixty minutes' notice, sixty days ahead

Date: 2026-08-24

## Status

Accepted

Supersedes the passing reference to minimum notice and booking horizon in
ADR 0007, which named them as rules no database constraint can express without
fixing their values.

## Context

The specification bounds the booking window at one end only: an Appointment
cannot be in the past. Both consequences of leaving the other end open are
concrete.

With no far end, a customer can book years ahead. The calendar has no natural
limit, availability queries have no bound, every schedule change an owner makes
must scan an unbounded future for orphaned Appointments, and popular slots can be
squatted indefinitely.

With no near end, "not in the past" permits booking a slot one minute from now.
The Resource is mid-appointment, gets no notice, and a customer arrives expecting
service.

Both bounds are per-Business by nature — a barber may accept bookings an hour out
while a tutor needs a day — but not per-Service, which is more configuration
surface than the product needs.

## Decision

Two fields on Business: `minimumNoticeMinutes`, defaulting to **60**, and
`bookingHorizonDays`, defaulting to **60**.

They enter the availability pipeline as a final clip, after the schedule layers
have been resolved: the date's Date Overrides else the weekday's Working Hours,
minus Blocks, minus occupied Appointments, **clipped to
`[now + minimumNotice, now + horizon]`**. Slot generation never learns about them.

When the near-end clip leaves a day with no Slots, the empty state surfaces the
Business's phone number with a call action. A customer who needs an appointment
sooner than the notice allows is told how to ask for it, not merely told no.

## Consequences

- Free Intervals stay the single shape where every scheduling constraint has been
  resolved; the window is one more subtraction rather than a new concept.
- The orphan scan when a schedule changes is bounded by the horizon.
- Same-day booking still works, which is a real source of value for these
  businesses.
- The horizon must be enforced on the server, not merely by limiting the calendar
  UI. Unlike double-booking, no database constraint catches a booking outside the
  window, because there is nothing for it to conflict with.
- Changing either field takes effect immediately for availability but does not
  invalidate Appointments already booked outside the new window.
