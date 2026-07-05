-- ============================================================
-- TRADEE — WhatsApp opt-in fields on profiles
-- Idempotent. Run in Supabase Dashboard -> SQL Editor.
-- Assumes customer-accounts.sql has already been applied.
-- ============================================================

alter table profiles add column if not exists whatsapp_number    text;
alter table profiles add column if not exists whatsapp_opt_in     boolean not null default false;
alter table profiles add column if not exists whatsapp_opt_in_at  timestamptz;

-- Recreate the signup trigger so it also captures the WhatsApp number and
-- consent passed in supabase.auth.signUp({ options: { data: {...} } }).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  wants_marketing boolean := coalesce((new.raw_user_meta_data ->> 'marketing_opt_in')::boolean, false);
  wants_whatsapp  boolean := coalesce((new.raw_user_meta_data ->> 'whatsapp_opt_in')::boolean, false);
begin
  insert into public.profiles (
    id, account_type, full_name, email,
    marketing_opt_in, marketing_opt_in_at,
    whatsapp_number, whatsapp_opt_in, whatsapp_opt_in_at
  )
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'account_type', 'customer'),
    new.raw_user_meta_data ->> 'full_name',
    new.email,
    wants_marketing,
    case when wants_marketing then now() else null end,
    nullif(new.raw_user_meta_data ->> 'whatsapp_number', ''),
    wants_whatsapp,
    case when wants_whatsapp then now() else null end
  )
  on conflict (id) do nothing;
  return new;
end; $$;
