import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!

// Who receives the daily report, and the founding-member cap.
const REPORT_TO = 'jordynkerasmus@gmail.com'
const PROMO_LIMIT = 100

Deno.serve(async (_req) => {
  try {
    const { count: total } = await supabase
      .from('listings').select('id', { count: 'exact', head: true })

    const { count: promo } = await supabase
      .from('listings').select('id', { count: 'exact', head: true })
      .eq('promo_verified', true)

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const { count: today } = await supabase
      .from('listings').select('id', { count: 'exact', head: true })
      .gte('created_at', since)

    const { count: verified } = await supabase
      .from('listings').select('id', { count: 'exact', head: true })
      .eq('tier', 'verified')
    const { count: premium } = await supabase
      .from('listings').select('id', { count: 'exact', head: true })
      .eq('tier', 'premium')

    const spotsLeft = Math.max(0, PROMO_LIMIT - (promo || 0))
    const dateStr = new Date().toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

    // Custom trades awaiting admin approval
    const { data: pendingRows } = await supabase
      .from('listings').select('pending_trades').not('pending_trades', 'is', null)
    const pendingTrades = (pendingRows || []).reduce((n, r) => n + ((r.pending_trades || []).length), 0)

    // Engagement: pull events for the last 30 days, then split out the last 24h.
    const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const { data: events } = await supabase
      .from('analytics_events').select('event_type, created_at').gte('created_at', since30)
    const ev = events || []
    const ct = (t: string, sinceTs?: string) =>
      ev.filter((e) => e.event_type === t && (!sinceTs || e.created_at >= sinceTs)).length
    // last 24h
    const v1 = ct('profile_view', since), c1 = ct('phone_click', since) + ct('whatsapp_click', since) + ct('email_click', since)
    const s1 = ct('search_impression', since), r1 = ct('review_left', since)
    const ctr1 = v1 > 0 ? Math.round((c1 / v1) * 100) : 0
    // last 30 days
    const v30 = ct('profile_view'), c30 = ct('phone_click') + ct('whatsapp_click') + ct('email_click')
    const ctr30 = v30 > 0 ? Math.round((c30 / v30) * 100) : 0

    const row = (label: string, value: number | string, accent = '#FFFDF9') =>
      `<tr><td style="padding:10px 0;border-bottom:1px solid #292524;color:#A8A29E;font-size:14px;">${label}</td><td style="padding:10px 0;border-bottom:1px solid #292524;text-align:right;color:${accent};font-size:18px;font-weight:700;">${value}</td></tr>`

    const html = `
<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#1C1917;font-family:'Helvetica Neue',Arial,sans-serif;">
  <div style="max-width:520px;margin:0 auto;padding:2rem 1rem;">
    <div style="text-align:center;margin-bottom:1.5rem;">
      <div style="font-size:2rem;font-weight:900;letter-spacing:0.08em;"><span style="color:#FFFDF9;">TRA</span><span style="color:#F59E0B;">DEE</span></div>
      <div style="color:#A8A29E;font-size:12px;letter-spacing:0.1em;text-transform:uppercase;margin-top:4px;">Daily Report · ${dateStr}</div>
    </div>
    <div style="background:#292524;border-radius:12px;padding:1.5rem 1.75rem;border:1px solid #3D3935;">
      <table style="width:100%;border-collapse:collapse;">
        ${row('New sign-ups (last 24h)', today || 0, '#22C55E')}
        ${row('Total tradesmen listed', total || 0)}
        ${row('Verified members', verified || 0)}
        ${row('Premium members', premium || 0)}
        ${row('Founding-member spots claimed', `${promo || 0} / ${PROMO_LIMIT}`)}
        ${row('⚠️ Custom trades awaiting your approval', pendingTrades, pendingTrades > 0 ? '#F59E0B' : '#FFFDF9')}
        <tr><td style="padding:14px 0 0;color:#F59E0B;font-size:14px;font-weight:700;">Free Verified spots left</td><td style="padding:14px 0 0;text-align:right;color:#F59E0B;font-size:24px;font-weight:800;">${spotsLeft}</td></tr>
      </table>
    </div>

    <div style="color:#A8A29E;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;margin:1.5rem 0 8px;">Engagement — last 24 hours</div>
    <div style="background:#292524;border-radius:12px;padding:1.5rem 1.75rem;border:1px solid #3D3935;">
      <table style="width:100%;border-collapse:collapse;">
        ${row('Profile views', v1)}
        ${row('Contact clicks (call / WhatsApp / email)', c1, '#F59E0B')}
        ${row('View → contact rate', `${ctr1}%`)}
        ${row('Search appearances', s1)}
        ${row('Reviews left', r1)}
      </table>
    </div>

    <div style="color:#A8A29E;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;margin:1.5rem 0 8px;">Engagement — last 30 days</div>
    <div style="background:#292524;border-radius:12px;padding:1.5rem 1.75rem;border:1px solid #3D3935;">
      <table style="width:100%;border-collapse:collapse;">
        ${row('Profile views', v30)}
        ${row('Contact clicks', c30, '#F59E0B')}
        ${row('View → contact rate', `${ctr30}%`)}
      </table>
    </div>

    <div style="text-align:center;color:#57534E;font-size:12px;margin-top:1.5rem;">Sent automatically by Tradee every morning. View live traffic in your Vercel dashboard.</div>
  </div>
</body></html>`

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Tradee <reports@tradee.org>',
        to: [REPORT_TO],
        subject: `Tradee daily — ${total || 0} listed, ${spotsLeft} free spots left`,
        html,
      }),
    })

    return new Response(JSON.stringify({ ok: true, total, today, spotsLeft }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }
})
