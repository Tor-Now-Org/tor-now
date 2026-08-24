# 11. Trigram matching for business discovery

Date: 2026-08-24

## Status

Accepted

## Context

Search is the platform's front door. The specification asks for partial, prefix
and word matching, and explicitly for a match even when the customer did not type
the exact name. That last requirement rules out a naive query.

Hebrew is the primary language, which eliminates the obvious database answer:
PostgreSQL ships no Hebrew dictionary or stemmer, so full-text search would fall
back to the `simple` configuration and offer little over a `LIKE` scan.

A dedicated search engine would give the best relevance, at the cost of a second
service to host, monitor and pay for at a scale the platform does not have.

The specification's result card also renders a business type that the model has no
field for, and states that only active Businesses appear without saying who sets
that flag.

## Decision

Match with `pg_trgm` over a GIN index, ranking by `similarity()` with a boost for
prefix matches. Trigram matching operates on characters rather than words, so it
behaves identically in Hebrew and English.

Business carries **no type field**. Categorisation is dropped rather than
introduced as free text.

`active` is **true on registration**. There is no approval queue; the
administrator panel deactivates reactively, and Billing deactivates on a lapsed
Subscription.

Search sits behind a repository interface, so a dedicated engine can replace the
implementation without touching callers.

## Consequences

- Inexact input is tolerated without new infrastructure, and the primary language
  is served as well as the secondary one.
- A Business is discoverable the moment it registers, so nobody has to staff a
  review queue from day one — and nothing stops a low-quality or fake listing from
  appearing until an administrator acts.
- There is no browse-by-category axis, and adding one later means backfilling a
  field across existing Businesses.
- Trigram indexes grow with the text they cover and rank by character overlap
  alone, so relevance will degrade as the number of Businesses grows. The
  repository seam is what makes that a replaceable problem.
