import { supabase } from './supabaseClient.js'

let listings = []
let currentProfile = null
let currentUser = null
let selectedTier = 'free'
let editTier = 'free'
let reviewingId = null
let filterTrade = '', filterProvince = '', filterTierVal = '', filterSort = 'rating', dirSearchTerm = ''

// ── Auth ──────────────────────────────────────────────────────────────────────
async function initAuth() {
  const { data: { session } } = await supabase.auth.getSession()
  currentUser = session?.user ?? null
  updateNavForAuth()
  supabase.auth.onAuthStateChange((_event, session) => {
    currentUser = session?.user ?? null
    updateNavForAuth()
  })
}

function updateNavForAuth() {
  const authBtn = document.getElementById('nav-auth-btn')
  const dashBtn = document.getElementById('nav-dashboard-btn')
  if (!authBtn) return
  if (currentUser) {
    authBtn.textContent = 'Log Out'
    authBtn.onclick = handleSignOut
    if (dashBtn) dashBtn.style.display = 'inline-flex'
  } else {
    authBtn.textContent = 'Trades Login'
    authBtn.onclick = () => window.showPage('login')
    if (dashBtn) dashBtn.style.display = 'none'
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
  if (!email || !password) { toast('Please fill in all fields.'); return }
  if (password !== password2) { toast('Passwords do not match.'); return }
  if (password.length < 6) { toast('Password must be at least 6 characters.'); return }
  const { error } = await supabase.auth.signUp({ email, password })
  if (error) { toast('Sign up failed: ' + error.message); return }
  toast('Account created! You can now list your business.')
  window.showPage('list')
}

window.handleSignOut = async function () {
  await supabase.auth.signOut()
  toast('Logged out.')
  window.showPage('home')
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
  el.innerHTML = `
    <div class="profile-hero" style="margin-bottom:1.5rem;">
      <div class="profile-avatar">${initials(listing.name)}</div>
      <div style="flex:1;">
        <div class="profile-name">${listing.name}</div>
        ${listing.contact_name ? `<div style="font-size:14px;color:var(--charcoal-6);margin-bottom:4px;">Contact: ${listing.contact_name}</div>` : ''}
        <div class="profile-trade">${listing.trade}</div>
        <div class="card-badges" style="margin-bottom:12px;">${tierBadge(listing.tier)}</div>
        <div style="background:var(--charcoal-3);border:1px solid var(--charcoal-4);border-radius:var(--radius);padding:10px 14px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
          <span style="font-size:13px;color:var(--charcoal-6);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${window.location.origin}/profile/${listing.id}</span>
          <button class="btn btn-primary btn-sm" onclick="copyProfileLink(${listing.id})">🔗 Copy Link</button>
        </div>
        <div style="font-size:12px;color:var(--charcoal-6);margin-top:6px;">Share this link with your clients so they can find and review you.</div>
      </div>
    </div>

    <div class="form-card">
      <h3>Edit Your Details</h3>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Business Name</label><input class="form-input" id="edit-business" value="${listing.name}"></div>
        <div class="form-group"><label class="form-label">Contact Name</label><input class="form-input" id="edit-contact" value="${listing.contact_name || ''}"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Call-out Fee (R)</label><input class="form-input" id="edit-callout" type="number" value="${listing.callout}"></div>
        <div class="form-group"><label class="form-label">Rate Per Hour (R)</label><input class="form-input" id="edit-rate" type="number" value="${listing.rate}"></div>
      </div>
      <div class="form-group"><label class="form-label">Business Description</label><textarea class="form-textarea" id="edit-desc">${listing.description || ''}</textarea></div>
      <div class="form-group"><label class="form-label">Credentials</label><input class="form-input" id="edit-creds" value="${listing.credentials ? listing.credentials.join(', ') : ''}"><div class="form-hint">Separate with commas</div></div>
      <div class="form-group"><label class="form-label">Years Experience</label><input class="form-input" id="edit-years" type="number" value="${listing.years_experience || 0}"></div>
      <div class="form-group">
        <label class="form-label">Upload New Certificates</label>
        <div style="border:2px dashed var(--charcoal-4);border-radius:var(--radius);padding:1.25rem;text-align:center;cursor:pointer;" onclick="document.getElementById('edit-cert-files').click()">
          <div style="font-size:14px;color:var(--charcoal-6);">📄 Click to upload PDF, JPG or PNG</div>
        </div>
        <input type="file" id="edit-cert-files" multiple accept=".pdf,.jpg,.jpeg,.png" style="display:none;" onchange="previewEditCerts(this.files)">
        <div id="edit-cert-preview" style="margin-top:0.75rem;display:flex;flex-direction:column;gap:8px;"></div>
        ${listing.certificate_urls && listing.certificate_urls.length ? `
        <div style="margin-top:1rem;">
          <div style="font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:var(--charcoal-6);margin-bottom:8px;">Uploaded Certificates</div>
          ${listing.certificate_urls.map((url, i) => `
            <div style="display:flex;align-items:center;gap:10px;background:var(--charcoal-3);border-radius:var(--radius);padding:8px 12px;margin-bottom:6px;">
              <span style="font-size:18px;">${url.includes('.pdf') ? '📄' : '🖼️'}</span>
              <a href="${url}" target="_blank" style="flex:1;font-size:13px;color:var(--amber);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">View Certificate ${i + 1}</a>
            </div>`).join('')}
        </div>` : ''}
      </div>
    </div>

    <div class="form-card">
      <h3>Subscription Plan</h3>
      <div class="tier-grid">
        <div class="tier-card ${editTier === 'free' ? 'selected' : ''}" id="edit-tier-free" onclick="selectEditTier('free')">
          <div class="tier-name">Free</div>
          <div class="tier-price">R0<span>/mo</span></div>
          <div class="tier-desc">Basic listing</div>
          <ul class="tier-features">
            <li><span class="tick">✓</span> Basic profile</li>
            <li><span class="tick">✓</span> Client reviews</li>
            <li><span class="cross">✗</span> Priority ranking</li>
            <li><span class="cross">✗</span> Verified badge</li>
            <li><span class="cross">✗</span> Featured placement</li>
          </ul>
        </div>
        <div class="tier-card featured ${editTier === 'verified' ? 'selected' : ''}" id="edit-tier-verified" onclick="selectEditTier('verified')">
          <div class="popular-tag">Most Popular</div>
          <div class="tier-name">Verified</div>
          <div class="tier-price">R149<span>/mo</span></div>
          <div class="tier-desc">Stand out with a verified badge</div>
          <ul class="tier-features">
            <li><span class="tick">✓</span> Basic profile</li>
            <li><span class="tick">✓</span> Client reviews</li>
            <li><span class="tick">✓</span> Priority ranking</li>
            <li><span class="tick">✓</span> Verified badge</li>
            <li><span class="cross">✗</span> Featured placement</li>
          </ul>
        </div>
        <div class="tier-card ${editTier === 'premium' ? 'selected' : ''}" id="edit-tier-premium" onclick="selectEditTier('premium')">
          <div class="tier-name">Premium</div>
          <div class="tier-price">R249<span>/mo</span></div>
          <div class="tier-desc">Maximum visibility</div>
          <ul class="tier-features">
            <li><span class="tick">✓</span> Basic profile</li>
            <li><span class="tick">✓</span> Client reviews</li>
            <li><span class="tick">✓</span> Priority ranking</li>
            <li><span class="tick">✓</span> Verified badge</li>
            <li><span class="tick">✓</span> Featured placement</li>
          </ul>
        </div>
      </div>
    </div>

    <button class="btn btn-primary" style="width:100%;padding:14px;font-size:15px;" onclick="saveListing(${listing.id})">Save Changes →</button>
    <div style="margin-top:1rem;text-align:center;">
      <button class="btn btn-outline btn-sm" style="color:var(--danger);border-color:var(--danger);" onclick="deleteListing(${listing.id})">Delete My Listing</button>
    </div>`
}

window.selectEditTier = function (tier) {
  editTier = tier
  ;['free', 'verified', 'premium'].forEach(t => {
    document.getElementById('edit-tier-' + t)?.classList.toggle('selected', t === tier)
  })
}

window.saveListing = async function (id) {
  const name = document.getElementById('edit-business').value.trim()
  const contact_name = document.getElementById('edit-contact').value.trim()
  const callout = parseInt(document.getElementById('edit-callout').value) || 0
  const rate = parseInt(document.getElementById('edit-rate').value) || 0
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
    const { error: uploadError } = await supabase.storage.from('certifications-registrations').upload(path, file)
    if (!uploadError) {
      const { data: urlData } = supabase.storage.from('certifications-registrations').getPublicUrl(path)
      certificate_urls.push(urlData.publicUrl)
    }
  }
  window.editCertFiles = []

  const { error } = await supabase.from('listings').update({
    name, contact_name, callout, rate, description, credentials, years_experience, tier: editTier, certificate_urls
  }).eq('id', id).eq('user_id', currentUser.id)
  if (error) { toast('Error saving: ' + error.message); return }
  toast('Listing updated!')
  await loadListings()
  renderDashboard()
}

window.previewEditCerts = function (files) {
  window.editCertFiles = [...(window.editCertFiles || []), ...Array.from(files)]
  const el = document.getElementById('edit-cert-preview')
  if (!el) return
  el.innerHTML = (window.editCertFiles || []).map((f, i) => `
    <div style="display:flex;align-items:center;gap:10px;background:var(--charcoal-3);border-radius:var(--radius);padding:8px 12px;">
      <span>${f.type.includes('pdf') ? '📄' : '🖼️'}</span>
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
function starsHTML(n) { const f = Math.round(n); return '★'.repeat(f) + '☆'.repeat(5 - f) }
function initials(name) { return name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase() }
function fmtRand(n) { return n === 0 ? 'Free' : 'R' + n }
function tierBadge(tier) {
  if (tier === 'premium') return '<span class="badge badge-premium">Premium</span>'
  if (tier === 'verified') return '<span class="badge badge-verified">Verified</span>'
  return '<span class="badge badge-free">Free</span>'
}
function toast(msg) {
  const t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show')
  setTimeout(() => t.classList.remove('show'), 3000)
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
    `<div class="trade-pill" onclick="filterByTrade('${t}')">${t}</div>`).join('')
  const featured = listings.filter(l => l.tier === 'premium').slice(0, 3)
    .concat(listings.filter(l => l.tier === 'verified').slice(0, 3)).slice(0, 6)
  document.getElementById('home-cards').innerHTML = featured.length
    ? featured.map(cardHTML).join('')
    : '<div class="empty-state" style="grid-column:1/-1"><h3>No Listings Yet</h3><p>Be the first to <a onclick="showPage(\'list\')" style="color:var(--amber);cursor:pointer;">list your business</a>!</p></div>'
}

window.filterByTrade = function (trade) { filterTrade = trade; document.getElementById('filter-trade').value = trade; showPage('directory') }
window.heroSearch = function () {
  filterTrade = document.getElementById('hero-search').value
  filterProvince = document.getElementById('hero-province').value
  document.getElementById('filter-province').value = filterProvince
  showPage('directory')
}

// ── Directory ─────────────────────────────────────────────────────────────────
function populateTradeFilter() {
  const trades = [...new Set(listings.map(l => l.trade))].sort()
  const opts = trades.map(t => `<option value="${t}">${t}</option>`).join('')
  document.getElementById('filter-trade').innerHTML = '<option value="">All Trades</option>' + opts
  document.getElementById('rank-trade-filter').innerHTML = '<option value="">All Trades</option>' + opts
  document.getElementById('filter-trade').value = filterTrade
}

window.applyFilters = function () {
  filterTrade = document.getElementById('filter-trade').value
  filterProvince = document.getElementById('filter-province').value
  filterTierVal = document.getElementById('filter-tier').value
  filterSort = document.getElementById('filter-sort').value
  renderDirectory()
}

function renderDirectory() {
  populateTradeFilter()
  document.getElementById('filter-province').value = filterProvince
  document.getElementById('filter-tier').value = filterTierVal
  document.getElementById('filter-sort').value = filterSort
  const tierOrder = { premium: 0, verified: 1, free: 2 }
  let filtered = listings.filter(l => {
    if (filterTrade && l.trade !== filterTrade) return false
    if (filterProvince && l.province !== filterProvince) return false
    if (filterTierVal && l.tier !== filterTierVal) return false
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
  document.getElementById('dir-cards').innerHTML = filtered.length
    ? filtered.map(cardHTML).join('')
    : `<div class="empty-state" style="grid-column:1/-1"><h3>No Results Found</h3><p>Try adjusting your filters or <a onclick="showPage('list')" style="color:var(--amber);cursor:pointer;">list your business</a> here.</p></div>`
  dirSearchTerm = ''
}

function cardHTML(l) {
  const rating = avgRating(l), rd = rating > 0 ? rating.toFixed(1) : '—'
  const reviewCount = l.reviews ? l.reviews.length : 0
  return `<div class="tradesman-card" onclick="openProfile(${l.id})">
    <div class="card-header">
      <div class="card-avatar ${l.tier === 'premium' ? 'premium-av' : ''}">${initials(l.name)}</div>
      <div style="flex:1;min-width:0;">
        <div class="card-name">${l.name}</div>
        ${l.contact_name ? `<div style="font-size:12px;color:var(--charcoal-6);margin-top:1px;">${l.contact_name}</div>` : ''}
        <div class="card-trade">${l.trade}</div>
        <div class="card-badges">${tierBadge(l.tier)}</div>
      </div>
    </div>
    <div class="card-rating">
      <span class="stars">${starsHTML(rating)}</span>
      <span class="rating-num">${rd}</span>
      <span class="rating-count">(${reviewCount} review${reviewCount !== 1 ? 's' : ''})</span>
    </div>
    <div class="card-info">
      <div class="info-item"><div class="info-label">Call-out Fee</div><div class="info-value">${fmtRand(l.callout)}</div></div>
      <div class="info-item"><div class="info-label">Rate / Hour</div><div class="info-value">${fmtRand(l.rate)}</div></div>
    </div>
    <div class="card-area">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>
      ${l.city}, ${l.province}
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
  // Update URL without reloading
  window.history.pushState({}, '', `/profile/${id}`)
  const rating = avgRating(l), rd = rating > 0 ? rating.toFixed(1) : '—'
  const reviews = l.reviews || []
  const credsHTML = l.credentials && l.credentials.length
    ? l.credentials.map(c => `<div class="cred-item"><div class="cred-icon">✓</div><span>${c}</span></div>`).join('')
    : '<p style="color:var(--charcoal-6);font-size:14px;">No credentials listed yet.</p>'
  const certsHTML = l.certificate_urls && l.certificate_urls.length
    ? l.certificate_urls.map((url, i) => `
        <a href="${url}" target="_blank" style="display:flex;align-items:center;gap:10px;background:var(--charcoal-3);border-radius:var(--radius);padding:10px 14px;text-decoration:none;transition:background 0.15s;" onmouseover="this.style.background='var(--charcoal-4)'" onmouseout="this.style.background='var(--charcoal-3)'">
          <span style="font-size:20px;">${url.includes('.pdf') ? '📄' : '🖼️'}</span>
          <span style="font-size:14px;color:var(--amber);">View Certificate ${i + 1}</span>
          <span style="margin-left:auto;font-size:12px;color:var(--charcoal-6);">↗ Open</span>
        </a>`).join('')
    : ''
  const reviewsHTML = reviews.length
    ? reviews.map(r => `
      <div class="review-item">
        <div class="review-header">
          <span class="reviewer-name">${r.reviewer_name}</span>
          <span class="review-date">${new Date(r.created_at).toLocaleDateString('en-ZA', { month: 'short', year: 'numeric' })}</span>
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
        <p class="review-text">${r.review_text}</p>
      </div>`).join('')
    : '<p style="color:var(--charcoal-6);font-size:14px;">No reviews yet — be the first!</p>'
  document.getElementById('profile-content').innerHTML = `
    <div class="profile-back" onclick="goBack()">← Back to Directory</div>
    <div class="profile-hero">
      <div class="profile-avatar">${initials(l.name)}</div>
      <div style="flex:1;">
        <div class="profile-name">${l.name}</div>
        ${l.contact_name ? `<div style="font-size:14px;color:var(--charcoal-6);margin-top:2px;margin-bottom:4px;">Contact: ${l.contact_name}</div>` : ''}
        <div class="profile-trade">${l.trade}</div>
        <div class="card-badges" style="margin-bottom:12px;">${tierBadge(l.tier)}</div>
        <div class="profile-rating-row">
          <span class="profile-rating-big">${rd}</span>
          <div>
            <div class="stars" style="font-size:18px;">${starsHTML(rating)}</div>
            <div style="font-size:12px;color:var(--charcoal-6);">${reviews.length} review${reviews.length !== 1 ? 's' : ''}</div>
          </div>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;">
          <button class="btn btn-primary btn-sm" onclick="openReviewModal(${l.id})">Leave a Review</button>
          <button class="btn btn-outline btn-sm" onclick="copyProfileLink(${l.id})">🔗 Share Profile</button>
          <button class="btn btn-outline btn-sm" onclick="goBack()">← Back</button>
        </div>
      </div>
    </div>
    <div class="profile-stats">
      <div class="stat-box"><span class="value">${fmtRand(l.callout)}</span><div class="label">Call-out Fee</div></div>
      <div class="stat-box"><span class="value">${fmtRand(l.rate)}/hr</span><div class="label">Hourly Rate</div></div>
      <div class="stat-box"><span class="value">${l.years_experience || '—'}</span><div class="label">Years Experience</div></div>
    </div>
    <div class="profile-section">
      <div class="section-title">About</div>
      <p style="font-size:15px;line-height:1.7;color:var(--charcoal-7);">${l.description || 'No description provided.'}</p>
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
    <div class="profile-section">
      <div class="section-title">Client Reviews (${reviews.length})</div>
      <div class="review-list">${reviewsHTML}</div>
      <div style="margin-top:1.5rem;padding-top:1.5rem;border-top:1px solid var(--charcoal-3);">
        <button class="btn btn-outline" onclick="openReviewModal(${l.id})">+ Write a Review</button>
      </div>
    </div>`
  showPage('profile')
}

window.copyProfileLink = function (id) {
  const url = `${window.location.origin}/profile/${id}`
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
window.openReviewModal = function (id) {
  reviewingId = id
  document.getElementById('review-modal').classList.add('open')
  document.getElementById('r-name').value = ''
  document.getElementById('r-text').value = ''
  document.getElementById('s5').checked = true
}
window.closeReviewModal = function () { document.getElementById('review-modal').classList.remove('open') }
function getStarVal(name) {
  const el = document.querySelector(`input[name="${name}"]:checked`)
  return el ? parseInt(el.value) : 5
}

window.submitReview = async function () {
  const reviewer_name = document.getElementById('r-name').value.trim()
  const review_text = document.getElementById('r-text').value.trim()
  if (!reviewer_name || !review_text) { toast('Please fill in your name and review.'); return }

  const quality = getStarVal('stars-quality')
  const service = getStarVal('stars-service')
  const cleanliness = getStarVal('stars-clean')
  const communication = getStarVal('stars-comms')
  const value = getStarVal('stars-value')
  const stars = Math.round((quality + service + cleanliness + communication + value) / 5)

  const { error } = await supabase.from('reviews').insert({
    listing_id: reviewingId, reviewer_name, review_text,
    stars, quality, service, cleanliness, communication, value
  })
  if (error) { toast('Error submitting review. Please try again.'); console.error(error); return }
  closeReviewModal()
  toast('Review submitted — thank you!')
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
window.selectTier = function (tier) {
  selectedTier = tier
  ;['free', 'verified', 'premium'].forEach(t => document.getElementById('tier-' + t).classList.toggle('selected', t === tier))
  const isPaid = tier === 'verified' || tier === 'premium'
  const locked = document.getElementById('cert-locked')
  const unlocked = document.getElementById('cert-unlocked')
  if (locked) locked.style.display = isPaid ? 'none' : 'block'
  if (unlocked) unlocked.style.display = isPaid ? 'block' : 'none'
}

function getSelectedTrade() {
  const sel = document.getElementById('f-trade')
  if (sel.value === '__new__') return document.getElementById('f-trade-new').value.trim()
  return sel.value
}

window.handleTradeSelect = function () {
  const sel = document.getElementById('f-trade')
  const newInput = document.getElementById('f-trade-new')
  const hint = document.getElementById('f-trade-new-hint')
  const isNew = sel.value === '__new__'
  newInput.style.display = isNew ? 'block' : 'none'
  hint.style.display = isNew ? 'block' : 'none'
  if (isNew) newInput.focus()
}

window.submitListing = async function () {
  const email = document.getElementById('f-email').value.trim()
  const password = document.getElementById('f-password').value
  const contact_name = document.getElementById('f-name').value.trim()
  const name = document.getElementById('f-business').value.trim() || contact_name
  const trade = getSelectedTrade()
  const province = document.getElementById('f-province').value
  const city = document.getElementById('f-city').value.trim()
  const callout = parseInt(document.getElementById('f-callout').value) || 0
  const rate = parseInt(document.getElementById('f-rate').value) || 0
  const description = document.getElementById('f-desc').value.trim()
  const credsRaw = document.getElementById('f-creds').value.trim()
  const years_experience = parseInt(document.getElementById('f-years').value) || 0
  const credentials = credsRaw ? credsRaw.split(',').map(c => c.trim()).filter(Boolean) : []
  if (!email || !password) { toast('Please enter your email and password.'); return }
  if (password.length < 6) { toast('Password must be at least 6 characters.'); return }
  if (!name || !trade || !province || !city) { toast('Please fill in name, trade, province and city.'); return }
  if (!rate) { toast('Please enter your hourly rate.'); return }
  if (!description) { toast('Please add a business description.'); return }

  // Create account first
  let userId = currentUser?.id ?? null
  if (!currentUser) {
    const { data, error: signUpError } = await supabase.auth.signUp({ email, password })
    if (signUpError) { toast('Account error: ' + signUpError.message); return }
    userId = data.user?.id ?? null
  }

  // Upload certificate files only for paid tiers
  const certFiles = (selectedTier === 'verified' || selectedTier === 'premium') ? (window.certFiles || []) : []
  const certificate_urls = []
  for (const file of certFiles) {
    const path = `${userId}/${Date.now()}-${file.name}`
    const { error: uploadError } = await supabase.storage.from('certifications-registrations').upload(path, file)
    if (!uploadError) {
      const { data: urlData } = supabase.storage.from('certifications-registrations').getPublicUrl(path)
      certificate_urls.push(urlData.publicUrl)
    }
  }

  const { error } = await supabase.from('listings').insert({
    name, contact_name, trade, province, city, callout, rate, description, credentials, years_experience, tier: selectedTier,
    user_id: userId, certificate_urls
  })
  if (error) { toast('Error saving listing. Please try again.'); console.error(error); return }
  toast(`${name} is now live on Tradee!`)
  ;['f-name', 'f-phone', 'f-email', 'f-password', 'f-city', 'f-callout', 'f-rate', 'f-desc', 'f-creds', 'f-years'].forEach(id => { const el = document.getElementById(id); if (el) el.value = '' })
  document.getElementById('f-trade').value = ''
  document.getElementById('f-province').value = ''
  selectTier('free')
  await loadListings()
  setTimeout(() => window.showPage('dashboard'), 1500)
}

// ── URL Routing ───────────────────────────────────────────────────────────────
function handleRoute() {
  const path = window.location.pathname
  const match = path.match(/^\/profile\/(\d+)$/)
  if (match) {
    window.openProfile(parseInt(match[1]))
  }
}

window.addEventListener('popstate', handleRoute)

// ── Init ──────────────────────────────────────────────────────────────────────
selectTier('free')
initAuth()
loadListings().then(() => handleRoute())

document.getElementById('star-select').addEventListener('mouseover', e => {
  if (e.target.tagName === 'LABEL') {
    const val = parseInt(e.target.getAttribute('for').replace('s', ''))
    document.querySelectorAll('.star-select label').forEach((l, i) => l.classList.toggle('lit', i < val))
  }
})
document.getElementById('star-select').addEventListener('mouseleave', () => {
  document.querySelectorAll('.star-select label').forEach(l => l.classList.remove('lit'))
})
