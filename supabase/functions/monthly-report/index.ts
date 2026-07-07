import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!
const CRON_SECRET = Deno.env.get('CRON_SECRET') || ''

// Escape any user-supplied value before it enters email HTML.
const esc = (s: unknown) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

Deno.serve(async (req) => {
  // Fail closed: never serve if the cron secret is unset.
  if (!CRON_SECRET || req.headers.get('X-Cron-Secret') !== CRON_SECRET) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } })
  }
  try {
    // Get all listings with an email and user_id
    const { data: listings, error } = await supabase
      .from('listings')
      .select('id, name, trade, email, province, tier, cities, rating_avg')
      .not('email', 'is', null)

    if (error) throw error

    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
    const monthEnd = now.toISOString()
    const monthName = now.toLocaleString('en-ZA', { month: 'long', year: 'numeric' })

    let sent = 0

    for (const listing of listings) {
      // Get this month's analytics for this listing
      const { data: events } = await supabase
        .from('analytics_events')
        .select('event_type')
        .eq('listing_id', listing.id)
        .gte('created_at', monthStart)
        .lte('created_at', monthEnd)

      const counts = {
        search_impression: 0,
        profile_view: 0,
        phone_click: 0,
        email_click: 0,
        whatsapp_click: 0,
        review_left: 0,
      }

      for (const e of events || []) {
        if (counts[e.event_type] !== undefined) counts[e.event_type]++
      }

      // Get reviews left this month
      const { data: monthReviews } = await supabase
        .from('reviews')
        .select('stars, reviewer_name, review_text')
        .eq('listing_id', listing.id)
        .gte('created_at', monthStart)
        .lte('created_at', monthEnd)

      const totalContacts = counts.phone_click + counts.email_click + counts.whatsapp_click
      const conversionRate = counts.profile_view > 0
        ? ((totalContacts / counts.profile_view) * 100).toFixed(1)
        : '0'

      // Tips based on listing data
      const tips = []
      if (!listing.rating_avg || listing.rating_avg < 4) tips.push('📸 Ask satisfied clients to leave a review — listings with 4+ stars get 3× more profile views.')
      if (listing.tier === 'free') tips.push('⭐ Upgrade to <strong>Verified (R149/mo)</strong> to unlock priority ranking, verified badge, and credentials display.')
      if (listing.tier === 'verified') tips.push('🚀 Upgrade to <strong>Premium (R249/mo)</strong> for featured placement at the top of the directory — maximum visibility.')
      if (!counts.whatsapp_click && counts.profile_view > 0) tips.push('💬 Add your WhatsApp number to your profile — clients in SA prefer WhatsApp over calls.')
      if (counts.profile_view < 10) tips.push('🔗 Share your profile link with past clients and on social media to get more visibility.')
      tips.push('✏️ Log in to <a href="https://tradee-dusky.vercel.app" style="color:#F59E0B;">tradee.vercel.app</a> to update your rates, description or photos anytime.')

      const reviewsHTML = monthReviews && monthReviews.length > 0
        ? monthReviews.map(r => `
          <div style="background:#3D3935;border-radius:6px;padding:12px 16px;margin-bottom:8px;">
            <div style="color:#F59E0B;font-size:14px;margin-bottom:4px;">${'★'.repeat(r.stars)}${'☆'.repeat(5-r.stars)}</div>
            <div style="font-size:13px;color:#D6D3D1;">"${esc(r.review_text)}"</div>
            <div style="font-size:12px;color:#A8A29E;margin-top:4px;">— ${esc(r.reviewer_name)}</div>
          </div>`).join('')
        : '<p style="color:#78716C;font-size:14px;">No reviews this month yet — share your profile link to get more!</p>'

      const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#1C1917;font-family:'Helvetica Neue',Arial,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:2rem 1rem;">

    <!-- Header -->
    <div style="text-align:center;margin-bottom:2rem;">
      <div style="font-size:2rem;font-weight:900;letter-spacing:0.08em;color:#FFFDF9;">
        <span style="color:#FFFDF9;">TRA</span><span style="color:#F59E0B;">DEE</span>
      </div>
      <div style="color:#A8A29E;font-size:13px;margin-top:4px;">Monthly Performance Report — ${monthName}</div>
    </div>

    <!-- Greeting -->
    <div style="background:#292524;border-radius:12px;padding:1.5rem;margin-bottom:1rem;">
      <h2 style="color:#FFFDF9;margin:0 0 6px;font-size:1.3rem;">Hi ${esc(listing.name)} 👋</h2>
      <p style="color:#A8A29E;margin:0;font-size:14px;line-height:1.6;">
        Here's how your Tradee listing performed in ${monthName}. Keep building your reputation — every review counts!
      </p>
    </div>

    <!-- Stats Grid -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:1rem;">
      <div style="background:#292524;border-radius:12px;padding:1.25rem;text-align:center;border:1px solid #3D3935;">
        <div style="font-size:2.5rem;font-weight:700;color:#F59E0B;line-height:1;">${counts.search_impression}</div>
        <div style="color:#A8A29E;font-size:12px;text-transform:uppercase;letter-spacing:0.06em;margin-top:6px;">Search Impressions</div>
        <div style="color:#78716C;font-size:11px;margin-top:3px;">Times your listing appeared in search</div>
      </div>
      <div style="background:#292524;border-radius:12px;padding:1.25rem;text-align:center;border:1px solid #3D3935;">
        <div style="font-size:2.5rem;font-weight:700;color:#F59E0B;line-height:1;">${counts.profile_view}</div>
        <div style="color:#A8A29E;font-size:12px;text-transform:uppercase;letter-spacing:0.06em;margin-top:6px;">Profile Views</div>
        <div style="color:#78716C;font-size:11px;margin-top:3px;">Clients who viewed your full profile</div>
      </div>
      <div style="background:#292524;border-radius:12px;padding:1.25rem;text-align:center;border:1px solid #3D3935;">
        <div style="font-size:2.5rem;font-weight:700;color:#25D366;line-height:1;">${counts.whatsapp_click}</div>
        <div style="color:#A8A29E;font-size:12px;text-transform:uppercase;letter-spacing:0.06em;margin-top:6px;">WhatsApp Clicks</div>
        <div style="color:#78716C;font-size:11px;margin-top:3px;">Clients who tapped WhatsApp</div>
      </div>
      <div style="background:#292524;border-radius:12px;padding:1.25rem;text-align:center;border:1px solid #3D3935;">
        <div style="font-size:2.5rem;font-weight:700;color:#F59E0B;line-height:1;">${counts.phone_click + counts.email_click}</div>
        <div style="color:#A8A29E;font-size:12px;text-transform:uppercase;letter-spacing:0.06em;margin-top:6px;">Call / Email Clicks</div>
        <div style="color:#78716C;font-size:11px;margin-top:3px;">Phone: ${counts.phone_click} · Email: ${counts.email_click}</div>
      </div>
    </div>

    <!-- Reviews + Rating -->
    <div style="background:#292524;border-radius:12px;padding:1.5rem;margin-bottom:1rem;border:1px solid #3D3935;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
        <div>
          <div style="color:#FFFDF9;font-weight:600;font-size:15px;">Reviews This Month</div>
          <div style="color:#A8A29E;font-size:13px;">${counts.review_left} new review${counts.review_left !== 1 ? 's' : ''}</div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:2rem;font-weight:700;color:#F59E0B;line-height:1;">${listing.rating_avg || '—'}</div>
          <div style="color:#A8A29E;font-size:12px;">Overall Rating</div>
        </div>
      </div>
      ${reviewsHTML}
    </div>

    <!-- Conversion -->
    <div style="background:#292524;border-radius:12px;padding:1.5rem;margin-bottom:1rem;border:1px solid #3D3935;">
      <div style="color:#FFFDF9;font-weight:600;font-size:15px;margin-bottom:6px;">Contact Conversion Rate</div>
      <div style="font-size:2.5rem;font-weight:700;color:#F59E0B;">${conversionRate}%</div>
      <div style="color:#A8A29E;font-size:13px;margin-top:4px;">${totalContacts} out of ${counts.profile_view} profile viewers contacted you</div>
    </div>

    <!-- Tips -->
    <div style="background:#292524;border-radius:12px;padding:1.5rem;margin-bottom:1.5rem;border:1px solid #3D3935;">
      <div style="color:#F59E0B;font-weight:600;font-size:15px;margin-bottom:1rem;">💡 Tips to Improve Your Listing</div>
      ${tips.map(t => `<div style="font-size:14px;color:#D6D3D1;margin-bottom:10px;line-height:1.5;">${t}</div>`).join('')}
    </div>

    <!-- CTA -->
    <div style="text-align:center;margin-bottom:2rem;">
      <a href="https://tradee-dusky.vercel.app" style="display:inline-block;background:#F59E0B;color:#1C1917;font-weight:700;padding:14px 32px;border-radius:6px;text-decoration:none;font-size:15px;">Update My Listing →</a>
    </div>

    <!-- Footer -->
    <div style="text-align:center;color:#57534E;font-size:12px;border-top:1px solid #292524;padding-top:1.5rem;">
      <div>You're receiving this because your business is listed on Tradee.</div>
      <div style="margin-top:4px;">© ${new Date().getFullYear()} Tradee · The Trade Directory</div>
    </div>

  </div>
</body>
</html>`

      // Send via Resend
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'Tradee <reports@tradee.co.za>',
          to: [listing.email],
          subject: `Your Tradee Monthly Report — ${monthName}`,
          html,
        }),
      })

      sent++
    }

    return new Response(JSON.stringify({ success: true, sent }), {
      headers: { 'Content-Type': 'application/json' },
    })

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
