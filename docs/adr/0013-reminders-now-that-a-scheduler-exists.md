# 13. Reminders, now that a scheduler exists

Date: 2026-09-01

## Status

Accepted

Amends ADR 0005, which named three approved templates and deferred reminders
"until a scheduler exists".

## Context

ADR 0005 deferred reminders for one reason: nothing ran unprompted. ADR 0007
then established that scheduled work runs on Supabase Cron, and the outbox
drain, audit retention and billing deactivation are all driven by it. The
premise the deferral rested on no longer holds.

Two things about reminders are unlike the other three templates. A confirmation,
a cancellation and a reschedule are each caused by something a person just did,
so the transaction that causes them is obvious. A reminder is caused by time
passing, which means something has to decide when — and something has to make
sure a message is not sent twice when that decision is made repeatedly.

## Decision

A fourth approved template, `BOOKING_REMINDER`, and an hourly job that enqueues
it for Appointments starting a day ahead.

The job writes the outbox row and a `reminder_enqueued_at` stamp on the
Appointment in the same transaction. The stamp, not a query over the outbox, is
what makes the reminder exactly-once: the job asks only "which confirmed
appointments start in this window and have no stamp", so running it twice, or
late, or after a crash, changes nothing.

The window is wider than the interval between runs — ninety minutes against an
hour — so a skipped run still catches its appointments rather than silently
dropping them.

Delivery stays the worker's job, as with every other template. The reminder job
never talks to a messaging provider.

## Consequences

- The set of approved templates grows to four. Meta bills per delivered template
  message and approves each one, so this is an approval to obtain before launch
  and not merely a line of code.
- Reminders are the only template whose volume is proportional to bookings
  rather than to events, which makes them the largest single line in the message
  bill. A per-Business switch is the obvious next lever and is deliberately not
  built yet; there is no evidence about which businesses want them.
- The lead time is a platform constant rather than a per-Business setting. A day
  suits the services this platform serves; making it configurable is a small
  change to `REMINDERS` and a field on Business when someone asks.
- An Appointment cancelled before the window is never reminded about, because
  the job only looks at confirmed ones. One cancelled *after* the reminder is
  enqueued will still receive it — the outbox row is already written, and ADR
  0005 is explicit that a queued message is not rolled back.
