const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type' } })
  }

  try {
    const { email, name } = await req.json()
    if (!email) return new Response(JSON.stringify({ error: 'No email provided' }), { status: 400 })

    const displayName = name || 'there'

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#1C1917;font-family:'Helvetica Neue',Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:2rem 1rem;">

    <!-- Logo -->
    <div style="text-align:center;margin-bottom:2rem;">
      <div style="font-size:2.2rem;font-weight:900;letter-spacing:0.08em;">
        <span style="color:#FFFDF9;">TRA</span><span style="color:#F59E0B;">DEE</span>
      </div>
      <div style="color:#A8A29E;font-size:12px;letter-spacing:0.1em;text-transform:uppercase;margin-top:4px;">South Africa's Trade Directory</div>
    </div>

    <!-- Hero -->
    <div style="background:#292524;border-radius:12px;padding:2rem;text-align:center;margin-bottom:1rem;border:1px solid #3D3935;">
      <div style="font-size:3rem;margin-bottom:1rem;">🎉</div>
      <h1 style="color:#FFFDF9;margin:0 0 12px;font-size:1.5rem;font-weight:700;">Welcome to Tradee, ${displayName}!</h1>
      <p style="color:#A8A29E;font-size:15px;line-height:1.7;margin:0 0 1.5rem;">
        You're now part of South Africa's fastest-growing trade directory. Thousands of homeowners, interior designers and property managers are looking for skilled tradesmen just like you.
      </p>
      <a href="https://tradee-dusky.vercel.app" style="display:inline-block;background:#F59E0B;color:#1C1917;font-weight:700;padding:14px 32px;border-radius:6px;text-decoration:none;font-size:15px;">Complete My Listing →</a>
    </div>

    <!-- Steps -->
    <div style="background:#292524;border-radius:12px;padding:1.5rem;margin-bottom:1rem;border:1px solid #3D3935;">
      <div style="color:#F59E0B;font-weight:700;font-size:14px;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:1rem;">Your next steps</div>

      <div style="display:flex;gap:12px;margin-bottom:12px;align-items:flex-start;">
        <div style="background:#F59E0B;color:#1C1917;font-weight:700;border-radius:50%;width:26px;height:26px;display:flex;align-items:center;justify-content:center;font-size:13px;flex-shrink:0;">1</div>
        <div>
          <div style="color:#FFFDF9;font-size:14px;font-weight:600;">Complete your business profile</div>
          <div style="color:#A8A29E;font-size:13px;margin-top:2px;">Add your description, rates, and service areas to get found faster.</div>
        </div>
      </div>

      <div style="display:flex;gap:12px;margin-bottom:12px;align-items:flex-start;">
        <div style="background:#F59E0B;color:#1C1917;font-weight:700;border-radius:50%;width:26px;height:26px;display:flex;align-items:center;justify-content:center;font-size:13px;flex-shrink:0;">2</div>
        <div>
          <div style="color:#FFFDF9;font-size:14px;font-weight:600;">Upload a profile photo</div>
          <div style="color:#A8A29E;font-size:13px;margin-top:2px;">Listings with photos get 3× more clicks than those without.</div>
        </div>
      </div>

      <div style="display:flex;gap:12px;align-items:flex-start;">
        <div style="background:#F59E0B;color:#1C1917;font-weight:700;border-radius:50%;width:26px;height:26px;display:flex;align-items:center;justify-content:center;font-size:13px;flex-shrink:0;">3</div>
        <div>
          <div style="color:#FFFDF9;font-size:14px;font-weight:600;">Share your profile link</div>
          <div style="color:#A8A29E;font-size:13px;margin-top:2px;">Send it to past clients and ask for reviews — a strong rating builds trust fast.</div>
        </div>
      </div>
    </div>

    <!-- Upgrade nudge -->
    <div style="background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.25);border-radius:12px;padding:1.5rem;margin-bottom:1.5rem;text-align:center;">
      <div style="color:#F59E0B;font-weight:700;font-size:14px;margin-bottom:6px;">⭐ Want more leads?</div>
      <div style="color:#A8A29E;font-size:13px;line-height:1.6;margin-bottom:1rem;">Upgrade to <strong style="color:#FFFDF9;">Verified (R149/mo)</strong> or <strong style="color:#F59E0B;">Premium (R249/mo)</strong> to appear at the top of the directory and unlock the verified badge.</div>
      <a href="https://tradee-dusky.vercel.app" style="display:inline-block;background:transparent;color:#F59E0B;font-weight:600;padding:10px 24px;border-radius:6px;text-decoration:none;font-size:14px;border:1px solid rgba(245,158,11,0.4);">See Plans →</a>
    </div>

    <!-- Footer -->
    <div style="text-align:center;color:#57534E;font-size:12px;border-top:1px solid #292524;padding-top:1.5rem;">
      <div>You're receiving this because you signed up on Tradee.</div>
      <div style="margin-top:4px;">© ${new Date().getFullYear()} Tradee · South Africa's Trade Directory</div>
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
        from: 'Tradee <welcome@tradee.org>',
        to: [email],
        subject: `Welcome to Tradee, ${displayName}! 🎉`,
        html,
      }),
    })

    const data = await res.json()
    return new Response(JSON.stringify({ success: true, data }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })
  }
})
