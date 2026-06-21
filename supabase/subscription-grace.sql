-- Supports the subscription lapse → warning → auto-downgrade flow.
-- grace_warned_at records when we last emailed a tradesman that their plan
-- lapsed, so the daily check doesn't email them every single day.
-- Run once in Supabase → SQL Editor.

alter table listings add column if not exists grace_warned_at timestamptz;
