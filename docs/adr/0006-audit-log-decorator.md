# 6. Append-only audit log, written by a repository decorator

Date: 2026-08-24

## Status

Accepted

## Context

Significant changes must be traceable: appointment creation and rescheduling,
cancellations, and changes to a Resource's Working Hours, Date Overrides and
Blocks. Cancellation already records who cancelled and when, but nothing records
authorship of any other change.

Storing only `updatedBy` and `updatedAt` on each row was rejected: it answers who
changed something *last*, while disputes are usually about a change made earlier.

Database triggers were considered and rejected. Triggers cannot be bypassed by any
write path, which is a real advantage, but the team prefers behaviour to live in
application code where it is visible in review and testable without a database.

## Decision

Record every significant mutation in a single append-only `audit_log` table:
`actor_id, action, entity_type, entity_id, before, after, occurred_at`, with
`before` and `after` as JSONB.

Writes are produced by an **auditing decorator** wrapping each repository, not by
call sites. The decorator implements the same interface as the repository it
wraps, reads the prior state, delegates the mutation, and appends the audit row.
Domain services depend on the repository interface and are unaware that auditing
happens at all.

The audit row is written **inside the same transaction** as the mutation it
describes. A committed change without its audit row is not an acceptable state.

Audit rows are retained for one year.

## Consequences

- Auditing is applied by composition at the point repositories are wired, so
  adding it to a new entity is a wiring change rather than an edit to every
  mutation site.
- Domain logic stays free of audit concerns and remains testable without an audit
  sink.
- Unlike a trigger, this can be bypassed. Any write reaching the database without
  passing through a decorated repository — a migration, an ad-hoc script, a future
  service with its own data access — produces no audit trail. Keeping all writes
  behind repositories is therefore a standing constraint, not merely a preference.
- The audit table grows monotonically and needs a retention job.
- Administrators may read individual customer records for support purposes, over
  a connection that bypasses Row Level Security. Those reads are audited as well
  as writes: an unlogged read on that path would be undetectable, and it is the
  only oversight mechanism covering it. Read auditing applies to administrator
  access to customer records and to nothing else.
