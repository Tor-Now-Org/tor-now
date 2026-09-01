# 15. Session tokens signed by the service, not by Supabase Auth

Date: 2026-09-01

## Status

Accepted

Amends ADR 0007, which routed verification through Twilio Verify via Supabase
Auth, and ADR 0009, which made Supabase Auth "the only authority on whether a
session is live".

## Context

ADR 0007 delegated verification and session issuance to Supabase Auth's phone
provider, which requires Twilio credentials. This deployment has none, and
Supabase Auth's phone sign-in cannot be used at all without them — which would
leave the platform with no way to authenticate anybody.

A second constraint appeared with it. The deployment tooling available here can
set no Edge Function secrets, so `SUPABASE_JWT_SECRET` cannot be provisioned;
Supabase injects `SUPABASE_DB_URL` and `SUPABASE_SERVICE_ROLE_KEY` and nothing
else.

## Decision

The service issues and verifies its own session tokens.

Verification codes are generated, salted by phone, hashed with SHA-256 and
stored by the service; the code itself is never stored. Delivery goes through
the `VerificationSender` port, whose adapters are the log and Twilio.

Tokens are JWTs carrying `sub`, `phone`, `role` and `is_administrator`, signed
with HMAC-SHA256 by a key derived through HKDF from `SUPABASE_JWT_SECRET` where
one is provisioned, and from `SUPABASE_SERVICE_ROLE_KEY` where one is not. The
derivation means the raw secret is never itself the signing key in either case.
Lifetime remains ADR 0009's thirty days, decided in one constant.

`/health` reports which secret the key was derived from.

## Consequences

- The platform can authenticate people without a messaging vendor, which is what
  makes a working deployment possible at all before Twilio is chosen.
- ADR 0009's claim that there is no second place deciding session validity still
  holds — there is exactly one, and it is now this service rather than Supabase
  Auth.
- Rotating the service role key invalidates every live session wherever the
  fallback is in use. Provisioning `SUPABASE_JWT_SECRET` removes that coupling
  and is the first thing to do before real customers.
- Code throttling and WhatsApp-to-SMS fallback are now the service's code rather
  than Twilio Verify configuration, which ADR 0007 counted as an advantage of
  the delegated approach. They are implemented here and tested; the loss is that
  they are ours to maintain.
- Moving back to Supabase Auth later means re-issuing sessions, not rewriting
  the domain: the `TokenIssuer` and `TokenVerifier` ports are what the rest of
  the system depends on.
