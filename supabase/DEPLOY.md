# Deploying the Tradee Edge Functions

These send transactional email via [Resend](https://resend.com):

| Function | Trigger | From address |
|---|---|---|
| `welcome-email` | new sign-up | `welcome@tradee.org` |
| `review-notification` | a client leaves a review | `reviews@tradee.org` |
| `daily-report` | daily cron → emails the owner sign-up stats | `reports@tradee.org` |
| `monthly-report` | monthly cron (separate task) | `reports@tradee.org` |

I can't deploy these for you — deployment is tied to your Supabase account
login. Run the steps below once on your machine (takes ~5 minutes).

---

## One-time setup

**1. Install the Supabase CLI**
```bash
brew install supabase/tap/supabase      # macOS
# or: npm i -g supabase
```

**2. Log in** (opens your browser)
```bash
supabase login
```

**3. Link this project**
```bash
cd /Users/jordynkateerasmus/Downloads/tradee
supabase link --project-ref hbqivzqhmuaidolernek
```

**4. Add your Resend API key as a secret** (get it from resend.com → API Keys)
```bash
supabase secrets set RESEND_API_KEY=re_your_key_here
```

---

## Deploy

```bash
supabase functions deploy welcome-email
supabase functions deploy review-notification
supabase functions deploy daily-report
```

(Or use the helper: `./supabase/deploy-functions.sh`)

Verify they appear under **Supabase Dashboard → Edge Functions**.

---

## Scheduling the daily report (owner stats email)

`daily-report` emails sign-up stats to `jordynkerasmus@gmail.com`. To send it
every morning:

**Easiest — Dashboard:** Supabase Dashboard → **Edge Functions** → `daily-report`
→ **Schedules** (or **Cron**) → add a schedule with cron expression
`0 5 * * *` (that's 05:00 UTC = **07:00 South Africa**). Supabase handles auth.

**Or via SQL** (needs `pg_cron` + `pg_net` enabled under Database → Extensions):
```sql
select cron.schedule(
  'tradee-daily-report', '0 5 * * *',
  $$ select net.http_post(
       url := 'https://hbqivzqhmuaidolernek.supabase.co/functions/v1/daily-report',
       headers := jsonb_build_object(
         'Authorization', 'Bearer <YOUR_SERVICE_ROLE_KEY>',
         'Content-Type', 'application/json')
     ); $$
);
```
To change the recipient or send time, edit `REPORT_TO` in the function and the
cron expression. Test it immediately from the dashboard with **"Invoke"** /
**"Run now"**.

---

## ⚠️ Before emails will actually send

Resend only delivers from a **verified domain**. The functions send from
`@tradee.org`, so until that domain is verified in Resend, delivery will fail.

Two options:
- **Now (testing):** change the `from:` address in each function to Resend's
  sandbox `onboarding@resend.dev`, redeploy, and emails will send to your own
  address only.
- **For launch:** add & verify `tradee.org` in Resend (Domains → Add Domain,
  then add the DNS records). Do this when you connect the domain to Vercel.

## Security note (from the audit)

`review-notification` and `welcome-email` currently take the recipient address
from the request body, so any caller could send a Tradee-branded email to any
address. Before heavy use, derive the recipient server-side from the listing id.
`monthly-report` uses the service-role key with no caller check — keep
`verify_jwt` on, or require a shared secret, so it can't be triggered by anyone.
See `SECURITY.md` findings #8 and #9.
