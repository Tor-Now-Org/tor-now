# 24. Several categories, and fewer of them

Date: 2026-10-04

## Status

Accepted. Supersedes the "one Category" part of ADR 0017; the rest of it stands.

## Context

A barbershop that also does kids' cuts, or a clinic with physiotherapy and
acupuncture, could be found under one Category only. The list had also grown to
86 entries, some saying the same thing twice ("אורתודנט" beside "מרפאת שיניים",
"לק ג׳ל" beside "מניקור ופדיקור").

## Decision

A Business has **one to three Categories**, in order. The first is its **main**
one: what a result card, a map pin and "visited" call it by.

- **Stored as `business.categories text[]`**, at most three and none twice, both
  checked by the table. Which codes exist is still the API's to check (ADR 0017),
  so adding one needs no migration. A GIN index serves "has this one".
- **Search finds a Business under any of its Categories**, chosen or inferred.
  Cards name the main one and say "+N"; the business page lists them all.
- **Nineteen Categories joined a sibling under the same parent group**, so no
  Business ends up under a different group than it chose. The merged label names
  both halves ("רופא שיניים ואורתודנט"). Every retired name stays a search word of
  the one it joined, in both languages. The migration moved every Business on a
  retired code; `CATEGORY_MERGES` in the domain keeps the same map, so a retired
  code arriving from an old client or an old link means the one it joined.
- **The old single field is still read and written.** Requests may send
  `category` (one code) instead of `categories`; both at once is refused. Responses
  carry `category` as the main one beside `categories`, so a client from before
  keeps working through a deploy.
- **Choosing from two parent groups is allowed.** The chooser says so in one line,
  since it is often a slip, and never refuses it.

## Consequences

- The main Category is the order of a list, not a flag: making another main is
  moving it first, and removing the main one makes the next one main.
- A Business with none (registered before ADR 0017) is still asked for one in
  settings; registering requires at least one, and none can be cleared.
- `CATEGORY_MERGES` and the migration's `case` must agree; the migration is
  proven by its before/after probe in `supabase/tests/migrations`.
