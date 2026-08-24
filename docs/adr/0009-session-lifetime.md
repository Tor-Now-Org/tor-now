# 9. A single thirty-day session lifetime for every role

Date: 2026-08-24

## Status

Accepted

## Context

Authentication is a WhatsApp code and nothing else (ADR 0004), so every login
costs a message and a wait. Session lifetime is therefore a cost and conversion
lever as much as a security one.

Owners and customers carry different blast radii. An owner's session reaches every
customer record in that Business; a customer's session reaches their own
appointments. That asymmetry argues for a shorter window on the privileged side.

Supabase Auth's refresh-token lifetime is a **project-wide** setting and cannot
vary by role. Differentiating would mean either a long project setting with a
shorter ceiling re-checked in application code for privileged sessions, or a short
project setting with customer sessions extended by something the platform does not
provide.

## Decision

One refresh-token lifetime of **thirty days**, applied to customers, owners and
administrators alike. No per-role ceiling, no application-level session logic.
Supabase Auth remains the only authority on whether a session is live.

## Consequences

- There is no second place where session validity is decided, so no code path can
  forget to apply it.
- Owner and administrator exposure is bounded by the same thirty days, which is
  the figure the privileged side wanted.
- Customers re-verify roughly every other visit. Typical booking intervals for
  these services run four to eight weeks, so a thirty-day window expires between
  most visits: a WhatsApp message per re-login, and a code wait at the moment of
  confirming. Under the no-hold model of ADR 0003 that wait is exactly when a slot
  can be lost to another customer.
- Message volume is therefore driven by returning customers, not only by new ones,
  which weakens the cost assumption behind the WhatsApp-primary choice in ADR 0005.
- Lengthening the window later is a settings change with no migration, so the
  figure can be revisited once real re-login volume is visible.
