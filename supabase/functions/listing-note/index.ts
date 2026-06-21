// Emails a tradesman a note/message from the Tradee admin team.
// Called by the admin "✉ Note" button. The note is also stored in listing_notes
// (by the client) so it shows in a "Messages from Tradee" box on their dashboard.
// Deploy with "Verify JWT" OFF. Secret: RESEND_API_KEY.
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!
const SITE = 'https://www.tradee.org'
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors })
  try {
    const { email, name, message } = await req.json()
    if (!email || !message) return new Response(JSON.stringify({ error: 'Missing email or message' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } })

    const safe = String(message).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#1C1917;font-family:'Helvetica Neue',Arial,sans-serif;">
  <div style="max-width:520px;margin:0 auto;padding:2rem 1rem;">
    <div style="text-align:center;margin-bottom:1.5rem;">
      <div style="font-size:2rem;font-weight:900;letter-spacing:0.08em;"><span style="color:#FFFDF9;">TRA</span><span style="color:#F59E0B;">DEE</span></div>
    </div>
    <div style="background:#292524;border:1px solid #3D3935;border-radius:12px;padding:1.5rem;">
      <h1 style="color:#FFFDF9;font-size:20px;margin:0 0 1rem;">A message from the Tradee team</h1>
      <p style="color:#A8A29E;font-size:14px;margin:0 0 0.5rem;">Hi ${name ? String(name).replace(/</g, '') : 'there'},</p>
      <div style="color:#FFFDF9;font-size:15px;line-height:1.6;background:#1C1917;border-radius:8px;padding:14px 16px;">${safe}</div>
      <div style="text-align:center;margin-top:1.5rem;">
        <a href="${SITE}" style="display:inline-block;background:#F59E0B;color:#1C1917;font-weight:700;padding:14px 28px;border-radius:8px;text-decoration:none;">Open my dashboard</a>
      </div>
      <p style="color:#57534E;font-size:12px;margin-top:1.25rem;">You can also see this message in the "Messages from Tradee" box on your dashboard.</p>
    </div>
    <div style="text-align:center;color:#57534E;font-size:12px;margin-top:1.5rem;">Tradee — The Trade Directory · tradee.org</div>
  </div>
</body></html>`

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'Tradee <support@tradee.org>', to: [email], subject: 'A message from Tradee', html }),
    })
    return new Response(JSON.stringify({ ok: true }), { headers: { ...cors, 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } })
  }
})
