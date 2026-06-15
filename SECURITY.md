# Tradee — Security Audit

_Audit date: 2026-06-15. Scope: RLS policies, data isolation, admin authorisation._

## How the security model works

Tradee is a client-only app (Vite + vanilla JS) talking directly to Supabase
with the **anon** key. The anon key is public by design — it is shipped in the
browser bundle. **All real security therefore lives in Postgres Row Level
Security (RLS) policies**, not in the JavaScript. Any check done in `main.js`
(e.g. the admin-email check) is UX only; a determined user can call Supabase
directly with the anon key, so every write path must be enforced by RLS.

Run [`supabase/security-policies.sql`](supabase/security-policies.sql) in the
Supabase SQL editor to apply the hardened policies described below. It is
idempotent.

---

## Findings

### 🔴 High

1. **Self-assigned paid tier (revenue bypass).**
   The listing INSERT policy was `with check (true)` and the client sends
   `tier` from the form. Anyone could create a `premium`/`verified` listing for
   free (there is no payment flow yet).
   **Fix:** `protect_listing_columns` trigger forces `tier='free'` on insert for
   non-admins; only an admin can promote a tier.

2. **Public exposure of registration/certificate documents.**
   `loadListings()` selects `*` for every listing and ships it to every
   anonymous visitor — including `certificate_urls`, which point at the
   **public** `certifications-registrations` bucket. Anyone can download other
   tradesmen's registration/ID documents.
   **Fix (requires follow-up code change — not yet done):** move certificates to
   a **private** bucket and serve them to the owner/admin via short-lived signed
   URLs. Profile photos & portfolio images can stay in a public bucket. SQL stub
   for the private-bucket policies is at the bottom of `security-policies.sql`.

3. **Reviews could be edited/forged.**
   The reply feature updates reviews by id with no ownership check in the client,
   relying on whatever RLS happened to exist. Without a column guard an owner
   could rewrite a 1-star review into 5 stars.
   **Fix:** `reviews_update_owner` policy limits updates to the listing owner/admin,
   and `protect_review_columns` makes everything except `reply_text`/`reply_at`
   immutable to non-admins.

### 🟠 Medium

4. **Admin panel failed _open_.**
   `renderAdmin()` allowed access when `VITE_ADMIN_EMAIL` was unset.
   **Fixed in code:** now fails closed (no admin list ⇒ nobody in). Admin
   mutations are additionally enforced server-side by `is_admin()` in RLS.

5. **Client wrote `rating_avg` directly.**
   Reviewers updated the listing's `rating_avg`, which both duplicates the DB
   trigger and requires a dangerously broad UPDATE permission.
   **Fixed in code:** removed; `rating_avg` is now only ever written by the
   server-side `trg_review_rating` trigger.

6. **Analytics readable by anyone.**
   `analytics_events` had no read restriction, letting competitors scrape each
   other's view/contact counts.
   **Fix:** `analytics_select_owner` — only the listing owner (or admin) can read
   its events; inserts remain open for tracking.

7. **Self-reviews.**
   Nothing stopped an owner reviewing their own listing.
   **Fix:** `reviews_insert_public` rejects a review whose listing belongs to the
   caller.

### 🟡 Low / follow-up

8. **Edge function `monthly-report` uses the service-role key and has no caller
   check.** If deployed with `verify_jwt = false` (common for cron), anyone who
   finds the URL could trigger a mass email blast. Require a shared secret header
   or restrict invocation to the cron schedule only.

9. **`review-notification` / `welcome-email` take recipient + content from the
   request body.** Any authenticated user could send a Tradee-branded email to an
   arbitrary address. Consider deriving the recipient server-side from the
   listing id rather than trusting the body.

10. **Precise `lat`/`lng` shipped publicly** for the map feature. Acceptable for a
    business directory, but be aware exact coordinates are visible to everyone.

---

## What was changed in this pass

- `supabase/security-policies.sql` — new, idempotent hardened RLS + triggers.
- `src/main.js` — admin panel fails closed; removed client-side `rating_avg` write.

## Still to do (recommended order)

1. **Run `supabase/security-policies.sql`** (edit the admin email first).
2. **Split storage buckets** — public `avatars`, private `certifications` +
   signed URLs (closes finding #2). Happy to implement on request.
3. Lock down the edge functions (#8, #9) when they are deployed.
