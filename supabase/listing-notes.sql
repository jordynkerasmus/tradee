-- Admin → tradesman notes/messages. Admin creates them; the tradesman sees
-- un-dismissed notes in a "Messages from Tradee" box on their dashboard and can
-- dismiss them. Run once in Supabase → SQL Editor.

create table if not exists listing_notes (
  id         bigint primary key generated always as identity,
  listing_id bigint not null references listings(id) on delete cascade,
  message    text not null,
  dismissed  boolean not null default false,
  created_at timestamptz not null default now()
);

alter table listing_notes enable row level security;

-- Admins can create / read / manage all notes.
drop policy if exists "admin manage notes" on listing_notes;
create policy "admin manage notes"
  on listing_notes for all using (is_admin()) with check (is_admin());

-- A tradesman can read notes on their own listing.
drop policy if exists "owner reads own notes" on listing_notes;
create policy "owner reads own notes"
  on listing_notes for select using (
    exists (select 1 from listings l where l.id = listing_notes.listing_id and l.user_id = auth.uid())
  );

-- A tradesman can mark their own notes as dismissed.
drop policy if exists "owner dismisses own notes" on listing_notes;
create policy "owner dismisses own notes"
  on listing_notes for update using (
    exists (select 1 from listings l where l.id = listing_notes.listing_id and l.user_id = auth.uid())
  ) with check (
    exists (select 1 from listings l where l.id = listing_notes.listing_id and l.user_id = auth.uid())
  );

grant select, insert, update, delete on table listing_notes to authenticated;
