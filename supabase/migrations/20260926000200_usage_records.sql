-- ---------------------------------------------------------------------------
-- Usage Records and Unit Rates (docs/billing/CONTEXT.md): what the platform
-- pays for on each Business's behalf, measured from the first message and
-- priced separately, so that a Plan's price and its Fair Use Limit are set from
-- what Businesses actually use at prices somebody has checked.
-- ---------------------------------------------------------------------------

-- A message in the outbox now says whose it is, so the cost of delivering it
-- can be charged to that Business. Nullable only for rows already written
-- before this migration; nothing enqueues without one from here on.
alter table notification_outbox
  add column business_id uuid references business (id) on delete set null;

-- The old three-argument function could enqueue a message nobody is charged
-- for. It goes, so that no path can keep calling it.
drop function app.enqueue_notification(text, text, jsonb);

create or replace function app.enqueue_notification(
  p_business_id uuid,
  p_recipient_phone text,
  p_template text,
  p_payload jsonb
)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into notification_outbox (business_id, recipient_phone, template, payload)
  values (p_business_id, p_recipient_phone, p_template, p_payload);
$$;

revoke all on function app.enqueue_notification(uuid, text, text, jsonb) from public;
grant execute on function app.enqueue_notification(uuid, text, text, jsonb) to anon, authenticated;

-- What one unit cost from a given day, and where the figure came from. An
-- administrator corrects one by adding a row from the day it applies — which
-- may be in the past — so what was recorded is priced again without being
-- rewritten.
create table unit_rate (
  id             bigserial primary key,
  unit           text        not null
    check (unit in ('WHATSAPP_UTILITY', 'WHATSAPP_AUTHENTICATION', 'SMS_SEGMENT')),
  effective_from date        not null,
  micro_shekels  bigint      not null check (micro_shekels >= 0),
  -- The rate card's address, or the invoice the figure was read from.
  source         text        not null check (length(btrim(source)) > 0),
  -- The administrator who entered it; null for a default the platform shipped with.
  checked_by     uuid references app_user (id),
  created_at     timestamptz not null default now(),

  unique (unit, effective_from)
);

-- Defaults to start from, dated before any usage was recorded, each saying
-- where it came from so it is plain which one to check first. At 3.70 shekels
-- to the dollar.
insert into unit_rate (unit, effective_from, micro_shekels, source) values
  ('SMS_SEGMENT', '2026-09-01', 952750,
   'Default: Twilio Israel mobile, $0.2575 a segment — https://www.twilio.com/en-us/sms/pricing/il'),
  ('WHATSAPP_UTILITY', '2026-09-01', 19610,
   'Default, unconfirmed: estimate of Meta''s Israel utility rate, $0.0053 — check against https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing'),
  ('WHATSAPP_AUTHENTICATION', '2026-09-01', 19610,
   'Default, unconfirmed: estimate of Meta''s Israel authentication rate, $0.0053 — check against https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing');

-- One billable thing that happened: a message sent, in so many units. It holds
-- no price; the cost is worked out from the rate in force when it happened.
create table usage_record (
  id            bigserial primary key,
  -- Null for usage no Business caused: signing a person in.
  business_id   uuid references business (id) on delete set null,
  source        text        not null check (
    source in ('BOOKING', 'SIGN_IN') or app.is_feature(source)
  ),
  unit          text        not null
    check (unit in ('WHATSAPP_UTILITY', 'WHATSAPP_AUTHENTICATION', 'SMS_SEGMENT')),
  quantity      integer     not null check (quantity >= 1),
  occurred_at   timestamptz not null default now()
);

create index usage_record_by_business on usage_record (business_id, occurred_at);
create index usage_record_by_time on usage_record (occurred_at);

-- Written by the delivery worker and the sign-in path over the service
-- connection, read by an administrator. Nobody else has any business here.
alter table unit_rate    enable row level security;
alter table usage_record enable row level security;

comment on table unit_rate is
  'What one unit cost from effective_from, with the evidence. RLS enabled with no policy: service_role only.';
comment on table usage_record is
  'One billable thing that happened, unpriced. RLS enabled with no policy: service_role only.';
