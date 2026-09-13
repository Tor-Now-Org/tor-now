-- ---------------------------------------------------------------------------
-- Fix ambiguous column reference in app.invite_user_to_business.
--
-- `returns table (user_id uuid, membership_id uuid)` creates OUT variables
-- named user_id/membership_id, which collide with the `user_id` column
-- referenced inside `insert into membership (user_id, ...) on conflict
-- (user_id, ...)` in the same function body. Renaming the OUT parameters
-- removes the ambiguity.
-- ---------------------------------------------------------------------------

drop function app.invite_user_to_business(uuid, text, text, text, text);

create function app.invite_user_to_business(
  target_business_id uuid,
  invite_phone text,
  invite_given_name text,
  invite_family_name text,
  invite_role text
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
  -- job (TypeScript) — this function trusts the role it's given.
  insert into membership (user_id, business_id, role)
  values (new_user_id, target_business_id, invite_role)
  on conflict (user_id, business_id) do update set role = excluded.role
  returning membership.id into new_membership_id;

  return query select new_user_id, new_membership_id;
end;
$$;

revoke all on function app.invite_user_to_business(uuid, text, text, text, text) from public;
grant execute on function app.invite_user_to_business(uuid, text, text, text, text) to authenticated;
