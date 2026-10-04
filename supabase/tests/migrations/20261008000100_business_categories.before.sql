-- Businesses as the schema held them before ADR 0024: one Category each, some
-- of them on codes that are about to join a sibling.
insert into business (name, phone, category) values
  ('probe orthodontist', '+972500000101', 'orthodontist'),
  ('probe barbershop',   '+972500000102', 'barbershop'),
  ('probe tires',        '+972500000103', 'tires'),
  ('probe couples',      '+972500000104', 'couples_therapy'),
  ('probe none',         '+972500000105', null);
