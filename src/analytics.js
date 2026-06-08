import { supabase } from './supabaseClient.js'

export async function trackEvent(eventType, listingId = null, extra = {}) {
  try {
    await supabase.from('analytics_events').insert({
      listing_id: listingId,
      event_type: eventType,
      trade: extra.trade || null,
      province: extra.province || null,
    })
  } catch (e) {
    // Silent fail — never block the UI for analytics
  }
}
