// Daily subscription lifecycle check.
// For every paid listing (verified/premium) whose tier_expires_at has passed:
//   • Day of lapse  → email a warning + (the dashboard shows a banner separately).
//   • 3+ days lapsed → downgrade to free + email confirmation.
// grace_warned_at stops us emailing the same person every day during grace.
// Deploy with "Verify JWT" OFF (it's called by cron, not a logged-in user).
// Secrets: RESEND_API_KEY, CRON_SECRET (+ Supabase auto-provides SUPABASE_URL / SERVICE_ROLE_KEY).
// Cron must pass header: X-Cron-Secret: <value of CRON_SECRET env var>
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!
const CRON_SECRET = Deno.env.get('CRON_SECRET') || ''
const SITE = 'https://www.tradee.org'
const GRACE_DAYS = 3
const DAY = 24 * 60 * 60 * 1000

const planLabel = (t: string) => (t === 'premium' ? 'Premium' : 'Verified')

function emailHtml(heading: string, body: string, ctaText: string) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#1C1917;font-family:'Helvetica Neue',Arial,sans-serif;">
  <div style="max-width:520px;margin:0 auto;padding:2rem 1rem;">
    <div style="text-align:center;margin-bottom:1.5rem;">
      <div style="font-size:2rem;font-weight:900;letter-spacing:0.08em;"><span style="color:#FFFDF9;">TRA</span><span style="color:#F59E0B;">DEE</span></div>
    </div>
    <div style="background:#292524;border:1px solid #3D3935;border-radius:12px;padding:1.5rem;">
      <h1 style="color:#FFFDF9;font-size:20px;margin:0 0 1rem;">${heading}</h1>
      <div style="color:#A8A29E;font-size:15px;line-height:1.6;">${body}</div>
      <div style="text-align:center;margin-top:1.5rem;">
        <a href="${SITE}" style="display:inline-block;background:#F59E0B;color:#1C1917;font-weight:700;padding:14px 28px;border-radius:8px;text-decoration:none;">${ctaText}</a>
      </div>
    </div>
    <div style="text-align:center;color:#57534E;font-size:12px;margin-top:1.5rem;">Tradee — The Trade Directory · tradee.org</div>
  </div>
</body></html>`
}

async function sendEmail(to: string, subject: string, html: string) {
  if (!to) return
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'Tradee <billing@tradee.org>', to: [to], subject, html }),
  })
}

Deno.serve(async (req) => {
  // Fail closed: if the secret is unset the endpoint stays locked, never public.
  if (!CRON_SECRET || req.headers.get('X-Cron-Secret') !== CRON_SECRET) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } })
  }
  try {
    const now = Date.now()
    const { data: listings, error } = await supabase
      .from('listings')
      .select('id, name, email, tier, tier_expires_at, promo_verified, grace_warned_at')
      .in('tier', ['verified', 'premium'])
    if (error) throw error

    let warned = 0, downgraded = 0
    for (const l of listings || []) {
      if (!l.tier_expires_at) continue
      const expires = new Date(l.tier_expires_at).getTime()
      if (now < expires) continue // still active / paid

      const plan = planLabel(l.tier)
      const daysOver = (now - expires) / DAY

      if (daysOver >= GRACE_DAYS) {
        // Past grace → downgrade to free.
        await supabase.from('listings')
          .update({ tier: 'free', tier_expires_at: null, promo_verified: false, grace_warned_at: null })
          .eq('id', l.id)
        const body = l.promo_verified
          ? `Your founding-member free <strong>${plan}</strong> period has ended, so your Tradee listing has moved to the free <strong>Standard</strong> plan.<br><br>Your listing is still live — you've just lost the priority ranking and Verified badge. You can re-activate ${plan} anytime from your dashboard.`
          : `We didn't receive your <strong>${plan}</strong> subscription payment, so your Tradee listing has now moved to the free <strong>Standard</strong> plan.<br><br>Your listing is still live — you've just lost the priority ranking and Verified badge. You can re-activate ${plan} anytime from your dashboard.`
        await sendEmail(l.email, `Your Tradee listing has moved to the free plan`,
          emailHtml('Your listing moved to the free plan', body, `Re-activate ${plan} →`))
        downgraded++
        continue
      }

      // Within grace window → warn once per cycle.
      const alreadyWarned = l.grace_warned_at && new Date(l.grace_warned_at).getTime() >= expires
      if (!alreadyWarned) {
        const daysLeft = Math.max(1, Math.ceil(GRACE_DAYS - daysOver))
        const body = l.promo_verified
          ? `Your founding-member free <strong>${plan}</strong> period has ended.<br><br>To keep your priority ranking and Verified badge, subscribe within <strong>${daysLeft} day${daysLeft !== 1 ? 's' : ''}</strong>. Otherwise your listing will automatically move to the free Standard plan.`
          : `We couldn't confirm your <strong>${plan}</strong> subscription payment this month.<br><br>Please renew within <strong>${daysLeft} day${daysLeft !== 1 ? 's' : ''}</strong> to keep your priority ranking and Verified badge. If we still haven't received payment, your listing will automatically move to the free Standard plan.`
        await sendEmail(l.email, `Action needed: your Tradee ${plan} plan`,
          emailHtml(`Your ${plan} plan needs attention`, body, `Renew ${plan} →`))
        await supabase.from('listings').update({ grace_warned_at: new Date(now).toISOString() }).eq('id', l.id)
        warned++
      }
    }

    return new Response(JSON.stringify({ ok: true, checked: listings?.length || 0, warned, downgraded }),
      { headers: { 'Content-Type': 'application/json' } })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
})
