import { supabase } from './supabaseClient.js'
import { PROVINCE_CITIES, CITY_COORDS, PROVINCE_COORDS } from './cities.js'
import { trackEvent } from './analytics.js'
import { inject } from '@vercel/analytics'

// Vercel Web Analytics — tracks unique visitors, page views, traffic sources.
// View the numbers in Vercel Dashboard → Analytics (enable Web Analytics there once).
inject()

let listings = []
let currentProfile = null
let currentUser = null
let selectedTier = 'free'
const ADMIN_EMAILS = (import.meta.env.VITE_ADMIN_EMAIL || '').split(',').map(e => e.trim()).filter(Boolean)

// Storage buckets:
//  - BUCKET_PUBLIC holds profile photos & portfolio images (publicly readable).
//  - BUCKET_CERTS is PRIVATE and holds registration/certificate documents.
//    We store the object PATH (not a public URL) and mint short-lived signed
//    URLs on demand for the owner and admins only. See supabase/security-policies.sql.
const BUCKET_PUBLIC = 'certifications-registrations'
const BUCKET_CERTS = 'certifications'

// Open a private certificate via a freshly-minted signed URL.
// Legacy entries were stored as full public URLs — open those directly.
window.viewCert = async function (ref) {
  if (!ref) return
  if (/^https?:\/\//.test(ref)) { window.open(ref, '_blank'); return }
  const { data, error } = await supabase.storage.from(BUCKET_CERTS).createSignedUrl(ref, 3600)
  if (error || !data?.signedUrl) { toast('Could not open document — please try again.'); return }
  window.open(data.signedUrl, '_blank')
}
// Filename for display from a path or URL.
function certLabel(ref, i) { return `${(ref || '').toLowerCase().includes('.pdf') ? 'PDF' : 'IMG'} · Document ${i + 1}` }
let editTier = 'free'
let reviewingId = null
let filterTrade = '', filterProvince = '', filterCity = '', filterSort = 'rating', dirSearchTerm = ''
let selectedCities = []

// ── Auth ──────────────────────────────────────────────────────────────────────
async function initAuth() {
  const { data: { session } } = await supabase.auth.getSession()
  currentUser = session?.user ?? null
  updateNavForAuth()
  if (currentUser) syncFavsOnLogin()
  supabase.auth.onAuthStateChange((_event, session) => {
    const wasLoggedOut = !currentUser
    currentUser = session?.user ?? null
    updateNavForAuth()
    if (currentUser && wasLoggedOut) syncFavsOnLogin()
  })
}

function updateNavForAuth() {
  const authBtn = document.getElementById('nav-auth-btn')
  const dashBtn = document.getElementById('nav-dashboard-btn')
  if (!authBtn) return
  const adminLink = document.getElementById('nav-admin')
  const mobileAdmin = document.getElementById('nav-mobile-admin')
  if (currentUser) {
    authBtn.textContent = 'Log Out'
    authBtn.onclick = handleSignOut
    if (dashBtn) dashBtn.style.display = 'inline-flex'
    const isAdmin = ADMIN_EMAILS.includes(currentUser.email)
    if (adminLink) adminLink.style.display = isAdmin ? 'inline' : 'none'
    if (mobileAdmin) mobileAdmin.style.display = isAdmin ? 'block' : 'none'
  } else {
    authBtn.textContent = 'My Listing'
    authBtn.onclick = () => window.showPage('login')
    if (dashBtn) dashBtn.style.display = 'none'
    if (adminLink) adminLink.style.display = 'none'
    if (mobileAdmin) mobileAdmin.style.display = 'none'
  }
}

window.handleLogin = async function () {
  const email = document.getElementById('login-email').value.trim()
  const password = document.getElementById('login-password').value
  if (!email || !password) { toast('Please enter your email and password.'); return }
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) { toast('Login failed: ' + error.message); return }
  toast('Welcome back!')
  window.showPage('dashboard')
}

window.handleSignup = async function () {
  const email = document.getElementById('signup-email').value.trim()
  const password = document.getElementById('signup-password').value
  const password2 = document.getElementById('signup-password2').value
  const agreed = document.getElementById('signup-agree')?.checked
  if (!email || !password) { toast('Please fill in all fields.'); return }
  if (password !== password2) { toast('Passwords do not match.'); return }
  if (password.length < 6) { toast('Password must be at least 6 characters.'); return }
  if (!agreed) { toast('Please accept the disclaimer and terms to continue.'); return }
  const { data, error } = await supabase.auth.signUp({ email, password })
  if (error) { toast('Sign up failed: ' + error.message); return }
  // Send welcome email via Edge Function
  supabase.functions.invoke('welcome-email', { body: { email } }).catch(() => {})
  if (!data.session) {
    // Email confirmation is enabled in Supabase — user must verify before logging in
    toast('Account created! Check your email to confirm your address, then log in.')
    window.showPage('login')
  } else {
    toast('Account created! You can now list your business.')
    window.showPage('list')
  }
}

window.handleSignOut = async function () {
  await supabase.auth.signOut()
  toast('Logged out.')
  window.showPage('home')
}

window.handleForgotPassword = async function () {
  const email = document.getElementById('login-email').value.trim()
  if (!email) { toast('Enter your email address first.'); return }
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + '/reset-password'
  })
  if (error) { toast('Error: ' + error.message); return }
  toast('Password reset email sent — check your inbox!')
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
async function renderDashboard() {
  const el = document.getElementById('dashboard-content')
  if (!currentUser) {
    el.innerHTML = `<div class="empty-state"><h3>Not Logged In</h3><p><a onclick="showPage('login')" style="color:var(--amber);cursor:pointer;">Log in</a> to manage your listing.</p></div>`
    return
  }
  const { data: listing, error } = await supabase.from('listings').select('*, reviews(*)').eq('user_id', currentUser.id).single()
  if (error || !listing) {
    el.innerHTML = `<div class="empty-state"><h3>No Listing Found</h3><p>You haven't listed your business yet.</p><br><button class="btn btn-primary" onclick="showPage('list')">List Your Business →</button></div>`
    return
  }
  editTier = listing.tier

  let _dashListingId = listing.id
  let _dashCreatedAt = listing.created_at

  async function fetchStats(period) {
    let since
    if (period === '7d') since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    else if (period === '30d') since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    else if (period === '6m') since = new Date(Date.now() - 183 * 24 * 60 * 60 * 1000).toISOString()
    else since = _dashCreatedAt
    const { data: events } = await supabase.from('analytics_events').select('event_type').eq('listing_id', _dashListingId).gte('created_at', since)
    const ev = events || []
    return {
      views: ev.filter(e => e.event_type === 'profile_view').length,
      phoneCl: ev.filter(e => e.event_type === 'phone_click').length,
      waCl: ev.filter(e => e.event_type === 'whatsapp_click').length,
      emailCl: ev.filter(e => e.event_type === 'email_click').length,
    }
  }

  window.switchStatPeriod = async function(btn, period) {
    document.querySelectorAll('.stat-period-btn').forEach(b => b.classList.remove('active'))
    btn.classList.add('active')
    const label = { '7d': 'Last 7 Days', '30d': 'Last 30 Days', '6m': 'Last 6 Months', 'all': 'Since Sign Up' }
    document.getElementById('stat-period-label').textContent = label[period]
    const s = await fetchStats(period)
    document.getElementById('stat-views').textContent = s.views
    document.getElementById('stat-calls').textContent = s.phoneCl
    document.getElementById('stat-wa').textContent = s.waCl
    document.getElementById('stat-email').textContent = s.emailCl
  }

  const { views, phoneCl, waCl, emailCl } = await fetchStats('30d')

  const portfolio = listing.portfolio_photos || []
  const reviews = listing.reviews || []
  const rating = avgRating(listing)

  let health = 0
  if (listing.photo_url) health += 20
  if (listing.description && listing.description.length > 30) health += 15
  if (listing.phone) health += 10
  if (listing.email) health += 10
  if (listing.credentials && listing.credentials.length > 0) health += 10
  if (listing.years_experience > 0) health += 5
  if (reviews.length > 0) health += 20
  if (listing.tier !== 'free') health += 10
  if (portfolio.length > 0) health += 10
  const healthColor = health >= 80 ? '#22c55e' : '#F59E0B'
  const healthLabel = health >= 80 ? 'Excellent' : health >= 50 ? 'Good' : 'Needs Work'

  const tips = []
  if (!listing.photo_url) tips.push('Add a profile photo (+20pts)')
  if (!listing.description || listing.description.length <= 30) tips.push('Write a description (+15pts)')
  if (!listing.phone) tips.push('Add phone number (+10pts)')
  if (!listing.email) tips.push('Add email address (+10pts)')
  if (!listing.credentials || listing.credentials.length === 0) tips.push('Add credentials (+10pts)')
  if (portfolio.length === 0) tips.push('Upload portfolio photos (+10pts)')
  if (listing.tier === 'free') tips.push('Upgrade plan (+10pts)')

  const reviewsListHTML = reviews.length
    ? reviews.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).map(r => `
    <div style="background:var(--charcoal-2);border:1px solid var(--charcoal-3);border-radius:var(--radius);padding:1rem;margin-bottom:10px;">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:6px;">
        <div>
          <span style="font-weight:600;color:var(--white);">${escHtml(r.reviewer_name)}</span>
          <span style="font-size:12px;color:var(--charcoal-6);margin-left:8px;">${new Date(r.created_at).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
        </div>
        <div style="color:var(--amber);font-size:14px;">${'★'.repeat(r.stars)}${'☆'.repeat(5 - r.stars)}</div>
      </div>
      <p style="font-size:14px;color:var(--charcoal-7);margin:0 0 10px;">${escHtml(r.review_text)}</p>
      ${r.reply_text ? `
      <div style="background:var(--charcoal-3);border-left:3px solid var(--amber);border-radius:0 var(--radius) var(--radius) 0;padding:8px 12px;font-size:13px;color:var(--charcoal-7);">
        <div style="font-weight:600;color:var(--amber);font-size:11px;margin-bottom:4px;">YOUR REPLY</div>
        ${escHtml(r.reply_text)}
      </div>` : `
      <div id="reply-section-${r.id}">
        <button class="btn btn-outline btn-sm" onclick="showReplyForm(${r.id})">↩ Reply</button>
      </div>`}
    </div>`).join('')
    : '<p style="color:var(--charcoal-6);font-size:14px;">No reviews yet — share your profile link with past clients!</p>'

  const portfolioHTML = portfolio.length
    ? portfolio.map((p, i) => `
    <div style="position:relative;aspect-ratio:1;border-radius:var(--radius);overflow:hidden;background:var(--charcoal-3);">
      <img src="${escHtml(p.url)}" style="width:100%;height:100%;object-fit:cover;">
      ${p.caption ? `<div style="position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,0,0.65);padding:4px 8px;font-size:11px;color:#fff;">${escHtml(p.caption)}</div>` : ''}
      <button onclick="removePortfolioPhoto(${listing.id},${i})" style="position:absolute;top:4px;right:4px;background:rgba(0,0,0,0.7);border:none;color:#fff;border-radius:50%;width:22px;height:22px;font-size:16px;line-height:1;cursor:pointer;">×</button>
    </div>`).join('')
    : '<p style="color:var(--charcoal-6);font-size:14px;">No photos yet. Upload before/after shots and completed work to build client trust.</p>'

  const promoUntil = listing.tier_expires_at ? new Date(listing.tier_expires_at).toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' }) : ''
  const promoNote = (listing.promo_verified && listing.tier_expires_at) ? `
    <div style="background:linear-gradient(135deg,rgba(245,158,11,0.18),rgba(245,158,11,0.06));border:1.5px solid rgba(245,158,11,0.45);border-radius:var(--radius-lg);padding:14px 18px;margin-bottom:1.5rem;">
      <div style="font-family:'Bebas Neue',sans-serif;letter-spacing:0.04em;font-size:1.1rem;color:var(--amber);margin-bottom:2px;">Founding Member — Verified Free</div>
      ${listing.verified_approved
        ? `<div style="font-size:13px;color:var(--charcoal-6);">Your Verified badge is active until <strong style="color:var(--white);">${promoUntil}</strong>. We'll remind you by email before it ends.</div>`
        : `<div style="font-size:13px;color:var(--charcoal-6);">You're featured free until <strong style="color:var(--white);">${promoUntil}</strong>. To switch on your green <strong>Verified badge</strong>, upload your ID and credential documents below — our team will review them and activate it.</div>`}
    </div>` : ''

  // Payment-overdue banner: paid plan whose renewal date has lapsed (3-day grace before auto-downgrade).
  const isPaidTier = listing.tier === 'verified' || listing.tier === 'premium'
  const expiresMs = listing.tier_expires_at ? new Date(listing.tier_expires_at).getTime() : 0
  const overdue = isPaidTier && expiresMs && expiresMs < Date.now()
  const daysLeft = overdue ? Math.max(1, Math.ceil(3 - (Date.now() - expiresMs) / 86400000)) : 0
  const overdueBanner = overdue ? `
    <div style="background:linear-gradient(135deg,rgba(239,68,68,0.18),rgba(239,68,68,0.06));border:1.5px solid rgba(239,68,68,0.55);border-radius:var(--radius-lg);padding:14px 18px;margin-bottom:1.5rem;">
      <div style="font-family:'Bebas Neue',sans-serif;letter-spacing:0.04em;font-size:1.1rem;color:#EF4444;margin-bottom:4px;">⚠️ ${listing.promo_verified ? 'Your free period has ended' : 'Subscription payment overdue'}</div>
      <div style="font-size:13px;color:var(--charcoal-6);margin-bottom:12px;">${listing.promo_verified
        ? `Your founding-member free period has ended. Subscribe within <strong style="color:var(--white);">${daysLeft} day${daysLeft !== 1 ? 's' : ''}</strong> to keep your priority ranking and Verified badge — otherwise your listing moves to the free Standard plan.`
        : `We couldn't confirm your ${listing.tier === 'premium' ? 'Premium' : 'Verified'} payment. Please renew within <strong style="color:var(--white);">${daysLeft} day${daysLeft !== 1 ? 's' : ''}</strong> or your listing will move to the free Standard plan.`}</div>
      <button class="btn btn-primary" onclick="startCheckout(${listing.id},'${listing.tier}')" style="width:100%;">Renew ${listing.tier === 'premium' ? 'Premium' : 'Verified'} now →</button>
    </div>` : ''

  const planLabels = { free: 'Standard (Free)', verified: 'Verified', premium: 'Premium' }
  const upBtn = (t, price) => `<button class="btn btn-primary" onclick="startCheckout(${listing.id},'${t}')" style="flex:1;min-width:200px;">Upgrade to ${planLabels[t]} — R${price}/mo</button>`
  let upgrades = ''
  if (listing.tier === 'free') upgrades = upBtn('verified', '149') + upBtn('premium', '249')
  else if (listing.tier === 'verified') upgrades = upBtn('premium', '249')
  const planCard = `
    <div class="form-card" style="margin-bottom:1rem;">
      <h3 style="margin-bottom:1rem;">Your Plan</h3>
      <div style="font-size:14px;color:var(--charcoal-6);">Current plan: <strong style="color:var(--white);">${planLabels[listing.tier] || listing.tier}</strong>${(listing.promo_verified && listing.tier_expires_at) ? ` · founding offer until ${promoUntil}` : ''}</div>
      ${upgrades
        ? `<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:14px;">${upgrades}</div><div style="font-size:12px;color:var(--charcoal-6);margin-top:10px;">Secure payment via PayFast. Cancel anytime. Your Verified badge still requires document approval.</div>`
        : `<div style="font-size:13px;color:var(--charcoal-6);margin-top:8px;">You're on our top plan. 🎉</div>`}
    </div>`

  el.innerHTML = `
    ${overdueBanner}
    ${promoNote}
    <div class="profile-hero" style="margin-bottom:1.5rem;">
      <div style="position:relative;display:inline-block;">
        <div class="profile-avatar" id="dash-avatar">${listing.photo_url ? `<img src="${listing.photo_url}" style="width:100%;height:100%;object-fit:cover;border-radius:var(--radius);">` : initials(listing.name)}</div>
        <label for="dash-photo-input" style="position:absolute;bottom:-6px;right:-6px;background:var(--amber);border-radius:50%;width:26px;height:26px;display:flex;align-items:center;justify-content:center;cursor:pointer;" title="Change photo"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#1C1917" stroke-width="2.5" stroke-linecap="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg></label>
        <input type="file" id="dash-photo-input" accept=".jpg,.jpeg,.png" style="display:none;" onchange="window.updatePhoto(this, ${listing.id})">
      </div>
      <div style="flex:1;">
        <div class="profile-name">${escHtml(listing.name)}</div>
        ${listing.contact_name ? `<div style="font-size:14px;color:var(--charcoal-6);margin-bottom:4px;">Contact: ${escHtml(listing.contact_name)}</div>` : ''}
        <div class="profile-trade">${escHtml(listing.trade)}</div>
        ${tierBadge(listing) ? `<div class="card-badges" style="margin-top:6px;">${tierBadge(listing)}</div>` : ''}
        <div style="background:var(--charcoal-3);border:1px solid var(--charcoal-4);border-radius:var(--radius);padding:10px 14px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
          <span style="font-size:13px;color:var(--charcoal-6);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${profileUrl(listing)}</span>
          <button class="btn btn-primary btn-sm" onclick="copyProfileLink(${listing.id})">🔗 Copy Link</button>
        </div>
      </div>
    </div>

    <div class="form-card" style="margin-bottom:1rem;">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:1rem;">
        <h3 style="margin:0;" id="stat-period-label">Last 30 Days</h3>
        <div class="stat-period-row" style="display:flex;gap:6px;flex-wrap:wrap;">
          <button class="stat-period-btn" onclick="switchStatPeriod(this,'7d')">7 Days</button>
          <button class="stat-period-btn active" onclick="switchStatPeriod(this,'30d')">30 Days</button>
          <button class="stat-period-btn" onclick="switchStatPeriod(this,'6m')">6 Months</button>
          <button class="stat-period-btn" onclick="switchStatPeriod(this,'all')">Since Sign Up</button>
        </div>
      </div>
      <div class="dash-stats-grid" style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:10px;">
        <div style="background:var(--charcoal-3);border-radius:var(--radius);padding:14px;text-align:center;">
          <div id="stat-views" class="stat-num-lg" style="font-size:1.8rem;font-weight:700;color:var(--white);">${views}</div>
          <div style="font-size:11px;color:var(--charcoal-6);text-transform:uppercase;letter-spacing:0.05em;margin-top:2px;">Views</div>
        </div>
        <div style="background:var(--charcoal-3);border-radius:var(--radius);padding:14px;text-align:center;">
          <div id="stat-calls" class="stat-num-lg" style="font-size:1.8rem;font-weight:700;color:var(--white);">${phoneCl}</div>
          <div style="font-size:11px;color:var(--charcoal-6);text-transform:uppercase;letter-spacing:0.05em;margin-top:2px;">Calls</div>
        </div>
        <div style="background:var(--charcoal-3);border-radius:var(--radius);padding:14px;text-align:center;">
          <div id="stat-wa" class="stat-num-lg" style="font-size:1.8rem;font-weight:700;color:#25D366;">${waCl}</div>
          <div style="font-size:11px;color:var(--charcoal-6);text-transform:uppercase;letter-spacing:0.05em;margin-top:2px;">WhatsApp</div>
        </div>
        <div style="background:var(--charcoal-3);border-radius:var(--radius);padding:14px;text-align:center;">
          <div id="stat-email" class="stat-num-lg" style="font-size:1.8rem;font-weight:700;color:var(--amber);">${emailCl}</div>
          <div style="font-size:11px;color:var(--charcoal-6);text-transform:uppercase;letter-spacing:0.05em;margin-top:2px;">Email</div>
        </div>
      </div>
      <div style="background:var(--charcoal-3);border-radius:var(--radius);padding:14px;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
          <div style="flex:1;">
            <div style="font-size:11px;color:var(--charcoal-6);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">Listing Health — ${healthLabel}</div>
            <div style="background:var(--charcoal-4);border-radius:100px;height:6px;overflow:hidden;">
              <div style="background:${healthColor};height:100%;width:${health}%;border-radius:100px;"></div>
            </div>
          </div>
          <div style="font-size:1.5rem;font-weight:700;color:${healthColor};">${health}<span style="font-size:12px;">/100</span></div>
        </div>
        ${tips.length ? `<div style="margin-top:8px;font-size:12px;color:var(--charcoal-6);">${tips.map(t => '• ' + t).join(' &nbsp;')}</div>` : ''}
      </div>
    </div>

    ${planCard}

    <div class="form-card" style="margin-bottom:1rem;">
      <h3 style="margin-bottom:1rem;">Client Reviews (${reviews.length})</h3>
      ${reviews.length ? `<div style="display:flex;align-items:center;gap:12px;margin-bottom:1rem;background:var(--charcoal-3);border-radius:var(--radius);padding:14px;">
        <div style="font-size:2.5rem;font-weight:800;color:var(--amber);">${rating > 0 ? rating.toFixed(1) : '—'}</div>
        <div>
          <div style="font-size:18px;color:var(--amber);">${starsHTML(rating)}</div>
          <div style="font-size:12px;color:var(--charcoal-6);">${reviews.length} review${reviews.length !== 1 ? 's' : ''}</div>
        </div>
      </div>` : ''}
      <div id="dash-reviews-list">${reviewsListHTML}</div>
    </div>

    <div class="form-card" style="margin-bottom:1rem;">
      <h3 style="margin-bottom:0.5rem;">Portfolio Photos</h3>
      <p style="font-size:13px;color:var(--charcoal-6);margin-bottom:1rem;">Upload before/after shots and completed work. Max 10MB per photo.</p>
      <div style="border:2px dashed var(--charcoal-4);border-radius:var(--radius);padding:1.25rem;text-align:center;cursor:pointer;margin-bottom:1rem;" onclick="document.getElementById('portfolio-input').click()">
        <div style="font-size:14px;color:var(--charcoal-6);">Click to upload photos</div>
        <div style="font-size:12px;color:var(--charcoal-6);margin-top:4px;">JPG, PNG · Max 10MB each</div>
      </div>
      <input type="file" id="portfolio-input" multiple accept=".jpg,.jpeg,.png" style="display:none;" onchange="uploadPortfolioPhotos(this, ${listing.id})">
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px;">${portfolioHTML}</div>
    </div>

    <div class="form-card">
      <h3 style="cursor:pointer;display:flex;align-items:center;justify-content:space-between;user-select:none;" onclick="const ed=document.getElementById('edit-form-body');ed.style.display=ed.style.display==='none'?'block':'none'">Edit Your Details <span style="font-size:13px;color:var(--charcoal-6);">▼ expand</span></h3>
      <div id="edit-form-body" style="display:none;">
        <div class="form-row">
          <div class="form-group"><label class="form-label">Business Name</label><input class="form-input" id="edit-business" value="${escHtml(listing.name)}"></div>
          <div class="form-group"><label class="form-label">Contact Name</label><input class="form-input" id="edit-contact" value="${escHtml(listing.contact_name || '')}"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Phone Number</label><input class="form-input" id="edit-phone" value="${escHtml(listing.phone || '')}"></div>
          <div class="form-group"><label class="form-label">Email</label><input class="form-input" id="edit-email" type="email" value="${escHtml(listing.email || '')}"></div>
        </div>
        <div class="form-group">
          <label class="form-label">Profile Photo</label>
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px;">
            ${listing.photo_url ? `<img src="${listing.photo_url}" style="width:56px;height:56px;border-radius:var(--radius);object-fit:cover;">` : `<div style="width:56px;height:56px;border-radius:var(--radius);background:var(--charcoal-3);display:flex;align-items:center;justify-content:center;font-family:'Bebas Neue',sans-serif;font-size:1.4rem;color:var(--amber);">${escHtml(listing.name.slice(0,2).toUpperCase())}</div>`}
            <div style="border:2px dashed var(--charcoal-4);border-radius:var(--radius);padding:0.75rem 1rem;cursor:pointer;flex:1;text-align:center;" onclick="document.getElementById('edit-photo-input').click()">
              <div style="font-size:13px;color:var(--charcoal-6);">Upload new photo</div>
            </div>
          </div>
          <input type="file" id="edit-photo-input" accept=".jpg,.jpeg,.png" style="display:none;" onchange="previewEditPhoto(this)">
          <div id="edit-photo-preview" style="font-size:12px;color:var(--charcoal-6);"></div>
        </div>
        <div class="form-group">
          <label class="form-label">Trades</label>
          <div style="font-size:12px;color:var(--charcoal-6);margin-bottom:6px;">Currently: <span style="color:var(--amber);">${(listing.trades && listing.trades.length ? listing.trades : [listing.trade]).join(', ')}</span></div>
          <input class="form-input" id="edit-trades-text" value="${escHtml((listing.trades && listing.trades.length ? listing.trades : [listing.trade || '']).join(', '))}" placeholder="e.g. Plumber, Tiler, Waterproofing">
          <div class="form-hint">Separate multiple trades with commas</div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Province</label>
            <select class="form-input" id="edit-province">
              ${['Nationwide / All Provinces','Gauteng','Western Cape','KwaZulu-Natal','Eastern Cape','Limpopo','Mpumalanga','North West','Free State','Northern Cape'].map(p => `<option value="${p}" ${listing.province === p ? 'selected' : ''}>${p}</option>`).join('')}
            </select>
          </div>
          <div class="form-group"><label class="form-label">Primary City</label><input class="form-input" id="edit-city" value="${escHtml(listing.city || '')}"></div>
        </div>
        <div class="form-group">
          <label class="form-label">Your base town / address</label>
          <div style="display:flex;gap:8px;margin-bottom:8px;">
            <input id="edit-location-text" type="text" placeholder="e.g. Sandton, Johannesburg" class="form-input" style="flex:1;">
            <button type="button" class="btn btn-outline btn-sm" onclick="geocodeEditLocation()" style="white-space:nowrap;">Locate</button>
          </div>
          <div class="form-hint">Where you're based — used to place you on the map and show you to nearby clients.</div>
          <div id="edit-geocode-status" style="font-size:12px;color:var(--charcoal-6);margin-bottom:8px;">${listing.lat ? '✓ Location set' : 'No location set yet'}</div>
          <input type="hidden" id="edit-lat" value="${listing.lat || ''}">
          <input type="hidden" id="edit-lng" value="${listing.lng || ''}">
          <label class="form-label" style="margin-top:8px;">How far you'll travel — Service Radius: <span id="edit-radius-label" style="color:var(--amber);">${(listing.service_radius || 30) >= 500 ? '500+ km (nationwide)' : (listing.service_radius || 30) + ' km'}</span></label>
          <input id="edit-service-radius" type="range" min="5" max="500" value="${listing.service_radius || 30}" step="5" style="width:100%;accent-color:var(--amber);" oninput="document.getElementById('edit-radius-label').textContent=(this.value>=500?'500+ km (nationwide)':this.value+' km')">
          <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--charcoal-5);margin-top:2px;"><span>5 km</span><span>500+ km</span></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Call-out Fee (R)</label><input class="form-input" id="edit-callout" value="${listing.callout === -1 ? 'N/A' : listing.callout}" placeholder="e.g. 350 or N/A"></div>
          <div class="form-group">
            <label class="form-label">Rate (R)</label>
            <div style="display:flex;gap:12px;margin-bottom:8px;">
              <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--charcoal-6);cursor:pointer;"><input type="radio" name="edit-rate-type" value="hour" ${listing.rate_type !== 'day' ? 'checked' : ''} style="accent-color:var(--amber);"> Per Hour</label>
              <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--charcoal-6);cursor:pointer;"><input type="radio" name="edit-rate-type" value="day" ${listing.rate_type === 'day' ? 'checked' : ''} style="accent-color:var(--amber);"> Per Day</label>
            </div>
            <input class="form-input" id="edit-rate" value="${listing.rate === -1 ? 'N/A' : listing.rate}" placeholder="e.g. 650 or N/A">
          </div>
        </div>
        <div class="form-group"><label class="form-label">Business Description</label><textarea class="form-textarea" id="edit-desc">${escHtml(listing.description || '')}</textarea></div>
        <div class="form-group">
          <label style="display:flex;align-items:center;gap:10px;cursor:pointer;font-size:14px;color:var(--white);">
            <input type="checkbox" id="edit-emergency" ${listing.after_hours ? 'checked' : ''} style="accent-color:var(--amber);width:18px;height:18px;">
            Available for after-hours / emergency call-outs
          </label>
          <div class="form-hint">Shows an "After-hours" badge and helps you appear for urgent searches.</div>
        </div>
        <div class="form-group"><label class="form-label">Credentials</label><input class="form-input" id="edit-creds" value="${escHtml(listing.credentials ? listing.credentials.join(', ') : '')}"><div class="form-hint">Separate with commas</div></div>
        <div class="form-group"><label class="form-label">Years Experience</label><input class="form-input" id="edit-years" type="number" value="${listing.years_experience || 0}"></div>
        <div class="form-group">
          <label class="form-label">Upload New Certificates</label>
          <div style="border:2px dashed var(--charcoal-4);border-radius:var(--radius);padding:1.25rem;text-align:center;cursor:pointer;" onclick="document.getElementById('edit-cert-files').click()">
            <div style="font-size:14px;color:var(--charcoal-6);">Click to upload PDF, JPG or PNG</div>
          </div>
          <input type="file" id="edit-cert-files" multiple accept=".pdf,.jpg,.jpeg,.png" style="display:none;" onchange="previewEditCerts(this.files)">
          <div id="edit-cert-preview" style="margin-top:0.75rem;display:flex;flex-direction:column;gap:8px;"></div>
          ${listing.certificate_urls && listing.certificate_urls.length ? `
          <div style="margin-top:1rem;">
            <div style="font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:var(--charcoal-6);margin-bottom:8px;">Uploaded Documents <span style="font-weight:400;text-transform:none;letter-spacing:0;">(private — only you & Tradee can see these)</span></div>
            ${listing.certificate_urls.map((ref, i) => `
              <div style="display:flex;align-items:center;gap:10px;background:var(--charcoal-3);border-radius:var(--radius);padding:8px 12px;margin-bottom:6px;">
                <span style="font-size:18px;">${(ref || '').includes('.pdf') ? 'PDF' : 'IMG'}</span>
                <button type="button" onclick="viewCert('${escHtml(ref)}')" style="flex:1;text-align:left;background:none;border:none;cursor:pointer;font-size:13px;color:var(--amber);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">View Document ${i + 1} ↗</button>
              </div>`).join('')}
          </div>` : ''}
        </div>
        <button class="btn btn-primary" style="width:100%;padding:14px;font-size:15px;" onclick="saveListing(${listing.id})">Save Changes →</button>
      </div>
    </div>

    <div class="form-card">
      <h3>Subscription Plan</h3>
      <div style="font-size:13px;color:var(--charcoal-6);margin-bottom:1rem;">Your current plan is highlighted. To change plans, use the <strong style="color:var(--white);">“Your Plan”</strong> card at the top of your dashboard — paid plans are activated securely through PayFast. 🔒</div>
      <div class="tier-grid">
        <div class="tier-card ${listing.tier === 'free' ? 'selected' : ''}" style="opacity:${listing.tier === 'free' ? '1' : '0.55'};">
          <div class="tier-name">Standard</div><div class="tier-price">R0<span>/mo</span></div>
          <ul class="tier-features">
            <li><span class="tick">✓</span> Basic profile</li><li><span class="tick">✓</span> Client reviews</li>
            <li><span class="cross">✗</span> Priority ranking</li><li><span class="cross">✗</span> Verified badge</li><li><span class="cross">✗</span> Featured placement</li>
          </ul>
          ${listing.tier === 'free' ? '<div style="font-size:12px;color:var(--amber);font-weight:600;margin-top:8px;">Your current plan</div>' : ''}
        </div>
        <div class="tier-card featured ${listing.tier === 'verified' ? 'selected' : ''}" style="opacity:${listing.tier === 'verified' ? '1' : '0.55'};">
          <div class="popular-tag">Most Popular</div><div class="tier-name">Verified</div><div class="tier-price">R149<span>/mo</span></div>
          <ul class="tier-features">
            <li><span class="tick">✓</span> Basic profile</li><li><span class="tick">✓</span> Client reviews</li>
            <li><span class="tick">✓</span> Priority ranking</li><li><span class="tick">✓</span> Verified badge</li><li><span class="cross">✗</span> Featured placement</li>
          </ul>
          ${listing.tier === 'verified' ? '<div style="font-size:12px;color:var(--amber);font-weight:600;margin-top:8px;">Your current plan</div>' : ''}
        </div>
        <div class="tier-card ${listing.tier === 'premium' ? 'selected' : ''}" style="opacity:${listing.tier === 'premium' ? '1' : '0.55'};">
          <div class="tier-name">Premium</div><div class="tier-price">R249<span>/mo</span></div>
          <ul class="tier-features">
            <li><span class="tick">✓</span> Basic profile</li><li><span class="tick">✓</span> Client reviews</li>
            <li><span class="tick">✓</span> Priority ranking</li><li><span class="tick">✓</span> Verified badge</li><li><span class="tick">✓</span> Featured placement</li>
          </ul>
          ${listing.tier === 'premium' ? '<div style="font-size:12px;color:var(--amber);font-weight:600;margin-top:8px;">Your current plan</div>' : ''}
        </div>
      </div>
    </div>

    <div style="margin-top:1rem;text-align:center;">
      <button class="btn btn-outline btn-sm" style="color:var(--danger);border-color:var(--danger);" onclick="deleteListing(${listing.id})">Delete My Listing</button>
    </div>`
}

window.showReplyForm = function (reviewId) {
  const section = document.getElementById('reply-section-' + reviewId)
  if (!section) return
  section.innerHTML = `
    <textarea id="reply-text-${reviewId}" class="form-textarea" style="margin-top:8px;min-height:80px;" placeholder="Write your reply..."></textarea>
    <div style="display:flex;gap:8px;margin-top:8px;">
      <button class="btn btn-primary btn-sm" onclick="submitReply(${reviewId})">Submit Reply</button>
      <button class="btn btn-outline btn-sm" onclick="renderDashboard()">Cancel</button>
    </div>`
}

window.submitReply = async function (reviewId) {
  const text = document.getElementById('reply-text-' + reviewId)?.value.trim()
  if (!text) { toast('Please write a reply.'); return }
  const { error } = await supabase.from('reviews').update({ reply_text: text, reply_at: new Date().toISOString() }).eq('id', reviewId)
  if (error) { toast('Error saving reply.'); return }
  toast('Reply saved!')
  renderDashboard()
}

window.uploadPortfolioPhotos = async function (input, listingId) {
  const MAX = 10 * 1024 * 1024
  const files = Array.from(input.files).filter(f => {
    if (f.size > MAX) { toast(`${f.name} is over 10MB and was skipped.`); return false }
    return true
  })
  if (!files.length) return
  toast('Uploading photos...')
  const { data: existing } = await supabase.from('listings').select('portfolio_photos').eq('id', listingId).single()
  const portfolio = existing?.portfolio_photos || []
  for (const file of files) {
    const path = `${currentUser.id}/portfolio-${Date.now()}-${file.name}`
    const { error: uploadError } = await supabase.storage.from(BUCKET_PUBLIC).upload(path, file)
    if (!uploadError) {
      const { data: urlData } = supabase.storage.from(BUCKET_PUBLIC).getPublicUrl(path)
      portfolio.push({ url: urlData.publicUrl, caption: '' })
    }
  }
  await supabase.from('listings').update({ portfolio_photos: portfolio }).eq('id', listingId).eq('user_id', currentUser.id)
  toast('Photos uploaded!')
  await loadListings()
  renderDashboard()
}

window.removePortfolioPhoto = async function (listingId, index) {
  const { data: existing } = await supabase.from('listings').select('portfolio_photos').eq('id', listingId).single()
  const portfolio = existing?.portfolio_photos || []
  portfolio.splice(index, 1)
  await supabase.from('listings').update({ portfolio_photos: portfolio }).eq('id', listingId).eq('user_id', currentUser.id)
  toast('Photo removed.')
  await loadListings()
  renderDashboard()
}

window.selectEditTier = function (tier) {
  editTier = tier
  ;['free', 'verified', 'premium'].forEach(t => {
    document.getElementById('edit-tier-' + t)?.classList.toggle('selected', t === tier)
  })
}

window.updatePhoto = async function (input, id) {
  const file = input.files[0]
  if (!file) return
  if (file.size > 2 * 1024 * 1024) { toast('Photo must be under 2MB'); return }
  toast('Uploading photo...')
  const path = `${currentUser.id}/photo-${Date.now()}-${file.name}`
  const { error: uploadError } = await supabase.storage.from(BUCKET_PUBLIC).upload(path, file)
  if (uploadError) { toast('Upload failed: ' + uploadError.message); return }
  const { data: urlData } = supabase.storage.from(BUCKET_PUBLIC).getPublicUrl(path)
  const photo_url = urlData.publicUrl
  const { error } = await supabase.from('listings').update({ photo_url }).eq('id', id).eq('user_id', currentUser.id)
  if (error) { toast('Error saving photo'); return }
  toast('Photo updated!')
  await loadListings()
  renderDashboard()
}

window.toggleSameAsContact = function (cb) {
  const biz = document.getElementById('f-business')
  if (!biz) return
  if (cb.checked) {
    biz.value = document.getElementById('f-name').value.trim()
    biz.readOnly = true
    biz.style.opacity = '0.5'
    document.getElementById('f-name').oninput = () => { biz.value = document.getElementById('f-name').value.trim() }
  } else {
    biz.readOnly = false
    biz.style.opacity = '1'
    document.getElementById('f-name').oninput = null
  }
}

window.saveListing = async function (id) {
  const name = document.getElementById('edit-business').value.trim()
  const contact_name = document.getElementById('edit-contact').value.trim()
  const calloutRaw = document.getElementById('edit-callout').value.trim()
  const rateRaw = document.getElementById('edit-rate').value.trim()
  const callout = calloutRaw.toUpperCase() === 'N/A' ? -1 : (parseInt(calloutRaw) || 0)
  const rate = rateRaw.toUpperCase() === 'N/A' ? -1 : (parseInt(rateRaw) || 0)
  const rateTypeEl = document.querySelector('input[name="edit-rate-type"]:checked')
  const rate_type = rateTypeEl ? rateTypeEl.value : 'hour'
  const description = document.getElementById('edit-desc').value.trim()
  const credsRaw = document.getElementById('edit-creds').value.trim()
  const years_experience = parseInt(document.getElementById('edit-years').value) || 0
  const credentials = credsRaw ? credsRaw.split(',').map(c => c.trim()).filter(Boolean) : []

  // Upload any new certificates
  const newFiles = window.editCertFiles || []
  const { data: existing } = await supabase.from('listings').select('certificate_urls').eq('id', id).single()
  const certificate_urls = existing?.certificate_urls || []
  for (const file of newFiles) {
    const path = `${currentUser.id}/${Date.now()}-${file.name}`
    // Certificates go to the PRIVATE bucket; store the path, not a public URL.
    const { error: uploadError } = await supabase.storage.from(BUCKET_CERTS).upload(path, file)
    if (!uploadError) certificate_urls.push(path)
  }
  window.editCertFiles = []

  const phone = document.getElementById('edit-phone')?.value.trim() || ''
  const email = document.getElementById('edit-email')?.value.trim() || ''
  const lat = parseFloat(document.getElementById('edit-lat')?.value) || null
  const lng = parseFloat(document.getElementById('edit-lng')?.value) || null
  const service_radius = parseInt(document.getElementById('edit-service-radius')?.value) || 30
  const province = document.getElementById('edit-province')?.value || ''
  const city = document.getElementById('edit-city')?.value.trim() || ''
  const tradesRaw = document.getElementById('edit-trades-text')?.value || ''
  const trades = tradesRaw.split(',').map(t => t.trim()).filter(Boolean)
  const trade = trades[0] || ''

  // Upload new profile photo if selected
  let photo_url = undefined
  const newPhoto = window.editPhotoFile
  if (newPhoto) {
    const photoPath = `${currentUser.id}/photo-${Date.now()}-${newPhoto.name}`
    const { error: photoErr } = await supabase.storage.from(BUCKET_PUBLIC).upload(photoPath, newPhoto)
    if (!photoErr) {
      const { data: photoUrlData } = supabase.storage.from(BUCKET_PUBLIC).getPublicUrl(photoPath)
      photo_url = photoUrlData.publicUrl
    }
    window.editPhotoFile = null
  }

  const after_hours = !!document.getElementById('edit-emergency')?.checked
  // NOTE: tier is intentionally NOT set here. The plan can only be changed via the
  // PayFast checkout flow (or by an admin) — never by saving the edit form.
  const updateData = { name, contact_name, phone, email, trade, trades, province, city, callout, rate, rate_type, description, credentials, years_experience, certificate_urls, lat, lng, service_radius, after_hours }
  if (photo_url !== undefined) updateData.photo_url = photo_url

  const { error } = await supabase.from('listings').update(updateData).eq('id', id).eq('user_id', currentUser.id)
  if (error) { toast('Error saving: ' + error.message); return }
  toast('Listing updated!')
  await loadListings()
  renderDashboard()
}

window.previewEditPhoto = function (input) {
  const file = input.files[0]
  if (!file) return
  window.editPhotoFile = file
  const preview = document.getElementById('edit-photo-preview')
  if (preview) preview.textContent = `✓ Ready to upload: ${file.name}`
}

window.previewEditCerts = function (files) {
  window.editCertFiles = [...(window.editCertFiles || []), ...Array.from(files)]
  const el = document.getElementById('edit-cert-preview')
  if (!el) return
  el.innerHTML = (window.editCertFiles || []).map((f, i) => `
    <div style="display:flex;align-items:center;gap:10px;background:var(--charcoal-3);border-radius:var(--radius);padding:8px 12px;">
      <span>${f.type.includes('pdf') ? 'PDF' : 'IMG'}</span>
      <span style="flex:1;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${f.name}</span>
      <span style="font-size:12px;color:var(--charcoal-6);">${(f.size/1024/1024).toFixed(1)}MB</span>
    </div>`).join('')
}

window.deleteListing = async function (id) {
  if (!confirm('Are you sure you want to delete your listing? This cannot be undone.')) return
  const { error } = await supabase.from('listings').delete().eq('id', id).eq('user_id', currentUser.id)
  if (error) { toast('Error deleting listing.'); return }
  toast('Listing deleted.')
  await loadListings()
  window.showPage('home')
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function slugify(name, id) {
  const base = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return `${base}-${id}`
}
function profileUrl(listing) {
  return `${window.location.origin}/profile/${slugify(listing.name, listing.id)}`
}
function escHtml(str) {
  if (!str) return ''
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')
}
function starsHTML(n) { const f = Math.round(n); return '★'.repeat(f) + '☆'.repeat(5 - f) }
function initials(name) { return name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase() }
function fmtRand(n) { return n === -1 ? 'N/A' : n === 0 ? 'Free' : 'R' + n }
// The green Verified badge shows only once an admin has reviewed the tradesman's
// uploaded documents and approved them (verified_approved = true) — not just from
// being on a paid/founding tier. Accepts the listing object.
function tierBadge(l) {
  return (l && l.verified_approved) ? '<span class="badge badge-verified">Verified</span>' : ''
}
function afterHoursBadge(l) {
  return (l && l.after_hours) ? '<span class="badge badge-afterhours">After-hours</span>' : ''
}
// Combined badge row (Verified + After-hours) for cards.
function cardBadges(l) {
  const b = tierBadge(l) + afterHoursBadge(l)
  return b ? `<div class="card-badges">${b}</div>` : ''
}
function toast(msg) {
  const t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show')
  setTimeout(() => t.classList.remove('show'), 3000)
}
// Favourites live in an in-memory Set, mirrored to localStorage for anon/offline
// use, and synced to the `favourites` table in Supabase when logged in so they
// follow the user across devices.
const FAV_HEART_FILLED = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>'
const FAV_HEART_EMPTY = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>'

let _favs = new Set(JSON.parse(localStorage.getItem('tradee_favs') || '[]'))
function getFavs() { return [..._favs] }
function isFav(id) { return _favs.has(id) }
function persistFavsLocal() { localStorage.setItem('tradee_favs', JSON.stringify([..._favs])) }
function updateFavButton(id) {
  document.querySelectorAll(`.fav-btn[data-id="${id}"]`).forEach(btn => {
    btn.innerHTML = isFav(id) ? FAV_HEART_FILLED : FAV_HEART_EMPTY
    btn.style.color = isFav(id) ? 'var(--amber)' : 'var(--charcoal-6)'
  })
}

// On login: merge any locally-saved favourites up to the server, then adopt the
// server set as the source of truth (so favourites saved on another device appear).
async function syncFavsOnLogin() {
  if (!currentUser) return
  try {
    const { data } = await supabase.from('favourites').select('listing_id').eq('user_id', currentUser.id)
    const merged = new Set((data || []).map(r => r.listing_id))
    const localOnly = [..._favs].filter(id => !merged.has(id))
    if (localOnly.length) {
      await supabase.from('favourites').insert(localOnly.map(listing_id => ({ user_id: currentUser.id, listing_id })))
      localOnly.forEach(id => merged.add(id))
    }
    _favs = merged
    persistFavsLocal()
    document.querySelectorAll('.fav-btn[data-id]').forEach(btn => updateFavButton(Number(btn.dataset.id)))
  } catch (_) { /* offline / table missing — keep local favourites */ }
}

window.toggleFav = async function (id, e) {
  if (e) e.stopPropagation()
  const wasFav = _favs.has(id)
  if (wasFav) _favs.delete(id); else _favs.add(id)
  persistFavsLocal()
  updateFavButton(id)
  if (currentUser) {
    try {
      if (wasFav) await supabase.from('favourites').delete().eq('user_id', currentUser.id).eq('listing_id', id)
      else await supabase.from('favourites').insert({ user_id: currentUser.id, listing_id: id })
    } catch (_) { /* best-effort; localStorage still holds the change */ }
  }
}
function avgRating(l) {
  if (l.rating_avg && l.rating_avg > 0) return parseFloat(l.rating_avg)
  if (l.reviews && l.reviews.length) return l.reviews.reduce((s, r) => s + r.stars, 0) / l.reviews.length
  return 0
}

// ── Data loading ─────────────────────────────────────────────────────────────
async function loadListings() {
  const { data, error } = await supabase
    .from('listings')
    .select('*, reviews(*)')
    .order('created_at', { ascending: false })
  if (error) { console.error(error); return }
  listings = data || []
  renderHome()
  populateTradeFilter()
  renderRankings()
}

// ── FAQ tabs ──────────────────────────────────────────────────────────────────
window.showFaqTab = function (which) {
  const trades = document.getElementById('faq-trades')
  const clients = document.getElementById('faq-clients')
  if (!trades || !clients) return
  const showTrades = which === 'trades'
  trades.style.display = showTrades ? 'block' : 'none'
  clients.style.display = showTrades ? 'none' : 'block'
  document.getElementById('faq-tab-trades').classList.toggle('active', showTrades)
  document.getElementById('faq-tab-clients').classList.toggle('active', !showTrades)
}

// ── Navigation ────────────────────────────────────────────────────────────────
window.showPage = function (name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'))
  document.getElementById('page-' + name).classList.add('active')
  document.querySelectorAll('.nav-links a').forEach(a => a.classList.remove('active'))
  const el = document.getElementById('nav-' + name)
  if (el) el.classList.add('active')
  window.scrollTo(0, 0)
  if (name === 'home') renderHome()
  if (name === 'directory') renderDirectory()
  if (name === 'rankings') renderRankings()
  if (name === 'dashboard') renderDashboard()
  if (name === 'admin') renderAdmin()
  if (name === 'list') {
    const s1 = document.getElementById('list-step-1')
    const s2 = document.getElementById('list-step-2')
    if (s1) s1.style.display = 'block'
    if (s2) s2.style.display = 'none'
    updatePromoBanner()
  }
}

// Founding-member offer: show a live "spots left" banner on the list page
// while fewer than 100 tradesmen have claimed the free 6-month Verified deal.
const PROMO_LIMIT = 100
async function updatePromoBanner() {
  const banner = document.getElementById('promo-banner')
  const spotsEl = document.getElementById('promo-spots')
  if (!banner || !spotsEl) return
  try {
    const { count } = await supabase.from('listings').select('id', { count: 'exact', head: true }).eq('promo_verified', true)
    const left = PROMO_LIMIT - (count || 0)
    if (left > 0) {
      spotsEl.textContent = `Only ${left} of ${PROMO_LIMIT} free spots left — claim yours now.`
      banner.style.display = 'block'
    } else {
      banner.style.display = 'none'
    }
  } catch (_) { banner.style.display = 'none' }
}

// ── Home ──────────────────────────────────────────────────────────────────────
function renderHome() {
  const total = listings.length
  const totalReviews = listings.reduce((s, l) => s + (l.reviews ? l.reviews.length : 0), 0)
  const totalTrades = [...new Set(listings.map(l => l.trade))].length
  document.getElementById('home-stats').innerHTML = `
    <div class="stat-item"><span class="stat-num">${total}</span><span class="stat-label">Tradesmen Listed</span></div>
    <div class="stat-item"><span class="stat-num">${totalTrades || 0}</span><span class="stat-label">Trade Categories</span></div>
    <div class="stat-item"><span class="stat-num">${totalReviews}</span><span class="stat-label">Verified Reviews</span></div>
    <div class="stat-item"><span class="stat-num">9</span><span class="stat-label">Provinces Covered</span></div>`
  const allTrades = [...new Set(listings.map(l => l.trade))].sort()
  document.getElementById('trade-cats').innerHTML = allTrades.map(t =>
    `<div class="trade-pill" data-trade="${escHtml(t)}">${escHtml(t)}</div>`).join('')
  document.getElementById('trade-cats').querySelectorAll('.trade-pill').forEach(el =>
    el.addEventListener('click', () => window.filterByTrade(el.dataset.trade)))
  const allPremiumHome = listings.filter(l => l.tier === 'premium')
  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000)
  const offset = allPremiumHome.length > 0 ? dayOfYear % allPremiumHome.length : 0
  const rotatedPremium = [...allPremiumHome.slice(offset), ...allPremiumHome.slice(0, offset)]
  const featured = rotatedPremium.slice(0, 3).concat(listings.filter(l => l.tier === 'verified').slice(0, 3)).slice(0, 6)
  document.getElementById('home-cards').innerHTML = featured.length
    ? featured.map(l => l.tier === 'premium' ? featuredCardHTML(l) : cardHTML(l)).join('')
    : '<div class="empty-state" style="grid-column:1/-1"><h3>No Listings Yet</h3><p>Be the first to <a onclick="showPage(\'list\')" style="color:var(--amber);cursor:pointer;">list your business</a>!</p></div>'
}

window.filterByTrade = function (trade) { _smartMode = false; filterTrade = trade; document.getElementById('filter-trade').value = trade; showPage('directory') }
window.updateHeroTrades = function () {
  const cat = document.getElementById('hero-category').value
  const tradeSelect = document.getElementById('hero-search')
  tradeSelect.innerHTML = '<option value="">All Trades</option>'
  const trades = cat ? TRADE_CATEGORIES[cat] : Object.values(TRADE_CATEGORIES).flat()
  trades.forEach(t => tradeSelect.add(new Option(t, t)))
}
window.updateFilterTrades = function () {
  const cat = document.getElementById('filter-category').value
  const tradeSelect = document.getElementById('filter-trade')
  if (cat) {
    tradeSelect.innerHTML = '<option value="">All Trades</option>'
    TRADE_CATEGORIES[cat].forEach(t => tradeSelect.add(new Option(t, t)))
  } else {
    tradeSelect.innerHTML = '<option value="">All Trades</option>' + buildTradeOptgroups()
  }
  tradeSelect.value = ''
  window.applyFilters()
}
window.heroSearch = function () {
  _smartMode = false
  filterTrade = document.getElementById('hero-search').value
  filterProvince = document.getElementById('hero-province').value
  filterCity = document.getElementById('hero-city')?.value || ''
  document.getElementById('filter-province').value = filterProvince
  window.showPage('directory')
}

// ── SMART SEARCH (keyword-based, no API key — upgradeable to AI later) ──────────
const TRADE_SYNONYMS = {
  'plumber':'Plumber','plumbing':'Plumber','pipe':'Plumber','pipes':'Plumber','leak':'Plumber','leaking':'Plumber','burst':'Plumber','drain':'Plumber','blocked drain':'Plumber','tap':'Plumber','toilet':'Plumber','blocked':'Plumber',
  'geyser':'Geyser & Hot Water','hot water':'Geyser & Hot Water',
  'gas':'Gas Fitter','gas fitter':'Gas Fitter',
  'aircon':'Air Conditioning & HVAC','air con':'Air Conditioning & HVAC','air conditioning':'Air Conditioning & HVAC','a/c':'Air Conditioning & HVAC','hvac':'Air Conditioning & HVAC','cooling':'Air Conditioning & HVAC',
  'pool':'Pool Service','borehole':'Borehole & Water','irrigation':'Irrigation & Sprinklers','sprinkler':'Irrigation & Sprinklers',
  'electrician':'Electrician','electrical':'Electrician','sparky':'Electrician','wiring':'Electrician','plug':'Electrician','db board':'Electrician','power':'Electrician','lights':'Electrician','lighting':'Electrician',
  'solar':'Solar Panel Installer','inverter':'Solar Panel Installer','pv':'Solar Panel Installer',
  'generator':'Generator Installer','genny':'Generator Installer',
  'cctv':'CCTV Installer','camera':'CCTV Installer','cameras':'CCTV Installer',
  'alarm':'Alarm & Security Systems','security':'Alarm & Security Systems',
  'gate motor':'Electric Gate & Intercom','gate':'Electric Gate & Intercom','intercom':'Electric Gate & Intercom',
  'ev charger':'EV Charger Installer',
  'builder':'Builder / General Contractor','building':'Builder / General Contractor','contractor':'Builder / General Contractor','construction':'Builder / General Contractor','renovation':'Builder / General Contractor','renovate':'Builder / General Contractor','extension':'Builder / General Contractor',
  'carpenter':'Carpenter','carpentry':'Carpenter',
  'tiler':'Tiler','tiling':'Tiler','tiles':'Tiler',
  'roofer':'Roofer','roof':'Roofer','roofing':'Roofer',
  'painter':'Painter','painting':'Painter','paint':'Painter',
  'plasterer':'Plasterer','plaster':'Plasterer',
  'bricklayer':'Bricklayer','brickwork':'Bricklayer',
  'damp':'Damp Proofing','waterproofing':'Waterproofing','waterproof':'Waterproofing',
  'ceiling':'Ceiling & Partitioning','glazier':'Glazier','glass':'Glazier','window':'Glazier',
  'fence':'Fencer','fencing':'Fencer','concrete':'Concrete Contractor',
  'flooring':'Flooring Installer','laminate':'Flooring Installer','vinyl':'Flooring Installer','architect':'Architect',
  'kitchen':'Kitchen Fitter','cupboards':'Kitchen Fitter',
  'interior designer':'Interior Designer','interior design':'Interior Designer','decor':'Interior Designer',
  'curtains':'Curtains & Blinds','blinds':'Curtains & Blinds',
  'wardrobe':'Wardrobe & Built-ins','built-in':'Wardrobe & Built-ins','built in':'Wardrobe & Built-ins',
  'wallpaper':'Wallpaper Installer','upholstery':'Upholsterer','upholster':'Upholsterer',
  'landscaper':'Landscaper','landscaping':'Landscaper','garden':'Landscaper',
  'lawn':'Lawn Care','grass':'Lawn Care',
  'tree feller':'Arborist / Tree Feller','tree':'Arborist / Tree Feller','arborist':'Arborist / Tree Feller',
  'paving':'Paving & Driveways','driveway':'Paving & Driveways',
  'pest':'Pest Control','pests':'Pest Control','fumigation':'Pest Control',
  'pressure washing':'Pressure Washing','pressure wash':'Pressure Washing','skip':'Skip Hire',
  'mobile mechanic':'Mobile Mechanic','mechanic':'Mobile Mechanic','auto electrician':'Auto Electrician',
  'panel beater':'Auto Panel Beater','panelbeater':'Auto Panel Beater','dent':'Auto Panel Beater',
  'tow':'Tow Truck','towing':'Tow Truck','tyre':'Tyre Fitting','tyres':'Tyre Fitting','tire':'Tyre Fitting',
  'windscreen':'Windscreen Repair','roadworthy':'Roadworthy & Inspection','car detail':'Car Detailer','detailing':'Car Detailer',
  'handyman':'Handyman','odd jobs':'Handyman','small jobs':'Handyman',
  'locksmith':'Locksmith','locked out':'Locksmith','lock':'Locksmith','keys':'Locksmith',
  'appliance':'Appliance Repair','fridge':'Appliance Repair','washing machine':'Appliance Repair','dishwasher':'Appliance Repair','stove':'Appliance Repair','oven repair':'Appliance Repair',
  'welder':'Welder & Fabrication','welding':'Welder & Fabrication',
  'moving':'Moving & Removals','removals':'Moving & Removals','movers':'Moving & Removals',
  'carpet cleaning':'Carpet Cleaning','carpet':'Carpet Cleaning',
  'window cleaning':'Window Cleaning','office cleaning':'Office Cleaning',
  'rubbish':'Rubbish Removal','junk':'Rubbish Removal','oven cleaning':'Oven Cleaning',
  'domestic':'Domestic Cleaner','maid':'Domestic Cleaner','housekeeper':'Housekeeper','cleaner':'Domestic Cleaner','cleaning':'Deep Cleaning',
}

let _smartMode = false, _smartRanked = [], _smartQuery = '', _smartInterp = ''

function runSmartSearch(query, all) {
  const q = query.toLowerCase()
  const targetTrades = new Set()
  Object.keys(TRADE_SYNONYMS).sort((a, b) => b.length - a.length).forEach(k => { if (q.includes(k)) targetTrades.add(TRADE_SYNONYMS[k]) })
  TRADES_LIST.forEach(t => { if (q.includes(t.toLowerCase())) targetTrades.add(t) })
  let province = '', city = ''
  Object.keys(PROVINCE_CITIES).forEach(p => { if (q.includes(p.toLowerCase())) province = p })
  Object.entries(PROVINCE_CITIES).forEach(([p, cities]) => { cities.forEach(c => { const bare = c.toLowerCase(); const stripped = bare.replace(/\s*\(.*\)/, ''); if (q.includes(stripped) || q.includes(bare)) { city = c; if (!province) province = p } }) })
  const emergency = /(emergency|urgent|asap|24\/7|24 7|24hr|24 hour|after hour|after-hour|tonight|right now|same day|immediately)/.test(q)
  const affordable = /(cheap|afford|budget|low cost|inexpensive|best price|reasonable|quote)/.test(q)
  const topRated = /(best|top|reliable|trusted|highly rated|good review|recommended|quality|professional)/.test(q)
  const words = q.split(/\W+/).filter(w => w.length > 3)

  const ranked = all.map(l => {
    let score = 0; const reasons = []
    const lTrades = (l.trades && l.trades.length ? l.trades : [l.trade]).filter(Boolean)
    if (targetTrades.size) {
      const m = lTrades.find(t => targetTrades.has(t))
      if (m) { score += 60; reasons.push(m) }
      else if (lTrades.some(t => words.some(w => t.toLowerCase().includes(w)))) score += 15
    }
    if (city && (l.city === city || (l.cities || []).includes(city))) { score += 35; reasons.push(city) }
    else if (province && l.province === province) { score += 20; if (!city) reasons.push(province) }
    else if (city || province) score -= 12
    const hay = (l.name + ' ' + (l.description || '') + ' ' + lTrades.join(' ')).toLowerCase()
    words.forEach(w => { if (hay.includes(w)) score += 3 })
    const r = avgRating(l)
    score += r * 4
    if (l.tier === 'premium') score += 6; else if (l.tier === 'verified') score += 3
    if (emergency && l.after_hours) { score += 25; reasons.push('After-hours') }
    else if (emergency && /(emergency|24|after hour|same day|urgent)/.test(hay)) { score += 18; reasons.push('Emergency') }
    if (topRated && r >= 4.5) score += 12
    if (affordable && l.callout >= 0) score += Math.max(0, 12 - l.callout / 100)
    return { l, score, reasons: [...new Set(reasons)] }
  })

  const hasCriteria = targetTrades.size || city || province
  let filtered = hasCriteria ? ranked.filter(x => x.score >= 20) : ranked
  if (hasCriteria && !filtered.length) filtered = ranked.filter(x => x.score > 0)
  filtered.sort((a, b) => b.score - a.score)

  const parts = []
  if (targetTrades.size) parts.push([...targetTrades].slice(0, 3).join(', '))
  if (city) parts.push('in ' + city); else if (province) parts.push('in ' + province)
  if (emergency) parts.push('available for emergencies')
  if (affordable) parts.push('budget-friendly')
  if (topRated) parts.push('highly rated')
  return { ranked: filtered.slice(0, 30), interp: parts.length ? parts.join(' · ') : 'best overall matches' }
}

// Works from any smart-search box (home, directory, rankings). `el` is the button
// or input that triggered it; we read the query from the input in the same box.
window.smartSearch = function (el) {
  let input = null
  if (el && el.closest) input = el.closest('.smart-search')?.querySelector('.smart-q-input')
  if (!input) input = document.querySelector('.smart-q-input')
  const q = (input?.value || '').trim()
  if (!q) return
  const res = runSmartSearch(q, listings)
  _smartMode = true; _smartRanked = res.ranked; _smartQuery = q; _smartInterp = res.interp
  // mirror the query into every box so it shows consistently
  document.querySelectorAll('.smart-q-input').forEach(i => { i.value = q })
  window.showPage('directory')
}

window.clearSmartSearch = function () {
  _smartMode = false; _smartRanked = []; _smartQuery = ''
  document.querySelectorAll('.smart-q-input').forEach(i => { i.value = '' })
  renderDirectory()
}

// PayFast checkout: ask the edge function for a signed payment link, then redirect.
window.startCheckout = async function (listingId, tier) {
  toast('Taking you to secure checkout…')
  try {
    const { data, error } = await supabase.functions.invoke('payfast-checkout', { body: { listing_id: listingId, tier, email: currentUser?.email } })
    if (error || !data?.url) { toast('Could not start checkout — please try again.'); return }
    window.location.href = data.url
  } catch (e) { toast('Could not start checkout — please try again.') }
}

function renderSmartResults() {
  document.getElementById('dir-title').textContent = `Results for "${_smartQuery}"`
  document.getElementById('dir-count').textContent = `${_smartRanked.length} match${_smartRanked.length !== 1 ? 'es' : ''}`
  let html = `<div style="grid-column:1/-1;background:rgba(245,158,11,0.06);border:1px solid rgba(245,158,11,0.25);border-radius:var(--radius);padding:14px 16px;margin-bottom:0.5rem;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
    <div style="font-size:13px;color:var(--charcoal-6);"><span style="color:var(--amber);font-weight:600;">Smart match:</span> ${escHtml(_smartInterp)}</div>
    <button class="btn btn-outline btn-sm" onclick="clearSmartSearch()">Clear search</button>
  </div>`
  if (!_smartRanked.length) {
    html += `<div class="empty-state" style="grid-column:1/-1"><h3>No matches found</h3><p>Try rephrasing, or <a onclick="clearSmartSearch()" style="color:var(--amber);cursor:pointer;">browse all tradesmen</a>.</p></div>`
  } else {
    html += _smartRanked.map(x => cardHTML(x.l)).join('')
  }
  document.getElementById('dir-cards').innerHTML = html
  _smartRanked.forEach(x => trackEvent('search_impression', x.l.id, { trade: x.l.trade, smart: true }))
}

window.updateHeroCities = function () {
  const province = document.getElementById('hero-province').value
  const citySelect = document.getElementById('hero-city')
  if (!citySelect) return
  citySelect.innerHTML = '<option value="">All Cities</option>'
  if (province && PROVINCE_CITIES[province]) {
    PROVINCE_CITIES[province].forEach(c => {
      citySelect.innerHTML += `<option value="${c}">${c}</option>`
    })
  }
}

window.photoFile = null
window.previewPhoto = function (input) {
  const file = input.files[0]
  if (!file) return
  if (file.size > 2 * 1024 * 1024) { toast('Photo must be under 2MB'); input.value = ''; return }
  window.photoFile = file
  const reader = new FileReader()
  reader.onload = e => {
    const preview = document.getElementById('photo-preview')
    preview.innerHTML = `<img src="${e.target.result}" style="width:100%;height:100%;object-fit:cover;border-radius:var(--radius);">`
  }
  reader.readAsDataURL(file)
}

window.toggleCityDropdown = function () {
  const dd = document.getElementById('f-city-dropdown')
  const province = document.getElementById('f-province')?.value || ''
  if (dd.style.display === 'none') {
    renderCityList(province)
    dd.style.display = 'block'
    document.getElementById('f-city-trigger').style.borderColor = 'var(--amber)'
    setTimeout(() => document.addEventListener('click', closeCityDropdownOutside), 0)
  } else {
    dd.style.display = 'none'
    document.getElementById('f-city-trigger').style.borderColor = 'var(--charcoal-4)'
  }
}

function closeCityDropdownOutside(e) {
  const wrap = document.getElementById('f-city-wrap')
  if (wrap && !wrap.contains(e.target)) {
    document.getElementById('f-city-dropdown').style.display = 'none'
    document.getElementById('f-city-trigger').style.borderColor = 'var(--charcoal-4)'
    document.removeEventListener('click', closeCityDropdownOutside)
  }
}

function renderCityList(province) {
  const list = document.getElementById('f-city-list')
  if (!list) return
  const baseCities = province && PROVINCE_CITIES[province] ? PROVINCE_CITIES[province] : Object.values(PROVINCE_CITIES).flat().sort()
  // Merge in any custom cities the user added
  const customCities = selectedCities.filter(c => !baseCities.includes(c))
  const allCities = [...baseCities, ...customCities]
  list.innerHTML = allCities.map(c => `
    <label style="display:flex;align-items:center;gap:10px;padding:7px 8px;border-radius:4px;cursor:pointer;font-size:14px;transition:background 0.1s;" onmouseover="this.style.background='var(--charcoal-3)'" onmouseout="this.style.background='transparent'">
      <input type="checkbox" value="${c}" ${selectedCities.includes(c) ? 'checked' : ''} onchange="window.toggleCity('${c}')" style="accent-color:var(--amber);width:16px;height:16px;">
      ${c}${!baseCities.includes(c) ? ' <span style="font-size:10px;color:var(--amber);margin-left:4px;">(custom)</span>' : ''}
    </label>`).join('') + `
  <div style="border-top:1px solid var(--charcoal-3);margin-top:6px;padding-top:6px;">
    <div style="display:flex;gap:6px;padding:4px 8px;">
      <input id="f-city-new-input" type="text" placeholder="Add a town / city…" style="flex:1;background:var(--charcoal-3);border:1px solid var(--charcoal-4);color:var(--white);font-family:'DM Sans',sans-serif;font-size:13px;padding:7px 10px;border-radius:var(--radius);outline:none;" onkeydown="if(event.key==='Enter'){event.preventDefault();window.addCustomCity()}" onfocus="this.style.borderColor='var(--amber)'" onblur="this.style.borderColor='var(--charcoal-4)'">
      <button onclick="window.addCustomCity()" style="background:var(--amber);color:var(--charcoal);border:none;border-radius:var(--radius);padding:7px 12px;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;">＋ Add</button>
    </div>
  </div>`
}

window.toggleCity = function (city) {
  if (selectedCities.includes(city)) {
    selectedCities = selectedCities.filter(c => c !== city)
  } else {
    selectedCities.push(city)
  }
  updateCityLabel()
}

window.addCustomCity = function () {
  const input = document.getElementById('f-city-new-input')
  if (!input) return
  const city = input.value.trim()
  if (!city) return
  if (!selectedCities.includes(city)) {
    selectedCities.push(city)
    // Also add to hero city dropdown so it's searchable
    addCityToHeroDropdown(city)
  }
  input.value = ''
  updateCityLabel()
  const province = document.getElementById('f-province')?.value || ''
  renderCityList(province)
}

function addCityToHeroDropdown(city) {
  const heroCity = document.getElementById('hero-city')
  if (!heroCity) return
  if (![...heroCity.options].some(o => o.value === city)) {
    const opt = new Option(city, city)
    heroCity.appendChild(opt)
  }
  // Also add to directory city filter if it exists
  const dirCity = document.getElementById('filter-city')
  if (dirCity && ![...dirCity.options].some(o => o.value === city)) {
    dirCity.appendChild(new Option(city, city))
  }
}

function updateCityLabel() {
  const label = document.getElementById('f-city-label')
  if (!label) return
  if (selectedCities.length === 0) {
    label.textContent = 'Select cities / areas…'
    label.style.color = 'var(--charcoal-6)'
  } else if (selectedCities.length <= 2) {
    label.textContent = selectedCities.join(', ')
    label.style.color = 'var(--white)'
  } else {
    label.textContent = `${selectedCities[0]}, ${selectedCities[1]} +${selectedCities.length - 2} more`
    label.style.color = 'var(--white)'
  }
}

document.addEventListener('change', e => {
  if (e.target && e.target.id === 'f-province') {
    selectedCities = []
    updateCityLabel()
    const dd = document.getElementById('f-city-dropdown')
    if (dd && dd.style.display !== 'none') renderCityList(e.target.value)
  }
})

// ── Directory ─────────────────────────────────────────────────────────────────
function buildTradeOptgroups() {
  return Object.entries(TRADE_CATEGORIES).map(([cat, trades]) =>
    `<optgroup label="${cat}">${trades.map(t => `<option value="${t}">${t}</option>`).join('')}</optgroup>`
  ).join('')
}
function populateCategorySelects() {
  const cats = Object.keys(TRADE_CATEGORIES)
  ;['hero-category', 'filter-category', 'f-trade-category'].forEach(id => {
    const el = document.getElementById(id)
    if (!el) return
    el.innerHTML = '<option value="">All Categories</option>'
    cats.forEach(cat => el.add(new Option(cat, cat)))
  })
}
function populateTradeFilter() {
  populateCategorySelects()
  const groups = buildTradeOptgroups()
  const base = '<option value="">All Trades</option>'
  ;['filter-trade', 'rank-trade-filter'].forEach(id => {
    const el = document.getElementById(id)
    if (el) el.innerHTML = base + groups
  })
  document.getElementById('filter-trade').value = filterTrade
  window.updateHeroTrades()
}

window.applyFilters = function () {
  _smartMode = false
  filterTrade = document.getElementById('filter-trade').value
  filterProvince = document.getElementById('filter-province').value
  filterSort = document.getElementById('filter-sort').value
  renderDirectory()
}

// ── MAP VIEW ────────────────────────────────────────────
let _map = null
let _dirView = 'list'

window.setDirView = function (view) {
  _dirView = view
  document.getElementById('btn-list-view').classList.toggle('active', view === 'list')
  document.getElementById('btn-map-view').classList.toggle('active', view === 'map')
  document.getElementById('dir-cards').style.display = view === 'list' ? '' : 'none'
  document.getElementById('map-container').style.display = view === 'map' ? 'block' : 'none'
  if (view === 'map') renderMap()
}

function renderMap() {
  if (typeof L === 'undefined') return
  const container = document.getElementById('map-container')
  if (!container) return

  if (!_map) {
    _map = L.map('map-container', { zoomControl: true }).setView([-28.4793, 24.6727], 6)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      attribution: '© OpenStreetMap © CARTO',
      maxZoom: 18,
    }).addTo(_map)
  }

  _map.eachLayer(l => { if (l instanceof L.Marker || l instanceof L.Circle) _map.removeLayer(l) })

  const icon = L.divIcon({
    className: '',
    html: '<div style="background:#F59E0B;width:14px;height:14px;border-radius:50%;border:2px solid #1C1917;box-shadow:0 0 6px rgba(245,158,11,0.6);"></div>',
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  })

  let placed = 0
  listings.forEach(l => {
    const c = listingCoords(l)
    if (!c) return
    placed++
    const radius = (l.service_radius || 30) * 1000
    L.circle(c, { radius, color: '#F59E0B', fillColor: '#F59E0B', fillOpacity: 0.08, weight: 1 }).addTo(_map)
    const allTrades = l.trades && l.trades.length ? l.trades : (l.trade ? [l.trade] : ['Tradesman'])
    const marker = L.marker(c, { icon }).addTo(_map)
    marker.bindPopup(`
      <div class="map-popup-name">${escHtml(l.name)}</div>
      <div class="map-popup-trade">${allTrades.map(escHtml).join(' · ')}</div>
      <div style="font-size:12px;color:#A8A29E;margin-bottom:4px;">${escHtml(l.city || l.province || '')}</div>
      <button class="map-popup-btn" onclick="openProfile(${l.id})">View Profile →</button>
    `)
  })

  // "You are here" pin
  if (_nearMeActive && _userLat && _userLng) {
    const youIcon = L.divIcon({
      className: '',
      html: '<div style="background:#fff;width:16px;height:16px;border-radius:50%;border:3px solid #F59E0B;box-shadow:0 0 10px rgba(245,158,11,0.8);"></div>',
      iconSize: [16, 16], iconAnchor: [8, 8],
    })
    L.marker([_userLat, _userLng], { icon: youIcon }).addTo(_map)
      .bindPopup('<div style="font-weight:700;color:#1C1917;font-size:13px;">You are here</div>')
    _map.setView([_userLat, _userLng], 10)
  }

  setTimeout(() => _map.invalidateSize(), 100)
}

window.geocodeListingLocation = async function () {
  const text = document.getElementById('f-location-text')?.value.trim()
  const status = document.getElementById('geocode-status')
  if (!text) { if (status) status.textContent = 'Please enter an address first.'; return }
  if (status) status.textContent = 'Locating...'
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(text + ', South Africa')}&format=json&limit=1`)
    const data = await res.json()
    if (!data.length) { if (status) status.textContent = 'Location not found — try a nearby town or suburb.'; return }
    document.getElementById('f-lat').value = data[0].lat
    document.getElementById('f-lng').value = data[0].lon
    if (status) { status.textContent = `✓ Found: ${data[0].display_name.split(',').slice(0, 2).join(',')}`; status.style.color = '#22C55E' }
  } catch (e) {
    if (status) status.textContent = 'Could not locate — check your connection.'
  }
}

window.geocodeEditLocation = async function () {
  const text = document.getElementById('edit-location-text')?.value.trim()
  const status = document.getElementById('edit-geocode-status')
  if (!text) { if (status) status.textContent = 'Please enter an address first.'; return }
  if (status) status.textContent = 'Locating...'
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(text + ', South Africa')}&format=json&limit=1`)
    const data = await res.json()
    if (!data.length) { if (status) status.textContent = 'Location not found — try a nearby town or suburb.'; return }
    document.getElementById('edit-lat').value = data[0].lat
    document.getElementById('edit-lng').value = data[0].lon
    if (status) { status.textContent = `✓ Found: ${data[0].display_name.split(',').slice(0, 2).join(',')}`; status.style.color = '#22C55E' }
  } catch (e) {
    if (status) status.textContent = 'Could not locate — check your connection.'
  }
}

// ── NEAR ME ───────────────────────────────────────────────
let _userLat = null, _userLng = null, _nearMeActive = false

// Best-available coordinates for a listing: exact → city centre → province centre.
function listingCoords(l) {
  if (l.lat && l.lng) return [l.lat, l.lng]
  if (l.city && CITY_COORDS[l.city]) return CITY_COORDS[l.city]
  if (l.province && PROVINCE_COORDS[l.province]) return PROVINCE_COORDS[l.province]
  return null
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371, dLat = (lat2-lat1)*Math.PI/180, dLng = (lng2-lng1)*Math.PI/180
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
}

window.toggleNearMe = function () {
  const btn = document.getElementById('near-me-btn')
  const status = document.getElementById('near-me-status')
  if (_nearMeActive) {
    _nearMeActive = false; _userLat = null; _userLng = null
    if (btn) { btn.style.color = 'var(--charcoal-6)'; btn.style.borderColor = 'var(--charcoal-4)'; btn.textContent = 'Near Me' }
    if (status) { status.style.display = 'none'; status.textContent = '' }
    renderDirectory(); return
  }
  if (!navigator.geolocation) { toast('Your browser does not support location.'); return }
  if (btn) btn.textContent = 'Locating...'
  navigator.geolocation.getCurrentPosition(pos => {
    _userLat = pos.coords.latitude; _userLng = pos.coords.longitude
    _nearMeActive = true
    if (btn) { btn.style.color = 'var(--amber)'; btn.style.borderColor = 'var(--amber)'; btn.textContent = 'Near Me ✓' }
    if (status) { status.style.display = 'block'; status.textContent = 'Showing tradesmen who cover your area. Switch to Map view to see them visually.' }
    window.setDirView('map')
    renderDirectory()
  }, () => {
    if (btn) btn.textContent = 'Near Me'
    toast('Could not get your location — please allow location access and try again.')
  })
}

window.toggleFavsFilter = function () {
  const btn = document.getElementById('fav-filter-btn')
  if (!btn) return
  const active = btn.dataset.active === '1'
  btn.dataset.active = active ? '0' : '1'
  btn.style.color = active ? 'var(--charcoal-6)' : 'var(--amber)'
  btn.style.borderColor = active ? 'var(--charcoal-4)' : 'var(--amber)'
  renderDirectory()
}

window.toggleAfterHoursFilter = function () {
  const btn = document.getElementById('afterhours-filter-btn')
  if (!btn) return
  const active = btn.dataset.active === '1'
  btn.dataset.active = active ? '0' : '1'
  btn.style.color = active ? 'var(--charcoal-6)' : 'var(--amber)'
  btn.style.borderColor = active ? 'var(--charcoal-4)' : 'var(--amber)'
  _smartMode = false
  renderDirectory()
}

function renderDirectory() {
  if (_smartMode) { renderSmartResults(); return }
  populateTradeFilter()
  document.getElementById('filter-province').value = filterProvince
  document.getElementById('filter-sort').value = filterSort
  const tierOrder = { premium: 0, verified: 1, free: 2 }
  const showFavsOnly = document.getElementById('fav-filter-btn')?.dataset.active === '1'
  const afterHoursOnly = document.getElementById('afterhours-filter-btn')?.dataset.active === '1'
  let filtered = listings.filter(l => {
    if (showFavsOnly && !isFav(l.id)) return false
    if (afterHoursOnly && !l.after_hours) return false
    if (_nearMeActive && _userLat && _userLng) {
      const c = listingCoords(l)
      if (!c) return false
      const dist = haversineKm(_userLat, _userLng, c[0], c[1])
      // Allow the wider of the tradesman's service radius or 50km (city-centre fallback is approximate).
      if (dist > Math.max(l.service_radius || 30, 50)) return false
    }
    if (filterTrade && l.trade !== filterTrade) return false
    if (filterProvince && l.province !== filterProvince && l.province !== 'Nationwide / All Provinces') return false
    if (filterCity) {
      const listingCities = l.cities && l.cities.length ? l.cities : [l.city]
      if (!listingCities.some(c => c === filterCity)) return false
    }
    if (dirSearchTerm) {
      const term = dirSearchTerm.toLowerCase()
      if (!l.name.toLowerCase().includes(term) && !l.trade.toLowerCase().includes(term) && !(l.description || '').toLowerCase().includes(term)) return false
    }
    return true
  }).sort((a, b) => {
    const td = tierOrder[a.tier] - tierOrder[b.tier]; if (td !== 0) return td
    if (filterSort === 'rating') return avgRating(b) - avgRating(a)
    if (filterSort === 'callout') return a.callout - b.callout
    if (filterSort === 'rate') return a.rate - b.rate
    if (filterSort === 'reviews') return (b.reviews ? b.reviews.length : 0) - (a.reviews ? a.reviews.length : 0)
    return 0
  })
  const titleParts = []
  if (dirSearchTerm) titleParts.push(`"${dirSearchTerm}"`)
  if (filterTrade) titleParts.push(filterTrade)
  if (filterProvince) titleParts.push(filterProvince)
  document.getElementById('dir-title').textContent = titleParts.length ? titleParts.join(' — ') : 'All Tradesmen'
  document.getElementById('dir-count').textContent = `${filtered.length} listing${filtered.length !== 1 ? 's' : ''}`

  // Split premium (featured) from the rest — rotate daily so everyone gets equal top exposure
  const allPremium = filtered.filter(l => l.tier === 'premium')
  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000)
  const offset = allPremium.length > 0 ? dayOfYear % allPremium.length : 0
  const featured = [...allPremium.slice(offset), ...allPremium.slice(0, offset)]
  const rest = filtered.filter(l => l.tier !== 'premium')

  let html = ''
  if (featured.length > 0) {
    html += `
      <div style="grid-column:1/-1;margin-bottom:0.5rem;">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:1rem;">
          <span style="font-family:'Bebas Neue',sans-serif;font-size:1.2rem;letter-spacing:0.06em;color:var(--amber);">Featured Tradesmen</span>
          <div style="flex:1;height:1px;background:linear-gradient(to right,rgba(245,158,11,0.4),transparent);"></div>
        </div>
      </div>
      ${featured.map(l => featuredCardHTML(l)).join('')}
      ${rest.length > 0 ? `<div style="grid-column:1/-1;height:1px;background:var(--charcoal-3);margin:0.5rem 0;"></div>` : ''}
    `
  }
  html += rest.length ? rest.map(cardHTML).join('') : (!featured.length ? `<div class="empty-state" style="grid-column:1/-1"><h3>No Results Found</h3><p>Try adjusting your filters or <a onclick="showPage('list')" style="color:var(--amber);cursor:pointer;">list your business</a> here.</p></div>` : '')

  document.getElementById('dir-cards').innerHTML = html
  dirSearchTerm = ''

  // Track search impressions for each visible listing
  filtered.forEach(l => {
    trackEvent('search_impression', l.id, { trade: l.trade, province: l.province })
  })
}

function featuredCardHTML(l) {
  const rating = avgRating(l), rd = rating > 0 ? rating.toFixed(1) : '—'
  const reviewCount = l.reviews ? l.reviews.length : 0
  const allTrades = l.trades && l.trades.length ? l.trades : (l.trade ? [l.trade] : [])
  const rateLabel = l.rate_type === 'day' ? 'Rate / Day' : 'Rate / Hr'
  return `<div class="tradesman-card featured-card" onclick="openProfile(${l.id})" style="border-color:var(--amber);background:linear-gradient(135deg,var(--charcoal-2) 0%,rgba(245,158,11,0.06) 100%);box-shadow:0 0 24px rgba(245,158,11,0.12);">
    <div style="position:absolute;top:12px;right:12px;background:var(--amber);color:var(--charcoal);font-size:10px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;padding:3px 10px;border-radius:100px;">Featured</div>
    <div class="card-header" style="margin-right:70px;">
      <div class="card-avatar premium-av">${l.photo_url ? `<img src="${l.photo_url}" style="width:100%;height:100%;object-fit:cover;border-radius:var(--radius);">` : initials(l.name)}</div>
      <div style="flex:1;min-width:0;">
        <div class="card-name">${escHtml(l.name)}</div>
        ${l.contact_name ? `<div style="font-size:12px;color:var(--charcoal-6);margin-top:1px;">${escHtml(l.contact_name)}</div>` : ''}
        <div class="card-trade">${allTrades.map(escHtml).join(' · ')}</div>
        ${cardBadges(l)}
      </div>
    </div>
    <div class="card-rating">
      <span class="stars">${starsHTML(rating)}</span>
      <span class="rating-num">${rd}</span>
      <span class="rating-count">(${reviewCount} review${reviewCount !== 1 ? 's' : ''})</span>
    </div>
    <div class="card-info">
      <div class="info-item"><div class="info-label">Call-out Fee</div><div class="info-value">${fmtRand(l.callout)}</div></div>
      <div class="info-item"><div class="info-label">${rateLabel}</div><div class="info-value">${fmtRand(l.rate)}</div></div>
    </div>
    ${l.phone || l.email ? `
    <div style="display:grid;grid-template-columns:${l.phone && l.email ? '1fr 1fr' : '1fr'};gap:8px;padding:0.75rem 0;border-top:1px solid rgba(245,158,11,0.2);border-bottom:1px solid rgba(245,158,11,0.2);margin-bottom:0.75rem;">
      ${l.phone ? `<div><div class="info-label">Phone</div><a href="tel:${escHtml(l.phone)}" onclick="event.stopPropagation();trackContact(${l.id},'phone')" style="font-size:13px;color:var(--white);text-decoration:none;font-weight:500;">${escHtml(l.phone)}</a></div>` : ''}
      ${l.email ? `<div><div class="info-label">Email</div><a href="mailto:${escHtml(l.email)}" onclick="event.stopPropagation();trackContact(${l.id},'email')" style="font-size:13px;color:var(--white);text-decoration:none;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block;">${escHtml(l.email)}</a></div>` : ''}
    </div>` : ''}
    <div style="display:flex;align-items:center;justify-content:space-between;margin-top:auto;">
      <div class="card-area" style="border-top:none;padding-top:0;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>
        ${l.cities && l.cities.length > 1 ? l.cities.slice(0,2).join(', ') + (l.cities.length > 2 ? ` +${l.cities.length-2} more` : '') : (l.city || '')}, ${l.province}
      </div>
      <div style="display:flex;align-items:center;gap:6px;">
        <button class="fav-btn" data-id="${l.id}" onclick="window.toggleFav(${l.id},event)" style="background:none;border:none;cursor:pointer;color:${isFav(l.id) ? 'var(--amber)' : 'var(--charcoal-6)'};padding:4px;display:flex;align-items:center;" title="Save to favourites">${isFav(l.id) ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>' : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>'}</button>
        <button class="btn btn-primary btn-sm" onclick="openProfile(${l.id})" style="white-space:nowrap;">More Info →</button>
      </div>
    </div>
  </div>`
}

function cardHTML(l) {
  const rating = avgRating(l), rd = rating > 0 ? rating.toFixed(1) : '—'
  const reviewCount = l.reviews ? l.reviews.length : 0
  const cityStr = l.cities && l.cities.length > 1 ? l.cities.slice(0,2).join(', ') + (l.cities.length > 2 ? ` +${l.cities.length-2} more` : '') : (l.city || '')
  const allTrades = l.trades && l.trades.length ? l.trades : (l.trade ? [l.trade] : [])
  const rateLabel = l.rate_type === 'day' ? 'Rate / Day' : 'Rate / Hr'
  return `<div class="tradesman-card">
    <div class="card-header">
      <div class="card-avatar ${l.tier === 'premium' ? 'premium-av' : ''}">${l.photo_url ? `<img src="${l.photo_url}" style="width:100%;height:100%;object-fit:cover;border-radius:var(--radius);">` : initials(l.name)}</div>
      <div style="flex:1;min-width:0;">
        <div class="card-name">${escHtml(l.name)}</div>
        ${l.contact_name ? `<div style="font-size:12px;color:var(--charcoal-6);margin-top:1px;">${escHtml(l.contact_name)}</div>` : ''}
        <div class="card-trade">${allTrades.map(escHtml).join(' · ')}</div>
        ${cardBadges(l)}
      </div>
    </div>
    <div class="card-rating">
      <span class="stars">${starsHTML(rating)}</span>
      <span class="rating-num">${rd}</span>
      <span class="rating-count">(${reviewCount} review${reviewCount !== 1 ? 's' : ''})</span>
    </div>
    <div class="card-info">
      <div class="info-item"><div class="info-label">Call-out Fee</div><div class="info-value">${fmtRand(l.callout)}</div></div>
      <div class="info-item"><div class="info-label">${rateLabel}</div><div class="info-value">${fmtRand(l.rate)}</div></div>
    </div>
    ${l.phone || l.email ? `
    <div style="display:grid;grid-template-columns:${l.phone && l.email ? '1fr 1fr' : '1fr'};gap:8px;padding:0.75rem 0;border-top:1px solid var(--charcoal-3);border-bottom:1px solid var(--charcoal-3);margin-bottom:0.75rem;">
      ${l.phone ? `<div><div class="info-label">Phone</div><a href="tel:${escHtml(l.phone)}" onclick="event.stopPropagation();trackContact(${l.id},'phone')" style="font-size:13px;color:var(--white);text-decoration:none;font-weight:500;">${escHtml(l.phone)}</a></div>` : ''}
      ${l.email ? `<div><div class="info-label">Email</div><a href="mailto:${escHtml(l.email)}" onclick="event.stopPropagation();trackContact(${l.id},'email')" style="font-size:13px;color:var(--white);text-decoration:none;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block;">${escHtml(l.email)}</a></div>` : ''}
    </div>` : ''}
    <div style="display:flex;align-items:center;justify-content:space-between;margin-top:auto;">
      <div class="card-area" style="border-top:none;padding-top:0;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>
        ${escHtml(cityStr)}, ${escHtml(l.province)}
      </div>
      <div style="display:flex;align-items:center;gap:6px;">
        <button class="fav-btn" data-id="${l.id}" onclick="window.toggleFav(${l.id},event)" style="background:none;border:none;cursor:pointer;color:${isFav(l.id) ? 'var(--amber)' : 'var(--charcoal-6)'};padding:4px;display:flex;align-items:center;" title="Save to favourites">${isFav(l.id) ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>' : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>'}</button>
        <button class="btn btn-primary btn-sm" onclick="openProfile(${l.id})" style="white-space:nowrap;">More Info →</button>
      </div>
    </div>
  </div>`
}

// ── Profile ───────────────────────────────────────────────────────────────────
window.openProfile = async function (id) {
  const { data: l, error } = await supabase
    .from('listings')
    .select('*, reviews(*)')
    .eq('id', id)
    .single()
  if (error || !l) return
  currentProfile = l
  window.history.pushState({}, '', `/profile/${slugify(l.name, l.id)}`)
  trackEvent('profile_view', l.id, { trade: l.trade, province: l.province })
  const rating = avgRating(l), rd = rating > 0 ? rating.toFixed(1) : '—'
  const reviews = l.reviews || []
  const allTrades = l.trades && l.trades.length ? l.trades : (l.trade ? [l.trade] : [])
  const rateLabel = l.rate_type === 'day' ? 'Rate / Day' : 'Rate / Hr'
  const credsHTML = l.credentials && l.credentials.length
    ? l.credentials.map(c => `<div class="cred-item"><div class="cred-icon">✓</div><span>${escHtml(c)}</span></div>`).join('')
    : '<p style="color:var(--charcoal-6);font-size:14px;">No credentials listed yet.</p>'
  // Registration documents are PRIVATE (held only for Tradee verification).
  // The public profile shows a trust note, never the documents themselves.
  const hasDocs = l.certificate_urls && l.certificate_urls.length
  const certsHTML = (hasDocs && (l.tier === 'verified' || l.tier === 'premium'))
    ? `<div style="display:flex;align-items:center;gap:10px;background:rgba(34,197,94,0.08);border:1px solid rgba(34,197,94,0.25);border-radius:var(--radius);padding:10px 14px;">
         <svg width="18" height="18" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="10" fill="#22C55E"/><path d="M6 10.5l3 3 5-6" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
         <span style="font-size:13px;color:var(--charcoal-6);">Registration & credential documents verified by Tradee.</span>
       </div>`
    : ''
  const portfolio = l.portfolio_photos || []
  const portfolioSection = portfolio.length ? `
    <div class="profile-section">
      <div class="section-title">Portfolio</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;">
        ${portfolio.map(p => `
          <div style="position:relative;aspect-ratio:1;border-radius:var(--radius);overflow:hidden;cursor:pointer;" onclick="openLightbox('${escHtml(p.url)}','${escHtml(p.caption || '')}')">
            <img src="${escHtml(p.url)}" style="width:100%;height:100%;object-fit:cover;transition:transform 0.2s;" onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">
            ${p.caption ? `<div style="position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,0,0.65);padding:4px 8px;font-size:11px;color:#fff;">${escHtml(p.caption)}</div>` : ''}
          </div>`).join('')}
      </div>
    </div>` : ''
  const reviewsHTML = reviews.length
    ? reviews.map(r => `
      <div class="review-item">
        <div class="review-header">
          <span class="reviewer-name">${escHtml(r.reviewer_name)}</span>
          <span class="review-date">${new Date(r.created_at).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
        </div>
        <div class="review-stars" style="margin-bottom:8px;">${'★'.repeat(r.stars)}${'☆'.repeat(5 - r.stars)} <span style="font-size:12px;color:var(--charcoal-6);margin-left:4px;">${r.stars}.0 overall</span></div>
        ${r.quality ? `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 16px;margin-bottom:8px;">
          <div style="font-size:12px;color:var(--charcoal-6);">Quality of Work <span style="color:var(--amber);">${'★'.repeat(r.quality)}</span></div>
          <div style="font-size:12px;color:var(--charcoal-6);">Level of Service <span style="color:var(--amber);">${'★'.repeat(r.service)}</span></div>
          <div style="font-size:12px;color:var(--charcoal-6);">Cleanliness <span style="color:var(--amber);">${'★'.repeat(r.cleanliness)}</span></div>
          <div style="font-size:12px;color:var(--charcoal-6);">Communication <span style="color:var(--amber);">${'★'.repeat(r.communication)}</span></div>
          <div style="font-size:12px;color:var(--charcoal-6);">Value for Money <span style="color:var(--amber);">${'★'.repeat(r.value)}</span></div>
        </div>` : ''}
        <p class="review-text">${escHtml(r.review_text)}</p>
        ${r.reply_text ? `
        <div style="margin-top:8px;background:var(--charcoal-3);border-left:3px solid var(--amber);border-radius:0 var(--radius) var(--radius) 0;padding:8px 12px;">
          <div style="font-size:11px;font-weight:600;color:var(--amber);margin-bottom:4px;">OWNER'S REPLY · ${new Date(r.reply_at).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
          <p style="font-size:13px;color:var(--charcoal-7);margin:0;">${escHtml(r.reply_text)}</p>
        </div>` : ''}
      </div>`).join('')
    : '<p style="color:var(--charcoal-6);font-size:14px;">No reviews yet — be the first!</p>'
  document.getElementById('profile-content').innerHTML = `
    <div class="profile-back" onclick="goBack()">← Back to Directory</div>
    <div class="profile-hero">
      <div class="profile-avatar">${l.photo_url ? `<img src="${l.photo_url}" style="width:100%;height:100%;object-fit:cover;border-radius:var(--radius);">` : initials(l.name)}</div>
      <div style="flex:1;">
        <div class="profile-name">${escHtml(l.name)}</div>
        ${l.contact_name ? `<div style="font-size:14px;color:var(--charcoal-6);margin-top:2px;margin-bottom:4px;">Contact: ${escHtml(l.contact_name)}</div>` : ''}
        <div class="profile-trade">${allTrades.map(escHtml).join(' · ')}</div>
        ${(tierBadge(l) || afterHoursBadge(l)) ? `<div class="card-badges" style="margin-top:6px;">${tierBadge(l)}${afterHoursBadge(l)}</div>` : ''}
        <div class="profile-rating-row">
          <span class="profile-rating-big">${rd}</span>
          <div>
            <div class="stars" style="font-size:18px;">${starsHTML(rating)}</div>
            <div style="font-size:12px;color:var(--charcoal-6);">${reviews.length} review${reviews.length !== 1 ? 's' : ''}</div>
          </div>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;">
          ${l.phone ? `<a href="https://wa.me/${l.phone.replace(/\D/g,'')}" target="_blank" onclick="trackContact(${l.id},'whatsapp')" class="btn btn-primary btn-sm" style="background:#25D366;text-decoration:none;">WhatsApp</a>` : ''}
          ${l.phone ? `<a href="tel:${l.phone}" onclick="trackContact(${l.id},'phone')" class="btn btn-outline btn-sm" style="text-decoration:none;">Call</a>` : ''}
          ${l.email ? `<a href="mailto:${l.email}" onclick="trackContact(${l.id},'email')" class="btn btn-outline btn-sm" style="text-decoration:none;">Email</a>` : ''}
          <button class="btn btn-outline btn-sm" onclick="openReviewModal(${l.id})">Leave a Review</button>
          <button class="btn btn-outline btn-sm" onclick="copyProfileLink(${l.id})">Share</button>
          <button class="btn btn-outline btn-sm" onclick="goBack()">Back</button>
        </div>
      </div>
    </div>
    <div class="profile-stats">
      <div class="stat-box"><span class="value">${fmtRand(l.callout)}</span><div class="label">Call-out Fee</div></div>
      <div class="stat-box"><span class="value">${fmtRand(l.rate)}${l.rate_type === 'day' ? '/day' : '/hr'}</span><div class="label">${rateLabel}</div></div>
      <div class="stat-box"><span class="value">${l.years_experience || '—'}</span><div class="label">Years Experience</div></div>
    </div>
    <div class="profile-section">
      <div class="section-title">About</div>
      <p style="font-size:15px;line-height:1.7;color:var(--charcoal-7);">${escHtml(l.description) || 'No description provided.'}</p>
      <div style="margin-top:1rem;display:flex;gap:8px;align-items:center;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>
        <span style="font-size:14px;color:var(--charcoal-6);">${l.city}, ${l.province}</span>
      </div>
    </div>
    <div class="profile-section">
      <div class="section-title">Credentials & Certifications</div>
      <div class="cred-list">${credsHTML}</div>
      ${certsHTML ? `<div style="margin-top:1rem;display:flex;flex-direction:column;gap:8px;">${certsHTML}</div>` : ''}
    </div>
    ${portfolioSection}
    <div class="profile-section">
      <div class="section-title">Client Reviews (${reviews.length})</div>
      <div class="review-list">${reviewsHTML}</div>
      <div style="margin-top:1.5rem;padding-top:1.5rem;border-top:1px solid var(--charcoal-3);">
        <button class="btn btn-outline" onclick="openReviewModal(${l.id})">+ Write a Review</button>
      </div>
    </div>`
  showPage('profile')
}

window.trackContact = function (id, type) {
  trackEvent(type + '_click', id)
}

window.copyProfileLink = function (id) {
  const listing = listings.find(l => l.id === id)
  const url = listing ? profileUrl(listing) : `${window.location.origin}/profile/${id}`
  navigator.clipboard.writeText(url).then(() => {
    toast('Profile link copied! Send it to your clients.')
  }).catch(() => {
    prompt('Copy this link and send it to your clients:', url)
  })
}

window.goBack = function () {
  window.history.pushState({}, '', '/')
  window.showPage('directory')
}

// ── Reviews ───────────────────────────────────────────────────────────────────
window.closeReviewModal = function () { document.getElementById('review-modal').classList.remove('open') }

window.submitReview = async function () {
  const reviewer_name = document.getElementById('r-name').value.trim()
  const review_text = document.getElementById('r-text').value.trim()
  if (!reviewer_name || !review_text) { toast('Please fill in your name and review.'); return }

  const quality = getStarVal('star-quality')
  const service = getStarVal('star-service')
  const cleanliness = getStarVal('star-clean')
  const communication = getStarVal('star-comms')
  const value = getStarVal('star-value')
  if (!quality || !service || !cleanliness || !communication || !value) { toast('Please rate all 5 categories.'); return }
  const stars = Math.round((quality + service + cleanliness + communication + value) / 5)

  const { error } = await supabase.from('reviews').insert({
    listing_id: reviewingId, reviewer_name, review_text,
    stars, quality, service, cleanliness, communication, value
  })
  if (error) { toast('Error submitting review. Please try again.'); console.error(error); return }

  // rating_avg is recomputed server-side by the on-review DB trigger —
  // clients are not trusted to write it (see supabase/security-policies.sql).

  trackEvent('review_left', reviewingId)
  // Notify tradesman by email
  try {
    const { data: tl } = await supabase.from('listings').select('email,name').eq('id', reviewingId).single()
    if (tl?.email) {
      supabase.functions.invoke('review-notification', { body: { email: tl.email, tradeName: tl.name, reviewerName: reviewer_name, stars } }).catch(() => {})
    }
  } catch (_) {}
  closeReviewModal()
  toast('Review submitted — thank you!')
  await loadListings()
  if (currentProfile && currentProfile.id === reviewingId) openProfile(reviewingId)
}

// ── Rankings ──────────────────────────────────────────────────────────────────
window.renderRankings = function () {
  const tradeFilt = document.getElementById('rank-trade-filter').value
  let ranked = listings
    .filter(l => !tradeFilt || l.trade === tradeFilt)
    .filter(l => l.reviews && l.reviews.length > 0)
    .map(l => ({ ...l, avg: avgRating(l) }))
    .sort((a, b) => b.avg - a.avg || (b.reviews.length - a.reviews.length))
  const maxAvg = ranked.length ? ranked[0].avg : 5
  document.getElementById('rank-list').innerHTML = ranked.map((l, i) => `
    <div class="rank-item" onclick="openProfile(${l.id})">
      <div class="rank-num">${i + 1}</div>
      <div class="rank-info">
        <div class="rank-name">${l.name}</div>
        <div class="rank-trade">${l.trade} · ${l.city}</div>
      </div>
      <div class="rank-bar-wrap">
        <div class="rank-bar"><div class="rank-bar-fill" style="width:${(l.avg / maxAvg * 100).toFixed(0)}%"></div></div>
        <div class="rank-score">${starsHTML(l.avg)} ${l.avg.toFixed(1)} (${l.reviews.length})</div>
      </div>
    </div>`).join('') || '<p style="color:var(--charcoal-6);padding:2rem 0;">No ranked tradesmen yet.</p>'
}

// ── List your business ────────────────────────────────────────────────────────
window.openLightbox = function (url, caption) {
  let box = document.getElementById('tradee-lightbox')
  if (!box) {
    box = document.createElement('div')
    box.id = 'tradee-lightbox'
    box.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.92);z-index:9999;display:flex;align-items:center;justify-content:center;flex-direction:column;cursor:zoom-out;padding:2rem;'
    box.onclick = () => { box.style.display = 'none' }
    document.body.appendChild(box)
  }
  box.innerHTML = `<img src="${escHtml(url)}" style="max-width:92vw;max-height:82vh;border-radius:8px;box-shadow:0 8px 40px rgba(0,0,0,0.6);">
    ${caption ? `<div style="color:#fff;font-size:14px;margin-top:14px;max-width:80vw;text-align:center;">${escHtml(caption)}</div>` : ''}
    <div style="color:#A8A29E;font-size:12px;margin-top:10px;">Click anywhere to close</div>`
  box.style.display = 'flex'
}

window.selectTier = function (tier) {
  selectedTier = tier
  ;['free', 'verified', 'premium'].forEach(t => document.getElementById('tier-' + t).classList.toggle('selected', t === tier))
  const isPaid = tier === 'verified' || tier === 'premium'
  // Certificate upload lock
  const locked = document.getElementById('cert-locked')
  const unlocked = document.getElementById('cert-unlocked')
  if (locked) locked.style.display = isPaid ? 'none' : 'block'
  if (unlocked) unlocked.style.display = isPaid ? 'block' : 'none'
  // Full credentials section lock
  const credsLocked = document.getElementById('credentials-locked')
  const credsUnlocked = document.getElementById('credentials-unlocked')
  if (credsLocked) credsLocked.style.display = isPaid ? 'none' : 'block'
  if (credsUnlocked) credsUnlocked.style.display = isPaid ? 'block' : 'none'
  // Mandatory ID confirmation (Verified/Premium only)
  const idWrap = document.getElementById('f-id-confirm-wrap')
  if (idWrap) idWrap.style.display = isPaid ? 'flex' : 'none'
}

window.goToStep2 = function () {
  const email = document.getElementById('f-email').value.trim()
  const password = document.getElementById('f-password').value
  if (!email) { toast('Please enter your email address.'); return }
  if (!password || password.length < 6) { toast('Password must be at least 6 characters.'); return }
  document.getElementById('list-step-1').style.display = 'none'
  document.getElementById('list-step-2').style.display = 'block'
  window.scrollTo(0, 0)
}

window.backToStep1 = function () {
  document.getElementById('list-step-2').style.display = 'none'
  document.getElementById('list-step-1').style.display = 'block'
  window.scrollTo(0, 0)
}

const TRADE_CATEGORIES = {
  'Home & Building': ['Architect','Bricklayer','Builder / General Contractor','Carpenter','Ceiling & Partitioning','Concrete Contractor','Damp Proofing','Demolition','Drywaller','Fencer','Flooring Installer','Glazier','Insulation Installer','Plasterer','Roofer','Scaffolder','Stonemason','Tiler','Waterproofing'],
  'Electrical & Tech': ['Alarm & Security Systems','AV & Home Automation','CCTV Installer','Data & Networking','Electrician','Electric Gate & Intercom','EV Charger Installer','Generator Installer','Solar Panel Installer'],
  'Plumbing & HVAC': ['Air Conditioning & HVAC','Borehole & Water','Gas Fitter','Geyser & Hot Water','Irrigation & Sprinklers','Plumber','Pool Service','Water Filtration'],
  'Finishing & Interior': ['Curtains & Blinds','Interior Designer','Kitchen Fitter','Painter','Upholsterer','Wallpaper Installer','Wardrobe & Built-ins'],
  'Outdoor & Garden': ['Arborist / Tree Feller','Landscaper','Lawn Care','Paving & Driveways','Pest Control','Pressure Washing','Skip Hire'],
  'Automotive': ['Auto Electrician','Auto Panel Beater','Car Audio & Accessories','Car Detailer','Mobile Mechanic','Roadworthy & Inspection','Tow Truck','Tyre Fitting','Windscreen Repair'],
  'Appliances & Small Jobs': ['Appliance Repair','Handyman','Locksmith','Moving & Removals','Welder & Fabrication'],
  'Cleaning': ['Carpet Cleaning','Commercial Cleaning','Deep Cleaning','Domestic Cleaner','End of Tenancy Cleaning','Garden Waste Removal','Housekeeper','Laundry & Ironing','Mattress Cleaning','Office Cleaning','Oven Cleaning','Pressure Washing','Rubbish Removal','Upholstery Cleaning','Window Cleaning'],
}
const TRADES_LIST = Object.values(TRADE_CATEGORIES).flat()
let selectedTrades = []

window.toggleTradeDropdown = function () {
  const dd = document.getElementById('f-trade-dropdown')
  if (dd.style.display === 'none') { renderTradeList(); dd.style.display = 'block' }
  else dd.style.display = 'none'
}

document.addEventListener('click', function closeTradeDropdown(e) {
  if (!document.getElementById('f-trade-wrapper')?.contains(e.target)) {
    const dd = document.getElementById('f-trade-dropdown')
    if (dd) dd.style.display = 'none'
  }
})

function renderTradeList() {
  const cat = document.getElementById('f-trade-category')?.value || ''
  const customTrades = selectedTrades.filter(t => !TRADES_LIST.includes(t))
  const categoriesToShow = cat ? { [cat]: TRADE_CATEGORIES[cat] } : TRADE_CATEGORIES
  let html = ''
  for (const [catName, trades] of Object.entries(categoriesToShow)) {
    html += `<div style="padding:5px 12px 3px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:var(--amber);background:var(--charcoal-3);">${catName}</div>`
    html += trades.map(t => `
      <label style="display:flex;align-items:center;gap:10px;padding:7px 12px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.04);" onclick="event.stopPropagation()">
        <input type="checkbox" value="${t}" ${selectedTrades.includes(t)?'checked':''} onchange="toggleTrade('${t}')" style="accent-color:var(--amber);width:16px;height:16px;flex-shrink:0;">
        <span style="color:var(--white);font-size:13px;">${t}</span>
      </label>`).join('')
  }
  if (customTrades.length) {
    html += `<div style="padding:5px 12px 3px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:var(--amber);background:var(--charcoal-3);">Custom</div>`
    html += customTrades.map(t => `
      <label style="display:flex;align-items:center;gap:10px;padding:7px 12px;cursor:pointer;" onclick="event.stopPropagation()">
        <input type="checkbox" value="${t}" checked onchange="toggleTrade('${t}')" style="accent-color:var(--amber);width:16px;height:16px;flex-shrink:0;">
        <span style="color:var(--white);font-size:13px;">${t}</span>
      </label>`).join('')
  }
  document.getElementById('f-trade-list').innerHTML = html
}

window.toggleTrade = function (trade) {
  if (selectedTrades.includes(trade)) selectedTrades = selectedTrades.filter(t => t !== trade)
  else selectedTrades.push(trade)
  updateTradeLabel()
  renderTradeList()
}

window.addCustomTrade = function () {
  const val = document.getElementById('f-trade-new').value.trim()
  if (val && !selectedTrades.includes(val)) {
    selectedTrades.push(val)
    updateTradeLabel()
    renderTradeList()
  }
}

function updateTradeLabel() {
  const label = document.getElementById('f-trade-label-text')
  if (!label) return
  if (selectedTrades.length === 0) { label.textContent = 'Select trades…'; label.style.color = 'var(--charcoal-6)' }
  else { label.textContent = selectedTrades.join(', '); label.style.color = 'var(--white)' }
}

function getSelectedTrade() {
  return selectedTrades[0] || ''
}

window.submitListing = async function () {
  const email = document.getElementById('f-email').value.trim()
  const password = document.getElementById('f-password').value
  const contact_name = document.getElementById('f-name').value.trim()
  const name = document.getElementById('f-business').value.trim() || contact_name
  const phone = document.getElementById('f-phone')?.value.trim() || ''
  const trade = getSelectedTrade()
  const trades = [...selectedTrades]
  const province = document.getElementById('f-province').value
  const city = selectedCities.length > 0 ? selectedCities[0] : ''
  const calloutRaw = document.getElementById('f-callout').value.trim()
  const rateRaw = document.getElementById('f-rate').value.trim()
  const callout = calloutRaw.toUpperCase() === 'N/A' ? -1 : (parseInt(calloutRaw) || 0)
  const rate = rateRaw.toUpperCase() === 'N/A' ? -1 : (parseInt(rateRaw) || 0)
  const rateTypeEl = document.querySelector('input[name="f-rate-type"]:checked')
  const rate_type = rateTypeEl ? rateTypeEl.value : 'hour'
  const description = document.getElementById('f-desc').value.trim()
  const credsRaw = document.getElementById('f-creds')?.value.trim() || ''
  const years_experience = parseInt(document.getElementById('f-years')?.value) || 0
  const credentials = credsRaw ? credsRaw.split(',').map(c => c.trim()).filter(Boolean) : []
  if (!email || !password) { toast('Please enter your email and password.'); return }
  if (password.length < 6) { toast('Password must be at least 6 characters.'); return }
  if (phone && !/^\+?[\d\s\-()]{7,15}$/.test(phone)) { toast('Please enter a valid phone number.'); return }
  if (!name || selectedTrades.length === 0 || !province || selectedCities.length === 0) { toast('Please fill in name, at least one trade, province and at least one city.'); return }
  if (!rate && rateRaw.toUpperCase() !== 'N/A') { toast('Please enter your rate or N/A.'); return }
  if (!description) { toast('Please add a business description.'); return }
  if ((selectedTier === 'verified' || selectedTier === 'premium') && !document.getElementById('f-id-confirm')?.checked) { toast('Verified & Premium require a valid ID / registration document — please upload it and tick the confirmation box.'); return }
  if (!document.getElementById('f-agree')?.checked) { toast('Please confirm your details and accept the disclaimer to publish.'); return }

  // Create account first
  let userId = currentUser?.id ?? null
  if (!currentUser) {
    const { data, error: signUpError } = await supabase.auth.signUp({ email, password })
    if (signUpError) { toast('Account error: ' + signUpError.message); return }
    userId = data.user?.id ?? null
    supabase.functions.invoke('welcome-email', { body: { email } }).catch(() => {})
  }

  // Upload profile photo if provided
  let photo_url = null
  const photoFile = window.photoFile
  if (photoFile) {
    const photoPath = `${userId}/photo-${Date.now()}-${photoFile.name}`
    const { error: photoUploadError } = await supabase.storage.from(BUCKET_PUBLIC).upload(photoPath, photoFile)
    if (!photoUploadError) {
      const { data: photoUrlData } = supabase.storage.from(BUCKET_PUBLIC).getPublicUrl(photoPath)
      photo_url = photoUrlData.publicUrl
    }
  }

  // Upload certificate files only for paid tiers
  const certFiles = (selectedTier === 'verified' || selectedTier === 'premium') ? (window.certFiles || []) : []
  const certificate_urls = []
  for (const file of certFiles) {
    const path = `${userId}/${Date.now()}-${file.name}`
    // Certificates go to the PRIVATE bucket; store the path, not a public URL.
    const { error: uploadError } = await supabase.storage.from(BUCKET_CERTS).upload(path, file)
    if (!uploadError) certificate_urls.push(path)
  }

  const lat = parseFloat(document.getElementById('f-lat')?.value) || null
  const lng = parseFloat(document.getElementById('f-lng')?.value) || null
  const service_radius = parseInt(document.getElementById('f-service-radius')?.value) || 30
  const cities = selectedCities.length > 0 ? selectedCities : (city ? [city] : [])
  const after_hours = !!document.getElementById('f-emergency')?.checked
  const { error } = await supabase.from('listings').insert({
    name, contact_name, phone, email, trade, trades, province, city: cities[0] || city, cities, callout, rate, rate_type, description, credentials, years_experience, tier: selectedTier,
    user_id: userId, certificate_urls, photo_url, lat, lng, service_radius, after_hours
  })
  if (error) { toast('Error saving listing. Please try again.'); console.error(error); return }
  toast(`${name} is now live on Tradee!`)
  ;['f-name', 'f-phone', 'f-email', 'f-password', 'f-callout', 'f-rate', 'f-desc', 'f-creds', 'f-years'].forEach(id => { const el = document.getElementById(id); if (el) el.value = '' })
  selectedCities = []; updateCityLabel()
  selectedTrades = []; updateTradeLabel()
  document.getElementById('f-trade-new').value = ''
  document.getElementById('f-province').value = ''
  selectTier('free')
  await loadListings()
  setTimeout(() => window.showPage('dashboard'), 1500)
}

// ── URL Routing ───────────────────────────────────────────────────────────────
function handleRoute() {
  // Return from PayFast checkout
  const sp = new URLSearchParams(window.location.search)
  const pay = sp.get('payment')
  if (pay) {
    if (pay === 'success') toast('Payment received — your upgrade will activate within a minute. 🎉')
    else if (pay === 'cancelled') toast('Payment cancelled — no charge made.')
    window.history.replaceState({}, '', '/')
    setTimeout(() => { if (currentUser) loadListings() }, 4000)
    return
  }
  const path = window.location.pathname
  const match = path.match(/^\/profile\/(.+)$/)
  if (match) {
    const slug = match[1]
    const numId = parseInt(slug)
    if (!isNaN(numId) && String(numId) === slug) {
      window.openProfile(numId)
    } else {
      const idMatch = slug.match(/-(\d+)$/)
      if (idMatch) window.openProfile(parseInt(idMatch[1]))
    }
    return
  }
  // Deep link from an SEO landing page, e.g. /?trade=Plumber&city=Umhlanga&province=KwaZulu-Natal
  const params = new URLSearchParams(window.location.search)
  const t = params.get('trade'), c = params.get('city'), p = params.get('province')
  if (t || c || p) {
    _smartMode = false
    filterTrade = t || ''
    filterCity = c || ''
    filterProvince = p || ''
    window.showPage('directory')
  }
}

window.addEventListener('popstate', handleRoute)

// ── Init ──────────────────────────────────────────────────────────────────────
selectTier('free')
initAuth()
loadListings().then(() => handleRoute())

function initStarSelects() {
  document.querySelectorAll('.star-select').forEach(group => {
    group.dataset.selected = '0'
    const stars = [...group.querySelectorAll('span')]
    function paint(val) { stars.forEach((s, i) => s.classList.toggle('lit', i < val)) }
    paint(0)
    stars.forEach((s, i) => {
      s.onclick = () => { group.dataset.selected = String(i + 1); paint(i + 1) }
      s.onmouseenter = () => paint(i + 1)
    })
    group.onmouseleave = () => paint(parseInt(group.dataset.selected) || 0)
  })
}

function getStarVal(id) {
  return parseInt(document.getElementById(id)?.dataset.selected) || 0
}

window.openReviewModal = function (id) {
  reviewingId = id
  document.getElementById('review-modal').classList.add('open')
  document.getElementById('r-name').value = ''
  document.getElementById('r-text').value = ''
  initStarSelects()
}

// ── Admin ─────────────────────────────────────────────────────────────────────
async function renderAdmin() {
  const el = document.getElementById('admin-content')
  if (!el) return
  // Fail closed: no admin list configured = nobody gets in.
  // (This is only UX gating — actual admin actions are enforced by RLS.)
  if (!currentUser || ADMIN_EMAILS.length === 0 || !ADMIN_EMAILS.includes(currentUser.email)) {
    el.innerHTML = '<div class="empty-state"><h3>Access Denied</h3><p>Admin only.</p></div>'
    return
  }
  el.innerHTML = '<div class="empty-state"><p>Loading...</p></div>'
  const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const since7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const since1 = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const [{ data: allListings }, { data: allReviews }, { data: events }] = await Promise.all([
    supabase.from('listings').select('*, reviews(*)').order('created_at', { ascending: false }),
    supabase.from('reviews').select('*, listings(name)').order('created_at', { ascending: false }).limit(50),
    supabase.from('analytics_events').select('event_type, listing_id, created_at').gte('created_at', since30)
  ])
  const ls = allListings || []
  const rs = allReviews || []
  const ev = events || []

  // Tier & sign-up breakdown
  const free = ls.filter(l => l.tier === 'free').length
  const verified = ls.filter(l => l.tier === 'verified').length
  const premium = ls.filter(l => l.tier === 'premium').length
  const promoUsed = ls.filter(l => l.promo_verified).length
  const spotsLeft = Math.max(0, 100 - promoUsed)
  const new7 = ls.filter(l => l.created_at >= since7).length
  const new1 = ls.filter(l => l.created_at >= since1).length

  // 30-day activity
  const ct = (t) => ev.filter(e => e.event_type === t).length
  const views = ct('profile_view'), phone = ct('phone_click'), wa = ct('whatsapp_click'), email = ct('email_click'), searches = ct('search_impression')
  const contacts = phone + wa + email
  const ctr = views > 0 ? Math.round((contacts / views) * 100) : 0

  // Top-viewed listings (30 days)
  const viewBy = {}
  ev.filter(e => e.event_type === 'profile_view' && e.listing_id).forEach(e => { viewBy[e.listing_id] = (viewBy[e.listing_id] || 0) + 1 })
  const topViewed = Object.entries(viewBy).sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([id, n]) => ({ name: ls.find(l => String(l.id) === String(id))?.name || 'Unknown', n }))

  const statCard = (value, label, color = 'var(--white)') =>
    `<div style="background:var(--charcoal-3);border-radius:var(--radius);padding:14px;text-align:center;">
      <div style="font-size:2rem;font-weight:700;color:${color};">${value}</div>
      <div style="font-size:11px;color:var(--charcoal-6);text-transform:uppercase;letter-spacing:0.05em;margin-top:2px;">${label}</div>
    </div>`

  el.innerHTML = `
    <h2 style="margin-bottom:1.5rem;">Admin Dashboard</h2>

    <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.08em;color:var(--charcoal-6);margin-bottom:8px;">Sign-ups by package</div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:1.25rem;">
      ${statCard(ls.length, 'Total Tradesmen')}
      ${statCard(free, 'Free / Standard')}
      ${statCard(verified, 'Verified', 'var(--amber)')}
      ${statCard(premium, 'Premium', 'var(--amber)')}
    </div>

    <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.08em;color:var(--charcoal-6);margin-bottom:8px;">Growth & founding-member offer</div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:1.25rem;">
      ${statCard(new1, 'New (last 24h)', '#22C55E')}
      ${statCard(new7, 'New (last 7 days)', '#22C55E')}
      ${statCard(`${promoUsed}/100`, 'Founding spots used')}
      ${statCard(spotsLeft, 'Free spots left', 'var(--amber)')}
    </div>

    <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.08em;color:var(--charcoal-6);margin-bottom:8px;">Activity — last 30 days</div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:6px;">
      ${statCard(views, 'Profile Views')}
      ${statCard(contacts, 'Contact Clicks', 'var(--amber)')}
      ${statCard(`${ctr}%`, 'View → Contact')}
      ${statCard(searches, 'Search Appearances')}
    </div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:1.25rem;">
      ${statCard(phone, 'Phone Calls')}
      ${statCard(wa, 'WhatsApp', '#25D366')}
      ${statCard(email, 'Emails')}
      ${statCard(ct('review_left'), 'Reviews Left')}
    </div>

    <div class="form-card" style="margin-bottom:1.25rem;">
      <h3 style="margin-bottom:1rem;">Top Viewed Listings (30 days)</h3>
      ${topViewed.length ? topViewed.map((t, i) => `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--charcoal-3);">
          <span style="color:var(--white);font-size:14px;">${i + 1}. ${escHtml(t.name)}</span>
          <span style="color:var(--amber);font-weight:700;">${t.n} views</span>
        </div>`).join('') : '<p style="color:var(--charcoal-6);font-size:14px;">No views recorded yet.</p>'}
    </div>

    <div style="background:rgba(245,158,11,0.06);border:1px solid rgba(245,158,11,0.2);border-radius:var(--radius);padding:12px 16px;margin-bottom:2rem;font-size:13px;color:var(--charcoal-6);">
      <strong style="color:var(--amber);">Site-wide visitors &amp; page views</strong> (unique daily visitors, traffic sources, devices) are tracked by Vercel — see your <strong style="color:var(--white);">Vercel dashboard → Analytics</strong>. The numbers above measure engagement with tradesman listings specifically.
    </div>

    <div class="form-card" style="margin-bottom:1rem;">
      <h3 style="margin-bottom:1rem;">All Listings</h3>
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead><tr style="color:var(--charcoal-6);text-align:left;">
            <th style="padding:8px 12px;border-bottom:1px solid var(--charcoal-3);">Name</th>
            <th style="padding:8px 12px;border-bottom:1px solid var(--charcoal-3);">Trade</th>
            <th style="padding:8px 12px;border-bottom:1px solid var(--charcoal-3);">Tier</th>
            <th style="padding:8px 12px;border-bottom:1px solid var(--charcoal-3);">Docs</th>
            <th style="padding:8px 12px;border-bottom:1px solid var(--charcoal-3);">Reviews</th>
            <th style="padding:8px 12px;border-bottom:1px solid var(--charcoal-3);">Actions</th>
          </tr></thead>
          <tbody>${ls.map(l => `
            <tr style="border-bottom:1px solid var(--charcoal-3);">
              <td style="padding:8px 12px;color:var(--white);">${escHtml(l.name)}</td>
              <td style="padding:8px 12px;color:var(--charcoal-6);">${escHtml(l.trade)}</td>
              <td style="padding:8px 12px;">${tierBadge(l) || '<span style="color:var(--charcoal-6);">Standard</span>'}</td>
              <td style="padding:8px 12px;white-space:nowrap;">${l.certificate_urls && l.certificate_urls.length ? l.certificate_urls.map((ref, i) => `<button class="btn btn-outline btn-sm" style="margin:0 2px;padding:2px 8px;" onclick="viewCert('${escHtml(ref)}')" title="Verify document">Doc ${i + 1}</button>`).join('') : '<span style="color:var(--charcoal-6);">—</span>'}</td>
              <td style="padding:8px 12px;color:var(--charcoal-6);">${l.reviews?.length || 0}</td>
              <td style="padding:8px 12px;white-space:nowrap;">
                <select style="background:var(--charcoal-3);border:1px solid var(--charcoal-4);color:var(--white);border-radius:4px;padding:4px;" onchange="adminSetTier(${l.id},this.value)">
                  <option value="free" ${l.tier === 'free' ? 'selected' : ''}>Standard</option>
                  <option value="verified" ${l.tier === 'verified' ? 'selected' : ''}>Verified</option>
                  <option value="premium" ${l.tier === 'premium' ? 'selected' : ''}>Premium</option>
                </select>
                <button class="btn btn-outline btn-sm" style="margin-left:6px;${l.verified_approved ? 'color:#22C55E;border-color:#22C55E;' : 'color:var(--amber);border-color:var(--amber);'}" onclick="openVerifyModal(${l.id})" title="Review documents and verify this tradesman">${l.verified_approved ? 'Verified ✓' : 'Review & verify'}</button>
                <button class="btn btn-outline btn-sm" style="margin-left:6px;color:var(--danger);border-color:var(--danger);" onclick="adminDeleteListing(${l.id})">Delete</button>
              </td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>
    <div class="form-card">
      <h3 style="margin-bottom:1rem;">Recent Reviews</h3>
      ${rs.map(r => `
        <div style="display:flex;align-items:flex-start;gap:12px;padding:10px 0;border-bottom:1px solid var(--charcoal-3);">
          <div style="flex:1;">
            <div style="font-size:13px;font-weight:600;color:var(--white);">${escHtml(r.reviewer_name)} → ${escHtml(r.listings?.name || '')}</div>
            <div style="font-size:12px;color:var(--charcoal-6);">${new Date(r.created_at).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })} · ${r.stars}★</div>
            <p style="font-size:13px;color:var(--charcoal-7);margin:4px 0;">${escHtml(r.review_text)}</p>
          </div>
          <button class="btn btn-outline btn-sm" style="color:var(--danger);border-color:var(--danger);flex-shrink:0;" onclick="adminDeleteReview(${r.id})">Remove</button>
        </div>`).join('')}
    </div>`
}

window.adminSetTier = async function (id, tier) {
  await supabase.from('listings').update({ tier }).eq('id', id)
  toast('Tier updated.')
  await loadListings()
}

// ── Verification review modal (admin) ─────────────────────────────────────────
let _verifyId = null
window.openVerifyModal = function (id) {
  const l = listings.find(x => x.id === id)
  if (!l) return
  _verifyId = id
  document.getElementById('verify-business').textContent = l.name
  const certs = l.certificate_urls || []
  document.getElementById('verify-docs').innerHTML = certs.length
    ? certs.map((ref, i) => `<button class="btn btn-outline btn-sm" style="text-align:left;" onclick="viewCert('${escHtml(ref)}')">View Document ${i + 1} ↗</button>`).join('')
    : '<span style="font-size:13px;color:var(--charcoal-6);">No documents uploaded yet.</span>'
  const v = l.verification || {}
  document.getElementById('vc-id').checked = !!v.id
  document.getElementById('vc-cert').checked = !!v.cert
  document.getElementById('vc-reg').checked = !!v.reg
  document.getElementById('vc-ins').checked = !!v.ins
  document.getElementById('vc-notes').value = v.notes || ''
  document.getElementById('verify-modal').classList.add('open')
}
window.closeVerifyModal = function () { document.getElementById('verify-modal').classList.remove('open') }

function collectVerifyChecks() {
  return {
    id: document.getElementById('vc-id').checked,
    cert: document.getElementById('vc-cert').checked,
    reg: document.getElementById('vc-reg').checked,
    ins: document.getElementById('vc-ins').checked,
    notes: document.getElementById('vc-notes').value.trim(),
    reviewed_at: new Date().toISOString(),
  }
}
async function saveVerification(approved) {
  if (_verifyId == null) return
  const update = { verification: collectVerifyChecks() }
  if (approved !== undefined) update.verified_approved = approved
  const { error } = await supabase.from('listings').update(update).eq('id', _verifyId)
  if (error) { toast('Could not save — did you run the SQL? ' + error.message); return }
  toast(approved === true ? 'Verified badge granted.' : approved === false ? 'Badge removed.' : 'Checks saved.')
  closeVerifyModal()
  await loadListings()
  renderAdmin()
}
window.grantVerified = function () {
  if (!document.getElementById('vc-id').checked && !confirm('Identity isn\'t ticked. Grant the badge anyway?')) return
  saveVerification(true)
}
window.saveVerificationOnly = function () { saveVerification(undefined) }
window.revokeVerified = function () { saveVerification(false) }

window.adminDeleteListing = async function (id) {
  if (!confirm('Delete this listing? This cannot be undone.')) return
  await supabase.from('listings').delete().eq('id', id)
  toast('Listing deleted.')
  await loadListings()
  renderAdmin()
}

window.adminDeleteReview = async function (id) {
  if (!confirm('Remove this review?')) return
  await supabase.from('reviews').delete().eq('id', id)
  toast('Review removed.')
  renderAdmin()
}
