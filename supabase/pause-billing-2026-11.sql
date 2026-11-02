-- ============================================================
-- TRADEE — PAUSE BILLING (2026-11-02)
-- Jordyn's decision: all current signups stay on their plan free,
-- indefinitely. No payment reminder emails, no auto-downgrades.
-- Idempotent. Run in Supabase -> SQL Editor.
--
-- How it works: the subscription-check cron skips any listing whose
-- tier_expires_at is NULL, so clearing expiries silences the whole
-- lapse -> warn -> downgrade flow without touching the function.
--
-- TO RE-ENABLE BILLING LATER: set tier_expires_at on paid listings
-- (e.g. now() + interval '1 month') and restore the 6-month promo
-- expiry below (change "tier_expires_at := null" back to
-- "now() + interval '6 months'" in the promo branch).
-- ============================================================

-- 1. Current signups: keep their tier, remove the expiry clock.
update listings
   set tier_expires_at = null,
       grace_warned_at = null
 where tier in ('verified', 'premium');

-- 2. Future signups: founding members still get free Verified placement,
--    now with NO expiry (was 6 months). Based on the latest version of
--    this function from verified-approval.sql — keeps all its guards.
create or replace function public.protect_listing_columns()
returns trigger language plpgsql as $$
declare
  promo_count integer;
begin
  if tg_op = 'INSERT' then
    if not public.is_admin() then
      new.rating_avg := 0;
      new.verified_approved := false;        -- badge is never self-granted
      select count(*) into promo_count from listings where promo_verified;
      if promo_count < 100 then
        new.tier            := 'verified';   -- founding placement perk (badge still needs approval)
        new.promo_verified  := true;
        new.tier_expires_at := null;         -- billing paused 2026-11-02 (was now() + 6 months)
      else
        new.tier            := 'free';
        new.promo_verified  := false;
        new.tier_expires_at := null;
      end if;
    end if;
  elsif tg_op = 'UPDATE' then
    if auth.uid() is not null and not public.is_admin()
       and current_setting('tradee.rating_update', true) is distinct from 'on' then
      new.tier              := old.tier;
      new.rating_avg        := old.rating_avg;
      new.promo_verified    := old.promo_verified;
      new.tier_expires_at   := old.tier_expires_at;
      new.verified_approved := old.verified_approved;   -- only admin can grant/revoke the badge
      new.verification      := old.verification;        -- only admin can set the check record
    end if;
  end if;
  return new;
end; $$;

-- Verify: should return 0
-- select count(*) from listings where tier in ('verified','premium') and tier_expires_at is not null;
