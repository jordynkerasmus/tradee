# PayFast Payments — Deploy & Test

Two edge functions power payments:
- **payfast-checkout** — builds a signed PayFast payment link (called by the logged-in tradesman from the dashboard).
- **payfast-itn** — receives PayFast's payment confirmation and upgrades the tier.

The code defaults to **PayFast's public sandbox merchant**, so you can test the whole flow before you have a PayFast account.

## 1. Deploy the two functions (Supabase Dashboard → Edge Functions → Deploy via editor)
- `payfast-checkout` — paste `supabase/functions/payfast-checkout/index.ts`. Leave **Verify JWT ON**.
- `payfast-itn` — paste `supabase/functions/payfast-itn/index.ts`. **Turn Verify JWT OFF** (PayFast doesn't send a JWT — important, or it'll reject the notification).

## 2. Secrets (Edge Functions → Secrets)
For **sandbox testing** you can skip merchant secrets (the code falls back to PayFast's public test merchant). Just add:
- `PAYFAST_MODE` = `sandbox`

When you **go live** (after creating your real PayFast account), add/replace:
- `PAYFAST_MODE` = `live`
- `PAYFAST_MERCHANT_ID` = your merchant id
- `PAYFAST_MERCHANT_KEY` = your merchant key
- `PAYFAST_PASSPHRASE` = your salt/passphrase (set the same value in your PayFast dashboard → Settings)

## 3. Test in sandbox
1. Log into Tradee as a tradesman → **My Listing** → **Your Plan** → click **Upgrade to Verified — R149/mo**.
2. You're redirected to PayFast's **sandbox** payment page. Complete the test payment (sandbox lets you pay without a real card).
3. PayFast calls `payfast-itn`, which upgrades that listing's tier. You return to Tradee with a "payment received" message; the tier updates within ~a minute.
4. Check the function logs (Edge Functions → payfast-itn → Logs) to see "upgraded to verified…".

## Notes
- A successful payment sets the **tier** (featured placement) + a ~1-month expiry that each recurring payment extends. The green **Verified badge** still requires admin document approval (kept separate for trust/liability).
- Subscriptions are monthly (`frequency=3`, indefinite). Cancellation handling can be added later.
- Going live also needs your real PayFast account set to **live** mode and the passphrase matching.
