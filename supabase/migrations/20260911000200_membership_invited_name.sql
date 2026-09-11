-- Inviting a phone that has never signed in discards the name the inviter
-- typed — the invitee sets their own name on first login (needsName). That is
-- right for app_user, but the team list then has nothing better to show than
-- the UNNAMED sentinel until the person registers. These columns keep the
-- inviter's typed name as a display hint, separate from identity.
alter table membership add column if not exists invited_given_name text;
alter table membership add column if not exists invited_family_name text;

alter table membership add constraint membership_invited_given_name_present check (
  invited_given_name is null or length(btrim(invited_given_name)) > 0
);
alter table membership add constraint membership_invited_family_name_present check (
  invited_family_name is null or length(btrim(invited_family_name)) > 0
);

comment on column membership.invited_given_name is
  'What the inviter typed as a given name, shown only while the invitee has not yet registered. Not identity.';
comment on column membership.invited_family_name is
  'What the inviter typed as a family name, shown only while the invitee has not yet registered. Not identity.';

drop function app.invite_user_to_business(uuid, text, text, text, text);

create function app.invite_user_to_business(
  target_business_id uuid,
  invite_phone text,
  invite_given_name text,
  invite_family_name text,
  invite_role text,
  invited_given_name text,
  invited_family_name text
)
returns table (out_user_id uuid, out_membership_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  new_user_id uuid;
  new_membership_id uuid;
begin
  -- Verify the caller is a manager of this business
  if not app.manages(target_business_id) then
    raise exception 'Insufficient permissions';
  end if;

  -- Find or create the user. A soft-deleted phone is reused, not duplicated;
  -- the caller (TypeScript) rejects inviting a closed account before calling.
  select id into new_user_id from app_user where phone = invite_phone;

  if new_user_id is null then
    insert into app_user (phone, given_name, family_name, birth_date)
    values (invite_phone, invite_given_name, invite_family_name, null)
    returning app_user.id into new_user_id;
  end if;

  -- Create or update the membership. requireRoleWithinReach is the caller's
  -- job (TypeScript) — this function trusts the role it's given. The
  -- inviter's typed name is kept as a display hint, refreshed on re-invite.
  insert into membership (
    user_id, business_id, role, invited_given_name, invited_family_name
  )
  values (
    new_user_id, target_business_id, invite_role, invited_given_name, invited_family_name
  )
  on conflict (user_id, business_id) do update set
    role = excluded.role,
    invited_given_name = excluded.invited_given_name,
    invited_family_name = excluded.invited_family_name
  returning membership.id into new_membership_id;

  return query select new_user_id, new_membership_id;
end;
$$;

revoke all on function app.invite_user_to_business(uuid, text, text, text, text, text, text) from public;
grant execute on function app.invite_user_to_business(uuid, text, text, text, text, text, text) to authenticated;
