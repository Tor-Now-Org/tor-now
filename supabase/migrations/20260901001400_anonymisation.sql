-- ADR 0008: "A soft delete does not satisfy a formal erasure request under
-- Israel's Privacy Protection Law, since the data is still held and still
-- identifies the person. Responding to such a request requires an anonymisation
-- path that does not exist yet; it would clear name, birth date and phone while
-- keeping the row."
--
-- This is that path. The row stays, so Appointments, per-business statistics and
-- the audit trail keep their references and no foreign key is orphaned — which
-- is the whole reason deletion was soft in the first place. What leaves is
-- everything that identifies the person.
--
-- The phone is replaced rather than nulled: it is the unique identity key and a
-- NOT NULL column, and replacing it with a value that cannot be dialled also
-- settles the other consequence the ADR records — the original number is
-- released, so the person, or whoever the carrier reissues it to, may register
-- again.
alter table app_user
  add column if not exists anonymised_at timestamptz;

comment on column app_user.anonymised_at is
  'ADR 0008: when a formal erasure request was answered. Irreversible.';

-- The phone check has to admit the replacement, which is deliberately not a
-- dialable number so nothing can mistake it for one.
alter table app_user drop constraint if exists app_user_phone_e164;
alter table app_user add constraint app_user_phone_e164 check (
  phone ~ '^\+[1-9][0-9]{7,14}$'
  or (anonymised_at is not null and phone ~ '^anonymised:[0-9a-f-]{36}$')
);

alter table app_user drop constraint if exists app_user_name_present;
alter table app_user add constraint app_user_name_present check (
  length(btrim(name)) > 0
);

-- Erasure runs over the service_role connection like every other administrator
-- action, and is audited — but the audit row deliberately records only that it
-- happened and to which row, never the values removed. An audit trail retaining
-- the data an erasure request just cleared would defeat the request, and ADR
-- 0006 keeps these rows for a year.
create or replace function app.anonymise_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_already timestamptz;
begin
  select anonymised_at into v_already from app_user where id = p_user_id;
  if v_already is not null then
    return;
  end if;

  update app_user
  set phone = 'anonymised:' || gen_random_uuid()::text,
      name = 'משתמש שהוסר',
      birth_date = null,
      deleted_at = coalesce(deleted_at, now()),
      anonymised_at = now(),
      is_administrator = false
  where id = p_user_id;
end;
$$;

revoke all on function app.anonymise_user(uuid) from public, anon, authenticated;
