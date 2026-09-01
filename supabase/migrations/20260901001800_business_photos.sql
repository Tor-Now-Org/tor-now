-- ---------------------------------------------------------------------------
-- Business photos
--
-- A Business gets one cover photo and up to three more. The bytes live in
-- Supabase Storage; this table is the record of which object belongs to which
-- Business, and in what order they are shown.
-- ---------------------------------------------------------------------------

create table business_photo (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid        not null references business (id) on delete cascade,
  -- The object's key inside the bucket. Unique because two rows pointing at one
  -- object would make deleting either of them destroy the other's picture.
  storage_path text        not null unique,
  content_type text        not null,
  byte_size    integer     not null,
  -- Slot zero is the cover; one to three are the rest. Expressing the limit as
  -- a numbered slot rather than a count is what lets the database hold it: a
  -- unique pair and a range check together say "one cover, at most three
  -- others" without a trigger counting rows, and without any write path being
  -- trusted to remember.
  position     smallint    not null,
  created_at   timestamptz not null default now(),

  constraint business_photo_slot_in_range check (position between 0 and 3),
  constraint business_photo_type_supported
    check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
  constraint business_photo_size_sane check (byte_size between 1 and 5242880),
  unique (business_id, position)
);

create index business_photo_by_business on business_photo (business_id, position);

comment on table business_photo is
  'One cover (position 0) and up to three more (positions 1-3), enforced by the unique pair and the range check rather than by application code.';

alter table business_photo enable row level security;

-- Read access matches the Business itself: a photo is part of how a customer
-- decides, so it is as public as the name and the address are.
create policy business_photo_readable on business_photo
  for select to anon, authenticated
  using (exists (select 1 from business
                  where business.id = business_photo.business_id
                    and (business.active or app.is_member_of(business.id))));

create policy business_photo_written_by_owner on business_photo
  for all to authenticated
  using (app.owns(business_id))
  with check (app.owns(business_id));

-- ---------------------------------------------------------------------------
-- The bucket
--
-- Public, because these photos are shown on a page that requires no session:
-- signing a URL per request would put a round trip in front of every image and
-- defeat the CDN, to protect something already meant to be seen. Writes are a
-- different matter and never happen from a browser — the Edge Function puts
-- the bytes there over the service role, which is outside RLS, so the bucket
-- needs no object policy of its own.
--
-- Storage is a Supabase schema. On a plain Postgres — CI, a laptop — it is
-- absent, and the photo store falls back to serving bytes from the API itself,
-- exactly as the notifier falls back to the log without Twilio.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regnamespace('storage') is null then
    raise notice 'no storage schema: skipping bucket creation';
    return;
  end if;

  execute $bucket$
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('business-photos', 'business-photos', true, 5242880,
            array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do update
      set public = excluded.public,
          file_size_limit = excluded.file_size_limit,
          allowed_mime_types = excluded.allowed_mime_types
  $bucket$;
end $$;
