// Builds a signed PayFast payment redirect URL server-side (keeps the passphrase
// secret). Client calls this, gets { url }, and redirects the tradesman to PayFast.
// Secrets: PAYFAST_MODE (sandbox|live), PAYFAST_MERCHANT_ID, PAYFAST_MERCHANT_KEY,
// PAYFAST_PASSPHRASE. In sandbox you can use PayFast's public test merchant.
import { crypto } from 'https://deno.land/std@0.224.0/crypto/mod.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const MODE = Deno.env.get('PAYFAST_MODE') || 'sandbox'
const MID = Deno.env.get('PAYFAST_MERCHANT_ID') || '10000100'        // sandbox default
const MKEY = Deno.env.get('PAYFAST_MERCHANT_KEY') || '46f0cd694581a'  // sandbox default
const PASSPHRASE = Deno.env.get('PAYFAST_PASSPHRASE') || ''
const PF_HOST = MODE === 'live' ? 'www.payfast.co.za' : 'sandbox.payfast.co.za'
const SITE = 'https://www.tradee.org'
const ITN_URL = 'https://hbqivzqhmuaidolernek.supabase.co/functions/v1/payfast-itn'

const PRICES: Record<string, string> = { verified: '149.00', premium: '249.00' }
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }

function pfEncode(v: string) {
  return encodeURIComponent(v.trim()).replace(/%20/g, '+').replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
}
async function md5hex(s: string) {
  const buf = await crypto.subtle.digest('MD5', new TextEncoder().encode(s))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors })
  try {
    // In live mode, refuse to build a link with the public sandbox merchant or an
    // empty passphrase — that would silently produce fake/insecure payments.
    if (MODE === 'live' && (MID === '10000100' || !PASSPHRASE)) {
      return new Response(JSON.stringify({ error: 'Payment configuration error' }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } })
    }

    // Require an authenticated user and verify they own the listing being upgraded.
    const token = (req.headers.get('Authorization') || '').replace('Bearer ', '').trim()
    if (!token) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } })
    const supaAnon = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!)
    const { data: authData, error: jwtErr } = await supaAnon.auth.getUser(token)
    if (jwtErr || !authData?.user?.id) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } })

    const { listing_id, tier, email } = await req.json()
    if (!PRICES[tier] || !listing_id) return new Response(JSON.stringify({ error: 'Invalid request' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } })

    const supaAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: listing } = await supaAdmin.from('listings').select('user_id').eq('id', listing_id).single()
    if (!listing || listing.user_id !== authData.user.id) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { ...cors, 'Content-Type': 'application/json' } })
    }

    const amount = PRICES[tier]

    // Order matters — PayFast rebuilds the signature from these fields in order.
    const data: Record<string, string> = {
      merchant_id: MID,
      merchant_key: MKEY,
      return_url: `${SITE}/?payment=success`,
      cancel_url: `${SITE}/?payment=cancelled`,
      notify_url: ITN_URL,
      email_address: (email || '').trim(),
      m_payment_id: `${listing_id}-${tier}-${Date.now()}`,
      amount,
      item_name: `Tradee ${tier.charAt(0).toUpperCase() + tier.slice(1)} subscription`,
      custom_int1: String(listing_id),
      custom_str1: tier,
      subscription_type: '1',
      billing_date: new Date().toISOString().slice(0, 10),
      recurring_amount: amount,
      frequency: '3', // 3 = monthly
      cycles: '0',     // 0 = until cancelled
    }
    // drop empty values
    for (const k of Object.keys(data)) if (!data[k]) delete data[k]

    let pfStr = Object.entries(data).map(([k, v]) => `${k}=${pfEncode(v)}`).join('&')
    if (PASSPHRASE) pfStr += `&passphrase=${pfEncode(PASSPHRASE)}`
    const signature = await md5hex(pfStr)

    const qs = Object.entries(data).map(([k, v]) => `${k}=${pfEncode(v)}`).join('&') + `&signature=${signature}`
    const url = `https://${PF_HOST}/eng/process?${qs}`
    return new Response(JSON.stringify({ url }), { headers: { ...cors, 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } })
  }
})
