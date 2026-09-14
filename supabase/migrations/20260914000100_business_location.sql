-- The pin the owner drops on the map, separate from the free-text `address`
-- they type: one is coordinates, the other is what a customer reads.
alter table business
  add column latitude  double precision,
  add column longitude double precision;

alter table business
  add constraint business_latitude_sane check (latitude between -90 and 90),
  add constraint business_longitude_sane check (longitude between -180 and 180);
