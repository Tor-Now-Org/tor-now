-- ---------------------------------------------------------------------------
-- Billing. Concerns the platform operator and the Business owner — never the
-- customer, who pays the Business directly and outside the system entirely.
-- ---------------------------------------------------------------------------

-- Every Business has one, including those on a free plan.
create table subscription (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid        not null unique references business (id) on delete cascade,
  plan           text        not null default 'FREE' check (plan in ('FREE', 'STANDARD')),
  amount_minor   integer     not null default 0,
  billing_period text        not null default 'MONTHLY' check (billing_period in ('MONTHLY', 'YEARLY')),
  -- The date the Business is paid up to, inclusive.
  paid_through   date        not null default current_date,
  created_at     timestamptz not null default now(),

  constraint subscription_amount_sane check (amount_minor >= 0)
);

-- A recorded receipt of money from a Business to the platform, entered by an
-- administrator. The platform moves no money itself; this records something
-- that already happened elsewhere.
create table payment (
  id              uuid primary key default gen_random_uuid(),
  subscription_id uuid        not null references subscription (id) on delete cascade,
  business_id     uuid        not null references business (id) on delete cascade,
  amount_minor    integer     not null,
  paid_on         date        not null,
  -- Every Payment has a named author.
  recorded_by     uuid        not null references app_user (id),
  note            text,
  recorded_at     timestamptz not null default now(),

  constraint payment_amount_positive check (amount_minor > 0)
);

create index payment_by_business on payment (business_id, paid_on desc);

-- Every Business gets a Subscription the moment it exists. Doing this in the
-- database rather than in the registration path means no future write path can
-- create a Business without one.
create or replace function app.create_default_subscription()
returns trigger
language plpgsql
as $$
begin
  insert into subscription (business_id) values (new.id);
  return new;
end;
$$;

create trigger business_gets_a_subscription
  after insert on business
  for each row execute function app.create_default_subscription();
