# 22. Usage is recorded unpriced; Unit Rates are dated and sourced

Date: 2026-09-26

## Status

Accepted

## Context

Plans are priced from what a busy Business actually costs (ADR 0020), so the
platform has to measure what it pays for on each Business's behalf from the
first message — WhatsApp templates, SMS segments, sign-in codes.

The prices behind those messages are not reliably known and do not stay put.
Twilio publishes its Israel SMS rate; Meta publishes its Israel WhatsApp rates
only as a downloadable card, and changes them on dates of its own choosing.
A cost stored with each message would freeze whatever figure was believed at
the time, right or wrong, and a correction found later could not reach what
was already recorded.

## Decision

Keep what happened and what it cost as two separate facts.

**A Usage Record holds no price.** It says which Business, which Feature (or
booking itself, or signing in), which unit — a WhatsApp utility or
authentication template, or an SMS segment — and how many. The delivery worker
writes it in the transaction that marks the message sent; the sign-in path
writes one for each code. A message that only went to the development log, or
was never delivered, records nothing.

**A Unit Rate is dated and carries its evidence.** It says what one unit cost
from a given day and where the figure was checked: a rate card's address, an
invoice. A correction is a new Unit Rate from the day it applies, and that day
may be in the past.

**Cost is worked out when it is read.** Usage is added up per UTC day — the day
a provider bills by — and each day is priced by the Unit Rate in force on it.
Usage no rate covers is reported as unpriced, never as free.

**The platform ships with defaults**, entered as if by hand and saying so:
Twilio's published SMS rate, and an estimate of Meta's WhatsApp rates marked
unconfirmed, all from 2026-09-01, before any usage. An administrator replaces
them through the admin panel once checked (ADR 0021).

## Consequences

- A rate corrected later — even backwards — reprices everything it covers with
  no migration and no rewritten row.
- Every cost figure is traceable to a rate and that rate to its source, which is
  what makes it safe to set a price from.
- Reading a cost is a sum over days rather than a sum over one column. The
  platform is small enough for that; a materialised daily total can come later
  without changing either fact.
- An SMS is recorded by its segments, counted from the text sent: a Hebrew
  message is Unicode, 70 characters to a segment, so it is usually two or three.
- Messages sent before this migration have no Usage Records; the outbox had no
  record of whose they were.
