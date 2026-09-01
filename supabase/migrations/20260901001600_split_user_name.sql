-- The sign-in and profile screens ask for a first name and a last name; the
-- model held one field and joined them on the way in, which meant a business
-- could show a customer's name but never sort or search by family name, and a
-- person could not correct one half without retyping the other.
--
-- `name` becomes the given name, which is what it always actually held, and the
-- family name gets a column of its own. It is nullable because the sign-in
-- screen asks for a first name and treats the rest as optional — a customer who
-- gives only "דנה" is a customer, not an invalid row.
alter table app_user rename column name to given_name;
alter table app_user add column if not exists family_name text;

alter table app_user drop constraint if exists app_user_name_present;
alter table app_user add constraint app_user_given_name_present check (
  length(btrim(given_name)) > 0
);
alter table app_user add constraint app_user_family_name_present check (
  family_name is null or length(btrim(family_name)) > 0
);

comment on column app_user.given_name is
  'The name a person is called. Required: every interface needs something to render.';
comment on column app_user.family_name is
  'Optional. Asked for at sign-in, and what an owner sorts a customer list by.';

-- Erasure clears both halves (ADR 0014).
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
      given_name = 'משתמש שהוסר',
      family_name = null,
      birth_date = null,
      deleted_at = coalesce(deleted_at, now()),
      anonymised_at = now(),
      is_administrator = false
  where id = p_user_id;
end;
$$;
