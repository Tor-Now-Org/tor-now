-- ---------------------------------------------------------------------------
-- ADR 0024: a Business has up to three Categories, the first its main one; and
-- nineteen Categories joined a sibling under the same parent group.
--
-- The codes stay a closed list the API validates (ADR 0017), so this checks
-- only what holds whatever the list says: at most three, none twice.
-- ---------------------------------------------------------------------------

alter table business add column categories text[] not null default '{}';

-- A code that joined a sibling moves with it, so nobody is left on a code the
-- list no longer has. Kept in step with CATEGORY_MERGES in packages/domain.
update business
set categories = array[
  case category
    when 'kids_haircuts' then 'barbershop'
    when 'hair_extensions' then 'hair_salon'
    when 'bridal_salon' then 'hair_salon'
    when 'gel_nails' then 'nail_salon'
    when 'permanent_makeup' then 'brows_lashes'
    when 'laser_hair_removal' then 'hair_removal'
    when 'reflexology' then 'massage'
    when 'meditation' then 'yoga'
    when 'orthodontist' then 'dental_clinic'
    when 'dermatologist' then 'family_doctor'
    when 'chiropractor' then 'physiotherapy'
    when 'psychologist' then 'psychotherapy'
    when 'couples_therapy' then 'psychotherapy'
    when 'naturopathy' then 'acupuncture'
    when 'pet_boarding' then 'dog_training'
    when 'language_lessons' then 'private_tutor'
    when 'notary' then 'lawyer'
    when 'insurance_agent' then 'financial_advisor'
    when 'tires' then 'car_mechanic'
    else category
  end
]
where category is not null;

drop index business_active_category;
alter table business drop column category;

create function app.has_no_repeats(items text[])
returns boolean
language sql
immutable
as $$
  select cardinality(items) = (select count(distinct item) from unnest(items) as item);
$$;

alter table business
  add constraint business_categories_at_most_three check (cardinality(categories) <= 3),
  add constraint business_categories_no_repeats check (app.has_no_repeats(categories));

-- Browsing a Category finds a Business whichever of its Categories it is.
create index business_active_categories on business using gin (categories) where active;

comment on column business.categories is
  'ADR 0024: up to three codes from the closed list in packages/domain, the first the main one. Empty until chosen.';
