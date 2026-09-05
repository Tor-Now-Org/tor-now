-- Removing a calendar must not remove what happened on it.
--
-- appointment.resource_id cascaded, so `delete from resource` took every
-- appointment ever made against it: the prices, the no-shows, the record a
-- business is judged on — silently, and with no way back. The application now
-- withdraws a calendar that has been booked rather than deleting it, but an
-- application rule is a promise and this is a guarantee: any other writer, a
-- script or a hand at the dashboard, would still have destroyed the history.
--
-- Restrict rather than set null: an appointment without a calendar is not a
-- lesser record, it is a broken one, and the exclusion constraint that stops
-- double booking is defined on resource_id.
--
-- The other things hanging off a Resource — its working hours, its blocks, its
-- date overrides — keep cascading. They describe when it could be booked, which
-- means nothing once it is gone; an appointment describes what happened, which
-- does not stop being true.
alter table appointment
  drop constraint appointment_resource_id_business_id_fkey;

alter table appointment
  add constraint appointment_resource_id_business_id_fkey
    foreign key (resource_id, business_id)
    references resource (id, business_id)
    on delete restrict;
