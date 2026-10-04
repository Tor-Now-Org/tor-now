-- After ADR 0024: each kept Category is the first of its list, a merged one has
-- moved to the sibling it joined, and a Business with none still has none.
do $$
declare v_categories text[];
begin
  select categories into v_categories from business where phone = '+972500000101';
  if v_categories is distinct from array['dental_clinic'] then raise exception 'BROKEN: orthodontist became %', v_categories; end if;
  select categories into v_categories from business where phone = '+972500000102';
  if v_categories is distinct from array['barbershop'] then raise exception 'BROKEN: barbershop became %', v_categories; end if;
  select categories into v_categories from business where phone = '+972500000103';
  if v_categories is distinct from array['car_mechanic'] then raise exception 'BROKEN: tires became %', v_categories; end if;
  select categories into v_categories from business where phone = '+972500000104';
  if v_categories is distinct from array['psychotherapy'] then raise exception 'BROKEN: couples therapy became %', v_categories; end if;
  select categories into v_categories from business where phone = '+972500000105';
  if v_categories is distinct from '{}'::text[] then raise exception 'BROKEN: no category became %', v_categories; end if;
  if exists (select 1 from information_schema.columns where table_name = 'business' and column_name = 'category') then
    raise exception 'BROKEN: the single category column is still there';
  end if;
  raise exception 'MIGRATION_HELD';
end $$;
