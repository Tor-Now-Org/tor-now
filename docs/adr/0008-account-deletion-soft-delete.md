# 8. Account deletion is a soft delete

Date: 2026-08-24

## Status

Accepted

## Context

Customers can ask for their account to be removed. Their data is entangled with
records other parties have their own reasons to keep: appointments that genuinely
took place, per-business statistics, and the audit trail.

Hard deletion was rejected — it destroys those records and breaks foreign keys
across a schema where much hangs off `user_id`. Anonymisation, which clears
identifying fields while keeping the row, was considered and not adopted.

## Decision

Deleting an account marks the User row deleted and hides it from all interfaces.
Personal data is retained. Appointments, statistics and audit history are
unaffected.

## Consequences

- Businesses keep accurate history and counts, and no foreign key is orphaned.
- The account can be restored if the customer changes their mind.
- A soft delete does not satisfy a formal erasure request under Israel's Privacy
  Protection Law, since the data is still held and still identifies the person.
  Responding to such a request requires an anonymisation path that does not exist
  yet; it would clear name, birth date and phone while keeping the row.
- Phone is the unique identity key. A soft-deleted row retains its phone, so that
  number cannot register again — neither by the original person nor by whoever the
  carrier later reissues it to. Releasing the phone on delete (nulling it, or
  moving it to a nullable `former_phone` column) is a small, self-contained change
  that removes this limitation if it proves a problem in practice.
