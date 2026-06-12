import { supabase } from './supabaseClient.js'
import { PROVINCE_CITIES } from './cities.js'
import { trackEvent } from './analytics.js'

let listings = []
let currentProfile = null
let currentUser = null
let selectedTier = 'free'
let editTier = 'free'
let reviewingId = null
let filterTrade = '', filterProvince = '', filterCity = '', filterTierVal = '', filterSort = 'rating', dirSearchTerm = ''
let selectedCities = []

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
  // Send welcome email via Edge Function
  supabase.functions.invoke('welcome-email', { body: { email } }).catch(() => {})
  toast('Account created! You can now list your business.')
  window.showPage('list')
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
  el.innerHTML = `
    <div class="profile-hero" style="margin-bottom:1.5rem;">
      <div style="position:relative;display:inline-block;">
        <div class="profile-avatar" id="dash-avatar">${listing.photo_url ? `<img src="${listing.photo_url}" style="width:100%;height:100%;object-fit:cover;border-radius:var(--radius);">` : initials(listing.name)}</div>
        <label for="dash-photo-input" style="position:absolute;bottom:-6px;right:-6px;background:var(--amber);border-radius:50%;width:26px;height:26px;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:13px;" title="Change photo">✏️</label>
        <input type="file" id="dash-photo-input" accept=".jpg,.jpeg,.png" style="display:none;" onchange="window.updatePhoto(this, ${listing.id})">
      </div>
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
        <div class="form-group"><label class="form-label">Phone Number</label><input class="form-input" id="edit-phone" value="${listing.phone || ''}"></div>
        <div class="form-group"><label class="form-label">Email</label><input class="form-input" id="edit-email" type="email" value="${listing.email || ''}"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Call-out Fee (R)</label><input class="form-input" id="edit-callout" value="${listing.callout === -1 ? 'N/A' : listing.callout}" placeholder="e.g. 350 or N/A"></div>
        <div class="form-group"><label class="form-label">Rate Per Hour (R)</label><input class="form-input" id="edit-rate" value="${listing.rate === -1 ? 'N/A' : listing.rate}" placeholder="e.g. 650 or N/A"></div>
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
          <div class="tier-name">Standard</div>
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

window.updatePhoto = async function (input, id) {
  const file = input.files[0]
  if (!file) return
  if (file.size > 2 * 1024 * 1024) { toast('Photo must be under 2MB'); return }
  toast('Uploading photo...')
  const path = `${currentUser.id}/photo-${Date.now()}-${file.name}`
  const { error: uploadError } = await supabase.storage.from('certifications-registrations').upload(path, file)
  if (uploadError) { toast('Upload failed: ' + uploadError.message); return }
  const { data: urlData } = supabase.storage.from('certifications-registrations').getPublicUrl(path)
  const photo_url = urlData.publicUrl
  const { error } = await supabase.from('listings').update({ photo_url }).eq('id', id).eq('user_id', currentUser.id)
  if (error) { toast('Error saving photo'); return }
  toast('Photo updated!')
  const avatar = document.getElementById('dash-avatar')
  if (avatar) avatar.innerHTML = `<img src="${photo_url}" style="width:100%;height:100%;object-fit:cover;border-radius:var(--radius);">`
  await loadListings()
}

window.saveListing = async function (id) {
  const name = document.getElementById('edit-business').value.trim()
  const contact_name = document.getElementById('edit-contact').value.trim()
  const calloutRaw = document.getElementById('edit-callout').value.trim()
  const rateRaw = document.getElementById('edit-rate').value.trim()
  const callout = calloutRaw.toUpperCase() === 'N/A' ? -1 : (parseInt(calloutRaw) || 0)
  const rate = rateRaw.toUpperCase() === 'N/A' ? -1 : (parseInt(rateRaw) || 0)
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

  const phone = document.getElementById('edit-phone')?.value.trim() || ''
  const email = document.getElementById('edit-email')?.value.trim() || ''
  const { error } = await supabase.from('listings').update({
    name, contact_name, phone, email, callout, rate, description, credentials, years_experience, tier: editTier, certificate_urls
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
function fmtRand(n) { return n === -1 ? 'N/A' : n === 0 ? 'Free' : 'R' + n }
function tierBadge(tier) {
  if (tier === 'premium') return '<span class="badge badge-premium">Premium</span><span class="badge badge-verified">Verified</span>'
  if (tier === 'verified') return '<span class="badge badge-verified">Verified</span>'
  return ''
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
  if (name === 'list') {
    const s1 = document.getElementById('list-step-1')
    const s2 = document.getElementById('list-step-2')
    if (s1) s1.style.display = 'block'
    if (s2) s2.style.display = 'none'
  }
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
  const allPremiumHome = listings.filter(l => l.tier === 'premium')
  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000)
  const offset = allPremiumHome.length > 0 ? dayOfYear % allPremiumHome.length : 0
  const rotatedPremium = [...allPremiumHome.slice(offset), ...allPremiumHome.slice(0, offset)]
  const featured = rotatedPremium.slice(0, 3).concat(listings.filter(l => l.tier === 'verified').slice(0, 3)).slice(0, 6)
  document.getElementById('home-cards').innerHTML = featured.length
    ? featured.map(l => l.tier === 'premium' ? featuredCardHTML(l) : cardHTML(l)).join('')
    : '<div class="empty-state" style="grid-column:1/-1"><h3>No Listings Yet</h3><p>Be the first to <a onclick="showPage(\'list\')" style="color:var(--amber);cursor:pointer;">list your business</a>!</p></div>'
}

window.filterByTrade = function (trade) { filterTrade = trade; document.getElementById('filter-trade').value = trade; showPage('directory') }
window.heroSearch = function () {
  filterTrade = document.getElementById('hero-search').value
  filterProvince = document.getElementById('hero-province').value
  filterCity = document.getElementById('hero-city')?.value || ''
  document.getElementById('filter-province').value = filterProvince
  window.showPage('directory')
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
function populateTradeFilter() {
  const groups = buildTradeOptgroups()
  const base = '<option value="">All Trades</option>'
  ;['filter-trade', 'rank-trade-filter', 'hero-search'].forEach(id => {
    const el = document.getElementById(id)
    if (el) el.innerHTML = base + groups
  })
  document.getElementById('filter-trade').value = filterTrade
  const catSel = document.getElementById('f-trade-category')
  if (catSel && catSel.options.length <= 1) {
    Object.keys(TRADE_CATEGORIES).forEach(cat => catSel.add(new Option(cat, cat)))
  }
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
          <span style="font-family:'Bebas Neue',sans-serif;font-size:1.2rem;letter-spacing:0.06em;color:var(--amber);">⭐ Featured Tradesmen</span>
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
  return `<div class="tradesman-card featured-card" onclick="openProfile(${l.id})" style="border-color:var(--amber);background:linear-gradient(135deg,var(--charcoal-2) 0%,rgba(245,158,11,0.06) 100%);box-shadow:0 0 24px rgba(245,158,11,0.12);">
    <div style="position:absolute;top:12px;right:12px;background:var(--amber);color:var(--charcoal);font-size:10px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;padding:3px 10px;border-radius:100px;">⭐ Featured</div>
    <div class="card-header" style="margin-right:70px;">
      <div class="card-avatar premium-av">${l.photo_url ? `<img src="${l.photo_url}" style="width:100%;height:100%;object-fit:cover;border-radius:var(--radius);">` : initials(l.name)}</div>
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
    ${l.phone || l.email ? `
    <div style="display:grid;grid-template-columns:${l.phone && l.email ? '1fr 1fr' : '1fr'};gap:8px;padding:0.75rem 0;border-top:1px solid rgba(245,158,11,0.2);border-bottom:1px solid rgba(245,158,11,0.2);margin-bottom:0.75rem;">
      ${l.phone ? `<div><div class="info-label">Phone</div><a href="tel:${l.phone}" onclick="event.stopPropagation();trackContact(${l.id},'phone')" style="font-size:13px;color:var(--white);text-decoration:none;font-weight:500;">${l.phone}</a></div>` : ''}
      ${l.email ? `<div><div class="info-label">Email</div><a href="mailto:${l.email}" onclick="event.stopPropagation();trackContact(${l.id},'email')" style="font-size:13px;color:var(--white);text-decoration:none;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block;">${l.email}</a></div>` : ''}
    </div>` : ''}
    <div style="display:flex;align-items:center;justify-content:space-between;">
      <div class="card-area" style="border-top:none;padding-top:0;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>
        ${l.cities && l.cities.length > 1 ? l.cities.slice(0,2).join(', ') + (l.cities.length > 2 ? ` +${l.cities.length-2} more` : '') : (l.city || '')}, ${l.province}
      </div>
      <button class="btn btn-primary btn-sm" onclick="openProfile(${l.id})" style="white-space:nowrap;">More Info →</button>
    </div>
  </div>`
}

function cardHTML(l) {
  const rating = avgRating(l), rd = rating > 0 ? rating.toFixed(1) : '—'
  const reviewCount = l.reviews ? l.reviews.length : 0
  const cityStr = l.cities && l.cities.length > 1 ? l.cities.slice(0,2).join(', ') + (l.cities.length > 2 ? ` +${l.cities.length-2} more` : '') : (l.city || '')
  return `<div class="tradesman-card">
    <div class="card-header">
      <div class="card-avatar ${l.tier === 'premium' ? 'premium-av' : ''}">${l.photo_url ? `<img src="${l.photo_url}" style="width:100%;height:100%;object-fit:cover;border-radius:var(--radius);">` : initials(l.name)}</div>
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
    ${l.phone || l.email ? `
    <div style="display:grid;grid-template-columns:${l.phone && l.email ? '1fr 1fr' : '1fr'};gap:8px;padding:0.75rem 0;border-top:1px solid var(--charcoal-3);border-bottom:1px solid var(--charcoal-3);margin-bottom:0.75rem;">
      ${l.phone ? `<div><div class="info-label">Phone</div><a href="tel:${l.phone}" onclick="event.stopPropagation();trackContact(${l.id},'phone')" style="font-size:13px;color:var(--white);text-decoration:none;font-weight:500;">${l.phone}</a></div>` : ''}
      ${l.email ? `<div><div class="info-label">Email</div><a href="mailto:${l.email}" onclick="event.stopPropagation();trackContact(${l.id},'email')" style="font-size:13px;color:var(--white);text-decoration:none;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block;">${l.email}</a></div>` : ''}
    </div>` : ''}
    <div style="display:flex;align-items:center;justify-content:space-between;">
      <div class="card-area" style="border-top:none;padding-top:0;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>
        ${cityStr}, ${l.province}
      </div>
      <button class="btn btn-primary btn-sm" onclick="openProfile(${l.id})" style="white-space:nowrap;">More Info →</button>
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
  window.history.pushState({}, '', `/profile/${id}`)
  trackEvent('profile_view', l.id, { trade: l.trade, province: l.province })
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
        <p class="review-text">${r.review_text}</p>
      </div>`).join('')
    : '<p style="color:var(--charcoal-6);font-size:14px;">No reviews yet — be the first!</p>'
  document.getElementById('profile-content').innerHTML = `
    <div class="profile-back" onclick="goBack()">← Back to Directory</div>
    <div class="profile-hero">
      <div class="profile-avatar">${l.photo_url ? `<img src="${l.photo_url}" style="width:100%;height:100%;object-fit:cover;border-radius:var(--radius);">` : initials(l.name)}</div>
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
          ${l.phone ? `<a href="https://wa.me/${l.phone.replace(/\D/g,'')}" target="_blank" onclick="trackContact(${l.id},'whatsapp')" class="btn btn-primary btn-sm" style="background:#25D366;text-decoration:none;">💬 WhatsApp</a>` : ''}
          ${l.phone ? `<a href="tel:${l.phone}" onclick="trackContact(${l.id},'phone')" class="btn btn-outline btn-sm" style="text-decoration:none;">📞 Call</a>` : ''}
          ${l.email ? `<a href="mailto:${l.email}" onclick="trackContact(${l.id},'email')" class="btn btn-outline btn-sm" style="text-decoration:none;">✉ Email</a>` : ''}
          <button class="btn btn-outline btn-sm" onclick="openReviewModal(${l.id})">⭐ Review</button>
          <button class="btn btn-outline btn-sm" onclick="copyProfileLink(${l.id})">🔗 Share</button>
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

window.trackContact = function (id, type) {
  trackEvent(type + '_click', id)
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

  // Recalculate rating_avg from all reviews for this listing and save it
  const { data: allReviews } = await supabase.from('reviews').select('stars').eq('listing_id', reviewingId)
  if (allReviews && allReviews.length) {
    const avg = allReviews.reduce((s, r) => s + r.stars, 0) / allReviews.length
    await supabase.from('listings').update({ rating_avg: parseFloat(avg.toFixed(2)) }).eq('id', reviewingId)
  }

  trackEvent('review_left', reviewingId)
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
  const province = document.getElementById('f-province').value
  const city = selectedCities.length > 0 ? selectedCities[0] : ''
  const calloutRaw = document.getElementById('f-callout').value.trim()
  const rateRaw = document.getElementById('f-rate').value.trim()
  const callout = calloutRaw.toUpperCase() === 'N/A' ? -1 : (parseInt(calloutRaw) || 0)
  const rate = rateRaw.toUpperCase() === 'N/A' ? -1 : (parseInt(rateRaw) || 0)
  const description = document.getElementById('f-desc').value.trim()
  const credsRaw = document.getElementById('f-creds')?.value.trim() || ''
  const years_experience = parseInt(document.getElementById('f-years')?.value) || 0
  const credentials = credsRaw ? credsRaw.split(',').map(c => c.trim()).filter(Boolean) : []
  if (!email || !password) { toast('Please enter your email and password.'); return }
  if (password.length < 6) { toast('Password must be at least 6 characters.'); return }
  if (!name || selectedTrades.length === 0 || !province || selectedCities.length === 0) { toast('Please fill in name, at least one trade, province and at least one city.'); return }
  if (!rate && rateRaw.toUpperCase() !== 'N/A') { toast('Please enter your hourly rate or N/A.'); return }
  if (!description) { toast('Please add a business description.'); return }

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
    const { error: photoUploadError } = await supabase.storage.from('certifications-registrations').upload(photoPath, photoFile)
    if (!photoUploadError) {
      const { data: photoUrlData } = supabase.storage.from('certifications-registrations').getPublicUrl(photoPath)
      photo_url = photoUrlData.publicUrl
    }
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

  const cities = selectedCities.length > 0 ? selectedCities : (city ? [city] : [])
  const { error } = await supabase.from('listings').insert({
    name, contact_name, phone, email, trade, province, city: cities[0] || city, cities, callout, rate, description, credentials, years_experience, tier: selectedTier,
    user_id: userId, certificate_urls, photo_url
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
