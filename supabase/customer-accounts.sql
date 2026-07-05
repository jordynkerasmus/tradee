-- ============================================================
-- TRADEE — CUSTOMER ACCOUNTS, PROFILES, LOGIN-REQUIRED REVIEWS,
-- and the TRADESMAN MESSAGES (notices) inbox.
-- ------------------------------------------------------------
-- Idempotent: safe to run multiple times in the Supabase
-- Dashboard → SQL Editor. Run the whole file at once.
-- Assumes security-policies.sql (is_admin(), listings.user_id,
-- review column-protection) has already been applied.
-- ============================================================

-- ============================================================
-- 1. PROFILES  (one row per account; created automatically on signup)
-- ============================================================
create table if not exists profiles (
  id                  uuid primary key references auth.users(id) on delete cascade,
  account_type        text not null default 'customer'
                        check (account_type in ('customer', 'tradesman')),
  full_name           text,
  email               text,
  marketing_opt_in    boolean not null default false,
  marketing_opt_in_at timestamptz,
  created_at          timestamptz default now()
);

alter table profiles enable row level security;

-- A user can read and update only their own profile (admins can read any).
drop policy if exists profiles_select_own on profiles;
create policy profiles_select_own
  on profiles for select to authenticated
  using (auth.uid() = id or public.is_admin());

drop policy if exists profiles_update_own on profiles;
create policy profiles_update_own
  on profiles for update to authenticated
  using (auth.uid() = id) with check (auth.uid() = id);

-- Profile rows are created by the trigger below (security definer),
-- so no client INSERT policy is needed.

-- Auto-create a profile whenever a new auth user signs up, reading the
-- fields passed in signUp({ options: { data: {...} } }).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  wants_marketing boolean := coalesce((new.raw_user_meta_data ->> 'marketing_opt_in')::boolean, false);
begin
  insert into public.profiles (id, account_type, full_name, email, marketing_opt_in, marketing_opt_in_at)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'account_type', 'customer'),
    new.raw_user_meta_data ->> 'full_name',
    new.email,
    wants_marketing,
    case when wants_marketing then now() else null end
  )
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- 2. REVIEWS — tie to a logged-in user, one per tradesman, editable
-- ============================================================
alter table reviews add column if not exists user_id uuid references auth.users(id) on delete set null;

-- One review per user per listing (legacy rows have null user_id and are unaffected).
create unique index if not exists reviews_user_listing_uniq
  on reviews (user_id, listing_id) where user_id is not null;

-- INSERT: must be logged in, row owned by self, not your own listing, no pre-filled reply.
drop policy if exists "Anyone can insert a review" on reviews;
drop policy if exists reviews_insert_public on reviews;
drop policy if exists reviews_insert_auth   on reviews;
create policy reviews_insert_auth
  on reviews for insert to authenticated
  with check (
    user_id = auth.uid()
    and reply_text is null
    and not exists (select 1 from listings l where l.id = listing_id and l.user_id = auth.uid())
  );

-- UPDATE: the review's author (edit own), the reviewed listing's owner (post a reply), or admin.
drop policy if exists reviews_update_owner on reviews;
create policy reviews_update_owner
  on reviews for update to authenticated
  using (
    public.is_admin()
    or user_id = auth.uid()
    or exists (select 1 from listings l where l.id = listing_id and l.user_id = auth.uid())
  )
  with check (
    public.is_admin()
    or user_id = auth.uid()
    or exists (select 1 from listings l where l.id = listing_id and l.user_id = auth.uid())
  );

-- Column protection: the author (or admin) may edit review content, but a
-- listing owner posting a reply may only touch reply_text / reply_at.
create or replace function public.protect_review_columns()
returns trigger language plpgsql as $$
begin
  if public.is_admin() or auth.uid() = old.user_id then
    -- author / admin: may change content, but never reassign ownership or listing
    new.user_id    := old.user_id;
    new.listing_id := old.listing_id;
  else
    -- listing owner replying: everything except the reply is immutable
    new.stars           := old.stars;
    new.review_text     := old.review_text;
    new.reviewer_name   := old.reviewer_name;
    new.listing_id      := old.listing_id;
    new.user_id         := old.user_id;
    new.quality         := old.quality;
    new.service         := old.service;
    new.cleanliness     := old.cleanliness;
    new.communication   := old.communication;
    new.value           := old.value;
    new.reliability     := old.reliability;
    new.responsiveness  := old.responsiveness;
    new.professionalism := old.professionalism;
    new.recommend       := old.recommend;
  end if;
  return new;
end; $$;

drop trigger if exists trg_protect_review_columns on reviews;
create trigger trg_protect_review_columns
  before update on reviews
  for each row execute function public.protect_review_columns();

-- ============================================================
-- 3. MESSAGES — one-way notices from Tradee to a user (tradesman inbox)
-- ============================================================
create table if not exists messages (
  id         bigint primary key generated always as identity,
  user_id    uuid not null references auth.users(id) on delete cascade,
  title      text not null,
  body       text,
  link       text,
  read       boolean not null default false,
  created_at timestamptz default now()
);

alter table messages enable row level security;

-- Recipients read and update (mark read) only their own messages.
drop policy if exists messages_select_own on messages;
create policy messages_select_own
  on messages for select to authenticated
  using (auth.uid() = user_id or public.is_admin());

drop policy if exists messages_update_own on messages;
create policy messages_update_own
  on messages for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Admins can send messages from the client; automated notices are sent
-- from Edge Functions using the service-role key (which bypasses RLS).
drop policy if exists messages_insert_admin on messages;
create policy messages_insert_admin
  on messages for insert to authenticated
  with check (public.is_admin());

create index if not exists messages_user_unread_idx on messages (user_id, read, created_at desc);
