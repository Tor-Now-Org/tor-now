# 18. Waiting for a time

Date: 2026-09-20

## Status

Accepted

## Context

A customer who finds a day with nothing on it leaves. The shop, meanwhile,
loses the hour a late cancellation frees, because the people who would take it
have no way of hearing about it. Both halves of that are worth fixing with one
feature.

The obvious model — reserve the freed slot for whoever is first in line — is
not available here. `CONTEXT.md` is explicit on two points that rule it out: a
Slot is "computed on demand, never stored", and an Appointment "exists only in
a confirmed state; there is no provisional or held Appointment". A waiting list
that holds an hour for somebody is a provisional Appointment by another name,
and would need its own state, its own expiry, and its own accommodation in ADR
0003's exclusion constraint.

Three further things constrain the design. Time frees in more ways than a
cancellation. Every message is billed and approved by Meta (ADR 0005). And an
hour that frees inside the Minimum Notice is not bookable at all (ADR 0012), so
"an appointment was cancelled, tell everyone" would send people after time
nobody can take.

## Decision

A **Waiting Entry**: one customer, one Service, one date, the parts of that day
that suit, and the calendars they will accept. It holds no time.

**One date rather than a range.** A range needs a lifetime policy, an expiry
sweep and a rule for partial matches. A single date needs none of the three: it
stops being open by being over.

**Morning, noon and evening** are the unit, and they are the same three the
customer's slot grid has always been grouped into. The boundaries moved from
the interface into the domain, because where morning ends stopped being a
heading and became something a customer can ask about. Wanting all three is
what "any time" means; an empty set is refused, since a convention like
"none means all" is read backwards exactly once before it messages everybody.

**Available whether or not the day is full.** The offer sits inside whichever
part of the grid is empty, so somebody who needs a morning finds it where they
discovered there was no morning, with the afternoon still bookable beside it.

**Everything that frees time leaves a mark, and a job recomputes.** Anything
touching a Resource's day writes a `waiting_recheck` row in the same
transaction as the change; a job drains the marks by asking the ordinary
availability question and then asking the domain whether any offered time falls
in a part somebody wanted. Minimum Notice, the Booking Horizon, Buffers, Blocks
and Date Overrides are therefore obeyed by inheritance rather than restated.
Hooking `booking.cancel` instead would have missed a reschedule away, a lifted
Block, a widened Date Override and a longer working day.

**Everyone waiting is told at once**, and the message says so. No queue, no
batches, no held time: the first to book gets it, and a message that admits
others were told makes arriving second expected rather than insulting. The
message names the part of the day rather than the hour — by the time it is read
the hour may be gone, and a wrong specific is worse than a right general — and
names the calendar, because "either of them" was on offer and which one freed
is the one thing the customer could not work out.

**A stamp, not a query over the outbox**, makes the job safe to run twice, as
ADR 0013 established for reminders. Here it doubles as a cooldown, so a day
that frees repeatedly cannot become a stream of messages to one person.

**The Business never sees the list.** Its only involvement is one control on
the owner's cancel sheet: publish the freed hour, or keep it. Keeping it writes
no mark, so the feature is simply off for that hour with nothing having to
remember it was. A customer's own cancellation always publishes —
`whoIsCancelling` already distinguishes the two — because a customer wants the
hour gone and has no opinion about who hears.

**A fifth template**, `WAITING_LIST_OPENING`, with ADR 0005's SMS fallback
behind it.

## Consequences

- The set of approved templates grows to five, and this is the first whose
  volume grows with how many people are waiting rather than with what happened.
  Spend is freed hours × depth of list. A per-Business switch is the lever, and
  the cooldown is the only other bound.
- Meta template approval and Israeli SMS sender registration both gate this
  feature, and both have lead times measured in days.
- The job runs every two minutes, so an opening is published within about that.
  Filling a short-notice gap is the point, and the work is proportional to what
  changed rather than to who is waiting, so a quiet run costs one empty query.
- Every write that changes a schedule now also writes a mark. That is one extra
  statement inside transactions that were already writing several, and it is
  what keeps the definition of "free" in exactly one place.
- Nothing holds time, so nothing new has to be reconciled with ADR 0003's
  exclusion constraint, and a customer reading about an opening may still find
  it taken. That is stated in the message rather than engineered away.
