-- Adds the after-hours / emergency availability flag to listings.
alter table listings add column if not exists after_hours boolean not null default false;
