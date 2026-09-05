-- Who the appointment is with.
--
-- An Appointment already snapshots the terms it was booked under — the service
-- name, its price, its duration — so that changing a Service later never
-- rewrites what happened. The person giving it is one of those terms: a
-- customer books with Ran, and if that calendar is later renamed or retired,
-- the appointment they turn up to was still with Ran.
--
-- Backfilled from the resource each appointment already points at, which is the
-- best available answer for rows written before the column existed and the
-- right one for every row whose resource has not been renamed since.
alter table appointment
  add column if not exists resource_name text;

update appointment a
   set resource_name = r.name
  from resource r
 where r.id = a.resource_id
   and a.resource_name is null;

alter table appointment
  alter column resource_name set not null;

comment on column appointment.resource_name is
  'The calendar''s name as it was at booking time. A snapshot, like service_name: renaming a resource does not rewrite appointments already made.';
