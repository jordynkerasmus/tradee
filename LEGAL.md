# Tradee — Legal Readiness (POPIA) & Draft Documents

> ⚠️ **Not legal advice.** These are practical drafts and a checklist to make your
> attorney review fast and cheap. Have a qualified South African attorney review
> and finalise everything below before a heavy/public launch.
>
> Placeholders in **[brackets]** need you to fill in / confirm.

---

## 1. What personal information Tradee processes

| Whose data | What we collect | Why |
|---|---|---|
| **Tradesmen** | Name, contact name, email, phone, business details, trades, locations (city/province, optional GPS), rates, profile & portfolio photos, ID & credential documents (private), tier/payment status | To create and run their public listing; verify the badge; contact them |
| **Clients / homeowners** | Reviewer name + review text & ratings; optional account email & password; saved favourites | To show reviews; let them save listings/sync across devices |
| **All visitors** | Usage events (profile views, contact clicks, searches) and Vercel web analytics (page views, approximate location/device, IP processed by Vercel) | To measure engagement & traffic |

**Processors / operators used:** Supabase (database, auth, file storage — hosted US/us-east-1), Resend (email, via Amazon SES), Vercel (hosting + analytics). Each must have a data-processing agreement in place (their standard DPAs cover this — confirm they're accepted).

---

## 2. POPIA checklist (before heavy launch)

- [ ] **Register an Information Officer** with the Information Regulator (mandatory). By default this is the "head" of the business — i.e. **[your name]**. Registration is free at the Regulator's portal.
- [ ] **Publish a Privacy / POPIA Notice** on the site (draft below) and link it from sign-up + footer.
- [ ] **Publish Terms of Service** (draft below) and link from sign-up + footer.
- [ ] **PAIA Manual** — POPIA/PAIA expects businesses to have a Promotion of Access to Information Act manual available. Use the Regulator's template; your attorney can confirm if you're exempt.
- [ ] **Lawful basis + consent** — the sign-up tick-box captures consent; make sure it links to the real Privacy Policy & Terms (currently it references documents that don't exist yet — fix by publishing them).
- [ ] **Data-subject request process** — a way for someone to ask to see, correct or delete their data. Easiest: a `privacy@tradee.org` (or support@) address that you action within a reasonable time.
- [ ] **Cross-border transfer note** — data is stored in the US (Supabase/Vercel). POPIA s72 allows this where the operator is bound by adequate protection (their DPAs) and/or with consent. State this in the Privacy Policy.
- [ ] **Security safeguards** — largely done (RLS, private certificate bucket, admin-only verification, encrypted secrets). Keep `SECURITY.md` up to date as your record.
- [ ] **Breach process** — know that a breach involving personal info must be reported to the Regulator and affected people. Keep a simple note of who to contact.
- [ ] **Retention** — decide how long you keep data (e.g. while the listing/account is active + a reasonable period after). State it in the policy.
- [ ] **Direct marketing** — the daily report goes to you only (fine). If you later email tradesmen/clients marketing, POPIA s69 requires consent/opt-out — keep an unsubscribe link.

---

## 3. DRAFT — Privacy / POPIA Notice

> _Publish at tradee.org/privacy. Attorney to finalise._

**Tradee Privacy Policy**
_Last updated: [date]_

**1. Who we are.** Tradee ("we", "us") operates the tradee.org online directory.
Responsible party: **[registered business name / sole proprietor name]**, **[address]**.
Information Officer: **[name]**, contactable at **[privacy@tradee.org]**.

**2. What we collect.** Depending on how you use Tradee, we collect: account details
(name, email, password); for tradesmen — business details, contact details, location,
photos, and identity/credential documents you upload; for reviewers — your name and
review; and usage/analytics data (pages viewed, listing interactions, device/approx.
location and IP processed by our hosting and analytics providers).

**3. Why we process it (lawful basis).** To provide the service and your listing
(performance of a contract), with your consent (e.g. publishing your listing,
uploading documents), and for our legitimate interests in running and improving a
safe directory. Reviews are published as part of the service.

**4. Identity/credential documents.** Documents you upload for verification are stored
privately and are visible only to you and Tradee's review team. We use them solely to
review your Verified badge. We do **not** publish them.

**5. Who we share with.** Service providers who process data on our behalf under
contract: Supabase (database, authentication, file storage), Resend (email), and
Vercel (hosting & analytics). Your public listing information (the details you choose
to publish) is visible to anyone using the directory.

**6. Where it's stored / cross-border.** Our providers host data outside South Africa
(including the United States). They are bound by data-processing terms providing an
adequate level of protection, as permitted under section 72 of POPIA.

**7. How we protect it.** We use access controls, encryption of secrets, private
storage for sensitive documents, and database row-level security. No system is 100%
secure, but we take reasonable steps to safeguard your information.

**8. How long we keep it.** While your account/listing is active and for a reasonable
period afterwards, or as required by law. You can ask us to delete your data.

**9. Your rights.** Under POPIA you may request access to, correction or deletion of
your personal information, object to processing, and lodge a complaint with the
Information Regulator (inforegulator.org.za). Contact **[privacy@tradee.org]**.

**10. Cookies / analytics.** We use privacy-friendly analytics (Vercel) to measure
traffic; it does not use advertising cookies.

**11. Changes.** We may update this policy and will post the new version here.

**12. Contact.** **[privacy@tradee.org]**.

---

## 4. DRAFT — Terms of Service

> _Publish at tradee.org/terms. Attorney to finalise._

**Tradee Terms of Service**
_Last updated: [date]_

1. **Acceptance.** By using Tradee or listing a business, you agree to these Terms.
2. **What Tradee is.** Tradee is an online directory that helps people find and
   compare tradesmen. **We are not a party to any agreement, booking, payment or work**
   arranged between users and tradesmen, take no commission on such work, and do not
   employ, supervise or control any tradesman.
3. **No guarantee / your responsibility.** We do not guarantee the quality,
   workmanship, licensing, insurance, conduct or availability of any tradesman.
   You are responsible for verifying a tradesman's credentials, insurance and
   references and for any agreement you enter into. **To the fullest extent permitted
   by law, Tradee is not liable for any loss, damage, injury or dispute arising from
   dealings between users and tradesmen.**
4. **The Verified badge.** The badge means a tradesman submitted identity/credential
   documents which we reviewed before granting it. It is **not** a guarantee of their
   work, licensing or insurance.
5. **Tradesman obligations.** You confirm your information is true and that you hold
   any licences, registrations and insurance required for your trade. You may not post
   false, misleading or unlawful content.
6. **Reviews.** Reviews must be genuine and based on real experiences. We may remove
   reviews that are fraudulent, abusive or unlawful.
7. **Payments.** Paid plans (when available) are billed as described at sign-up.
   [Payment, renewal and refund terms — to be completed with PayFast launch.]
8. **Termination.** We may suspend or remove listings that breach these Terms.
9. **Governing law.** These Terms are governed by the laws of South Africa.
10. **Contact.** **[support@tradee.org]**.

---

## 5. On-site disclaimers (already live — keep consistent)

The sign-up and "List your business" flows already show a liability-disclaimer
tick-box. Once the Privacy Policy and Terms pages exist, link the words
"Terms of Service" and "Privacy Policy" in those tick-boxes to the real pages.

---

## 6. Recommended next actions
1. Confirm the **[bracket]** details (business name, address, Information Officer, privacy email).
2. Have an attorney review the two drafts above.
3. **Publish** them as `/privacy` and `/terms` pages and link from sign-up + footer
   (we can build these pages into the site — they're simple static pages).
4. Register your Information Officer with the Information Regulator.
5. Set up **[privacy@tradee.org]** (or use support@) to receive data-subject requests.
