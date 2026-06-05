-- Run this in Supabase Dashboard → SQL Editor

-- Listings table
create table listings (
  id bigint primary key generated always as identity,
  name text not null,
  trade text not null,
  province text not null,
  city text not null,
  callout integer default 0,
  rate integer not null,
  description text,
  credentials text[],
  years_experience integer default 0,
  tier text not null default 'free' check (tier in ('free', 'verified', 'premium')),
  phone text,
  email text,
  rating_avg numeric(3,2) default 0,
  created_at timestamptz default now()
);

-- Reviews table
create table reviews (
  id bigint primary key generated always as identity,
  listing_id bigint not null references listings(id) on delete cascade,
  reviewer_name text not null,
  stars integer not null check (stars >= 1 and stars <= 5),
  review_text text not null,
  created_at timestamptz default now()
);

-- Enable RLS
alter table listings enable row level security;
alter table reviews enable row level security;

-- Public read for listings
create policy "Listings are publicly visible"
on listings for select to anon, authenticated
using (true);

-- Public insert for listings (anyone can submit — add auth later)
create policy "Anyone can insert a listing"
on listings for insert to anon, authenticated
with check (true);

-- Public read for reviews
create policy "Reviews are publicly visible"
on reviews for select to anon, authenticated
using (true);

-- Anyone can leave a review
create policy "Anyone can insert a review"
on reviews for insert to anon, authenticated
with check (true);

-- Auto-update rating_avg on listings when a review is inserted
create or replace function update_listing_rating()
returns trigger as $$
begin
  update listings
  set rating_avg = (
    select avg(stars)::numeric(3,2)
    from reviews
    where listing_id = new.listing_id
  )
  where id = new.listing_id;
  return new;
end;
$$ language plpgsql;

create trigger on_review_insert
after insert on reviews
for each row execute function update_listing_rating();
