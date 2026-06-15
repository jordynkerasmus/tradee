-- ============================================================
-- TRADEE — STORAGE BUCKETS
-- Run AFTER security-policies.sql (it defines public.is_admin()).
-- Idempotent. Run in Supabase Dashboard → SQL Editor.
-- ============================================================

-- Private bucket for registration / certificate documents.
-- Files are keyed  <user_id>/<timestamp>-<filename>  and are NEVER public;
-- the app serves them via short-lived signed URLs to the owner & admins only.
insert into storage.buckets (id, name, public)
values ('certifications', 'certifications', false)
on conflict (id) do update set public = false;

-- Owner: full control over files inside their own  <uid>/  folder.
drop policy if exists "certs_owner_all" on storage.objects;
create policy "certs_owner_all" on storage.objects
  for all to authenticated
  using      (bucket_id = 'certifications' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'certifications' and (storage.foldername(name))[1] = auth.uid()::text);

-- Admin: read any certificate (needed to verify tradesmen).
drop policy if exists "certs_admin_read" on storage.objects;
create policy "certs_admin_read" on storage.objects
  for select to authenticated
  using (bucket_id = 'certifications' and public.is_admin());

-- NOTE on the existing public bucket "certifications-registrations":
-- it now holds ONLY profile photos & portfolio images, which are meant to be
-- public — leave its policies as they are. Any OLD certificate files still in
-- that public bucket from before this change should be deleted manually
-- (Dashboard → Storage), since they remain publicly downloadable until removed.
