-- Stores the reviewer's email PRIVATELY, separate from the public `reviews` table
-- (reviews are world-readable, so emails must NOT live there).
-- Anyone can add their email when leaving a review; only admins can read them.
-- Run once in Supabase → SQL Editor.

create table if not exists review_emails (
  review_id  bigint primary key references reviews(id) on delete cascade,
  email      text not null,
  created_at timestamptz not null default now()
);

alter table review_emails enable row level security;

-- Anyone (including anonymous visitors leaving a review) may add an email.
drop policy if exists "anyone can add review email" on review_emails;
create policy "anyone can add review email"
  on review_emails for insert to anon, authenticated with check (true);

-- Only admins can read or manage the emails.
drop policy if exists "admin reads review emails" on review_emails;
create policy "admin reads review emails"
  on review_emails for all using (is_admin());

-- Table-level privileges (RLS still applies on top of these).
grant insert on table review_emails to anon, authenticated;
grant select on table review_emails to authenticated;
