# 7. Supabase Edge Functions as the domain layer, RLS as the isolation backstop

Date: 2026-08-24

## Status

Accepted

Amends ADR 0005: verification codes are delivered by Twilio Verify through
Supabase Auth, not through the `Notifier` port. The port carries booking
confirmations and cancellations only.

## Context

The platform runs on Supabase (Postgres, Auth, Edge Functions) with a React
front end on Vercel. Supabase hosts no long-running processes, so application
code runs as Deno Edge Functions; NestJS is not a viable target and Hono with an
explicit composition root replaces it.

Three earlier decisions constrain the write path. Bookings must catch the
exclusion-constraint violation (ADR 0003), audit rows must be written in the same
transaction as the mutation they describe (ADR 0006), and businesses must be
unable to reach each other's data.

`supabase-js` speaks to PostgREST and offers no transactions, so the domain layer
connects to Postgres directly through Supavisor.

## Decision

**Runtime.** A single Edge Function with internal Hono routing hosts the domain
layer. Scheduled work — draining the notification outbox, audit retention — is
driven by Supabase Cron, since serverless functions do not run unprompted.

**Identity.** Edge Functions verify the Supabase JWT, then re-establish the
caller's identity per transaction on the direct connection:

```sql
select set_config('role', 'authenticated', true);
select set_config('request.jwt.claims', '<claims>', true);
```

Both settings are transaction-local and cannot leak across pooled connections.
`auth.uid()` therefore resolves correctly inside a real transaction with RLS
active. The `service_role` key is confined to Edge Function environment variables.

**Isolation.** Enforced twice, deliberately. Row Level Security is enabled on
every table and is the authority; the domain layer additionally checks Membership
explicitly to produce meaningful errors. `business_id` is carried on every
tenant-scoped table so policies never join, kept consistent by composite foreign
keys against the parent's `(id, business_id)`.

**Client access.** The browser never reads `appointment`, `block` or `audit_log`,
and never writes any table directly. Availability is computed in an Edge Function
that returns start times only.

## Consequences

- Tenant isolation survives a forgotten predicate in application code, and a
  wrong RLS policy still produces a clear error from the explicit check.
- Booking rules that no database constraint can express — working hours, breaks,
  and the booking window of ADR 0012 — are enforceable, because the only write
  path is the Edge Function.
- Neither customer identities nor a business's booking volume are exposed by the
  availability endpoint, since only free start times cross the wire.
- RLS policy mistakes surface as missing rows rather than errors, which is harder
  to debug and needs deliberate test coverage per policy.
- Verification, code throttling and WhatsApp-to-SMS fallback become Twilio Verify
  configuration rather than code the project owns.
- Deno constrains library choice, and every background job needs a cron entry.
