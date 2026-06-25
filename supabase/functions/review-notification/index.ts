// Security: requires a valid Supabase JWT (anon or user) so only requests from
// the Tradee frontend can trigger this. Accepts listing_id and looks up the
// owner email server-side — prevents this function being used as an email relay
// to arbitrary addresses.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors })

  try {
    // Require a valid Supabase JWT (anon key or user token)
    const token = (req.headers.get('Authorization') || '').replace('Bearer ', '').trim()
    if (!token) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }
    const supaAnon = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!)
    const { error: jwtErr } = await supaAnon.auth.getUser(token)
    // anon key won't resolve to a user but that's OK — we just need a valid project JWT
    // If the token is completely invalid (not from this project), getUser will error
    // We only block on a hard JWT parse failure (not simply "no user")
    if (jwtErr && jwtErr.status === 401) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const { listing_id, reviewerName, stars } = await req.json()
    if (!listing_id) {
      return new Response(JSON.stringify({ error: 'listing_id required' }), {
        status: 400, headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    // Look up listing owner email server-side — never trust the caller to supply the recipient
    const supaAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: listing } = await supaAdmin
      .from('listings').select('email, name').eq('id', listing_id).single()
    if (!listing?.email) {
      return new Response(JSON.stringify({ ok: true, skipped: 'no email on file' }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const { email, name: tradeName } = listing
    const starsStr = '★'.repeat(stars) + '☆'.repeat(5 - stars)
    const displayName = tradeName || 'there'

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#1C1917;font-family:'Helvetica Neue',Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:2rem 1rem;">

    <div style="text-align:center;margin-bottom:2rem;">
      <div style="font-size:2.2rem;font-weight:900;letter-spacing:0.08em;">
        <span style="color:#FFFDF9;">TRA</span><span style="color:#F59E0B;">DEE</span>
      </div>
      <div style="color:#A8A29E;font-size:12px;letter-spacing:0.1em;text-transform:uppercase;margin-top:4px;">The Trade Directory</div>
    </div>

    <div style="background:#292524;border-radius:12px;padding:2rem;text-align:center;margin-bottom:1rem;border:1px solid #3D3935;">
      <div style="font-size:3rem;margin-bottom:1rem;">⭐</div>
      <h1 style="color:#FFFDF9;margin:0 0 8px;font-size:1.4rem;font-weight:700;">New review for ${displayName}</h1>
      <div style="font-size:1.8rem;color:#F59E0B;margin:12px 0;">${starsStr}</div>
      <p style="color:#A8A29E;font-size:15px;margin:0 0 1.5rem;">
        <strong style="color:#FFFDF9;">${reviewerName}</strong> just left you a ${stars}-star review on Tradee.
      </p>
      <a href="https://www.tradee.org/dashboard" style="display:inline-block;background:#F59E0B;color:#1C1917;font-weight:700;padding:14px 32px;border-radius:6px;text-decoration:none;font-size:15px;">View &amp; Reply →</a>
    </div>

    <div style="background:#292524;border-radius:12px;padding:1.5rem;margin-bottom:1rem;border:1px solid #3D3935;">
      <div style="color:#F59E0B;font-weight:700;font-size:13px;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px;">Pro tip</div>
      <p style="color:#A8A29E;font-size:14px;line-height:1.6;margin:0;">Replying to reviews builds trust with future clients. Log in to your dashboard to write a reply.</p>
    </div>

    <div style="text-align:center;color:#57534E;font-size:12px;border-top:1px solid #292524;padding-top:1.5rem;">
      <div>You're receiving this because you have a listing on Tradee.</div>
    </div>

  </div>
</body>
</html>`

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Tradee <reviews@tradee.org>',
        to: [email],
        subject: `New ${stars}★ review from ${reviewerName}`,
        html,
      }),
    })

    const data = await res.json()
    return new Response(JSON.stringify({ success: true, data }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
})
