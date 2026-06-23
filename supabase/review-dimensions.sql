-- Adds the new review rating dimensions (1–5 stars each) and keeps them
-- immutable to listing owners (only the reviewer/admin set them).
-- Run once in Supabase → SQL Editor.

alter table reviews add column if not exists reliability     integer;
alter table reviews add column if not exists responsiveness  integer;
alter table reviews add column if not exists professionalism integer;
alter table reviews add column if not exists recommend       integer;

-- Defense-in-depth: a listing owner replying to a review can't alter any of the
-- rating fields (incl. the new ones) — only their reply. Admins can edit.
create or replace function public.protect_review_columns()
returns trigger language plpgsql as $$
begin
  if not public.is_admin() then
    new.stars          := old.stars;
    new.review_text    := old.review_text;
    new.reviewer_name  := old.reviewer_name;
    new.listing_id     := old.listing_id;
    new.quality        := old.quality;
    new.service        := old.service;
    new.cleanliness    := old.cleanliness;
    new.communication  := old.communication;
    new.value          := old.value;
    new.reliability    := old.reliability;
    new.responsiveness := old.responsiveness;
    new.professionalism := old.professionalism;
    new.recommend      := old.recommend;
  end if;
  return new;
end; $$;
