import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!
const SITE = 'https://www.tradee.org'
const ADMIN_EMAILS = (Deno.env.get('ADMIN_EMAILS') || 'jordynkerasmus@gmail.com')
  .split(',').map((s) => s.trim().toLowerCase())
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors })
  try {
    const authHeader = req.headers.get('Authorization') || ''
    const token = authHeader.replace('Bearer ', '').trim()
    if (!token) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }
    const supa = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!)
    const { data: { user } } = await supa.auth.getUser(token)
    if (!user || !ADMIN_EMAILS.includes((user.email || '').toLowerCase())) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403, headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const { email, name, message } = await req.json()
    if (!email || !message) {
      return new Response(JSON.stringify({ error: 'Missing email or message' }), {
        status: 400, headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const safe = String(message)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/\n/g, '<br>')
    const displayName = name ? String(name).replace(/</g, '') : 'there'

    const html = [
      '<!DOCTYPE html><html><head><meta charset="UTF-8"></head>',
      '<body style="margin:0;padding:0;background:#1C1917;font-family:Arial,sans-serif;">',
      '<div style="max-width:520px;margin:0 auto;padding:2rem 1rem;">',
      '<div style="text-align:center;margin-bottom:1.5rem;font-size:2rem;font-weight:900;">',
      '<span style="color:#FFFDF9;">TRA</span><span style="color:#F59E0B;">DEE</span></div>',
      '<div style="background:#292524;border:1px solid #3D3935;border-radius:12px;padding:1.5rem;">',
      '<h1 style="color:#FFFDF9;font-size:20px;margin:0 0 1rem;">A message from the Tradee team</h1>',
      '<p style="color:#A8A29E;font-size:14px;margin:0 0 0.5rem;">Hi ' + displayName + ',</p>',
      '<div style="color:#FFFDF9;font-size:15px;line-height:1.6;background:#1C1917;border-radius:8px;padding:14px 16px;">',
      safe,
      '</div>',
      '<div style="text-align:center;margin-top:1.5rem;">',
      '<a href="' + SITE + '" style="display:inline-block;background:#F59E0B;color:#1C1917;',
      'font-weight:700;padding:14px 28px;border-radius:8px;text-decoration:none;">Open my dashboard</a>',
      '</div>',
      '<p style="color:#57534E;font-size:12px;margin-top:1.25rem;">',
      'You can also see this message in the Messages from Tradee box on your dashboard.</p>',
      '</div>',
      '<div style="text-align:center;color:#57534E;font-size:12px;margin-top:1.5rem;">',
      'Tradee - The Trade Directory - tradee.org</div>',
      '</div></body></html>',
    ].join('')

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + RESEND_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Tradee <support@tradee.org>',
        to: [email],
        subject: 'A message from Tradee',
        html,
      }),
    })
    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
})
