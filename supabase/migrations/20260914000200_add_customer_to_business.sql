-- ---------------------------------------------------------------------------
-- Writing down a customer so the Business can book them in.
--
-- A Business taking a booking over the telephone knows a number and a name.
-- When that number has never signed in there is no User to attach the
-- appointment to, and app_user's RLS has no gap through which the shop may
-- create one — the same problem invitations have, solved the same way.
--
-- It is not `invite_user_to_business`, for one reason that matters: that
-- function requires app.manages(), because handing somebody a role is
-- management's to do. The person who most needs this is a WORKER at the chair,
-- taking a call — and what they are creating grants nothing. A CUSTOMER
-- membership is the absence of privilege, so app.staffs() is the right gate,
-- and reusing the invitation would have meant either refusing the worker or
-- widening a function that hands out roles.
--
-- The other difference is the conflict clause. An invitation rewrites the role
-- on purpose: re-inviting somebody is how their terms change. This must never
-- do that. A colleague who rings up for a haircut is booked in as themselves,
-- and if `role = 'CUSTOMER'` were written here, booking one a haircut would
-- take away their calendar.
-- ---------------------------------------------------------------------------

create function app.add_customer_to_business(
  target_business_id uuid,
  customer_phone text,
  customer_given_name text,
  customer_family_name text
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
  -- Anybody who works here. A WORKER fills their own diary and has to be able
  -- to say who the appointment is for.
  if not app.staffs(target_business_id) then
    raise exception 'Insufficient permissions';
  end if;

  select id into new_user_id from app_user where phone = customer_phone;

  if new_user_id is null then
    insert into app_user (phone, given_name, family_name, birth_date)
    values (customer_phone, customer_given_name, customer_family_name, null)
    returning app_user.id into new_user_id;
  end if;

  -- Only ever adds. An existing membership keeps the role it has, whatever
  -- that role is — see the note above.
  insert into membership (
    user_id, business_id, role, invited_given_name, invited_family_name
  )
  values (
    new_user_id, target_business_id, 'CUSTOMER', customer_given_name, customer_family_name
  )
  on conflict (user_id, business_id) do update set
    -- A no-op update, so the row is returned rather than the insert reporting
    -- nothing. Nothing about the existing membership changes.
    user_id = membership.user_id
  returning membership.id into new_membership_id;

  return query select new_user_id, new_membership_id;
end;
$$;

revoke all on function app.add_customer_to_business(uuid, text, text, text) from public;
grant execute on function app.add_customer_to_business(uuid, text, text, text) to authenticated;
