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

  -- 20260908000200 fixed an ambiguous column that only raises on a call, and
  -- 20260911000200 changed the signature — which is why this calls it rather
  -- than reading its source.
  select * into v_invited
    from app.invite_user_to_business(
      v_biz, '+972500000106', 'מוזמן', 'חדש', 'WORKER', 'מוזמן', 'חדש');
  if v_invited is null then
    raise exception 'POLICY BROKEN: invite_user_to_business returned nothing';
  end if;
  -- 20260911000200: the name the inviter typed is kept on the membership, so
  -- a team list can name somebody who has never signed in.
  if not exists (select 1 from membership
                 where business_id = v_biz and invited_given_name = 'מוזמן') then
    raise exception 'POLICY BROKEN: the invited name was not kept on the membership';
  end if;
  if not exists (select 1 from membership
                 where business_id = v_biz and role = 'WORKER'
                   and user_id <> v_worker) then
    raise exception 'POLICY BROKEN: the invited worker has no membership';
  end if;

  -- Inviting the same number twice is a correction, not a second person.
  perform app.invite_user_to_business(
    v_biz, '+972500000106', 'מוזמן', 'חדש', 'MANAGER', 'מוזמן', 'מתוקן');
  if (select count(*) from app_user where phone = '+972500000106') <> 1 then
    raise exception 'POLICY BROKEN: a repeated invitation made a second user';
  end if;
  if not exists (select 1 from membership
                 where business_id = v_biz and invited_family_name = 'מתוקן') then
    raise exception 'POLICY BROKEN: a corrected invitation did not refresh the name';
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

  -- 20260912000100: a manager inviting by phone has to find somebody who signed
  -- up elsewhere and holds no Membership here. The stranger is a customer of
  -- the *other* salon, which is exactly that person.
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);
  set local role authenticated;
  select count(*) into v_seen from app_user where id = v_stranger;
  reset role;
  if v_seen <> 1 then
    raise exception 'POLICY BROKEN: an owner cannot look up a user to invite them';
  end if;

  -- And that reach belongs to management, not to everybody who works there: a
  -- worker reads the people of their own business and no further.
  perform set_config('request.jwt.claims', json_build_object('sub', v_worker)::text, true);
  set local role authenticated;
  select count(*) into v_seen from app_user where id = v_stranger;
  reset role;
  if v_seen <> 0 then
    raise exception 'POLICY BROKEN: a worker read a user from outside their business';
  end if;

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

  -- --- reviews ---------------------------------------------------------------
  -- The probe's appointment is still to come, so reviewing waits until one has
  -- ended: refused now, allowed once a past one exists.
  perform set_config('request.jwt.claims', json_build_object('sub', v_customer)::text, true);
  set local role authenticated;
  v_failed := false;
  begin
    insert into review (business_id, customer_id, stars) values (v_biz, v_customer, 5);
  exception when insufficient_privilege or others then v_failed := true;
  end;
  reset role;
  if not v_failed then
    raise exception 'POLICY BROKEN: a customer reviewed before their appointment ended';
  end if;
  insert into appointment (business_id, resource_id, service_id, customer_id,
      start_at, end_at, occupied_until, service_name, resource_name,
      price_minor, duration_minutes, buffer_minutes)
    values (v_biz, v_res, v_svc, v_customer, now() - interval '2 hours', now() - interval '90 minutes',
            now() - interval '80 minutes', 'probe cut', 'probe chair', 8000, 30, 10);

  -- A customer who has been writes one, and edits it in place; anybody may
  -- read it with the author's given name.
  perform set_config('request.jwt.claims', json_build_object('sub', v_customer)::text, true);
  set local role authenticated;
  insert into review (business_id, customer_id, stars, comment) values (v_biz, v_customer, 4, 'probe');
  insert into review (business_id, customer_id, stars, comment) values (v_biz, v_customer, 5, 'edited')
    on conflict (business_id, customer_id) do update set stars = excluded.stars, comment = excluded.comment;
  reset role;
  set local role anon;
  select count(*) into v_seen from app.business_reviews(v_biz)
    where stars = 5 and author_name = 'לקוחה';
  reset role;
  if v_seen <> 1 then
    raise exception 'POLICY BROKEN: a customer review was not written, edited, or readable';
  end if;

  -- Anonymous hides the author from everybody reading, and keeps it in the row.
  update review set anonymous = true where business_id = v_biz and customer_id = v_customer;
  set local role anon;
  select count(*) into v_seen from app.business_reviews(v_biz)
    where author_name is null and customer_id is null;
  reset role;
  if v_seen <> 1 then
    raise exception 'POLICY BROKEN: an anonymous review named its author';
  end if;

  -- Somebody with no confirmed appointment here cannot write one.
  perform set_config('request.jwt.claims', json_build_object('sub', v_stranger)::text, true);
  set local role authenticated;
  v_failed := false;
  begin
    insert into review (business_id, customer_id, stars) values (v_biz, v_stranger, 1);
  exception when insufficient_privilege or others then v_failed := true;
  end;
  reset role;
  if not v_failed then
    raise exception 'POLICY BROKEN: a stranger reviewed a business they never booked';
  end if;

  -- --- ADR 0018: waiting for a time ----------------------------------------
  -- Leaving a mark is the one write here that no policy admits: it goes
  -- through a SECURITY DEFINER function, because an upsert that cannot see its
  -- own conflict is refused by Row Level Security. The repository contract
  -- runs as the owner and so cannot tell — which is precisely why this is
  -- here, and why it was the end-to-end suite that found it the first time.
  perform set_config('request.jwt.claims', json_build_object('sub', v_customer)::text, true);
  set local role authenticated;
  perform app.mark_for_recheck(v_res, date '2026-10-06');
  -- Twice, because a busy morning marks the same day again and the second one
  -- has a conflict to resolve.
  perform app.mark_for_recheck(v_res, date '2026-10-06');
  reset role;
  select count(*) into v_seen from waiting_recheck
    where resource_id = v_res and on_date = date '2026-10-06';
  if v_seen <> 1 then
    raise exception 'POLICY BROKEN: marking a day twice left % rows', v_seen;
  end if;

  -- And the marks themselves are readable by nobody: they would otherwise
  -- hand any signed-in user a listing of which calendars changed and when.
  set local role authenticated;
  select count(*) into v_seen from waiting_recheck;
  reset role;
  if v_seen <> 0 then
    raise exception 'POLICY BROKEN: a signed-in user can read the recheck marks';
  end if;

  -- A Waiting Entry belongs to the customer who wrote it. A stranger cannot
  -- write one in their name, and cannot read theirs.
  perform set_config('request.jwt.claims', json_build_object('sub', v_customer)::text, true);
  set local role authenticated;
  insert into waiting_entry (business_id, customer_id, service_id, on_date, parts)
    values (v_biz, v_customer, v_svc, date '2026-10-07', array['MORNING']);
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', v_stranger)::text, true);
  set local role authenticated;
  select count(*) into v_seen from waiting_entry;
  v_failed := false;
  begin
    insert into waiting_entry (business_id, customer_id, service_id, on_date, parts)
      values (v_biz, v_customer, v_svc, date '2026-10-08', array['EVENING']);
  exception when insufficient_privilege or others then v_failed := true;
  end;
  reset role;
  if v_seen <> 0 then
    raise exception 'POLICY BROKEN: a stranger read somebody else''s waiting list';
  end if;
  if not v_failed then
    raise exception 'POLICY BROKEN: a stranger waited in somebody else''s name';
  end if;

  -- The Business cannot read the list either: the owner's only involvement is
  -- deciding whether a cancelled hour is published.
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);
  set local role authenticated;
  select count(*) into v_seen from waiting_entry;
  reset role;
  if v_seen <> 0 then
    raise exception 'POLICY BROKEN: an owner can read who is waiting';
  end if;

  raise exception 'ALL_POLICIES_HELD';
end $$;
