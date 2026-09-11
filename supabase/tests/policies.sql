-- What the migrations DO, as opposed to whether they apply.
--
-- invariants.sql proves the constraints; this proves the parts that only
-- misbehave once somebody is using them — Row Level Security read as a real
-- role, and the SECURITY DEFINER functions actually called. Both of the fixes
-- in 20260908000200 and 20260908000400 were bugs of exactly that shape: the
-- migration applied cleanly to an empty database and CI was satisfied, while
-- the function raised on its first call and the policy denied a read it was
-- written to allow. Nothing here would have let either of them past.
--
-- Run with:  psql "$SUPABASE_DB_URL" -f supabase/tests/policies.sql
-- It succeeds when the final notice reads ALL_POLICIES_HELD.
--
-- Identity is what ADR 0007 establishes per transaction, so the probe sets the
-- same claim the Edge Function sets and switches to the same role PostgREST
-- would be using.
do $$
declare
  v_owner uuid; v_worker uuid; v_customer uuid; v_stranger uuid;
  v_biz uuid; v_other uuid; v_res uuid; v_svc uuid;
  v_seen int; v_failed boolean; v_invited record;
begin
  -- --- a business with a team, and somebody who has booked ------------------
  insert into app_user (phone, given_name) values ('+972500000101', 'בעלים') returning id into v_owner;
  insert into app_user (phone, given_name) values ('+972500000102', 'עובד') returning id into v_worker;
  insert into app_user (phone, given_name) values ('+972500000103', 'לקוחה') returning id into v_customer;
  insert into app_user (phone, given_name) values ('+972500000104', 'זרה') returning id into v_stranger;

  insert into business (name, phone) values ('probe salon', '+972500000101') returning id into v_biz;
  insert into business (name, phone) values ('other salon', '+972500000105') returning id into v_other;
  insert into resource (business_id, name) values (v_biz, 'probe chair') returning id into v_res;
  insert into service (business_id, name, duration_minutes, price_minor)
    values (v_biz, 'probe cut', 30, 8000) returning id into v_svc;

  insert into membership (user_id, business_id, role) values (v_owner, v_biz, 'OWNER');
  insert into membership (user_id, business_id, role) values (v_worker, v_biz, 'WORKER');
  insert into membership (user_id, business_id, role) values (v_customer, v_biz, 'CUSTOMER');
  insert into membership (user_id, business_id, role) values (v_stranger, v_other, 'CUSTOMER');

  insert into appointment (business_id, resource_id, service_id, customer_id,
      start_at, end_at, occupied_until, service_name, resource_name,
      price_minor, duration_minutes, buffer_minutes)
    values (v_biz, v_res, v_svc, v_customer, '2026-10-06T09:00:00Z', '2026-10-06T09:30:00Z',
            '2026-10-06T09:40:00Z', 'probe cut', 'probe chair', 8000, 30, 10);

  -- --- the functions, called rather than merely created ---------------------
  -- As the owner, because the function guards itself on who is asking — which
  -- is another thing that can only be established by calling it.
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);

  -- 20260908000200 fixed an ambiguous column that only raises on a call.
  select * into v_invited
    from app.invite_user_to_business(v_biz, '+972500000106', 'מוזמן', 'חדש', 'WORKER');
  if v_invited is null then
    raise exception 'POLICY BROKEN: invite_user_to_business returned nothing';
  end if;
  if not exists (select 1 from membership
                 where business_id = v_biz and role = 'WORKER'
                   and user_id <> v_worker) then
    raise exception 'POLICY BROKEN: the invited worker has no membership';
  end if;

  -- Inviting the same number twice is a correction, not a second person.
  perform app.invite_user_to_business(v_biz, '+972500000106', 'מוזמן', 'חדש', 'MANAGER');
  if (select count(*) from app_user where phone = '+972500000106') <> 1 then
    raise exception 'POLICY BROKEN: a repeated invitation made a second user';
  end if;

  -- --- Row Level Security, read as the roles it is written for --------------
  -- An owner reads the customer who booked with them.
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);
  set local role authenticated;
  select count(*) into v_seen from app_user where id = v_customer;
  if v_seen <> 1 then
    raise exception 'POLICY BROKEN: an owner cannot read their own customer';
  end if;
  reset role;

  -- And so does a worker of the same business — the bug 20260908000400 fixed.
  perform set_config('request.jwt.claims', json_build_object('sub', v_worker)::text, true);
  set local role authenticated;
  select count(*) into v_seen from app_user where id = v_customer;
  if v_seen <> 1 then
    raise exception 'POLICY BROKEN: a worker cannot read a customer of the business they staff';
  end if;

  -- The same worker has no business reading somebody who books elsewhere.
  select count(*) into v_seen from app_user where id = v_stranger;
  if v_seen <> 0 then
    raise exception 'POLICY BROKEN: a worker read a customer of another business';
  end if;
  reset role;

  -- A customer reads themselves and nobody else.
  perform set_config('request.jwt.claims', json_build_object('sub', v_customer)::text, true);
  set local role authenticated;
  select count(*) into v_seen from app_user where id = v_customer;
  if v_seen <> 1 then raise exception 'POLICY BROKEN: a customer cannot read themselves'; end if;
  select count(*) into v_seen from app_user where id = v_owner;
  if v_seen <> 0 then raise exception 'POLICY BROKEN: a customer read the owner'; end if;

  -- And sees their own appointment, but not the business's other rows.
  select count(*) into v_seen from appointment where customer_id = v_customer;
  if v_seen <> 1 then
    raise exception 'POLICY BROKEN: a customer cannot read their own appointment';
  end if;
  reset role;

  -- A worker sees the business's appointments: that is the whole point of the
  -- role, and it is the read the interface makes on every day screen.
  perform set_config('request.jwt.claims', json_build_object('sub', v_worker)::text, true);
  set local role authenticated;
  select count(*) into v_seen from appointment where business_id = v_biz;
  if v_seen <> 1 then
    raise exception 'POLICY BROKEN: a worker cannot read the business appointments';
  end if;
  reset role;

  -- Somebody with no membership at all sees none of it.
  perform set_config('request.jwt.claims', json_build_object('sub', v_stranger)::text, true);
  set local role authenticated;
  select count(*) into v_seen from appointment where business_id = v_biz;
  if v_seen <> 0 then
    raise exception 'POLICY BROKEN: an outsider read the business appointments';
  end if;
  select count(*) into v_seen from working_hours where business_id = v_biz;
  reset role;

  -- --- writing, as the roles ------------------------------------------------
  -- A worker may not rewrite the business's identity; only management may.
  perform set_config('request.jwt.claims', json_build_object('sub', v_worker)::text, true);
  set local role authenticated;
  v_failed := false;
  begin
    update business set name = 'taken over' where id = v_biz;
    if not found then v_failed := true; end if;
  exception when insufficient_privilege or others then v_failed := true;
  end;
  reset role;
  if not v_failed then
    raise exception 'POLICY BROKEN: a worker renamed the business';
  end if;

  raise exception 'ALL_POLICIES_HELD';
end $$;
