-- ADR 0005 deferred reminders "until a scheduler exists". One exists now, so
-- this is the state a reminder job needs: a stamp saying the reminder for this
-- appointment has been enqueued.
--
-- The stamp, rather than a query over the outbox, is what makes the job safe to
-- run as often as anyone likes. It is written in the same transaction as the
-- outbox row, so a crash between the two is not a state the system can reach —
-- the same guarantee ADR 0005 relies on for confirmations.
alter table appointment
  add column if not exists reminder_enqueued_at timestamptz;

comment on column appointment.reminder_enqueued_at is
  'ADR 0005: set when the reminder was written to the outbox, so it is written exactly once.';

create index if not exists appointment_awaiting_reminder
  on appointment (start_at)
  where status = 'CONFIRMED' and reminder_enqueued_at is null;
