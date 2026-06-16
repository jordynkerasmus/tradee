// Generates static SEO landing pages ("Plumbers in Umhlanga") + sitemap.xml +
// robots.txt into dist/ after the Vite build. Each page is real crawlable HTML
// with unique title/meta/content and a CTA that deep-links into the filtered
// directory. Run via the `postbuild` npm script.
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = resolve(ROOT, 'dist')
const BASE = 'https://www.tradee.org'

// slug -> exact trade name (must match listing.trade) + friendly label
const TRADES = [
  ['electrician', 'Electrician', 'Electrician'],
  ['plumber', 'Plumber', 'Plumber'],
  ['builder', 'Builder / General Contractor', 'Builder'],
  ['handyman', 'Handyman', 'Handyman'],
  ['painter', 'Painter', 'Painter'],
  ['roofer', 'Roofer', 'Roofer'],
  ['tiler', 'Tiler', 'Tiler'],
  ['carpenter', 'Carpenter', 'Carpenter'],
  ['landscaper', 'Landscaper', 'Landscaper'],
  ['locksmith', 'Locksmith', 'Locksmith'],
]
// slug -> {name (exact, for filter), label (display), province}
const CITIES = [
  ['johannesburg', 'Johannesburg', 'Johannesburg', 'Gauteng'],
  ['pretoria', 'Pretoria', 'Pretoria', 'Gauteng'],
  ['sandton', 'Sandton', 'Sandton', 'Gauteng'],
  ['centurion', 'Centurion', 'Centurion', 'Gauteng'],
  ['cape-town', 'Cape Town', 'Cape Town', 'Western Cape'],
  ['durban', 'Durban', 'Durban', 'KwaZulu-Natal'],
  ['umhlanga', 'Umhlanga', 'Umhlanga', 'KwaZulu-Natal'],
  ['ballito', 'Ballito', 'Ballito', 'KwaZulu-Natal'],
  ['pinetown', 'Pinetown', 'Pinetown', 'KwaZulu-Natal'],
  ['pietermaritzburg', 'Pietermaritzburg', 'Pietermaritzburg', 'KwaZulu-Natal'],
  ['hillcrest', 'Hillcrest', 'Hillcrest', 'KwaZulu-Natal'],
  ['westville', 'Westville', 'Westville', 'KwaZulu-Natal'],
]

const enc = (s) => encodeURIComponent(s)
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function page(trade, city) {
  const [, tName, tLabel] = trade
  const [cSlug, cName, cLabel, province] = city
  const url = `${BASE}/find/${trade[0]}-in-${cSlug}/`
  const cta = `${BASE}/?trade=${enc(tName)}&city=${enc(cName)}&province=${enc(province)}`
  const title = `Find a Trusted ${tLabel} in ${cLabel} | Tradee`
  const desc = `Looking for a reliable ${tLabel.toLowerCase()} in ${cLabel}? Browse rated, reviewed local ${tLabel.toLowerCase()}s on Tradee and contact them directly. Free to use.`
  // sibling links: same trade, other cities + other trades, same city
  const otherCities = CITIES.filter(c => c[0] !== cSlug).slice(0, 6)
    .map(c => `<a href="${BASE}/find/${trade[0]}-in-${c[0]}/">${esc(tLabel)}s in ${esc(c[2])}</a>`).join('')
  const otherTrades = TRADES.filter(t => t[0] !== trade[0])
    .map(t => `<a href="${BASE}/find/${t[0]}-in-${cSlug}/">${esc(t[2])}s in ${esc(cLabel)}</a>`).join('')
  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${url}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:type" content="website"><meta property="og:url" content="${url}">
<style>
:root{--charcoal:#1C1917;--charcoal2:#292524;--charcoal3:#3D3935;--amber:#F59E0B;--white:#FFFDF9;--grey:#A8A29E}
*{box-sizing:border-box}body{margin:0;background:var(--charcoal);color:var(--white);font-family:'Helvetica Neue',Arial,sans-serif;line-height:1.6}
.wrap{max-width:760px;margin:0 auto;padding:3rem 1.25rem}
.logo{font-size:1.8rem;font-weight:900;letter-spacing:0.08em;margin-bottom:2rem}.logo span{color:var(--amber)}
h1{font-size:2rem;line-height:1.2;margin:0 0 1rem}.amber{color:var(--amber)}
p{color:var(--grey)}
.cta{display:inline-block;background:var(--amber);color:#1C1917;font-weight:700;padding:14px 28px;border-radius:8px;text-decoration:none;margin:1.25rem 0}
.card{background:var(--charcoal2);border:1px solid var(--charcoal3);border-radius:12px;padding:1.25rem 1.5rem;margin:1.5rem 0}
ul{color:var(--grey);padding-left:1.2rem}
.links{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
.links a{font-size:13px;color:var(--amber);background:var(--charcoal2);border:1px solid var(--charcoal3);padding:6px 12px;border-radius:100px;text-decoration:none}
.foot{margin-top:2.5rem;border-top:1px solid var(--charcoal3);padding-top:1.25rem;font-size:13px;color:var(--grey)}
.foot a{color:var(--amber)}
</style></head><body><div class="wrap">
<div class="logo">TRA<span>DEE</span></div>
<h1>Find a Trusted <span class="amber">${esc(tLabel)}</span> in ${esc(cLabel)}</h1>
<p>Need a reliable ${esc(tLabel.toLowerCase())} in ${esc(cLabel)}? Tradee lists local, rated and reviewed ${esc(tLabel.toLowerCase())}s so you can compare and contact them directly — no booking fees, no middleman.</p>
<a class="cta" href="${cta}">See ${esc(tLabel.toLowerCase())}s in ${esc(cLabel)} &rarr;</a>
<div class="card">
  <strong>Why use Tradee to find a ${esc(tLabel.toLowerCase())} in ${esc(cLabel)}?</strong>
  <ul>
    <li>Real client reviews and star ratings — choose with confidence</li>
    <li>Verified tradesmen who've submitted their credentials</li>
    <li>Contact them directly by call, WhatsApp or email</li>
    <li>Completely free to use for homeowners</li>
  </ul>
</div>
<p><strong style="color:var(--white)">Other ${esc(tLabel.toLowerCase())}s nearby:</strong></p>
<div class="links">${otherCities}</div>
<p style="margin-top:1.5rem"><strong style="color:var(--white)">Other trades in ${esc(cLabel)}:</strong></p>
<div class="links">${otherTrades}</div>
<div class="foot">Are you a ${esc(tLabel.toLowerCase())} in ${esc(cLabel)}? <a href="${BASE}/">List your business free on Tradee &rarr;</a><br><br><a href="${BASE}/">Tradee — The Trade Directory</a></div>
</div></body></html>`
}

let count = 0
const urls = []
for (const t of TRADES) {
  for (const c of CITIES) {
    const dir = resolve(DIST, 'find', `${t[0]}-in-${c[0]}`)
    mkdirSync(dir, { recursive: true })
    writeFileSync(resolve(dir, 'index.html'), page(t, c))
    urls.push(`${BASE}/find/${t[0]}-in-${c[0]}/`)
    count++
  }
}

// sitemap.xml
const staticUrls = [`${BASE}/`, `${BASE}/faq`]
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${[...staticUrls, ...urls].map(u => `  <url><loc>${u}</loc></url>`).join('\n')}
</urlset>`
writeFileSync(resolve(DIST, 'sitemap.xml'), sitemap)
writeFileSync(resolve(DIST, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${BASE}/sitemap.xml\n`)

console.log(`gen-landing: wrote ${count} landing pages + sitemap.xml + robots.txt`)
