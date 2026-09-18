-- ---------------------------------------------------------------------------
-- Reviews
--
-- A customer's stars and words about a Business. One per customer per
-- Business — the unique pair is what makes "sent once, edited after" true of
-- the data — and only from a customer who has been: a CONFIRMED Appointment
-- there whose end has passed (outcome FINISHED, see booking/outcome.ts).
-- ---------------------------------------------------------------------------

create table review (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid        not null references business (id) on delete cascade,
  customer_id uuid        not null references app_user (id),
  stars       smallint    not null,
  comment     text        not null default '',
  -- Shown without the author's name. Who wrote it is still this row's
  -- customer_id: anonymous to the business and other customers, not to the
  -- platform.
  anonymous   boolean     not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint review_stars_in_range check (stars between 1 and 5),
  constraint review_comment_length check (length(comment) <= 1000),
  unique (business_id, customer_id)
);

create index review_by_business on review (business_id, updated_at desc);

alter table review enable row level security;

-- As public as the Business itself.
create policy review_readable on review
  for select to anon, authenticated
  using (exists (select 1 from business
                  where business.id = review.business_id
                    and (business.active or app.is_member_of(business.id))));

-- ADR 0007's backstop: the service checks the same thing to give a usable
-- error, but a customer who has not been cannot write one whatever the path.
create or replace function app.has_visited(target_business uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from appointment
    where business_id = target_business
      and customer_id = app.current_user_id()
      and status = 'CONFIRMED'
      and end_at <= now()
  );
$$;

revoke all on function app.has_visited(uuid) from public;
grant execute on function app.has_visited(uuid) to authenticated;

create policy review_written_by_customer on review
  for insert to authenticated
  with check (customer_id = app.current_user_id() and app.has_visited(business_id));

create policy review_edited_by_author on review
  for update to authenticated
  using (customer_id = app.current_user_id())
  with check (customer_id = app.current_user_id() and app.has_visited(business_id));

-- Who wrote it. RLS shows a User only to themselves and to owners, so the
-- author's given name is handed over here and nothing else about them — and
-- for an anonymous review, not even that, nor the author's id. An erased
-- author reads as whatever anonymisation left (ADR 0014); a soft-deleted one
-- is left out.
create or replace function app.business_reviews(p_business_id uuid)
returns table (
  id uuid, business_id uuid, customer_id uuid, stars smallint, comment text,
  anonymous boolean, created_at timestamptz, updated_at timestamptz, author_name text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select r.id, r.business_id,
         case when r.anonymous then null else r.customer_id end,
         r.stars, r.comment, r.anonymous, r.created_at, r.updated_at,
         case when r.anonymous then null else u.given_name end
  from review r
  join app_user u on u.id = r.customer_id
  join business b on b.id = r.business_id
  where r.business_id = p_business_id
    and (u.deleted_at is null or u.anonymised_at is not null)
    and (b.active or app.is_member_of(b.id))
  order by r.updated_at desc;
$$;

revoke all on function app.business_reviews(uuid) from public;
grant execute on function app.business_reviews(uuid) to anon, authenticated;
