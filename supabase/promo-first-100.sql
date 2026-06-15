-- ============================================================
-- TRADEE — FOUNDING MEMBER OFFER
-- First 100 sign-ups get the Verified badge free for 6 months.
-- Run AFTER security-policies.sql. Idempotent.
-- ============================================================

-- Track who got the promo and when their free Verified period ends.
alter table listings add column if not exists tier_expires_at timestamptz;
alter table listings add column if not exists promo_verified  boolean not null default false;

-- Replace the column-protection trigger function with a promo-aware version.
-- (The trigger itself, trg_protect_listing_columns, is already attached.)
create or replace function public.protect_listing_columns()
returns trigger language plpgsql as $$
declare
  promo_count integer;
begin
  if tg_op = 'INSERT' then
    if not public.is_admin() then
      new.rating_avg := 0;
      select count(*) into promo_count from listings where promo_verified;
      if promo_count < 100 then
        -- Founding member: free Verified for 6 months.
        new.tier            := 'verified';
        new.promo_verified  := true;
        new.tier_expires_at := now() + interval '6 months';
      else
        new.tier            := 'free';
        new.promo_verified  := false;
        new.tier_expires_at := null;
      end if;
    end if;
  elsif tg_op = 'UPDATE' then
    -- End-user sessions always carry auth.uid(); cron / admin-SQL contexts do not.
    -- So normal users can't touch tier / rating / promo fields, but backend jobs can.
    if auth.uid() is not null and not public.is_admin()
       and current_setting('tradee.rating_update', true) is distinct from 'on' then
      new.tier            := old.tier;
      new.rating_avg      := old.rating_avg;
      new.promo_verified  := old.promo_verified;
      new.tier_expires_at := old.tier_expires_at;
    end if;
  end if;
  return new;
end; $$;

-- NOTE: the automatic "drop back to free when the 6 months expire" step, plus the
-- 30-day / 7-day / 1-day reminder emails and the pay-to-stay flow, are built later
-- alongside PayFast + the email functions. They will read tier_expires_at (set above).
-- The first cohort won't expire until ~6 months from launch, so there is plenty of runway.
