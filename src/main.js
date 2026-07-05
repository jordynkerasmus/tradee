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
let filterTrade = '', filterProvince = '', filterCity = '', filterSort = 'rating', dirSearchTerm = '', filterAfterHours = false, _favsOnly = false
let selectedCities = []

// ── Auth ──────────────────────────────────────────────────────────────────────
// The signed-in user's account profile (account_type, full_name, marketing_opt_in).
let userProfile = null
async function loadUserProfile() {
  if (!currentUser) { userProfile = null; return }
  try {
    const { data } = await supabase.from('profiles').select('*').eq('id', currentUser.id).single()
    userProfile = data || null
  } catch (_) { userProfile = null }
}
// 'guest' | 'customer' | 'tradesman'. A user with a listing is always a tradesman.
function accountType() {
  if (!currentUser) return 'guest'
  return userProfile?.account_type === 'tradesman' ? 'tradesman' : 'customer'
}

async function initAuth() {
  const { data: { session } } = await supabase.auth.getSession()
  currentUser = session?.user ?? null
  await loadUserProfile()
  updateNavForAuth()
  renderBottomNav()
  loadUnreadCount()
  if (currentUser) syncFavsOnLogin()
  supabase.auth.onAuthStateChange(async (_event, session) => {
    const wasLoggedOut = !currentUser
    currentUser = session?.user ?? null
    await loadUserProfile()
    updateNavForAuth()
    renderBottomNav()
    loadUnreadCount()
    if (currentUser && wasLoggedOut) syncFavsOnLogin()
  })
}

function updateNavForAuth() {
  const isAdmin = currentUser && ADMIN_EMAILS.includes(currentUser.email)
  const isTradesman = accountType() === 'tradesman'
  const show = (id, on, disp = 'block') => { const el = document.getElementById(id); if (el) el.style.display = on ? disp : 'none' }
  // Desktop: Log In (logged out) vs Saved link + Account dropdown (logged in).
  show('nav-login-btn', !currentUser, 'inline-flex')
  show('nav-saved-link', !!currentUser, 'inline')
  show('nav-settings-link', !!currentUser, 'inline')
  show('nav-account-wrap', !!currentUser, 'inline-block')
  show('nav-list-btn', !isTradesman, 'inline-flex')       // tradesmen already have a listing
  show('da-dashboard', isTradesman)
  show('da-messages', isTradesman)
  show('da-admin', isAdmin)
  // Mobile account sheet.
  const mobileAuth = document.getElementById('nav-mobile-auth')
  if (mobileAuth) mobileAuth.textContent = currentUser ? 'Log Out' : 'Log In'
  show('nav-mobile-dashboard', currentUser && isTradesman)
  show('nav-mobile-admin', isAdmin)
  show('nav-mobile-saved', !!currentUser)
  show('nav-mobile-settings', !!currentUser)
  show('nav-mobile-identity', !!currentUser)
  const idName = document.getElementById('nav-mobile-identity-name')
  if (idName) idName.textContent = userProfile?.full_name || currentUser?.email || ''
}

window.toggleDesktopAccount = function (e) {
  if (e) e.stopPropagation()
  document.getElementById('nav-account-menu')?.classList.toggle('open')
}
window.closeDesktopAccount = function () { document.getElementById('nav-account-menu')?.classList.remove('open') }
document.addEventListener('click', e => {
  const wrap = document.getElementById('nav-account-wrap')
  if (wrap && !wrap.contains(e.target)) closeDesktopAccount()
})

window.toggleMarketing = async function (el) {
  if (!currentUser) return
  const on = el ? !!el.checked : !!document.querySelector('.marketing-toggle')?.checked
  try {
    await supabase.from('profiles').update({
      marketing_opt_in: on,
      marketing_opt_in_at: on ? new Date().toISOString() : null
    }).eq('id', currentUser.id)
    if (userProfile) userProfile.marketing_opt_in = on
    document.querySelectorAll('.marketing-toggle').forEach(c => { c.checked = on })
    toast(on ? 'Marketing emails on.' : 'Marketing emails off.')
  } catch (_) { toast('Could not update — please try again.') }
}

window.handleLogin = async function () {
  const email = document.getElementById('login-email').value.trim()
  const password = document.getElementById('login-password').value
  if (!email || !password) { toast('Please enter your email and password.'); return }
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) { toast('Login failed: ' + error.message); return }
  // Refresh auth state + profile, then route by role.
  const { data: { session } } = await supabase.auth.getSession()
  currentUser = session?.user ?? null
  await loadUserProfile()
  updateNavForAuth(); renderBottomNav(); loadUnreadCount()
  toast('Welcome back!')
  window.showPage(accountType() === 'tradesman' ? 'dashboard' : 'home')
}

let signupAccountType = 'customer'
window.setSignupType = function (t) {
  signupAccountType = t
  document.querySelectorAll('#signup-type .acct-opt').forEach(b => b.classList.toggle('active', b.dataset.type === t))
}

window.handleSignup = async function () {
  const full_name = document.getElementById('signup-name')?.value.trim() || ''
  const email = document.getElementById('signup-email').value.trim()
  const password = document.getElementById('signup-password').value
  const password2 = document.getElementById('signup-password2').value
  const agreed = document.getElementById('signup-agree')?.checked
  const marketing = !!document.getElementById('signup-marketing')?.checked
  if (!full_name) { toast('Please enter your name.'); return }
  if (!email || !password) { toast('Please fill in all fields.'); return }
  if (password !== password2) { toast('Passwords do not match.'); return }
  if (password.length < 6) { toast('Password must be at least 6 characters.'); return }
  if (!agreed) { toast('Please accept the disclaimer and terms to continue.'); return }
  const { data, error } = await supabase.auth.signUp({
    email, password,
    options: { data: { full_name, account_type: signupAccountType, marketing_opt_in: marketing } }
  })
  if (error) { toast('Sign up failed: ' + error.message); return }
  // Send welcome email via Edge Function
  supabase.functions.invoke('welcome-email', { body: { email } }).catch(() => {})
  if (!data.session) {
    // Email confirmation is enabled in Supabase — user must verify before logging in
    toast('Account created! Check your email to confirm your address, then log in.')
    window.showPage('login')
  } else {
    currentUser = data.user
    await loadUserProfile()
    updateNavForAuth(); renderBottomNav()
    if (signupAccountType === 'tradesman') {
      toast('Account created! Let\'s list your business.')
      window.showPage('list')
    } else {
      toast('Account created — welcome to Tradee!')
      window.showPage('home')
    }
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

  // Notes/messages sent to this tradesman by the Tradee admin team.
  let dashNotes = []
  try {
    const { data: nd } = await supabase.from('listing_notes').select('*').eq('listing_id', listing.id).eq('dismissed', false).order('created_at', { ascending: false })
    dashNotes = nd || []
  } catch (_) {}

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
    ${dashNotes.length ? `
    <div style="background:rgba(96,165,250,0.1);border:1.5px solid rgba(96,165,250,0.45);border-radius:var(--radius-lg);padding:14px 18px;margin-bottom:1.5rem;">
      <div style="font-family:'Bebas Neue',sans-serif;letter-spacing:0.04em;font-size:1.1rem;color:#60A5FA;margin-bottom:6px;">📩 Messages from Tradee</div>
      ${dashNotes.map(n => `<div style="display:flex;gap:10px;align-items:flex-start;padding:8px 0;border-top:1px solid var(--charcoal-3);">
        <div style="flex:1;font-size:14px;color:var(--white);line-height:1.5;">${escHtml(n.message)}<div style="font-size:11px;color:var(--charcoal-6);margin-top:3px;">${new Date(n.created_at).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })}</div></div>
        <button class="btn btn-outline btn-sm" style="flex-shrink:0;" onclick="dismissNote(${n.id})">Got it</button>
      </div>`).join('')}
    </div>` : ''}
    ${overdueBanner}
    ${promoNote}
    <div class="profile-hero" style="margin-bottom:1.5rem;">
      <div style="position:relative;display:inline-block;">
        <div class="profile-avatar" id="dash-avatar">${listing.photo_url ? `<img src="${escHtml(listing.photo_url)}" style="width:100%;height:100%;object-fit:cover;border-radius:var(--radius);">` : initials(listing.name)}</div>
        <label for="dash-photo-input" style="position:absolute;bottom:-6px;right:-6px;background:var(--amber);border-radius:50%;width:26px;height:26px;display:flex;align-items:center;justify-content:center;cursor:pointer;" title="Change photo"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#1C1917" stroke-width="2.5" stroke-linecap="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg></label>
        <input type="file" id="dash-photo-input" accept=".jpg,.jpeg,.png" style="display:none;" onchange="window.updatePhoto(this, ${listing.id})">
      </div>
      <div style="flex:1;">
        <div class="profile-name">${escHtml(listing.name)}</div>
        ${listing.contact_name ? `<div style="font-size:14px;color:var(--charcoal-6);margin-bottom:4px;">Contact: ${escHtml(listing.contact_name)}</div>` : ''}
        <div class="profile-trade">${escHtml(listing.trade)}</div>
        ${tierBadge(listing) ? `<div class="card-badges" style="margin-top:8px;margin-bottom:14px;">${tierBadge(listing)}</div>` : ''}
        <div style="background:var(--charcoal-3);border:1px solid var(--charcoal-4);border-radius:var(--radius);padding:10px 14px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:4px;">
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
          <div class="form-group"><label class="form-label">Phone Number</label><div style="display:flex;gap:0;border-radius:var(--radius);overflow:hidden;border:1px solid var(--charcoal-4);"><span style="background:var(--charcoal-3);padding:10px 14px;color:var(--charcoal-6);font-size:14px;font-weight:600;white-space:nowrap;border-right:1px solid var(--charcoal-4);">+27</span><input class="form-input" id="edit-phone" placeholder="82 000 0000" maxlength="12" style="border:none;border-radius:0;flex:1;" oninput="this.value=this.value.replace(/[^\\d\\s]/g,'')" value="${escHtml((listing.phone || '').replace(/^\\+?27/, '').replace(/^0/, ''))}"></div><div class="form-hint">Digits only after +27, no leading 0</div></div>
          <div class="form-group"><label class="form-label">Email</label><input class="form-input" id="edit-email" type="email" value="${escHtml(listing.email || '')}"></div>
        </div>
        <div class="form-group">
          <label class="form-label">Profile Photo</label>
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px;">
            ${listing.photo_url ? `<img src="${escHtml(listing.photo_url)}" style="width:56px;height:56px;border-radius:var(--radius);object-fit:cover;">` : `<div style="width:56px;height:56px;border-radius:var(--radius);background:var(--charcoal-3);display:flex;align-items:center;justify-content:center;font-family:'Bebas Neue',sans-serif;font-size:1.4rem;color:var(--amber);">${escHtml(listing.name.slice(0,2).toUpperCase())}</div>`}
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
          <div class="form-hint">Separate multiple trades with commas. Type any trade you like — unlisted ones are reviewed by our team before going live.</div>
          <select class="form-input" style="margin-top:8px;" onchange="addTradeFromList(this)">
            <option value="">＋ Quick-add a listed trade…</option>
            ${Object.entries(TRADE_CATEGORIES).map(([cat, ts]) => `<optgroup label="${escHtml(cat)}">${ts.map(t => `<option value="${escHtml(t)}">${escHtml(t)}</option>`).join('')}</optgroup>`).join('')}
          </select>
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
          <div class="form-group"><label class="form-label">Travel Fee (R per km)</label><input class="form-input" id="edit-travel" value="${listing.travel_rate === -1 ? 'N/A' : (listing.travel_rate ?? '')}" placeholder="e.g. 8 or N/A"></div>
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
  const name = titleCase(document.getElementById('edit-business').value.trim())
  const contact_name = document.getElementById('edit-contact').value.trim()
  const travelRaw = document.getElementById('edit-travel')?.value.trim() || ''
  const travel_rate = travelRaw === '' ? null : (travelRaw.toUpperCase() === 'N/A' ? -1 : (parseInt(travelRaw) || 0))
  const calloutRaw = document.getElementById('edit-callout').value.trim()
  const rateRaw = document.getElementById('edit-rate').value.trim()
  const isNA = s => /n\/a/i.test(s) || (s && isNaN(parseInt(s)))
  const callout = isNA(calloutRaw) ? -1 : (parseInt(calloutRaw) || 0)
  const rate = isNA(rateRaw) ? -1 : (parseInt(rateRaw) || 0)
  const rateTypeEl = document.querySelector('input[name="edit-rate-type"]:checked')
  const rate_type = rateTypeEl ? rateTypeEl.value : 'hour'
  const description = fixBio(document.getElementById('edit-desc').value.trim())
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

  const phoneEditRaw = document.getElementById('edit-phone')?.value.trim().replace(/\D/g,'') || ''
  const phone = phoneEditRaw ? '+27' + (phoneEditRaw.startsWith('0') ? phoneEditRaw.slice(1) : phoneEditRaw) : ''
  const email = document.getElementById('edit-email')?.value.trim() || ''
  const lat = parseFloat(document.getElementById('edit-lat')?.value) || null
  const lng = parseFloat(document.getElementById('edit-lng')?.value) || null
  const service_radius = parseInt(document.getElementById('edit-service-radius')?.value) || 30
  const province = document.getElementById('edit-province')?.value || ''
  const city = document.getElementById('edit-city')?.value.trim() || ''
  const tradesRaw = document.getElementById('edit-trades-text')?.value || ''
  const enteredTrades = tradesRaw.split(',').map(t => t.trim()).filter(Boolean)
  // Standard trades + any custom trades the admin already approved (already in this listing's trades) go live.
  const existingListing = listings.find(l => l.id === id)
  const approvedSet = new Set((existingListing?.trades || []))
  const trades = enteredTrades.filter(t => TRADES_LIST.includes(t) || approvedSet.has(t))
  const pending_trades = enteredTrades.filter(t => !TRADES_LIST.includes(t) && !approvedSet.has(t))
  const trade = trades[0] || (pending_trades.length ? 'Pending review' : '')

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
  const updateData = { name, contact_name, phone, email, trade, trades, pending_trades, province, city, callout, travel_rate, rate, rate_type, description, credentials, years_experience, certificate_urls, lat, lng, service_radius, after_hours }
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

window.adminMoveToCredentials = async function (listingId, photoUrl, photoIndex) {
  if (!confirm('Move this image from the public portfolio to private Credentials?')) return
  toast('Moving…')
  try {
    const resp = await fetch(photoUrl)
    const blob = await resp.blob()
    const ext = photoUrl.split('.').pop().split('?')[0] || 'jpg'
    const { data: { user: adminUser } } = await supabase.auth.getUser()
    const path = `${adminUser.id}/${Date.now()}-moved.${ext}`
    const { error: upErr } = await supabase.storage.from(BUCKET_CERTS).upload(path, blob)
    if (upErr) { toast('Upload failed: ' + upErr.message); return }
    const { data: fresh } = await supabase.from('listings').select('portfolio_photos, certificate_urls').eq('id', listingId).single()
    const portfolio = (fresh?.portfolio_photos || []).filter((_, i) => i !== photoIndex)
    const certs = [...(fresh?.certificate_urls || []), path]
    const { error: dbErr } = await supabase.from('listings').update({ portfolio_photos: portfolio, certificate_urls: certs }).eq('id', listingId)
    if (dbErr) { toast('DB update failed: ' + dbErr.message); return }
    toast('Moved to Credentials!')
    const idx = (window._adminListings || []).findIndex(x => x.id === listingId)
    if (idx !== -1) { window._adminListings[idx].portfolio_photos = portfolio; window._adminListings[idx].certificate_urls = certs }
    adminEditListing(listingId)
  } catch (e) { toast('Error: ' + e.message) }
}
window.previewAdminCerts = function (files) {
  window._aemNewCertFiles = [...(window._aemNewCertFiles || []), ...Array.from(files)]
  document.getElementById('aem-cert-preview').textContent = `${window._aemNewCertFiles.length} file(s) ready to upload`
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
// Uniform Title Case: first letter of each word capitalised, the rest lowercase.
function titleCase(str) {
  if (!str) return str
  return String(str).toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase())
}
function fixBio(str) {
  if (!str) return str
  return String(str)
    .replace(/\bi\b/g, 'I')
    .replace(/(^|[.!?]\s+)([a-z])/g, (_, sep, ch) => sep + ch.toUpperCase())
    .replace(/^([a-z])/, (ch) => ch.toUpperCase())
}
function initials(name) { return name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase() }

const _revealObserver = window.IntersectionObserver ? new IntersectionObserver((entries) => {
  entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); _revealObserver.unobserve(e.target) } })
}, { threshold: 0.08 }) : null
function revealCards(container) {
  if (!_revealObserver) return
  ;(container || document).querySelectorAll('.tradesman-card, .square-card, .compact-row').forEach((el, i) => {
    el.classList.add('reveal')
    el.style.transitionDelay = Math.min(i * 40, 300) + 'ms'
    _revealObserver.observe(el)
  })
}
function fmtRand(n) { return n === -1 ? 'N/A' : n === 0 ? 'Free' : 'R' + n }
function fmtTravel(n) { return (n === null || n === undefined || n === '') ? null : n === -1 ? 'N/A' : n === 0 ? 'Free' : 'R' + n + '/km' }
// The green Verified badge shows only once an admin has reviewed the tradesman's
// uploaded documents and approved them (verified_approved = true) — not just from
// being on a paid/founding tier. Accepts the listing object.
function tierBadge(l) {
  return (l && l.verified_approved) ? '<span class="badge badge-verified">Verified</span>' : ''
}
function afterHoursBadge(l) {
  return (l && l.after_hours) ? '<span class="badge badge-afterhours">After Hours</span>' : ''
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
  // Normalise display fields to uniform Title Case (names + towns), regardless of how they were entered.
  listings = (data || []).map(l => ({
    ...l,
    name: titleCase(l.name),
    contact_name: titleCase(l.contact_name),
    city: titleCase(l.city),
    cities: Array.isArray(l.cities) ? l.cities.map(titleCase) : l.cities,
  }))
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
const PAGE_PATHS = { home: '/', directory: '/directory', rankings: '/rankings', faq: '/how-it-works', privacy: '/privacy', terms: '/terms', list: '/list', login: '/login', signup: '/signup', dashboard: '/dashboard', admin: '/admin', messages: '/messages', account: '/account' }

// ── Mobile bottom nav (role-based) ──────────────────────────────────────────
const BNAV_ICONS = {
  home: '<svg viewBox="0 0 24 24"><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/></svg>',
  directory: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>',
  rankings: '<svg viewBox="0 0 24 24"><path d="M8 21h8"/><path d="M12 17v4"/><path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/></svg>',
  saved: '<svg viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>',
  dashboard: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="5" rx="1"/><rect x="13" y="11" width="8" height="10" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/></svg>',
  messages: '<svg viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>',
  account: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
}
function bnavItem(id, label, icon, onclick, badge) {
  return `<button class="bnav-item" id="bnav-${id}" onclick="${onclick}">${BNAV_ICONS[icon]}<span>${label}</span>${badge ? '<span class="bnav-badge" id="bnav-msg-badge" style="display:none;"></span>' : ''}</button>`
}
const BNAV_RAISE = `<div class="bnav-raise"><button class="bnav-raise-btn" onclick="showPage('list')" aria-label="List your business">${BNAV_ICONS.plus}</button><span>List</span></div>`

function renderBottomNav() {
  const nav = document.getElementById('bottom-nav')
  if (!nav) return
  const type = accountType()
  const account = bnavItem('account', 'Account', 'account', 'toggleMobileMenu()')
  let items
  if (type === 'tradesman') {
    items = [
      bnavItem('home', 'Home', 'home', 'goHome()'),
      bnavItem('rankings', 'Rankings', 'rankings', "showPage('rankings')"),
      bnavItem('dashboard', 'Dashboard', 'dashboard', "showPage('dashboard')"),
      bnavItem('messages', 'Messages', 'messages', "showPage('messages')", true),
      account,
    ]
  } else if (type === 'customer') {
    items = [
      bnavItem('home', 'Home', 'home', 'goHome()'),
      bnavItem('rankings', 'Rankings', 'rankings', "showPage('rankings')"),
      BNAV_RAISE,
      bnavItem('saved', 'Saved', 'saved', 'showSaved()'),
      account,
    ]
  } else {
    items = [
      bnavItem('home', 'Home', 'home', 'goHome()'),
      bnavItem('rankings', 'Rankings', 'rankings', "showPage('rankings')"),
      BNAV_RAISE,
      account,
    ]
  }
  nav.innerHTML = items.join('')
  const active = document.querySelector('.page.active')
  if (active) setActiveBottomNav(active.id.replace('page-', ''))
}
function setActiveBottomNav(name) {
  document.querySelectorAll('.bnav-item').forEach(b => b.classList.remove('active'))
  const b = document.getElementById('bnav-' + name)
  if (b) b.classList.add('active')
}
async function loadUnreadCount() {
  const badge = document.getElementById('bnav-msg-badge')
  if (!badge) return
  if (!currentUser || accountType() !== 'tradesman') { badge.style.display = 'none'; return }
  try {
    const { count } = await supabase.from('messages').select('id', { count: 'exact', head: true }).eq('user_id', currentUser.id).eq('read', false)
    badge.style.display = count > 0 ? 'block' : 'none'
  } catch (_) {}
}

async function renderMessages() {
  const el = document.getElementById('messages-list')
  if (!el) return
  if (!currentUser) {
    el.innerHTML = `<div class="empty-state"><h3>Log in to see your messages</h3><p><a onclick="showPage('login')" style="color:var(--amber);cursor:pointer;">Log in</a> to view notices from Tradee.</p></div>`
    return
  }
  el.innerHTML = `<div style="color:var(--charcoal-6);font-size:13px;padding:1rem 0;">Loading…</div>`
  const { data, error } = await supabase.from('messages').select('*').eq('user_id', currentUser.id).order('created_at', { ascending: false })
  if (error) { el.innerHTML = `<div class="empty-state"><h3>Couldn't load messages</h3><p>Please try again.</p></div>`; return }
  if (!data || !data.length) {
    el.innerHTML = `<div class="empty-state"><h3>No messages yet</h3><p>Notices from Tradee — reviews, billing and account updates — will appear here.</p></div>`
    return
  }
  el.innerHTML = data.map(m => `<div class="msg-item${m.read ? '' : ' msg-unread'}">
    <div class="msg-top"><span class="msg-title">${escHtml(m.title)}</span><span class="msg-date">${new Date(m.created_at).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })}</span></div>
    ${m.body ? `<p class="msg-body">${escHtml(m.body)}</p>` : ''}
    ${m.link ? `<a href="${escHtml(m.link)}" class="msg-link">Open →</a>` : ''}
  </div>`).join('')
  // Mark everything read once viewed, then refresh the unread dot.
  const unreadIds = data.filter(m => !m.read).map(m => m.id)
  if (unreadIds.length) {
    try { await supabase.from('messages').update({ read: true }).in('id', unreadIds).eq('user_id', currentUser.id) } catch (_) {}
    loadUnreadCount()
  }
}

// ── Account settings ────────────────────────────────────────────────────────
function renderAccount() {
  const guard = document.getElementById('account-guard')
  const forms = document.getElementById('account-forms')
  if (!currentUser) {
    if (forms) forms.style.display = 'none'
    if (guard) guard.innerHTML = `<div class="empty-state"><h3>Log in to manage your account</h3><p><a onclick="showPage('login')" style="color:var(--amber);cursor:pointer;">Log in</a> to update your details.</p></div>`
    return
  }
  if (guard) guard.innerHTML = ''
  if (forms) forms.style.display = 'block'
  const name = document.getElementById('acc-name'); if (name) name.value = userProfile?.full_name || ''
  const email = document.getElementById('acc-email'); if (email) email.value = currentUser.email || ''
  const mkt = document.getElementById('acc-marketing'); if (mkt) mkt.checked = !!userProfile?.marketing_opt_in
  const pw = document.getElementById('acc-pw'); if (pw) pw.value = ''
  const pw2 = document.getElementById('acc-pw2'); if (pw2) pw2.value = ''
}

window.saveAccountDetails = async function () {
  if (!currentUser) { window.showPage('login'); return }
  const full_name = document.getElementById('acc-name').value.trim()
  const email = document.getElementById('acc-email').value.trim()
  const marketing = !!document.getElementById('acc-marketing')?.checked
  if (!full_name) { toast('Please enter your name.'); return }
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { toast('Please enter a valid email.'); return }
  toast('Saving…')
  // Profile fields
  try {
    await supabase.from('profiles').update({
      full_name,
      marketing_opt_in: marketing,
      marketing_opt_in_at: marketing ? (userProfile?.marketing_opt_in ? userProfile.marketing_opt_in_at : new Date().toISOString()) : null
    }).eq('id', currentUser.id)
    if (userProfile) { userProfile.full_name = full_name; userProfile.marketing_opt_in = marketing }
  } catch (e) { toast('Could not save your details — please try again.'); return }
  // Email change (Supabase auth) — only if it actually changed
  if (email !== currentUser.email) {
    const { error } = await supabase.auth.updateUser({ email })
    if (error) { toast('Details saved, but email change failed: ' + error.message); return }
    toast('Saved. Check your inbox to confirm your new email address.')
    return
  }
  toast('Account details saved.')
}

window.updatePassword = async function () {
  if (!currentUser) { window.showPage('login'); return }
  const pw = document.getElementById('acc-pw').value
  const pw2 = document.getElementById('acc-pw2').value
  if (!pw || pw.length < 6) { toast('Password must be at least 6 characters.'); return }
  if (pw !== pw2) { toast('Passwords do not match.'); return }
  const { error } = await supabase.auth.updateUser({ password: pw })
  if (error) { toast('Could not update password: ' + error.message); return }
  document.getElementById('acc-pw').value = ''
  document.getElementById('acc-pw2').value = ''
  toast('Password updated.')
}

window.showPage = function (name, fromRoute) {
  if (name === 'directory') name = 'home'   // home + directory are one merged browse page
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'))
  document.getElementById('page-' + name).classList.add('active')
  // Record this page in browser history so the Back/Forward buttons move between in-app pages.
  if (!fromRoute) {
    try { window.history.pushState({ tradeePage: name }, '', PAGE_PATHS[name] || '/') } catch (_) {}
  }
  document.querySelectorAll('.nav-links a').forEach(a => a.classList.remove('active'))
  const el = document.getElementById('nav-' + name)
  if (el) el.classList.add('active')
  // Leaving the browse page clears the saved-only view.
  if (name !== 'home') _favsOnly = false
  setActiveBottomNav(name)
  window.scrollTo(0, 0)
  if (name === 'home') renderHome()
  if (name === 'rankings') renderRankings()
  if (name === 'dashboard') renderDashboard()
  if (name === 'messages') renderMessages()
  if (name === 'account') renderAccount()
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

// ── Home = Browse (merged home + directory) ─────────────────────────────────
// The landing renders the trade chips, then the full filterable directory below.
function renderHome() {
  const allTrades = [...new Set(listings.map(l => l.trade))].sort()
  const catsEl = document.getElementById('trade-cats')
  if (catsEl) {
    catsEl.classList.add('icon-cats')
    catsEl.innerHTML = allTrades.map(t =>
      `<div class="cat-chip" data-trade="${escHtml(t)}">
        <div class="cat-ico">${tradeIconSVG(t)}</div>
        <div class="cat-lbl">${escHtml(t.split(' /')[0])}</div>
      </div>`).join('')
    catsEl.querySelectorAll('.cat-chip').forEach(el =>
      el.addEventListener('click', () => window.filterByTrade(el.dataset.trade)))
  }
  renderDirectory()
}

// Reset to a clean, unfiltered browse (used by the Home tab / logo).
window.goHome = function () {
  _smartMode = false; _favsOnly = false; filterTrade = ''; filterProvince = ''; filterCity = ''; dirSearchTerm = ''
  // reset the search pill labels
  document.querySelectorAll('.pill-trade-label').forEach(tl => { tl.textContent = 'Describe it, or pick a trade…'; tl.classList.remove('set') })
  document.querySelectorAll('.pill-loc-label').forEach(ll => { ll.textContent = 'Any area'; ll.classList.remove('set') })
  showPage('home')
}
window.filterByTrade = function (trade) { _smartMode = false; _favsOnly = false; filterTrade = trade; const ft = document.getElementById('filter-trade'); if (ft) ft.value = trade; showPage('home') }
// Browse the full directory (clears any saved-only view).
window.browseDirectory = function () { _favsOnly = false; _smartMode = false; showPage('home') }
// Show only the current user's saved listings.
window.showSaved = function () { _favsOnly = true; _smartMode = false; showPage('home') }

// ── Trade icons (line SVGs, category-based with a few specific overrides) ───────
const CAT_ICONS = {
  'Home & Building': '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/>',
  'Electrical & Tech': '<path d="M13 2 3 14h7l-1 8 10-12h-7z"/>',
  'Plumbing & HVAC': '<path d="M12 3s6 6 6 10a6 6 0 0 1-12 0c0-4 6-10 6-10z"/>',
  'Finishing & Interior': '<rect x="4" y="4" width="13" height="6" rx="1"/><path d="M17 7h3v4h-7v3"/><path d="M13 14v3a1 1 0 0 1-1 1 1 1 0 0 0-1 1v3"/>',
  'Outdoor & Garden': '<path d="M12 22V12M12 12c0-4 2-7 6-8-1 4-2 7-6 8zM12 12c0-3-2-5-5-6 1 3 2 5 5 6z"/>',
  'Automotive': '<path d="M5 13l1.5-4.5A2 2 0 0 1 8.4 7h7.2a2 2 0 0 1 1.9 1.5L19 13"/><path d="M4 13h16v4H4z"/><circle cx="7.5" cy="17.5" r="1.5"/><circle cx="16.5" cy="17.5" r="1.5"/>',
  'Appliances & Small Jobs': '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.5-.7-.7-2.5z"/>',
  'Cleaning': '<path d="M9 3h4v3H9z"/><path d="M13 4h4l1 3h-6z"/><path d="M9 6H7a2 2 0 0 0-2 2v12h8V8a2 2 0 0 0-2-2z"/><path d="M6 12h6"/>',
}
const TRADE_ICONS = {
  'Plumber': '<path d="M9 3v4a3 3 0 0 0 3 3 3 3 0 0 0 3-3V3"/><path d="M12 10v11"/><path d="M8 21h8"/>',
  'Electrician': '<path d="M13 2 3 14h7l-1 8 10-12h-7z"/>',
  'Painter': '<path d="M3 21v-3a3 3 0 1 1 3 3H3"/><path d="M20 4a13 13 0 0 0-11 8.5"/><path d="M20 4a13 13 0 0 1-8.5 11"/><path d="M10.5 9a7 7 0 0 1 4 4"/>',
  'Tiler': '<rect x="3" y="3" width="18" height="18" rx="1"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
  'Carpenter': '<path d="M3 17l14-4 4 4-4 4-3-3"/><path d="M3 17l2-6 2 1 1-3 2 1 1-3 2 1"/>',
  'Handyman': '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.5-.7-.7-2.5z"/>',
  'CCTV Installer': '<path d="M3 6l16 3.8l-1 4.4l-16 -3.8z"/><circle cx="4.2" cy="7.7" r="1.15"/><path d="M10.5 13.2l-2 6.3"/><path d="M4.5 19.5h8"/>',
}
let _tradeToCat = null
function tradeIconPaths(trade) {
  if (!_tradeToCat) {
    _tradeToCat = {}
    for (const [c, ts] of Object.entries(TRADE_CATEGORIES)) ts.forEach(t => { _tradeToCat[t] = c })
  }
  return TRADE_ICONS[trade] || CAT_ICONS[_tradeToCat[trade]] || '<circle cx="12" cy="12" r="8"/>'
}
function tradeIconSVG(trade) {
  return `<svg viewBox="0 0 24 24">${tradeIconPaths(trade)}</svg>`
}

// ── Popup search modal ──────────────────────────────────────────────────────
const POPULAR_TRADES = ['Plumber', 'Electrician', 'Builder / General Contractor', 'Painter', 'Tiler', 'Handyman']
window.openSearchModal = function () {
  const sel = document.getElementById('modal-trade')
  if (sel && sel.options.length <= 1) sel.innerHTML = '<option value="">Any trade</option>' + buildTradeOptgroups()
  const pop = document.getElementById('modal-popular')
  if (pop && !pop.dataset.built) {
    pop.innerHTML = POPULAR_TRADES.map(t =>
      `<div class="sm-sug" data-trade="${escHtml(t)}">${tradeIconSVG(t)}${escHtml(t.split(' /')[0])}</div>`).join('')
    pop.querySelectorAll('.sm-sug').forEach(el => el.addEventListener('click', () => {
      const active = el.classList.contains('active')
      pop.querySelectorAll('.sm-sug').forEach(s => s.classList.remove('active'))
      if (!active) { el.classList.add('active'); document.getElementById('modal-trade').value = el.dataset.trade }
      else document.getElementById('modal-trade').value = ''
    }))
    pop.dataset.built = '1'
  }
  // reflect current picks when reopening
  const mt = document.getElementById('modal-trade'); if (mt) mt.value = filterTrade
  const mp = document.getElementById('modal-province'); if (mp) mp.value = filterProvince
  updateModalCities()
  const mc = document.getElementById('modal-city'); if (mc) mc.value = filterCity
  const mah = document.getElementById('modal-afterhours'); if (mah) mah.checked = filterAfterHours
  document.querySelectorAll('#modal-popular .sm-sug').forEach(s => s.classList.toggle('active', s.dataset.trade === filterTrade && !!filterTrade))
  document.getElementById('search-modal').classList.add('open')
}
window.closeSearchModal = function () { document.getElementById('search-modal').classList.remove('open') }
// Populate the modal's city dropdown from the chosen province (or all cities).
window.updateModalCities = function () {
  const sel = document.getElementById('modal-city')
  if (!sel) return
  const prov = document.getElementById('modal-province')?.value || ''
  const prev = sel.value
  const cities = prov && PROVINCE_CITIES[prov] ? PROVINCE_CITIES[prov] : Object.values(PROVINCE_CITIES).flat().sort()
  sel.innerHTML = '<option value="">All cities</option>' + cities.map(c => `<option value="${escHtml(c)}">${escHtml(c)}</option>`).join('')
  if ([...sel.options].some(o => o.value === prev)) sel.value = prev
}
window.modalSearch = function () {
  _smartMode = false
  filterTrade = document.getElementById('modal-trade')?.value || ''
  filterProvince = document.getElementById('modal-province')?.value || ''
  filterAfterHours = !!document.getElementById('modal-afterhours')?.checked
  filterCity = document.getElementById('modal-city')?.value || ''
  const dp = document.getElementById('filter-province'); if (dp) dp.value = filterProvince
  const dt = document.getElementById('filter-trade'); if (dt) dt.value = filterTrade
  // reflect the picks on every search pill (home, directory, rankings)
  document.querySelectorAll('.pill-trade-label').forEach(tl => {
    tl.textContent = filterTrade ? filterTrade.split(' /')[0] : 'Describe it, or pick a trade…'
    tl.classList.toggle('set', !!filterTrade)
  })
  const locLabel = filterCity || filterProvince || 'Any area'
  document.querySelectorAll('.pill-loc-label').forEach(ll => {
    ll.textContent = locLabel
    ll.classList.toggle('set', !!(filterCity || filterProvince))
  })
  closeSearchModal()
  window.showPage('directory')
}
window.updateHeroTrades = function () {}
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
    let tradeHit = false
    const lTrades = (l.trades && l.trades.length ? l.trades : [l.trade]).filter(Boolean)
    if (targetTrades.size) {
      const m = lTrades.find(t => targetTrades.has(t))
      if (m) { score += 60; reasons.push(m); tradeHit = true }
      else if (lTrades.some(t => words.some(w => t.toLowerCase().includes(w)))) { score += 15; tradeHit = true }
    }
    if (city && (l.city === city || (l.cities || []).includes(city))) { score += 35; reasons.push(city) }
    else if (province && l.province === province) { score += 20; if (!city) reasons.push(province) }
    else if (city || province) score -= 12
    const hay = (l.name + ' ' + (l.description || '') + ' ' + lTrades.join(' ')).toLowerCase()
    words.forEach(w => { if (hay.includes(w)) score += 3 })
    const r = avgRating(l)
    score += r * 4
    if (l.tier === 'premium') score += 6; else if (l.tier === 'verified') score += 3 // priority ranking: Premium > Verified > Free
    if (emergency && l.after_hours) { score += 25; reasons.push('After-hours') }
    else if (emergency && /(emergency|24|after hour|same day|urgent)/.test(hay)) { score += 18; reasons.push('Emergency') }
    if (topRated && r >= 4.5) score += 12
    if (affordable && l.callout >= 0) score += Math.max(0, 12 - l.callout / 100)
    return { l, score, reasons: [...new Set(reasons)], tradeHit }
  })

  let filtered
  if (targetTrades.size) {
    // A specific trade was searched → only show listings in that trade.
    filtered = ranked.filter(x => x.tradeHit)
  } else if (city || province) {
    filtered = ranked.filter(x => x.score >= 20)
  } else {
    filtered = ranked
  }
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
  if (el && el.closest) input = (el.closest('.smart-search') || el.closest('.sm-ai-box'))?.querySelector('.smart-q-input')
  if (!input) input = document.querySelector('.smart-q-input')
  const q = (input?.value || '').trim()
  if (!q) return
  const res = runSmartSearch(q, listings)
  _smartMode = true; _smartRanked = res.ranked; _smartQuery = q; _smartInterp = res.interp
  // mirror the query into every box so it shows consistently
  document.querySelectorAll('.smart-q-input').forEach(i => { i.value = q })
  if (typeof closeSearchModal === 'function') closeSearchModal()
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
    html += `<div class="square-grid">${_smartRanked.map(x => squareCardHTML(x.l)).join('')}</div>`
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
  const city = titleCase(input.value.trim())
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
  const ftSel = document.getElementById('filter-trade'); if (ftSel) ftSel.value = filterTrade
  window.updateHeroTrades()
}

window.applyFilters = function () {
  _smartMode = false
  filterTrade = document.getElementById('filter-trade')?.value ?? filterTrade
  filterProvince = document.getElementById('filter-province')?.value ?? filterProvince
  filterSort = document.getElementById('filter-sort')?.value ?? filterSort
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
  const nearWrap = document.getElementById('near-me-toggle-wrap')
  if (nearWrap) nearWrap.style.display = view === 'map' ? 'flex' : 'none'
  const nearCheck = document.getElementById('near-me-check')
  if (nearCheck) nearCheck.checked = _nearMeActive
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
  const check = document.getElementById('near-me-check')
  const status = document.getElementById('near-me-status')
  if (_nearMeActive) {
    _nearMeActive = false; _userLat = null; _userLng = null
    if (check) check.checked = false
    if (status) { status.style.display = 'none'; status.textContent = '' }
    renderDirectory(); return
  }
  if (!navigator.geolocation) { toast('Your browser does not support location.'); if (check) check.checked = false; return }
  if (status) { status.style.display = 'block'; status.textContent = 'Locating you…' }
  navigator.geolocation.getCurrentPosition(pos => {
    _userLat = pos.coords.latitude; _userLng = pos.coords.longitude
    _nearMeActive = true
    if (check) check.checked = true
    if (status) { status.style.display = 'block'; status.textContent = 'Showing tradesmen who cover your area.' }
    window.setDirView('map')
    renderDirectory()
  }, () => {
    if (check) check.checked = false
    if (status) { status.style.display = 'none' }
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
  const fpSel = document.getElementById('filter-province'); if (fpSel) fpSel.value = filterProvince
  const fsSel = document.getElementById('filter-sort'); if (fsSel) fsSel.value = filterSort
  const tierOrder = { premium: 0, verified: 1, free: 2 }
  const showFavsOnly = _favsOnly || document.getElementById('fav-filter-btn')?.dataset.active === '1'
  const afterHoursOnly = filterAfterHours || document.getElementById('afterhours-filter-btn')?.dataset.active === '1'
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
  document.getElementById('dir-title').textContent = _favsOnly ? 'Saved' : (titleParts.length ? titleParts.join(' — ') : 'All Tradesmen')
  document.getElementById('dir-count').textContent = _favsOnly
    ? `${filtered.length} saved listing${filtered.length !== 1 ? 's' : ''}`
    : `${filtered.length} listing${filtered.length !== 1 ? 's' : ''}`

  // Split premium (featured) from the rest — rotate every 10 minutes so each paid account gets frequent top exposure
  const allPremium = filtered.filter(l => l.tier === 'premium')
  const slot10 = Math.floor(Date.now() / (10 * 60 * 1000))
  const offset = allPremium.length > 0 ? slot10 % allPremium.length : 0
  const featured = [...allPremium.slice(offset), ...allPremium.slice(0, offset)]
  const rest = filtered.filter(l => l.tier !== 'premium')

  const emptyHtml = _favsOnly
    ? `<div class="empty-state" style="grid-column:1/-1"><h3>No saved tradesmen yet</h3><p>Tap the heart on any listing to save it here.</p></div>`
    : `<div class="empty-state" style="grid-column:1/-1"><h3>No Results Found</h3><p>Try adjusting your filters or <a onclick="showPage('list')" style="color:var(--amber);cursor:pointer;">list your business</a> here.</p></div>`
  const featLabel = `<div style="grid-column:1/-1;margin-bottom:0.5rem;"><div style="display:flex;align-items:center;gap:12px;margin-bottom:1rem;"><span style="font-family:'Bebas Neue',sans-serif;font-size:1.2rem;letter-spacing:0.06em;color:var(--amber);">Featured Tradesmen</span><div style="flex:1;height:1px;background:linear-gradient(to right,rgba(245,158,11,0.4),transparent);"></div></div></div>`
  // Featured premium in a swipe carousel, the rest as a tile grid with load-more. (All screen sizes.)
  let html = ''
  if (featured.length) html += featLabel + `<div class="square-grid" style="margin-bottom:12px;">${featured.map(l => squareCardHTML(l, null, true)).join('')}</div>`
  if (rest.length) {
    html += `<div class="square-grid">${rest.map((l, i) => squareCardHTML(l, null, false, i >= 12)).join('')}</div>` + (rest.length > 12 ? `<div style="grid-column:1/-1;text-align:center;padding:14px 0;"><span onclick="document.querySelectorAll('#dir-cards .more-hidden').forEach(c=>c.style.display='');this.parentNode.remove()" style="color:var(--amber);border:0.5px solid var(--charcoal-3);border-radius:999px;padding:8px 20px;cursor:pointer;font-size:13px;">Load more (${rest.length - 12})</span></div>` : '')
  } else if (!featured.length) html += emptyHtml

  document.getElementById('dir-cards').innerHTML = html
  revealCards(document.getElementById('dir-cards'))
  dirSearchTerm = ''

  // Track search impressions for each visible listing
  filtered.forEach(l => {
    trackEvent('search_impression', l.id, { trade: l.trade, province: l.province })
  })
}

function isMobileView() { return window.matchMedia('(max-width: 640px)').matches }

// Small featured card for the mobile swipe carousel (no contact details).
function featuredMiniHTML(l) {
  const rating = avgRating(l), rd = rating > 0 ? rating.toFixed(1) : '—'
  const reviewCount = l.reviews ? l.reviews.length : 0
  const trade = (l.trades && l.trades.length ? l.trades[0] : l.trade) || ''
  const av = l.photo_url ? `<img src="${escHtml(l.photo_url)}" style="width:100%;height:100%;object-fit:cover;">` : initials(l.name)
  const verified = l.verified_approved ? '<span style="font-size:9px;color:#22C55E;border:1px solid #22C55E;border-radius:3px;padding:1px 5px;">Verified</span>' : ''
  const after = l.after_hours ? '<span style="font-size:9px;color:var(--amber);border:1px solid var(--amber);border-radius:3px;padding:1px 5px;">After Hrs</span>' : ''
  const reviewStr = reviewCount > 0 ? `★ ${rd} <span style="color:var(--charcoal-6);">(${reviewCount})</span>` : '<span style="color:var(--amber);">★</span> <span style="color:var(--charcoal-6);">No reviews yet</span>'
  return `<div class="feat-mini" onclick="openProfile(${l.id})">
    <span style="position:absolute;top:8px;right:8px;background:var(--amber);color:var(--charcoal);font-size:8px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;padding:2px 7px;border-radius:999px;">Featured</span>
    <div style="width:36px;height:36px;border-radius:7px;background:var(--charcoal-3);display:flex;align-items:center;justify-content:center;color:var(--amber);font-family:'Bebas Neue',sans-serif;font-size:1.05rem;margin-bottom:7px;overflow:hidden;">${av}</div>
    <div style="color:var(--white);font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding-right:8px;">${escHtml(l.name)}</div>
    <div style="color:var(--amber);font-size:11px;">${escHtml(trade)}</div>
    <div style="color:var(--amber);font-size:11px;margin-top:5px;">${reviewStr}</div>
    <div style="display:flex;gap:4px;margin-top:6px;flex-wrap:wrap;">${verified}${after}</div>
  </div>`
}

// Small square card for the mobile 2-column grid of standard listings.
function squareCardHTML(l, rankNum, featured, hidden) {
  const rating = avgRating(l), rd = rating > 0 ? rating.toFixed(1) : null
  const reviewCount = l.reviews ? l.reviews.length : 0
  const trade = (l.trades && l.trades.length ? l.trades[0] : l.trade) || ''
  const suburb = (l.cities && l.cities.length ? l.cities[0] : (l.city || l.province)) || ''
  const av = l.photo_url ? `<img src="${escHtml(l.photo_url)}">` : initials(l.name)
  const featuredBadge = featured ? '<span style="font-size:9px;font-weight:700;background:var(--amber);color:var(--charcoal);border-radius:3px;padding:1px 6px;letter-spacing:0.04em;">FEATURED</span>' : ''
  const verifiedBadge = l.verified_approved ? '<span style="font-size:9px;color:#22C55E;border:1px solid #22C55E;border-radius:3px;padding:1px 5px;">Verified</span>' : ''
  const afterBadge = l.after_hours ? '<span style="font-size:9px;color:var(--amber);border:1px solid var(--amber);border-radius:3px;padding:1px 5px;">After Hrs</span>' : ''
  const favBtn = currentUser ? `<button class="fav-btn sc-fav" data-id="${l.id}" onclick="event.stopPropagation();window.toggleFav(${l.id},event)" title="Save" aria-label="Save to your profile" style="color:${isFav(l.id) ? 'var(--amber)' : 'var(--charcoal-6)'};">${isFav(l.id) ? FAV_HEART_FILLED : FAV_HEART_EMPTY}</button>` : ''
  const topRight = (featuredBadge || verifiedBadge || afterBadge || favBtn)
    ? `<div class="sc-top-right">${featuredBadge}${verifiedBadge}${afterBadge}${favBtn}</div>` : ''
  const ratingStr = rd
    ? `<span style="color:var(--amber);">★</span> <span style="color:var(--white);font-weight:700;">${rd}</span> <span style="color:var(--charcoal-6);">(${reviewCount})</span>`
    : '<span style="color:var(--amber);">★</span> <span style="color:var(--charcoal-6);">No reviews yet</span>'
  return `<div class="square-card${featured ? ' square-card--featured' : ''}${hidden ? ' more-hidden' : ''}"${hidden ? ' style="display:none"' : ''} onclick="openProfile(${l.id})">
    <div class="sc-top">
      <div class="sc-av2">${av}</div>
      ${topRight}
    </div>
    <div class="sc-name">${escHtml(l.name)}</div>
    <div class="sc-trade2">${escHtml(trade)}</div>
    <div class="sc-rating2">${ratingStr}</div>
    <div class="sc-foot">
      <span class="sc-loc"><svg viewBox="0 0 24 24"><path d="M12 21s-7-6-7-11a7 7 0 0 1 14 0c0 5-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg><span>${escHtml(suburb)}</span></span>
      <span class="sc-view">View →</span>
    </div>
  </div>`
}

function compactRowHTML(l) {
  const rating = avgRating(l)
  const rd = rating > 0 ? rating.toFixed(1) : null
  const reviewCount = l.reviews ? l.reviews.length : 0
  const trade = (l.trades && l.trades.length ? l.trades[0] : l.trade) || ''
  const suburb = (l.cities && l.cities.length ? l.cities[0] : (l.city || l.province)) || ''
  const av = l.photo_url ? `<img src="${escHtml(l.photo_url)}">` : initials(l.name)
  const verified = l.verified_approved ? '<span style="color:#22C55E;font-size:12px;" title="Verified">✔</span>' : ''
  const after = l.after_hours ? '<span class="compact-mini" style="color:var(--amber);border:0.5px solid var(--amber);">After Hours</span>' : ''
  const ratingStr = rd ? `★ ${rd} (${reviewCount})` : 'No reviews yet'
  return `<div class="compact-row" onclick="openProfile(${l.id})">
    <div class="compact-av">${av}</div>
    <div style="flex:1;min-width:0;">
      <div style="display:flex;align-items:center;gap:6px;"><span class="compact-name">${escHtml(l.name)}</span>${verified}${after}</div>
      <div class="compact-sub">${escHtml(trade)}${suburb ? ' · ' + escHtml(suburb) : ''} · <span style="color:var(--amber);">${ratingStr}</span></div>
    </div>
    <span style="color:var(--charcoal-5);font-size:20px;line-height:1;flex:0 0 auto;">›</span>
  </div>`
}

// Re-render the directory/home when crossing the mobile breakpoint so the layout swaps cleanly.
try {
  window.matchMedia('(max-width: 640px)').addEventListener('change', () => {
    if (document.getElementById('page-directory')?.classList.contains('active')) renderDirectory()
    if (document.getElementById('page-home')?.classList.contains('active')) renderHome()
    if (document.getElementById('page-rankings')?.classList.contains('active')) renderRankings()
  })
} catch (_) {}

function featuredCardHTML(l) {
  const rating = avgRating(l), rd = rating > 0 ? rating.toFixed(1) : '—'
  const reviewCount = l.reviews ? l.reviews.length : 0
  const allTrades = l.trades && l.trades.length ? l.trades : (l.trade ? [l.trade] : [])
  const rateLabel = l.rate_type === 'day' ? 'Rate / Day' : 'Rate / Hr'
  return `<div class="tradesman-card featured-card" onclick="openProfile(${l.id})" style="border-color:var(--amber);background:linear-gradient(135deg,var(--charcoal-2) 0%,rgba(245,158,11,0.06) 100%);box-shadow:0 0 24px rgba(245,158,11,0.12);">
    <div style="position:absolute;top:12px;right:12px;background:var(--amber);color:var(--charcoal);font-size:10px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;padding:3px 10px;border-radius:100px;">Featured</div>
    <div class="card-header" style="margin-right:70px;">
      <div class="card-avatar premium-av">${l.photo_url ? `<img src="${escHtml(l.photo_url)}" style="width:100%;height:100%;object-fit:cover;border-radius:var(--radius);">` : initials(l.name)}</div>
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
  return `<div class="tradesman-card${l.verified_approved ? ' tradesman-card--verified' : ''}">
    <div class="card-header">
      <div class="card-avatar ${l.tier === 'premium' ? 'premium-av' : ''}">${l.photo_url ? `<img src="${escHtml(l.photo_url)}" style="width:100%;height:100%;object-fit:cover;border-radius:var(--radius);">` : initials(l.name)}</div>
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
window.openProfile = async function (id, fromRoute) {
  const { data: l, error } = await supabase
    .from('listings')
    .select('*, reviews(*)')
    .eq('id', id)
    .single()
  if (error || !l) return
  currentProfile = l
  if (!fromRoute) {
    try { window.history.pushState({ tradeePage: 'profile', pid: id }, '', `/profile/${slugify(l.name, l.id)}`) } catch (_) {}
  }
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
         <span style="font-size:13px;color:var(--charcoal-6);">Identity verified by Tradee.</span>
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
          ${r.reliability ? `<div style="font-size:12px;color:var(--charcoal-6);">Reliability <span style="color:var(--amber);">${'★'.repeat(r.reliability)}</span></div>` : ''}
          ${r.responsiveness ? `<div style="font-size:12px;color:var(--charcoal-6);">Responsiveness <span style="color:var(--amber);">${'★'.repeat(r.responsiveness)}</span></div>` : ''}
          ${r.professionalism ? `<div style="font-size:12px;color:var(--charcoal-6);">Professionalism <span style="color:var(--amber);">${'★'.repeat(r.professionalism)}</span></div>` : ''}
          ${r.recommend ? `<div style="font-size:12px;color:var(--charcoal-6);">Would recommend <span style="color:var(--amber);">${'★'.repeat(r.recommend)}</span></div>` : ''}
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
    <div class="profile-back" onclick="window.showPage('directory')">← Back to Directory</div>
    <div class="profile-hero">
      <div class="profile-avatar">${l.photo_url ? `<img src="${escHtml(l.photo_url)}" style="width:100%;height:100%;object-fit:cover;border-radius:var(--radius);">` : initials(l.name)}</div>
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
          ${l.phone ? `<a href="https://wa.me/${(d => d.startsWith('0') ? '27' + d.slice(1) : d.startsWith('+') ? d.slice(1) : d)(l.phone.replace(/\D/g,''))}" target="_blank" onclick="trackContact(${l.id},'whatsapp')" class="btn btn-primary btn-sm" style="background:#25D366;text-decoration:none;">WhatsApp</a>` : ''}
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
      <div class="stat-box"><span class="value">${fmtRand(l.rate)}${l.rate !== -1 ? (l.rate_type === 'day' ? '/day' : '/hr') : ''}</span><div class="label">${rateLabel}</div></div>
      ${fmtTravel(l.travel_rate) ? `<div class="stat-box"><span class="value">${fmtTravel(l.travel_rate)}</span><div class="label">Travel Fee</div></div>` : ''}
      <div class="stat-box"><span class="value">${l.years_experience || '—'}</span><div class="label">Years Experience</div></div>
    </div>
    <div class="profile-section">
      <div class="section-title">About</div>
      <p style="font-size:15px;line-height:1.7;color:var(--charcoal-7);">${escHtml(fixBio(l.description)) || 'No description provided.'}</p>
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
  window.history.back()
}

// ── Reviews ───────────────────────────────────────────────────────────────────
window.closeReviewModal = function () { document.getElementById('review-modal').classList.remove('open') }

window.submitReview = async function () {
  try {
    if (!currentUser) { toast('Please log in to leave a review.'); window.showPage('login'); return }
    const reviewer_name = (userProfile?.full_name || currentUser.email || '').trim()
    const review_text = document.getElementById('r-text').value.trim()
    if (!review_text) { toast('Please fill in your written review.'); return }

    const quality = getStarVal('star-quality')
    const service = getStarVal('star-service')
    const cleanliness = getStarVal('star-clean')
    const communication = getStarVal('star-comms')
    const value = getStarVal('star-value')
    const reliability = getStarVal('star-reliability') || null
    const responsiveness = getStarVal('star-responsiveness') || null
    const professionalism = getStarVal('star-professionalism') || null
    const recommend = getStarVal('star-recommend') || null
    if (!quality) { toast('Please rate Quality of Work.'); return }
    if (!service) { toast('Please rate Level of Service.'); return }
    if (!cleanliness) { toast('Please rate Cleanliness.'); return }
    if (!communication) { toast('Please rate Communication.'); return }
    if (!value) { toast('Please rate Value for Money.'); return }

    const allRated = [quality, service, cleanliness, communication, value, reliability, responsiveness, professionalism, recommend].filter(Boolean)
    const stars = Math.round(allRated.reduce((a, b) => a + b, 0) / allRated.length)

    toast('Submitting...')
    const payload = { review_text, stars, quality, service, cleanliness, communication, value, reliability, responsiveness, professionalism, recommend }
    let error
    if (_editingReviewId) {
      ({ error } = await supabase.from('reviews').update(payload).eq('id', _editingReviewId).eq('user_id', currentUser.id))
    } else {
      ({ error } = await supabase.from('reviews').insert({ listing_id: reviewingId, user_id: currentUser.id, reviewer_name, ...payload }))
    }
    if (error) {
      if (/duplicate|unique/i.test(error.message)) { toast("You've already reviewed this tradesman — your review has been updated."); }
      else { toast('Error: ' + error.message); console.error(error); return }
    }

    trackEvent('review_left', reviewingId)
    supabase.functions.invoke('review-notification', { body: { listing_id: reviewingId, reviewerName: reviewer_name, stars } }).catch(() => {})
    closeReviewModal()
    toast(_editingReviewId ? 'Review updated — thank you!' : 'Review submitted — thank you!')
    await loadListings()
    if (currentProfile && currentProfile.id === reviewingId) openProfile(reviewingId)
  } catch (err) {
    toast('Unexpected error: ' + err.message)
    console.error(err)
  }
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
  const rankList = document.getElementById('rank-list')
  if (!ranked.length) {
    rankList.innerHTML = '<p style="color:var(--charcoal-6);padding:2rem 0;">No ranked tradesmen yet.</p>'
  } else {
    // Same square tiles as home/directory, in ranked order (with a rank number prefix). All screen sizes.
    rankList.innerHTML = `<div class="square-grid">${ranked.map((l, i) => squareCardHTML(l, i + 1)).join('')}</div>`
  }
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

window.goToStep2 = async function () {
  const email = document.getElementById('f-email').value.trim()
  const password = document.getElementById('f-password').value
  if (!email) { toast('Please enter your email address.'); return }
  if (!password || password.length < 6) { toast('Password must be at least 6 characters.'); return }

  const proceed = () => {
    document.getElementById('list-step-1').style.display = 'none'
    document.getElementById('list-step-2').style.display = 'block'
    window.scrollTo(0, 0)
  }
  // If this account already has a listing, take them straight to it instead of making a new one.
  const goToExistingListing = async (uid) => {
    const { data } = await supabase.from('listings').select('id').eq('user_id', uid).maybeSingle()
    if (data) { toast("Welcome back — here's your listing."); window.showPage('dashboard'); return true }
    return false
  }

  // Already logged in this session?
  if (currentUser) {
    if (await goToExistingListing(currentUser.id)) return
    proceed(); return
  }

  // Try logging them in with what they entered — maybe they already have an account.
  const { data: signInData, error: signInErr } = await supabase.auth.signInWithPassword({ email, password })
  if (!signInErr && signInData?.user) {
    currentUser = signInData.user
    if (await goToExistingListing(signInData.user.id)) return
    proceed(); return // account exists but no listing yet — let them create one
  }

  // Not a valid login — create a new account (or detect a wrong-password clash).
  const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({ email, password })
  if (signUpErr) {
    if (/already|registered|exists/i.test(signUpErr.message)) {
      toast('You already have an account with this email — please log in.')
      const le = document.getElementById('login-email'); if (le) le.value = email
      window.showPage('login'); return
    }
    toast('Account error: ' + signUpErr.message); return
  }
  if (signUpData?.user) { currentUser = signUpData.user; supabase.functions.invoke('welcome-email', { body: { email } }).catch(() => {}) }
  proceed()
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
  const input = document.getElementById('f-trade-new')
  const val = titleCase(input.value.trim())
  if (val && !selectedTrades.includes(val)) {
    selectedTrades.push(val)
    updateTradeLabel()
    renderTradeList()
  }
  input.value = ''
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
  const name = titleCase(document.getElementById('f-business').value.trim() || contact_name)
  const phoneRaw = document.getElementById('f-phone')?.value.trim().replace(/\D/g, '') || ''
  const phone = phoneRaw ? '+27' + (phoneRaw.startsWith('0') ? phoneRaw.slice(1) : phoneRaw) : ''
  // Split into standard trades (go live now) and custom trades (held for admin approval).
  const standardTrades = selectedTrades.filter(t => TRADES_LIST.includes(t))
  const pending_trades = selectedTrades.filter(t => !TRADES_LIST.includes(t))
  const trades = standardTrades
  const trade = standardTrades[0] || (pending_trades.length ? 'Pending review' : '')
  const province = document.getElementById('f-province').value
  const city = selectedCities.length > 0 ? selectedCities[0] : ''
  const travelRaw = document.getElementById('f-travel')?.value.trim() || ''
  const travel_rate = travelRaw === '' ? null : (travelRaw.toUpperCase() === 'N/A' ? -1 : (parseInt(travelRaw) || 0))
  const calloutRaw = document.getElementById('f-callout').value.trim()
  const rateRaw = document.getElementById('f-rate').value.trim()
  const isNA = s => /n\/a/i.test(s) || (s && isNaN(parseInt(s)))
  const callout = isNA(calloutRaw) ? -1 : (parseInt(calloutRaw) || 0)
  const rate = isNA(rateRaw) ? -1 : (parseInt(rateRaw) || 0)
  const rateTypeEl = document.querySelector('input[name="f-rate-type"]:checked')
  const rate_type = rateTypeEl ? rateTypeEl.value : 'hour'
  const description = fixBio(document.getElementById('f-desc').value.trim())
  const credsRaw = document.getElementById('f-creds')?.value.trim() || ''
  const years_experience = parseInt(document.getElementById('f-years')?.value) || 0
  const credentials = credsRaw ? credsRaw.split(',').map(c => c.trim()).filter(Boolean) : []
  if (!email || !password) { toast('Please enter your email and password.'); return }
  if (password.length < 6) { toast('Password must be at least 6 characters.'); return }
  if (phone && phone.replace(/\D/g,'').length < 11) { toast('Please enter a valid SA mobile number (9 digits after +27).'); return }
  const isNationwide = province === 'Nationwide / All Provinces'
  if (!name) { toast('Please enter your business or contact name.'); return }
  if (selectedTrades.length === 0) { toast('Please pick at least one trade — tap the “Select trades” box and tick one (or type a custom trade and press ＋ Add).'); return }
  if (!province) { toast('Please select your province.'); return }
  if (!isNationwide && selectedCities.length === 0) { toast('Please tap the “Select cities / areas” box and tick at least one area you cover.'); return }
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
  const cities = selectedCities.length > 0 ? selectedCities : (isNationwide ? ['Nationwide'] : (city ? [city] : []))
  const after_hours = !!document.getElementById('f-emergency')?.checked
  const { error } = await supabase.from('listings').insert({
    name, contact_name, phone, email, trade, trades, pending_trades, province, city: cities[0] || city, cities, callout, travel_rate, rate, rate_type, description, credentials, years_experience, tier: selectedTier,
    user_id: userId, certificate_urls, photo_url, lat, lng, service_radius, after_hours
  })
  if (error) { toast('Error saving listing. Please try again.'); console.error(error); return }
  // Creating a listing makes this account a tradesman — flip the profile + nav.
  try {
    await supabase.from('profiles').update({ account_type: 'tradesman' }).eq('id', userId)
    if (userProfile) userProfile.account_type = 'tradesman'; else await loadUserProfile()
    renderBottomNav()
  } catch (_) {}
  toast(`${name} is now live on Tradee!`)
  ;['f-name', 'f-phone', 'f-email', 'f-password', 'f-callout', 'f-travel', 'f-rate', 'f-desc', 'f-creds', 'f-years'].forEach(id => { const el = document.getElementById(id); if (el) el.value = '' })
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
      window.openProfile(numId, true)
    } else {
      const idMatch = slug.match(/-(\d+)$/)
      if (idMatch) window.openProfile(parseInt(idMatch[1]), true)
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
    window.showPage('directory', true)
    return
  }
  // Map a known page path back to its page (so Back/Forward and refresh land correctly).
  const pageByPath = { '/': 'home', '/directory': 'home', '/rankings': 'rankings', '/how-it-works': 'faq', '/privacy': 'privacy', '/terms': 'terms', '/list': 'list', '/login': 'login', '/signup': 'signup', '/dashboard': 'dashboard', '/admin': 'admin', '/messages': 'messages', '/account': 'account' }
  const pageName = pageByPath[path] || 'home'
  // Replace the current history entry with a known state so popstate always fires with context.
  if (!window.history.state?.tradeePage) {
    window.history.replaceState({ tradeePage: pageName }, '', path)
  }
  window.showPage(pageName, true)
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

window.openReviewModal = async function (id) {
  if (!currentUser) { toast('Please log in to leave a review.'); window.showPage('login'); return }
  reviewingId = id
  const name = userProfile?.full_name || currentUser.email
  document.getElementById('r-name').value = name
  const asName = document.getElementById('r-as-name'); if (asName) asName.textContent = name
  document.getElementById('r-text').value = ''
  initStarSelects()
  document.getElementById('review-modal').classList.add('open')
  // If they've reviewed this tradesman before, load it so they edit rather than duplicate.
  try {
    const { data: existing } = await supabase.from('reviews').select('*').eq('listing_id', id).eq('user_id', currentUser.id).maybeSingle()
    _editingReviewId = existing?.id || null
    if (existing) {
      document.getElementById('r-text').value = existing.review_text || ''
      const set = (sid, v) => { const el = document.getElementById(sid); if (el && v) { el.dataset.selected = v; el.querySelectorAll('span').forEach((s, i) => s.classList.toggle('lit', i < v)) } }
      set('star-quality', existing.quality); set('star-service', existing.service); set('star-clean', existing.cleanliness)
      set('star-comms', existing.communication); set('star-value', existing.value)
    }
  } catch (_) { _editingReviewId = null }
}
let _editingReviewId = null

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
  const since180 = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString()
  const since7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const since1 = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const [{ data: allListings }, { data: allReviews }, { data: events }, { data: reviewEmails }, { data: sentNotes }] = await Promise.all([
    supabase.from('listings').select('*, reviews(*)').order('created_at', { ascending: false }),
    supabase.from('reviews').select('*, listings(name)').order('created_at', { ascending: false }).limit(50),
    supabase.from('analytics_events').select('event_type, listing_id, created_at').gte('created_at', since180),
    supabase.from('review_emails').select('review_id, email'),
    supabase.from('listing_notes').select('*, listings(name)').order('created_at', { ascending: false }).limit(100)
  ])
  // Map private reviewer emails (admin-only) onto each review.
  const emailByReview = {}
  ;(reviewEmails || []).forEach(re => { emailByReview[re.review_id] = re.email })
  const ls = allListings || []
  ls.forEach(l => (l.reviews || []).forEach(r => { r.reviewer_email = emailByReview[r.id] || '' }))
  window._adminListings = ls
  window._adminEvents = events || []
  const rs = allReviews || []
  rs.forEach(r => { r.reviewer_email = emailByReview[r.id] || '' })
  const ev = events || []

  // Tier & sign-up breakdown
  const free = ls.filter(l => l.tier === 'free').length
  const verified = ls.filter(l => l.tier === 'verified').length
  const premium = ls.filter(l => l.tier === 'premium').length
  const promoUsed = ls.filter(l => l.promo_verified).length
  const spotsLeft = Math.max(0, 100 - promoUsed)
  const new7 = ls.filter(l => l.created_at >= since7).length
  const new1 = ls.filter(l => l.created_at >= since1).length

  // Custom trades awaiting approval
  const pendingListings = ls.filter(l => Array.isArray(l.pending_trades) && l.pending_trades.length)
  const pendingCount = pendingListings.reduce((n, l) => n + l.pending_trades.length, 0)
  const pendingSection = pendingCount ? `
    <div class="form-card" style="margin-bottom:1.25rem;border:1.5px solid rgba(245,158,11,0.5);background:rgba(245,158,11,0.05);">
      <h3 style="margin-bottom:0.5rem;">⚠️ ${pendingCount} custom trade${pendingCount !== 1 ? 's' : ''} awaiting your approval</h3>
      <p style="font-size:13px;color:var(--charcoal-6);margin-bottom:1rem;">These were typed in by tradesmen and are hidden from the public until you approve them. Approve to make them live, or reject to remove.</p>
      ${pendingListings.map(l => `
        <div style="padding:10px 0;border-bottom:1px solid var(--charcoal-3);">
          <div style="color:var(--white);font-size:14px;font-weight:600;margin-bottom:6px;">${escHtml(l.name)}</div>
          ${l.pending_trades.map((t, i) => `
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px;">
              <input id="pend-${l.id}-${i}" class="form-input" value="${escHtml(t)}" style="flex:1;min-width:160px;font-size:14px;padding:6px 10px;" title="Edit the trade text before approving">
              <button class="btn btn-outline btn-sm" style="color:#22C55E;border-color:#22C55E;" onclick="approvePendingTrade(${l.id},'${escHtml(t).replace(/'/g, "\\'")}','pend-${l.id}-${i}')">Approve</button>
              <button class="btn btn-outline btn-sm" style="color:var(--danger);border-color:var(--danger);" onclick="rejectPendingTrade(${l.id},'${escHtml(t).replace(/'/g, "\\'")}')">Reject</button>
            </div>`).join('')}
        </div>`).join('')}
    </div>` : ''

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

    ${pendingSection}

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

    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:8px;">
      <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.08em;color:var(--charcoal-6);">Activity</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        ${[[1, '24h'], [7, '7d'], [14, '14d'], [30, '30d'], [180, '6mo']].map(([d, lbl]) => `<button class="admin-period-btn" data-days="${d}" onclick="renderAdminActivity(${d})" style="padding:6px 13px;border:1px solid var(--charcoal-4);border-radius:100px;background:transparent;color:var(--charcoal-6);font-size:12px;cursor:pointer;">${lbl}</button>`).join('')}
      </div>
    </div>
    <div id="admin-activity" style="margin-bottom:1.25rem;"></div>

    <div class="form-card" style="margin-bottom:1.25rem;">
      <h3 style="margin-bottom:1rem;">Top Viewed Listings (last 6 months)</h3>
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
      <h3 style="margin-bottom:0.75rem;">All Listings</h3>
      <input class="form-input" id="admin-listing-search" placeholder="🔍 Search by name, trade or email…" oninput="filterAdminListings(this.value)" style="margin-bottom:1rem;">
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
            <tr style="border-bottom:1px solid var(--charcoal-3);" data-search="${escHtml(((l.name || '') + ' ' + (l.trade || '') + ' ' + (l.trades || []).join(' ') + ' ' + (l.email || '')).toLowerCase())}">
              <td style="padding:8px 12px;"><span onclick="openProfile(${l.id})" style="color:var(--amber);cursor:pointer;text-decoration:underline;" title="Open this tradesman's profile">${escHtml(l.name)}</span></td>
              <td style="padding:8px 12px;color:var(--charcoal-6);">${escHtml(l.trade)}</td>
              <td style="padding:8px 12px;">${tierBadge(l) || '<span style="color:var(--charcoal-6);">Standard</span>'}</td>
              <td style="padding:8px 12px;white-space:nowrap;">${l.certificate_urls && l.certificate_urls.length ? l.certificate_urls.map((ref, i) => `<button class="btn btn-outline btn-sm" style="margin:0 2px;padding:2px 8px;" onclick="viewCert('${escHtml(ref)}')" title="Verify document">Doc ${i + 1}</button>`).join('') : '<span style="color:var(--charcoal-6);">—</span>'}</td>
              <td style="padding:8px 12px;">${(l.reviews?.length || 0) > 0 ? `<button class="btn btn-outline btn-sm" style="padding:2px 10px;" onclick="openListingReviews(${l.id})" title="View & manage reviews">${l.reviews.length} ⓘ</button>` : '<span style="color:var(--charcoal-6);">0</span>'}</td>
              <td style="padding:8px 12px;white-space:nowrap;">
                <button class="btn btn-outline btn-sm" style="margin-right:6px;" onclick="openProfile(${l.id})" title="View listing">View</button>
                <button class="btn btn-outline btn-sm" style="margin-right:6px;color:#a78bfa;border-color:#a78bfa;" onclick="adminEditListing(${l.id})" title="Edit this listing's details">Edit</button>
                <button class="btn btn-outline btn-sm" style="margin-right:6px;" onclick="openListingStats(${l.id})" title="See this tradesman's views & clicks">Stats</button>
                <button class="btn btn-outline btn-sm" style="margin-right:6px;color:#60A5FA;border-color:#60A5FA;" onclick="sendListingNote(${l.id})" title="Send a note/message to this tradesman">Note</button>
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
            <div style="font-size:12px;color:var(--charcoal-6);">${new Date(r.created_at).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })} · ${r.stars}★${r.reviewer_email ? ' · ' + escHtml(r.reviewer_email) : ''}</div>
            <p style="font-size:13px;color:var(--charcoal-7);margin:4px 0;">${escHtml(r.review_text)}</p>
          </div>
          <button class="btn btn-outline btn-sm" style="color:var(--danger);border-color:var(--danger);flex-shrink:0;" onclick="adminDeleteReview(${r.id})">Remove</button>
        </div>`).join('')}
    </div>
    <div class="form-card" style="margin-top:1rem;">
      <h3 style="margin-bottom:1rem;">Notes sent to tradesmen</h3>
      ${(sentNotes && sentNotes.length) ? sentNotes.map(n => `
        <div style="padding:10px 0;border-bottom:1px solid var(--charcoal-3);">
          <div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap;">
            <span style="font-size:13px;font-weight:600;color:var(--white);">${escHtml(n.listings?.name || 'Unknown listing')}</span>
            <span style="font-size:11px;color:var(--charcoal-6);">${new Date(n.created_at).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })} · ${n.dismissed ? '<span style="color:#22C55E;">seen by them</span>' : 'unread'}</span>
          </div>
          <p style="font-size:13px;color:var(--charcoal-7);margin:4px 0 0;">${escHtml(n.message)}</p>
        </div>`).join('') : '<p style="color:var(--charcoal-6);font-size:14px;">No notes sent yet. Use the "Note" button on any listing above to send one.</p>'}
    </div>`
  renderAdminActivity(30)
}

window.renderAdminActivity = function (days) {
  const cont = document.getElementById('admin-activity')
  if (!cont) return
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
  const e2 = (window._adminEvents || []).filter(e => new Date(e.created_at).getTime() >= cutoff)
  const ct = (t) => e2.filter(e => e.event_type === t).length
  const views = ct('profile_view'), phone = ct('phone_click'), wa = ct('whatsapp_click'), email = ct('email_click'), searches = ct('search_impression'), reviews = ct('review_left')
  const contacts = phone + wa + email
  const ctr = views > 0 ? Math.round((contacts / views) * 100) : 0
  const card = (v, l, c = 'var(--white)') => `<div style="background:var(--charcoal-3);border-radius:var(--radius);padding:14px;text-align:center;"><div style="font-size:2rem;font-weight:700;color:${c};">${v}</div><div style="font-size:11px;color:var(--charcoal-6);text-transform:uppercase;letter-spacing:0.05em;margin-top:2px;">${l}</div></div>`
  cont.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:6px;">
      ${card(views, 'Profile Views')}${card(contacts, 'Contact Clicks', 'var(--amber)')}${card(`${ctr}%`, 'View → Contact')}${card(searches, 'Search Appearances')}
    </div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;">
      ${card(phone, 'Phone Calls')}${card(wa, 'WhatsApp', '#25D366')}${card(email, 'Emails')}${card(reviews, 'Reviews Left')}
    </div>`
  document.querySelectorAll('.admin-period-btn').forEach(b => {
    const on = Number(b.dataset.days) === days
    b.style.background = on ? 'var(--amber)' : 'transparent'
    b.style.color = on ? 'var(--charcoal)' : 'var(--charcoal-6)'
    b.style.borderColor = on ? 'var(--amber)' : 'var(--charcoal-4)'
  })
}

window.openListingStats = function (id, days) {
  const l = (window._adminListings || []).find(x => x.id === id)
  if (!l) return
  const period = days || 30
  let box = document.getElementById('admin-stats-modal')
  if (!box) {
    box = document.createElement('div')
    box.id = 'admin-stats-modal'
    box.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1.5rem;'
    box.onclick = (e) => { if (e.target === box) box.style.display = 'none' }
    document.body.appendChild(box)
  }
  const cutoff = Date.now() - period * 24 * 60 * 60 * 1000
  const ev = (window._adminEvents || []).filter(e => String(e.listing_id) === String(id) && new Date(e.created_at).getTime() >= cutoff)
  const ct = (t) => ev.filter(e => e.event_type === t).length
  const views = ct('profile_view'), phone = ct('phone_click'), wa = ct('whatsapp_click'), email = ct('email_click'), searches = ct('search_impression'), reviews = ct('review_left')
  const contacts = phone + wa + email
  const ctr = views > 0 ? Math.round((contacts / views) * 100) : 0
  const card = (v, lbl, c = 'var(--white)') => `<div style="background:var(--charcoal-3);border-radius:var(--radius);padding:14px;text-align:center;"><div style="font-size:1.8rem;font-weight:700;color:${c};">${v}</div><div style="font-size:11px;color:var(--charcoal-6);text-transform:uppercase;letter-spacing:0.05em;margin-top:2px;">${lbl}</div></div>`
  const periodBtns = [[7, '7d'], [30, '30d'], [180, '6mo']].map(([d, t]) => `<button onclick="openListingStats(${id},${d})" style="padding:6px 13px;border:1px solid ${d === period ? 'var(--amber)' : 'var(--charcoal-4)'};border-radius:100px;background:${d === period ? 'var(--amber)' : 'transparent'};color:${d === period ? 'var(--charcoal)' : 'var(--charcoal-6)'};font-size:12px;cursor:pointer;">${t}</button>`).join('')
  box.innerHTML = `<div style="background:var(--charcoal-2);border:1px solid var(--charcoal-3);border-radius:12px;max-width:560px;width:100%;max-height:85vh;overflow-y:auto;padding:1.5rem;">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
      <h3 style="margin:0;">${escHtml(l.name)} — Stats</h3>
      <button onclick="document.getElementById('admin-stats-modal').style.display='none'" style="background:none;border:none;color:var(--charcoal-6);font-size:24px;cursor:pointer;line-height:1;">×</button>
    </div>
    <div style="display:flex;gap:6px;margin:10px 0 16px;">${periodBtns}</div>
    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;">
      ${card(views, 'Profile Views')}${card(contacts, 'Contact Clicks', 'var(--amber)')}
      ${card(`${ctr}%`, 'View → Contact')}${card(searches, 'Search Appearances')}
      ${card(phone, 'Phone Calls')}${card(wa, 'WhatsApp', '#25D366')}
      ${card(email, 'Emails')}${card(reviews, 'Reviews Left')}
    </div>
    <p style="font-size:11px;color:var(--charcoal-6);margin-top:12px;">Same engagement metrics this tradesman sees on their own dashboard.</p>
  </div>`
  box.style.display = 'flex'
}

window.dismissNote = async function (id) {
  await supabase.from('listing_notes').update({ dismissed: true }).eq('id', id)
  renderDashboard()
}

window.sendListingNote = async function (id) {
  const l = (window._adminListings || []).find(x => x.id === id)
  if (!l) return
  const message = prompt(`Send a note to ${l.name}.\nThey'll get an email and see it on their dashboard:\n\n(e.g. "Please re-upload your ID — the copy was blurry.")`)
  if (!message || !message.trim()) return
  const { error } = await supabase.from('listing_notes').insert({ listing_id: id, message: message.trim() })
  if (error) { toast('Could not send note: ' + error.message); return }
  if (l.email) supabase.functions.invoke('listing-note', { body: { email: l.email, name: l.name, message: message.trim() } }).catch(() => {})
  toast('Note sent to ' + l.name + '.')
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

window.openListingReviews = function (id) {
  const l = (window._adminListings || []).find(x => x.id === id)
  if (!l) return
  const reviews = (l.reviews || []).slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
  let box = document.getElementById('admin-reviews-modal')
  if (!box) {
    box = document.createElement('div')
    box.id = 'admin-reviews-modal'
    box.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1.5rem;'
    box.onclick = (e) => { if (e.target === box) box.style.display = 'none' }
    document.body.appendChild(box)
  }
  const rowsHtml = reviews.length ? reviews.map(r => `
    <div style="display:flex;align-items:flex-start;gap:12px;padding:12px 0;border-bottom:1px solid var(--charcoal-3);">
      <div style="flex:1;">
        <div style="font-size:13px;font-weight:600;color:var(--white);">${escHtml(r.reviewer_name || 'Anonymous')} · ${r.stars}★</div>
        <div style="font-size:11px;color:var(--charcoal-6);">${new Date(r.created_at).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })}${r.reviewer_email ? ' · ' + escHtml(r.reviewer_email) : ''}</div>
        <p style="font-size:13px;color:var(--charcoal-7);margin:6px 0 0;">${escHtml(r.review_text || '')}</p>
      </div>
      <button class="btn btn-outline btn-sm" style="color:var(--danger);border-color:var(--danger);flex-shrink:0;" onclick="adminDeleteReviewFromModal(${r.id},${id})">Delete</button>
    </div>`).join('') : '<p style="color:var(--charcoal-6);font-size:14px;">No reviews yet.</p>'
  box.innerHTML = `<div style="background:var(--charcoal-2);border:1px solid var(--charcoal-3);border-radius:12px;max-width:600px;width:100%;max-height:85vh;overflow-y:auto;padding:1.5rem;">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
      <h3 style="margin:0;">Reviews — ${escHtml(l.name)}</h3>
      <button onclick="document.getElementById('admin-reviews-modal').style.display='none'" style="background:none;border:none;color:var(--charcoal-6);font-size:24px;cursor:pointer;line-height:1;">×</button>
    </div>
    ${rowsHtml}
  </div>`
  box.style.display = 'flex'
}

window.adminDeleteReviewFromModal = async function (reviewId, listingId) {
  if (!confirm('Delete this review? This cannot be undone.')) return
  const { error } = await supabase.from('reviews').delete().eq('id', reviewId)
  if (error) { toast('Could not delete: ' + error.message); return }
  const l = (window._adminListings || []).find(x => x.id === listingId)
  if (l) l.reviews = (l.reviews || []).filter(r => r.id !== reviewId)
  toast('Review deleted.')
  openListingReviews(listingId)
}

window.filterAdminListings = function (q) {
  const term = (q || '').trim().toLowerCase()
  document.querySelectorAll('#admin-listing-search')[0]?.closest('.form-card')
    ?.querySelectorAll('tbody tr').forEach(tr => {
      tr.style.display = (!term || (tr.dataset.search || '').includes(term)) ? '' : 'none'
    })
}

window.addTradeFromList = function (sel) {
  const val = sel.value
  if (!val) return
  const input = document.getElementById('edit-trades-text')
  const current = input.value.split(',').map(t => t.trim()).filter(Boolean)
  if (!current.includes(val)) current.push(val)
  input.value = current.join(', ')
  sel.value = ''
}

window.approvePendingTrade = async function (id, trade, inputId) {
  const l = listings.find(x => x.id === id)
  if (!l) return
  // Use the admin's edited text (if any), otherwise the original.
  let finalTrade = trade
  if (inputId) { const el = document.getElementById(inputId); if (el && el.value.trim()) finalTrade = el.value.trim() }
  const pending = (l.pending_trades || []).filter(t => t !== trade)
  const trades = [...(l.trades || []).filter(t => t && t !== 'Pending review'), finalTrade]
  const primary = (l.trade && l.trade !== 'Pending review') ? l.trade : finalTrade
  const { error } = await supabase.from('listings').update({ trades, pending_trades: pending, trade: primary }).eq('id', id)
  if (error) { toast('Could not approve: ' + error.message); return }
  toast(`Approved “${finalTrade}” — now live.`)
  await loadListings()
  renderAdmin()
}

window.rejectPendingTrade = async function (id, trade) {
  if (!confirm(`Reject and remove “${trade}”? The tradesman will need to pick a listed trade instead.`)) return
  const l = listings.find(x => x.id === id)
  if (!l) return
  const pending = (l.pending_trades || []).filter(t => t !== trade)
  const { error } = await supabase.from('listings').update({ pending_trades: pending }).eq('id', id)
  if (error) { toast('Could not reject: ' + error.message); return }
  toast(`Rejected “${trade}”.`)
  await loadListings()
  renderAdmin()
}

window.adminDeleteListing = async function (id) {
  if (!confirm('Delete this listing? This cannot be undone.')) return
  await supabase.from('listings').delete().eq('id', id)
  toast('Listing deleted.')
  await loadListings()
  renderAdmin()
}

window.adminEditListing = async function (id) {
  const l = (window._adminListings || []).find(x => x.id === id)
  if (!l) return
  const phoneDisplay = (l.phone || '').replace(/^\+?27/, '').replace(/^0/, '')
  const rateVal = l.rate === -1 ? 'N/A' : (l.rate || '')
  const calloutVal = l.callout === -1 ? 'N/A' : (l.callout || '')

  const modal = document.getElementById('admin-edit-modal')
  if (!modal) return
  document.getElementById('aem-id').value = id
  document.getElementById('aem-name').value = l.name || ''
  document.getElementById('aem-contact').value = l.contact_name || ''
  document.getElementById('aem-phone').value = phoneDisplay
  document.getElementById('aem-email').value = l.email || ''
  document.getElementById('aem-trade').value = l.trade || ''
  document.getElementById('aem-rate').value = rateVal
  document.getElementById('aem-callout').value = calloutVal
  document.getElementById('aem-rate-type').value = l.rate_type || 'hour'
  document.getElementById('aem-desc').value = l.description || ''
  window._aemNewCertFiles = []
  document.getElementById('aem-cert-preview').textContent = ''
  const docsList = document.getElementById('aem-docs-list')
  docsList.innerHTML = (l.certificate_urls || []).map((ref, i) =>
    `<button class="btn btn-outline btn-sm" style="padding:2px 8px;" onclick="viewCert('${escHtml(ref)}')" title="View document">Doc ${i + 1} ↗</button>`
  ).join('') || '<span style="font-size:12px;color:var(--charcoal-6);">No documents on file.</span>'
  const portfolioList = document.getElementById('aem-portfolio-list')
  const photos = l.portfolio_photos || []
  if (photos.length === 0) {
    portfolioList.innerHTML = '<span style="font-size:12px;color:var(--charcoal-6);">No portfolio images.</span>'
  } else {
    portfolioList.innerHTML = photos.map((p, i) => {
      const url = (typeof p === 'object' && p !== null) ? (p.url || '') : p
      return `<div style="position:relative;width:80px;">
        <img src="${escHtml(url)}" style="width:80px;height:80px;object-fit:cover;border-radius:6px;border:1px solid var(--charcoal-4);">
        <button onclick="adminMoveToCredentials(${l.id},'${escHtml(url)}',${i})" title="Move to Credentials (make private)"
          style="position:absolute;bottom:3px;left:50%;transform:translateX(-50%);white-space:nowrap;font-size:9px;padding:2px 5px;background:#1C1917cc;border:1px solid #22C55E;color:#22C55E;border-radius:3px;cursor:pointer;">
          → Credentials
        </button>
      </div>`
    }).join('')
  }
  modal.classList.add('open')
}

window.adminSaveListing = async function () {
  const id = parseInt(document.getElementById('aem-id').value)
  const name = document.getElementById('aem-name').value.trim()
  const contact_name = document.getElementById('aem-contact').value.trim()
  const phoneRaw = document.getElementById('aem-phone').value.trim().replace(/\D/g,'')
  const phone = phoneRaw ? '+27' + (phoneRaw.startsWith('0') ? phoneRaw.slice(1) : phoneRaw) : ''
  const email = document.getElementById('aem-email').value.trim()
  const trade = document.getElementById('aem-trade').value.trim()
  const rateRaw = document.getElementById('aem-rate').value.trim()
  const calloutRaw = document.getElementById('aem-callout').value.trim()
  const isNA = s => /n\/a/i.test(s) || (s && isNaN(parseInt(s)))
  const rate = isNA(rateRaw) ? -1 : (parseInt(rateRaw) || 0)
  const callout = isNA(calloutRaw) ? -1 : (parseInt(calloutRaw) || 0)
  const rate_type = document.getElementById('aem-rate-type').value
  const description = fixBio(document.getElementById('aem-desc').value.trim())

  const { data: existingL } = await supabase.from('listings').select('certificate_urls').eq('id', id).single()
  const certificate_urls = existingL?.certificate_urls || []
  for (const file of (window._aemNewCertFiles || [])) {
    const { data: { user } } = await supabase.auth.getUser()
    const ownerId = (window._adminListings || []).find(x => x.id === id)?.user_id || user?.id
    const path = `${ownerId}/${Date.now()}-${file.name}`
    const { error: uploadError } = await supabase.storage.from(BUCKET_CERTS).upload(path, file)
    if (!uploadError) certificate_urls.push(path)
  }
  window._aemNewCertFiles = []

  const { error } = await supabase.from('listings').update({ name, contact_name, phone, email, trade, rate, callout, rate_type, description, certificate_urls }).eq('id', id)
  if (error) { toast('Error saving: ' + error.message); return }
  document.getElementById('admin-edit-modal').classList.remove('open')
  toast('Listing updated.')
  await renderAdmin()
}

window.closeAdminEditModal = function () {
  document.getElementById('admin-edit-modal').classList.remove('open')
}

window.adminDeleteReview = async function (id) {
  if (!confirm('Remove this review?')) return
  await supabase.from('reviews').delete().eq('id', id)
  toast('Review removed.')
  renderAdmin()
}

// ── Auto-update: apply new deploys without the user needing to refresh ──────────
// The service worker (registerType: autoUpdate) installs new versions in the
// background. Here we reload to the new version when it takes over — but never
// while someone is mid-form or has a modal open — and re-check every 30 minutes
// so even long-open tabs pick up changes on their own.
if ('serviceWorker' in navigator) {
  let _reloading = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (_reloading) return
    const tag = document.activeElement && document.activeElement.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
    if (document.querySelector('.modal-overlay.open')) return
    _reloading = true
    window.location.reload()
  })
  navigator.serviceWorker.getRegistration().then((reg) => {
    if (reg) setInterval(() => reg.update(), 30 * 60 * 1000)
  }).catch(() => {})
}
