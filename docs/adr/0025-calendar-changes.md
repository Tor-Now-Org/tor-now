# 25. "שינוי ביומן": one way to change a day

Date: 2026-10-04

## Status

Accepted. Builds on ADR 0002's layers and ADR 0016's roles; changes nothing they store.

## Context

Owners had three tools for the same thought — a blockage, a calendar's special
day, and the shop's special day — and could not tell which to reach for. Each
lived behind a different door with its own form, a worker could reach some and
not others, and a calendar's view showed the shop's days as if they were its own.

## Decision

There is one thing, a **Change**, described by what happens and for whom:

| What happens            | One calendar                   | The whole business                          |
| ----------------------- | ------------------------------ | ------------------------------------------- |
| Not working all day     | A Date Override with no hours  | A Date Override with no hours, every calendar |
| Not working part of day | Blocks over those hours        | The same Blocks on every calendar, one group  |
| Working other hours     | Date Overrides with the hours  | The same Overrides on every calendar          |

- **Nothing new is stored.** Changes are read back from Blocks and Overrides by a
  pure classifier in `packages/domain`: one group of Blocks is one change; a date
  every calendar on offer overrides the same way is the business's; consecutive
  dates saying the same thing are one change. Existing blockages and special days
  appear as changes as they are, with no migration; an all-day blockage made
  before this still reads as a day off.
- **A day off is a day with no hours**, for one calendar as for the business, so it
  reads the same through every edit and replaces other hours set for that day.
- **One API, one sheet.** `/businesses/:id/changes` lists, previews, applies and
  removes. Every door — the +, a free stretch, the schedule, an existing change —
  opens the same sheet; a door only fills in what it knows.
- **Permission is by scope** (ADR 0016): the whole business is an owner's or a
  manager's; a calendar, whoever keeps it. A worker reads the business's changes
  and is refused writing them by the API, not only by the screen.
- **An edit is one replacement.** The old change's days from today on are removed
  and the new one written in one transaction; days already lived stay as they were.
- **The people booked are answered for.** Preview names whoever a change strands;
  the owner cancels and tells them (the default) or keeps them.

## Consequences

- The old closure, block and override routes remain for older clients; the web
  uses only the change routes.
- Two adjacent decisions saying exactly the same thing read as one change.
- A change covers at most 366 days, which bounds what a list reads around it.
