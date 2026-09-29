# 23. What Businesses and the platform cost is read when looked at

Date: 2026-09-29

## Status

Accepted

## Context

ADR 0022 records every billable message as an unpriced Usage Record and keeps
Unit Rates apart. Nothing yet read them. Pricing needs three things from them:
what each Plan costs against what it earns, a way to ask what a Business of a
given size would cost, and a warning when one Business runs up far more than
any Business should (the Fair Use Limit, which ADR 0020 made alert-only).

Some of what the platform pays belongs to no Business: sign-in codes, and the
bills for hosting, the website and a phone number. A price that ignores them
covers the messages and not the platform.

## Decision

**Everything is worked out when an administrator looks.** A month's figures,
the calculator's measured examples and every Fair Use reading are the Usage
Records of the span priced by the Unit Rates in force on each UTC day. A span
runs from midnight in Israel — a month is Israel's calendar month, "today" is
Israel's day — so a message sent just after midnight on the 1st counts in the
new month, even though its rate is the UTC day's. Nothing
about a result is stored: no "over the limit" status on a Business, no Flag, no
"checked" mark, and no scheduled job. A changed limit or corrected rate is
reflected the next time a screen opens, and a new month needs no reset.

**The four figures per Plan** count the Businesses paying for the span — Paid
or In grace on its last day, as the directory's statistics count revenue — at
their Plan's price and running Add-ons. Trials and those not paying are shown
apart. Each Plan's margin is also shown after its share of the Platform Cost.

**Platform Cost** is sign-in codes, measured, plus running costs an
administrator enters as dated, sourced monthly amounts. A running cost counts
at the amount in force on the span's last day; zero from a day stops it.

**The Cost Calculator** is a pure domain function over a month of messages per
cause, in WhatsApp messages and SMS messages. An SMS is priced by its measured
average number of parts, so the administrator counts messages, not parts. It
starts from measured examples — the average paying Business over the last 30
days, and the most expensive one — and from up to eight Reference Businesses
the administrators save, update, rename and delete.

**Fair Use Limits** are per cause (booking, reminders, the waiting list), per
Business, per calendar month in shekels; and one for sign-in codes across the
platform per day in Israel. Crossing one raises a banner on the Businesses tab
and shows on the Fair Use screen and the Business's sheet. Nothing stops.

**Sign-in codes go only to Israeli numbers** for now. A code to a foreign
number is how SMS pumping runs up a bill, and the interface only ever offered
+972.

## Consequences

- No state can go stale or need clearing, and there is no job to fail quietly.
  If nobody opens the admin panel, nobody is told — an accepted cost of
  alerting in the app only.
- Every reading is a sum over a month of Usage Records. At the platform's size
  that is one query; a daily total can be added later without changing any
  screen.
- Past months use today's Plan prices and Add-ons. Moves within a month are
  rare enough that this is read as an approximation, and is labelled as the
  month's figures, not an invoice.
- Adding a message template needs a calculator row: a test fails until its
  cause is one of the calculator's.
