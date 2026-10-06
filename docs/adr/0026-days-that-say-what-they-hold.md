# 26. Days that say what they hold

Date: 2026-10-06

## Status

Accepted. Builds on ADR 0003 (fetched on demand), ADR 0012 (the Minimum Notice
and Booking Horizon) and ADR 0018 (Parts of Day, the waiting list).

Amended 2026-10-07: the customer's Part of Day choice ("מתי נוח לכם?") is
withdrawn from the business page. Every day counts, and shows, all its times;
the page opens on the first day with any room. The two decisions below that
name a chosen Part of Day no longer apply. Parts of Day still group the times
and still shape the waiting list (ADR 0018).

## Context

A customer chose a day and only then learned whether it had room. A closed day,
a full one and a quiet one looked the same until each was tapped, the strip
stopped at fourteen days whatever the Business's horizon, and a preference for
evenings had to be checked one day at a time. Behind the screen, why a day was
empty was judged wrongly in three cases: a day whose hours had ended read as
full (offering a waiting list for time already gone), a day the notice reached
into read as full (offering the waiting list instead of the phone ADR 0012
promises), and a day off inside the notice read as "too soon" (sending the
customer to call about a day nobody works).

## Decision

- **Every day carries its mark.** Availability is read two weeks at a time —
  already one request at a constant number of queries — so each day shows its
  count of free Slots, or why it has none: closed, full, by phone, over, or when
  it opens. Every day stays tappable; a full day still leads to the waiting list.
- **Why a day is empty is judged inside the window**, in the order a customer
  asks it, and only by open hours long enough for the Service:
  1. no open hours at all, or none long enough: `CLOSED`;
  2. open hours inside the window, all taken: `FULLY_BOOKED`;
  3. open hours between now and the notice: `TOO_SOON`;
  4. open hours past the horizon: `BEYOND_HORIZON`;
  5. open hours only before now: `DAY_OVER` (new).
- **The window's last day is offered.** The horizon is measured from now, so its
  last date is usually partly open; availability says so (`partlyBeyondHorizon`)
  and the rest of that day opens as the clock moves — later today, not tomorrow.
- **The page opens on the first day with room** in the chosen Part of Day, once
  every day before it has answered. A day the customer picks is kept.
- **A Part of Day chosen once applies to every day** — the counts and the times —
  and is remembered on the device.
- **The month reaches the whole horizon.** Past two weeks the strip ends in
  "כל החודש"; the sheet pages only through the horizon's months, and a date past
  it says the day it opens: its date less the horizon.
- **One request covers at most 31 days**, refused at the HTTP edge.
- **A Minimum Notice must stop short of the Booking Horizon**, by more than the
  offer's rounding (`leavesRoomToBook`). The settings form and the API refuse
  any pair that would leave nothing to book.

## Consequences

- `EmptyReason` gains `DAY_OVER`, and a day gains `partlyBeyondHorizon`; an
  older client reads the first as full and ignores the second.
- A day the notice cuts into, with its remaining hours taken, is still full and
  still offers the waiting list — the hours in reach are what is full.
- What a day says is a guide, never a promise: confirming re-checks the time, as
  ADR 0003 always required.
