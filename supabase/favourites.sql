-- ============================================================
-- TRADEE — FAVOURITES (saved listings, synced across devices)
-- Idempotent. Run in Supabase Dashboard → SQL Editor.
-- ============================================================

create table if not exists favourites (
  user_id    uuid    not null references auth.users(id) on delete cascade,
  listing_id bigint  not null references listings(id)    on delete cascade,
  created_at timestamptz default now(),
  primary key (user_id, listing_id)
);

alter table favourites enable row level security;

-- A user may only see and manage their own saved listings.
drop policy if exists "favourites_select_own" on favourites;
create policy "favourites_select_own"
  on favourites for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "favourites_insert_own" on favourites;
create policy "favourites_insert_own"
  on favourites for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "favourites_delete_own" on favourites;
create policy "favourites_delete_own"
  on favourites for delete to authenticated
  using (auth.uid() = user_id);
