#!/usr/bin/env bash
# Deploy Tradee's email edge functions. Run after `supabase login` and
# `supabase link --project-ref hbqivzqhmuaidolernek`. See DEPLOY.md.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "→ Deploying welcome-email…"
supabase functions deploy welcome-email

echo "→ Deploying review-notification…"
supabase functions deploy review-notification

echo "✓ Done. Check Supabase Dashboard → Edge Functions."
echo "  Reminder: set RESEND_API_KEY (supabase secrets set RESEND_API_KEY=…)"
echo "  and verify the tradee.org domain in Resend before emails will send."
