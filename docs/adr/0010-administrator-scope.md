# 10. Operational administrator scope, without impersonation

Date: 2026-08-24

## Status

Accepted

## Context

The specification gives the administrator a broad and vague list, including
"manage permissions" — which has no referent in this model, since authorization is
the existence of a Membership and there is no permission system to administer.

Decisions taken elsewhere added two responsibilities the specification never
anticipated: deactivating a Business, and recording a Payment against a
Subscription.

The weight of this decision comes from ADR 0007. Administrator actions run over
the `service_role` connection that bypasses Row Level Security, so there is no
database backstop on this path — only application code. Every capability granted
is a capability an attacker acquires by compromising a single phone number, which
under ADR 0004 is the whole of an administrator's credentials.

A strictly minimal scope was considered: read-only lists plus the two writes
already required. It was rejected as unable to support the platform operator when
a Business owner needs help.

## Decision

Administrators may read the list of Businesses and Users, toggle a Business's
active flag, record a Payment, deactivate a User, edit a Business on its owner's
behalf, and open an individual customer record for support purposes.

**Impersonation is excluded.** No administrator may act as another User.

The first administrator is seeded by migration; thereafter the flag is set only by
another administrator, and that change is audited. Administrator login additionally
requires the phone number to appear on an explicit allowlist, so a stolen session
or a mistakenly set flag is not sufficient on its own.

Every administrator action is audited without exception, reads of customer records
included, as recorded in ADR 0006.

## Consequences

- Support work that would otherwise require database access has a bounded,
  audited path through the product.
- The audit log remains answerable. Impersonated actions would record the wrong
  actor, which would make every "the system did this without me" dispute
  unresolvable.
- Administrators can read customer names and phone numbers across Businesses —
  precisely what tenant isolation forbids between Businesses. The justification is
  no stronger for the operator, and read auditing plus the allowlist are the only
  controls on it.
- The allowlist is operational state that must be maintained; an administrator
  who changes their number is locked out until it is updated.
