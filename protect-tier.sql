-- Closes the free-upgrade loophole at the DATABASE level.
-- A tradesman can edit their own listing, but must NOT be able to change their
-- paid plan (tier), its expiry, the founding-promo flag, or the Verified badge
-- by editing their row directly. Those may only change via:
--   * the PayFast edge function (runs as service_role), or
--   * an admin (is_admin()).
-- Run this once in Supabase → SQL Editor.

create or replace function protect_tier_change()
returns trigger
language plpgsql
security definer
as $$
begin
  -- Allow the PayFast edge function (service_role) and admins to change anything.
  if auth.role() = 'service_role' or is_admin() then
    return new;
  end if;

  -- For everyone else, block changes to the protected fields.
  if new.tier             is distinct from old.tier
  or new.tier_expires_at  is distinct from old.tier_expires_at
  or new.promo_verified   is distinct from old.promo_verified
  or new.verified_approved is distinct from old.verified_approved then
    raise exception 'Plan and verification changes must go through checkout or an admin.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_protect_tier on listings;
create trigger trg_protect_tier
  before update on listings
  for each row execute function protect_tier_change();
