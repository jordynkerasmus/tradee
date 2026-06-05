import { supabase } from './supabaseClient.js'

let listings = []
let currentProfile = null
let selectedTier = 'free'
let reviewingId = null
let filterTrade = '', filterProvince = '', filterTierVal = '', filterSort = 'rating', dirSearchTerm = ''

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
  const rating = avgRating(l), rd = rating > 0 ? rating.toFixed(1) : '—'
  const reviews = l.reviews || []
  const credsHTML = l.credentials && l.credentials.length
    ? l.credentials.map(c => `<div class="cred-item"><div class="cred-icon">✓</div><span>${c}</span></div>`).join('')
    : '<p style="color:var(--charcoal-6);font-size:14px;">No credentials listed yet.</p>'
  const reviewsHTML = reviews.length
    ? reviews.map(r => `<div class="review-item"><div class="review-header"><span class="reviewer-name">${r.reviewer_name}</span><span class="review-date">${new Date(r.created_at).toLocaleDateString('en-ZA', { month: 'short', year: 'numeric' })}</span></div><div class="review-stars">${'★'.repeat(r.stars)}${'☆'.repeat(5 - r.stars)}</div><p class="review-text">${r.review_text}</p></div>`).join('')
    : '<p style="color:var(--charcoal-6);font-size:14px;">No reviews yet — be the first!</p>'
  document.getElementById('profile-content').innerHTML = `
    <div class="profile-back" onclick="showPage('directory')">← Back to Directory</div>
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
          <button class="btn btn-outline btn-sm" onclick="showPage('directory')">← Back</button>
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

// ── Reviews ───────────────────────────────────────────────────────────────────
window.openReviewModal = function (id) {
  reviewingId = id
  document.getElementById('review-modal').classList.add('open')
  document.getElementById('r-name').value = ''
  document.getElementById('r-text').value = ''
  document.getElementById('s5').checked = true
}
window.closeReviewModal = function () { document.getElementById('review-modal').classList.remove('open') }
window.submitReview = async function () {
  const reviewer_name = document.getElementById('r-name').value.trim()
  const review_text = document.getElementById('r-text').value.trim()
  const starsEl = document.querySelector('input[name="stars"]:checked')
  const stars = starsEl ? parseInt(starsEl.value) : 5
  if (!reviewer_name || !review_text) { toast('Please fill in your name and review.'); return }
  const { error } = await supabase.from('reviews').insert({ listing_id: reviewingId, reviewer_name, review_text, stars })
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
  if (!name || !trade || !province || !city) { toast('Please fill in name, trade, province and city.'); return }
  if (!rate) { toast('Please enter your hourly rate.'); return }
  if (!description) { toast('Please add a business description.'); return }
  const { error } = await supabase.from('listings').insert({
    name, contact_name, trade, province, city, callout, rate, description, credentials, years_experience, tier: selectedTier
  })
  if (error) { toast('Error saving listing. Please try again.'); console.error(error); return }
  toast(`${name} is now live on Tradee!`)
  ;['f-name', 'f-phone', 'f-email', 'f-city', 'f-callout', 'f-rate', 'f-desc', 'f-creds', 'f-years'].forEach(id => { document.getElementById(id).value = '' })
  document.getElementById('f-trade').value = ''
  document.getElementById('f-province').value = ''
  selectTier('free')
  await loadListings()
  filterTrade = trade
  setTimeout(() => showPage('directory'), 1500)
}

// ── Init ──────────────────────────────────────────────────────────────────────
selectTier('free')
loadListings()

document.getElementById('star-select').addEventListener('mouseover', e => {
  if (e.target.tagName === 'LABEL') {
    const val = parseInt(e.target.getAttribute('for').replace('s', ''))
    document.querySelectorAll('.star-select label').forEach((l, i) => l.classList.toggle('lit', i < val))
  }
})
document.getElementById('star-select').addEventListener('mouseleave', () => {
  document.querySelectorAll('.star-select label').forEach(l => l.classList.remove('lit'))
})
