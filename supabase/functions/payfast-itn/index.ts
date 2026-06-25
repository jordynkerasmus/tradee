// Receives PayFast's Instant Transaction Notification (ITN), verifies it, and
// upgrades the tradesman's tier on a completed payment.
// IMPORTANT: deploy this function with "Verify JWT" turned OFF (PayFast won't send a JWT).
// Secrets: PAYFAST_MODE, PAYFAST_PASSPHRASE (+ Supabase auto-provides URL/SERVICE_ROLE_KEY).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { crypto } from 'https://deno.land/std@0.224.0/crypto/mod.ts'

const MODE = Deno.env.get('PAYFAST_MODE') || 'sandbox'
const PASSPHRASE = Deno.env.get('PAYFAST_PASSPHRASE') || ''
const PF_HOST = MODE === 'live' ? 'www.payfast.co.za' : 'sandbox.payfast.co.za'
const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const PRICES: Record<string, string> = { verified: '149.00', premium: '249.00' }

function pfEncode(v: string) {
  return encodeURIComponent(v.trim()).replace(/%20/g, '+').replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
}
async function md5hex(s: string) {
  const buf = await crypto.subtle.digest('MD5', new TextEncoder().encode(s))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (req) => {
  try {
    const raw = await req.text()
    const params = new URLSearchParams(raw)
    const data: Record<string, string> = {}
    for (const [k, v] of params) data[k] = v

    // 1) Verify the signature (rebuild from posted fields in received order, minus signature)
    let sigStr = [...params.entries()].filter(([k]) => k !== 'signature').map(([k, v]) => `${k}=${pfEncode(v)}`).join('&')
    if (PASSPHRASE) sigStr += `&passphrase=${pfEncode(PASSPHRASE)}`
    const expected = await md5hex(sigStr)
    if (expected !== data.signature) { console.error('PayFast signature mismatch'); return new Response('invalid', { status: 400 }) }

    // 2) Confirm with PayFast's server that this notification is genuine
    const validate = await fetch(`https://${PF_HOST}/eng/query/validate`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: raw,
    })
    const validateText = (await validate.text()).trim()
    if (validateText !== 'VALID') { console.error('PayFast validate failed:', validateText); return new Response('invalid', { status: 400 }) }

    // 3) On a completed payment, grant the tier for ~1 month + grace
    if (data.payment_status === 'COMPLETE') {
      const listingId = data.custom_int1
      const tier = data.custom_str1

      // Cross-check amount — reject if it doesn't match the expected price for this tier
      if (!PRICES[tier] || data.amount_gross !== PRICES[tier]) {
        console.error(`PayFast amount mismatch: got ${data.amount_gross}, expected ${PRICES[tier]} for tier ${tier}`)
        return new Response('invalid', { status: 400 })
      }

      // Verify the listing ID embedded in m_payment_id matches custom_int1
      // m_payment_id format: ${listing_id}-${tier}-${timestamp}
      const paymentIdParts = (data.m_payment_id || '').split('-')
      if (paymentIdParts[0] !== String(listingId)) {
        console.error(`PayFast listing ID mismatch: m_payment_id prefix ${paymentIdParts[0]} vs custom_int1 ${listingId}`)
        return new Response('invalid', { status: 400 })
      }

      if (listingId) {
        const expires = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000).toISOString()
        await supabase.from('listings').update({ tier, tier_expires_at: expires, promo_verified: false, grace_warned_at: null }).eq('id', listingId)
        console.log(`PayFast: listing ${listingId} upgraded to ${tier} until ${expires}`)
      }
    }
    return new Response('OK')
  } catch (e) {
    console.error('PayFast ITN error:', e)
    return new Response('error', { status: 500 })
  }
})
