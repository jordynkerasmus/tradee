# Deploying the Tradee Edge Functions

These send transactional email via [Resend](https://resend.com):

| Function | Trigger | From address |
|---|---|---|
| `welcome-email` | new sign-up | `welcome@tradee.org` |
| `review-notification` | a client leaves a review | `reviews@tradee.org` |
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
```

(Or use the helper: `./supabase/deploy-functions.sh`)

Verify they appear under **Supabase Dashboard → Edge Functions**.

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
