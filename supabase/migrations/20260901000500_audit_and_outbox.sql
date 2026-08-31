-- ---------------------------------------------------------------------------
-- Audit log (ADR 0006)
-- ---------------------------------------------------------------------------

-- Append-only. Rows are written by an auditing repository decorator, inside the
-- same transaction as the mutation they describe: a committed change without
-- its audit row is not an acceptable state.
create table audit_log (
  id          bigserial primary key,
  actor_id    uuid        references app_user (id),
  action      text        not null,
  entity_type text        not null,
  entity_id   text,
  before      jsonb,
  after       jsonb,
  occurred_at timestamptz not null default now(),

  constraint audit_log_action_present check (length(btrim(action)) > 0)
);

create index audit_log_recent on audit_log (occurred_at desc);
create index audit_log_by_entity on audit_log (entity_type, entity_id, occurred_at desc);
create index audit_log_by_actor on audit_log (actor_id, occurred_at desc);

comment on table audit_log is
  'ADR 0006. Retained for one year. Administrator reads of customer records are audited too — an unlogged read on the service_role path would be undetectable, and it is the only oversight mechanism covering it.';

-- Append-only is enforced, not merely intended. Without this, the same
-- connection that writes the trail could rewrite it.
create or replace function app.reject_audit_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_log is append-only';
end;
$$;

create trigger audit_log_is_append_only
  before update or delete on audit_log
  for each row execute function app.reject_audit_mutation();

-- ---------------------------------------------------------------------------
-- Notification outbox (ADR 0005)
-- ---------------------------------------------------------------------------

-- Messages are enqueued in the same transaction as the event that caused them
-- and delivered by a worker, so a messaging outage delays notifications but
-- never rolls back or loses the booking that triggered them.
create table notification_outbox (
  id             bigserial primary key,
  recipient_phone text       not null,
  -- One of the three approved templates: confirmation, cancellation, reschedule.
  template       text        not null,
  payload        jsonb       not null default '{}'::jsonb,
  status         text        not null default 'PENDING'
    check (status in ('PENDING', 'SENT', 'FAILED')),
  attempts       integer     not null default 0,
  last_error     text,
  -- ADR 0005: WhatsApp primary, SMS fallback when delivery fails.
  delivered_via  text check (delivered_via in ('WHATSAPP', 'SMS', 'LOG')),
  created_at     timestamptz not null default now(),
  delivered_at   timestamptz
);

-- The worker's claim query reads exactly this index.
create index notification_outbox_pending
  on notification_outbox (created_at)
  where status = 'PENDING';

-- ---------------------------------------------------------------------------
-- Phone verification (ADR 0004)
-- ---------------------------------------------------------------------------

-- Codes are stored hashed, never in the clear: this table is readable by the
-- service_role connection, and a plaintext code here would be a credential at
-- rest. Rate limiting narrows to code issuance and code checking, which is what
-- `attempts` and the issuance index below support.
create table verification_code (
  id          uuid primary key default gen_random_uuid(),
  phone       text        not null,
  code_hash   text        not null,
  expires_at  timestamptz not null,
  consumed_at timestamptz,
  attempts    integer     not null default 0,
  created_at  timestamptz not null default now(),

  constraint verification_code_e164 check (phone ~ '^\+[1-9][0-9]{7,14}$')
);

create index verification_code_live
  on verification_code (phone, created_at desc);
