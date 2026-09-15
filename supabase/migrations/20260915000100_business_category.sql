-- ADR 0017: what kind of place a Business is. A code from a closed list the API
-- validates; the labels live with the code in the domain package. No check
-- constraint, so adding a Category never needs a migration. Null for every
-- Business registered before this existed, until its owner chooses one.
alter table business add column category text;

-- Browsing a Category is a filter over active businesses only.
create index business_active_category on business (category) where active;
