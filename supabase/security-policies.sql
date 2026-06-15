-- ============================================================
-- TRADEE — RLS & DATA-ISOLATION HARDENING
-- ------------------------------------------------------------
-- Idempotent: safe to run multiple times in the Supabase
-- Dashboard → SQL Editor. Run the whole file at once.
--
-- IMPORTANT: edit the admin email(s) in is_admin() below to
-- match your admin account(s) before running.
-- ============================================================

-- ── 0. Make sure RLS is enabled everywhere ──────────────────
alter table listings          enable row level security;
alter table reviews           enable row level security;
alter table analytics_events  enable row level security;

-- ── Helper: is the caller an admin? ─────────────────────────
-- Server-side admin check based on the signed JWT email claim.
-- This is the REAL admin gate — the client-side check is only UX.
create or replace function public.is_admin()
returns boolean language sql stable as $$
  select coalesce(auth.jwt() ->> 'email', '') in (
    'jordynkerasmus@gmail.com'          -- << edit / add admin emails here
  )
$$;

-- ============================================================
-- LISTINGS
-- ============================================================

-- SELECT: directory is public.
drop policy if exists "Listings are publicly visible" on listings;
drop policy if exists "listings_select_public"        on listings;
create policy "listings_select_public"
  on listings for select to anon, authenticated
  using (true);

-- INSERT: must be logged in and may only insert a row owned by self.
-- (tier / rating_avg are forced by the trigger below — not trusted.)
drop policy if exists "Anyone can insert a listing" on listings;
drop policy if exists "listings_insert_own"         on listings;
create policy "listings_insert_own"
  on listings for insert to authenticated
  with check (auth.uid() = user_id);

-- UPDATE: owner (their own row) or admin (any row).
drop policy if exists "listings_update_own" on listings;
create policy "listings_update_own"
  on listings for update to authenticated
  using      (auth.uid() = user_id or public.is_admin())
  with check (auth.uid() = user_id or public.is_admin());

-- DELETE: owner (their own row) or admin (any row).
drop policy if exists "Admin can delete any listing" on listings;
drop policy if exists "listings_delete_own"          on listings;
create policy "listings_delete_own"
  on listings for delete to authenticated
  using (auth.uid() = user_id or public.is_admin());

-- Protect privileged columns: a non-admin must NOT be able to
-- self-assign a paid tier or fake their rating, even though they
-- can update their own row.
create or replace function public.protect_listing_columns()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if not public.is_admin() then
      new.tier       := 'free';   -- no payment flow yet → everyone starts free
      new.rating_avg := 0;
    end if;
  elsif tg_op = 'UPDATE' then
    -- allow the rating trigger (below) to write rating_avg; block everyone else
    if not public.is_admin()
       and current_setting('tradee.rating_update', true) is distinct from 'on' then
      new.tier       := old.tier;        -- block tier self-upgrade
      new.rating_avg := old.rating_avg;  -- block rating tampering
    end if;
  end if;
  return new;
end; $$;

drop trigger if exists trg_protect_listing_columns on listings;
create trigger trg_protect_listing_columns
  before insert or update on listings
  for each row execute function public.protect_listing_columns();

-- ============================================================
-- REVIEWS
-- ============================================================

-- SELECT: reviews are public.
drop policy if exists "Reviews are publicly visible" on reviews;
drop policy if exists "reviews_select_public"        on reviews;
create policy "reviews_select_public"
  on reviews for select to anon, authenticated
  using (true);

-- INSERT: anyone may leave a review, but NOT on their own listing,
-- and they may not pre-populate the owner reply.
drop policy if exists "Anyone can insert a review" on reviews;
drop policy if exists "reviews_insert_public"      on reviews;
create policy "reviews_insert_public"
  on reviews for insert to anon, authenticated
  with check (
    reply_text is null
    and not exists (
      select 1 from listings l
      where l.id = listing_id and l.user_id = auth.uid()
    )
  );

-- UPDATE: only the owner of the reviewed listing (to post a reply)
-- or an admin. Column protection below stops them altering the
-- actual review content / star rating.
drop policy if exists "reviews_update_owner" on reviews;
create policy "reviews_update_owner"
  on reviews for update to authenticated
  using (
    public.is_admin() or exists (
      select 1 from listings l where l.id = listing_id and l.user_id = auth.uid()
    )
  )
  with check (
    public.is_admin() or exists (
      select 1 from listings l where l.id = listing_id and l.user_id = auth.uid()
    )
  );

-- DELETE: admin only.
drop policy if exists "Admin can delete any review" on reviews;
drop policy if exists "reviews_delete_admin"        on reviews;
create policy "reviews_delete_admin"
  on reviews for delete to authenticated
  using (public.is_admin());

-- A listing owner may ONLY set reply_text / reply_at on a review.
-- Everything else (stars, text, category scores) is immutable to them
-- so they can't turn a 1-star review into a 5-star one.
create or replace function public.protect_review_columns()
returns trigger language plpgsql as $$
begin
  if not public.is_admin() then
    new.stars         := old.stars;
    new.review_text   := old.review_text;
    new.reviewer_name := old.reviewer_name;
    new.listing_id    := old.listing_id;
    new.quality       := old.quality;
    new.service       := old.service;
    new.cleanliness   := old.cleanliness;
    new.communication := old.communication;
    new.value         := old.value;
  end if;
  return new;
end; $$;

drop trigger if exists trg_protect_review_columns on reviews;
create trigger trg_protect_review_columns
  before update on reviews
  for each row execute function public.protect_review_columns();

-- ============================================================
-- RATING TRIGGER (recomputed server-side; never trusted from client)
-- ============================================================
create or replace function update_listing_rating()
returns trigger language plpgsql security definer as $$
begin
  perform set_config('tradee.rating_update', 'on', true);
  update listings
     set rating_avg = (
       select coalesce(avg(stars), 0)::numeric(3,2)
       from reviews where listing_id = coalesce(new.listing_id, old.listing_id)
     )
   where id = coalesce(new.listing_id, old.listing_id);
  return null;
end; $$;

drop trigger if exists on_review_insert on reviews;
drop trigger if exists trg_review_rating on reviews;
create trigger trg_review_rating
  after insert or update or delete on reviews
  for each row execute function update_listing_rating();

-- ============================================================
-- ANALYTICS_EVENTS
-- ============================================================
-- Anyone can write a tracking event...
drop policy if exists "analytics_insert_public" on analytics_events;
create policy "analytics_insert_public"
  on analytics_events for insert to anon, authenticated
  with check (true);

-- ...but only the listing OWNER (or admin) can read its raw events,
-- so competitors can't scrape each other's view / contact counts.
drop policy if exists "analytics_select_owner" on analytics_events;
create policy "analytics_select_owner"
  on analytics_events for select to authenticated
  using (
    public.is_admin() or exists (
      select 1 from listings l where l.id = listing_id and l.user_id = auth.uid()
    )
  );

-- ============================================================
-- STORAGE  (run only AFTER you split buckets — see SECURITY.md)
-- ------------------------------------------------------------
-- Registration / certificate documents must live in a PRIVATE
-- bucket and be served via short-lived signed URLs, NOT public
-- URLs. Profile photos & portfolio images can stay public.
--
-- Example policies once a private "certifications" bucket exists
-- (files keyed by  <auth.uid()>/<filename> ):
--
--   create policy "certs_owner_rw" on storage.objects
--     for all to authenticated
--     using      (bucket_id = 'certifications' and (storage.foldername(name))[1] = auth.uid()::text)
--     with check (bucket_id = 'certifications' and (storage.foldername(name))[1] = auth.uid()::text);
--
--   create policy "certs_admin_read" on storage.objects
--     for select to authenticated
--     using (bucket_id = 'certifications' and public.is_admin());
-- ============================================================
