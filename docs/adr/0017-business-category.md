# 17. Business category

Date: 2026-09-15

## Status

Accepted. Supersedes the "no type field" part of ADR 0011.

## Context

ADR 0011 dropped categorisation rather than introduce it as free text, and named
the cost: no browse-by-category axis, and a backfill whenever one is added.

Customers now need to find "a barbershop near me" without knowing a name, and to
find a business whose name does not say what it does. Free text is still the wrong
answer — "מספרה", "ספר" and "Barber" would be three categories.

## Decision

A Business has **one Category**, a code from a closed list kept in
`packages/domain`, with Hebrew and English labels and search synonyms beside it.
`other` is in the list, so no owner is ever stuck.

- **Required on registration; nullable in the table.** Businesses registered before
  this have none until the owner chooses one in Settings. Nothing is backfilled.
- **Validated by the API, not a check constraint**, so adding a code needs no
  migration. Renaming a code does, and is avoided.
- **Search takes the Category two ways.** Chosen by the customer, it is a hard
  filter and may stand alone (browse). Inferred from the typed text, it is a
  ranking boost that also admits businesses whose name does not match — never a
  filter, so a name match is never lost. `other` is never inferred.
- **A browse orders by distance** when the customer's position is sent, in SQL,
  so the result limit keeps the nearest businesses rather than an arbitrary slice.

## Consequences

- One source of words for both the suggestion in the browser and the inference on
  the server.
- The list is a code change. Owners cannot add their own Category.
- Distance is a flat-earth approximation used only for ordering; it holds across
  Israel and would need PostGIS for a wide geography.
- Synonym matching is prefix and substring, not typo-tolerant; trigram matching
  still covers names.
