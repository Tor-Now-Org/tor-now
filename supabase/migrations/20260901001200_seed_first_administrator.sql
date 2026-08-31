-- ADR 0010: "The first administrator is seeded by migration; thereafter the flag
-- is set only by another administrator, and that change is audited." There is
-- deliberately no self-service route to this flag, so it has to start here.
--
-- Two independent conditions have to hold before an administrator can sign in,
-- and this seeds both: the flag on the User, and the phone number on the
-- allowlist. Either alone is insufficient, which is what makes a mistakenly set
-- flag or a stolen session not enough on its own.
--
-- The row is created rather than updated because the User may not exist yet:
-- the person signs in afterwards with the same number and is recognised.
insert into app_user (phone, name, is_administrator)
values ('+972521110000', 'הנהלת תורNow', true)
on conflict (phone) do update set is_administrator = true;

insert into administrator_allowlist (phone, note, added_by)
select
  '+972521110000',
  'Seeded by migration as the platform''s first administrator (ADR 0010).',
  id
from app_user
where phone = '+972521110000'
on conflict (phone) do nothing;
