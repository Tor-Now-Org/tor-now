# 29. One list design for the business's lists, and the customer page

Date: 2026-10-10

## Status

Accepted.

## Context

The services, calendars, team and customer lists were the plainest screens
left. Every row was a card of its own with three or four buttons and a red
"מחיקה" on it, so names were squeezed and every row shouted "delete". Nothing on
a row could be recognised at a glance, phone numbers showed as "+972549534655",
and the customer page's loudest element was "חסימת הלקוח".

## Decision

All four lists share one design (`components/owner/list-ui.tsx`): a header with
the count and the way to add, one card of rows, and a sheet per row.

- **A row** is a mark, the name, one line under it, a tag only when there is
  something to say, and a chevron when it opens. The whole row is the button.
- **The mark** is the colour the day view already uses: a service's event colour
  as the row's edge (by its place in the services list, as the calendar
  colours it), a calendar's lane colour, a person's initial.
- **The actions** that were on every row are in the row's sheet, once: hours,
  renaming, showing as a switch, and deleting last and apart. A service's
  standing is a switch in its editing sheet, saved with the rest. The recovery
  timeline in that sheet takes the service's colour.
- **Customers** are sorted by name, the filter says how many each holds, and
  past a dozen the list is split by first letter.
- **Phone numbers** are shown as dialled in Israel, "054-953-4655"
  (`phoneShown`); numbers from abroad are left as they are.

The customer page joins the booked screen's family: a navy band with the
customer's name, number, "לקוח מאז", and named call and WhatsApp buttons; three
count tiles; the upcoming appointments — all of them up to three, and past
three the first three with "עוד N" to open the rest in place; the history as
dated rows, split by month past a dozen; booking pinned at the bottom; and
blocking last, behind a question. A blocked customer says so in the band, and
lifting the block is the one action left.

## Consequences

Every action that existed is still there, one tap further for the row it is
on. The rules did not move: who may edit whom (ADR 0016), the last calendar on
offer, the plan's lock on adding, and Customer History (ADR 0019).
