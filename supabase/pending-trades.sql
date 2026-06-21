-- Holds custom (non-standard) trades a tradesman typed in, awaiting admin approval.
-- They are NOT shown publicly until the admin approves them (moves them into `trades`).
-- Run once in Supabase → SQL Editor.

alter table listings add column if not exists pending_trades text[] not null default '{}';
