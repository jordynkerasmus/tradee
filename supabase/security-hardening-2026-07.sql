-- ============================================================
-- TRADEE — Security hardening pass (2026-07-07)
-- Idempotent. Run the whole file at once in Supabase → SQL Editor.
-- Assumes security-policies.sql, customer-accounts.sql and
-- whatsapp-optin.sql have already been applied.
-- Addresses audit findings: account_type self-promotion,
-- update_listing_rating search_path, review_emails INSERT,
-- analytics_events INSERT.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Stop a normal user promoting their own account_type.
--    Choosing customer/tradesman AT SIGNUP is fine (handled by the
--    signup trigger); this only pins the column on later UPDATEs so a
--    customer cannot flip themselves to tradesman from the client.
-- ------------------------------------------------------------
create or replace function public.protect_profile_columns()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then
    new.account_type := old.account_type;
  end if;
  return new;
end; $$;

drop trigger if exists trg_protect_profile_columns on profiles;
create trigger trg_protect_profile_columns
  before update on profiles
  for each row execute function public.protect_profile_columns();

-- ------------------------------------------------------------
-- 2. Pin search_path on the SECURITY DEFINER rating function.
--    (Same body as security-policies.sql, now with a fixed search_path
--    so it can't be hijacked via schema shadowing.)
-- ------------------------------------------------------------
create or replace function update_listing_rating()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
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

-- ------------------------------------------------------------
-- 3. Lock down review_emails INSERT. Reviews now require login, so an
--    email may only be added for a review the caller actually authored.
--    (Was: anon + authenticated with check (true).)
-- ------------------------------------------------------------
drop policy if exists "anyone can add review email" on review_emails;
drop policy if exists "review_email_insert_for_own_review" on review_emails;
create policy "review_email_insert_for_own_review"
  on review_emails for insert to authenticated
  with check (
    exists (select 1 from reviews r where r.id = review_id and r.user_id = auth.uid())
  );

-- anon can no longer write to this table.
revoke insert on table review_emails from anon;

-- ------------------------------------------------------------
-- 4. Constrain analytics_events INSERT to known event types. This does
--    not fully prevent a logged-in/anon client forging events for a
--    listing (true prevention needs server-side writes), but it stops
--    arbitrary junk rows. Analytics are informational only (not billing).
-- ------------------------------------------------------------
drop policy if exists "analytics_insert_public" on analytics_events;
create policy "analytics_insert_public"
  on analytics_events for insert to anon, authenticated
  with check (
    event_type in (
      'search_impression', 'profile_view', 'phone_click',
      'email_click', 'whatsapp_click', 'review_left'
    )
  );

-- ============================================================
-- Verify (optional): run after the above.
--   select tgname from pg_trigger where tgname = 'trg_protect_profile_columns';
--   select proname, prosecdef from pg_proc where proname in ('update_listing_rating','protect_profile_columns');
-- ============================================================
