-- ============================================================
-- TRADEE — VERIFIED BADGE = ADMIN-APPROVED (not just paid tier)
-- The green Verified badge now shows ONLY after an admin has reviewed
-- the tradesman's uploaded documents and approved them.
-- Run AFTER security-policies.sql and promo-first-100.sql. Idempotent.
-- ============================================================

alter table listings add column if not exists verified_approved boolean not null default false;

-- Keep the column protected: only an admin (or backend) can set it.
-- This replaces protect_listing_columns with a version that also guards
-- verified_approved, while preserving the founding-member promo logic.
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
        new.tier_expires_at := now() + interval '6 months';
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
    end if;
  end if;
  return new;
end; $$;
