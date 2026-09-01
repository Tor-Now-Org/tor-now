# 14. Anonymisation, to answer an erasure request

Date: 2026-09-01

## Status

Accepted

Completes ADR 0008, which recorded that this path "does not exist yet".

## Context

ADR 0008 made deletion a soft delete and named the gap that leaves: a soft
delete does not satisfy a formal erasure request under Israel's Privacy
Protection Law, because the data is still held and still identifies the person.
It also described what the answer would look like — "clear name, birth date and
phone while keeping the row" — and left it unbuilt.

Two details that description leaves open turn out to decide the design. `phone`
is `NOT NULL` and unique, so it cannot simply be cleared. And the audit trail of
ADR 0006 keeps rows for a year, which means an erasure recorded the way every
other change is recorded would retain exactly the data the request asked to be
removed.

## Decision

An `anonymise` operation that clears the identifying fields, keeps the row, and
cannot be undone.

`phone` is replaced with `anonymised:<uuid>` rather than nulled. This keeps the
column non-null and unique, is not a dialable number so nothing can mistake it
for one, and settles the other consequence ADR 0008 recorded: the original
number is released, so the person — or whoever the carrier later reissues it to
— may register again.

The audit entry records that an erasure happened, to which row, by which
administrator, and the reason given. It deliberately records none of the values
removed.

It is an administrator action. A formal request arrives at the operator rather
than through a screen, and the operation is irreversible, which is not something
to put behind a button a customer can press by accident. The reason is required.

## Consequences

- The gap ADR 0008 named is closed, and the erasure is answerable: the trail
  shows one happened and why, without holding what it erased.
- Appointments, per-business statistics and the audit trail keep their
  references and stay accurate, which was the whole reason deletion was soft.
- It cannot be undone, including by an administrator, and restoring the account
  does not bring the details back. That is the point, and the interface says so
  before asking for confirmation.
- A person who is erased and then registers again with the same number is a new
  User with no history. That is correct, and it means "erased" is not a state
  anyone can be talked out of afterwards.
- The audit row still names the administrator who acted, which is personal data
  about them rather than about the customer, and is retained for the usual year.
