# 1. Greedy walk for slot generation, behind a strategy seam

Date: 2026-08-22

## Status

Accepted

## Context

Given a Service duration, a Buffer and a set of Free Intervals for a Resource on
a given day, the system must decide which start times to offer the customer.
Times are only ever computed after the customer has chosen a Service, so the
duration is always known.

Two candidate algorithms were considered:

- **Greedy walk** — step a cursor forward from the start of each Free Interval in
  `duration + buffer` increments, jumping the cursor past any conflict. Produces
  few, tightly packed options with drifting offsets (10:20, 10:55, 11:30).
- **Fixed granularity** — test every start on a fixed step (e.g. every 15
  minutes) for whether the Service fits. Produces many options on round times.

Neither is optimal. Both strand time: greedy skips windows that sit off-cursor,
and a fixed grid cannot start a 20-minute Service at 09:50 on a 15-minute step.
Which one yields more completed bookings in practice is an empirical question we
have no data to answer yet, because it depends on customer choice behaviour and
not only on packing.

## Decision

Use **greedy walk** for the MVP, isolated behind a `SlotGenerationStrategy`
interface with the signature `(freeIntervals, duration, buffer) -> Slot[]`.

Constraint gathering — resolving Working Hours, Overrides, Breaks, Blocks and
existing Appointments into Free Intervals — sits outside the strategy and is
shared by all implementations. The strategy is a pure function: no I/O, no clock,
no database access.

Non-round start times are explicitly accepted as a cost.

## Consequences

- The strategy is swappable per Business by configuration, so the choice can be
  revisited against real booking data rather than argued from first principles.
- All scheduling domain complexity lives in constraint gathering, which is tested
  independently of slot generation.
- Slot generation is a pure function over intervals and is exhaustively testable
  without fixtures.
- Customers see fewer options than a fine-grained grid would offer, and those
  options drift to non-round times as a day fills up. We consider fewer,
  well-spaced options an acceptable and possibly desirable UX outcome.
- The stated motivation is *not* that greedy maximises utilisation — it does not.
  It is that greedy is a reasonable default whose replacement is cheap.
