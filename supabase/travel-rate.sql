-- Adds an optional per-km travel fee to listings.
-- Stored as: a number (rand per km), 0 = free, -1 = N/A, null = not set.
-- Run once in Supabase → SQL Editor.

alter table listings add column if not exists travel_rate numeric;
