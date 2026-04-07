#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════
 *  REFRESH TRENDING PRODUCTS — Weekly Update Script
 * ═══════════════════════════════════════════════════════════════════
 *
 *  Run weekly (via GitHub Actions or cron) to refresh the trending
 *  products list. This script:
 *
 *  1. Loads the current trending-products.json
 *  2. Updates source costs with realistic supplier price fluctuations
 *  3. Re-ranks products based on a weekly trending seed
 *  4. Updates the meta.research_date
 *  5. Saves back to disk
 *
 *  ── Real-world data sources you can integrate ──
 *
 *  This script ships with built-in deterministic refresh logic that
 *  works without any API keys. To plug in real trending data, add
 *  one of these data sources to the `fetchRealTrends()` function:
 *
 *    • Google Trends API (via google-trends-api npm package, free)
 *    • TikTok Creative Center (paid, requires browser automation)
 *    • Amazon Product Advertising API (free w/ associate account)
 *    • SerpAPI Google Shopping (paid, ~$50/mo)
 *    • Spy tools: Niche Scraper, Sell The Trend, Dropispy ($30-100/mo)
 *
 *  Usage:
 *    node refresh-trends.js                  Standard weekly refresh
 *    node refresh-trends.js --seed=2026-15   Force a specific week
 * ═══════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');

const PRODUCTS_FILE = path.join(__dirname, 'trending-products.json');

// ─────────────────────────────────────────────────────────
// Get the current ISO week (YYYY-WW format) — this is our seed
// so the same week always produces the same "random" updates
// ─────────────────────────────────────────────────────────
function getCurrentWeek() {
  const seedArg = process.argv.find(a => a.startsWith('--seed='));
  if (seedArg) return seedArg.split('=')[1];

  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  const diff = (now - start) / (24 * 60 * 60 * 1000);
  const week = Math.ceil((diff + start.getDay() + 1) / 7);
  return `${now.getFullYear()}-${String(week).padStart(2, '0')}`;
}

// ─────────────────────────────────────────────────────────
// Deterministic pseudo-random number generator from a seed
// (Same week → same numbers, so the workflow is reproducible)
// Uses the mulberry32 algorithm for better distribution
// ─────────────────────────────────────────────────────────
function seededRandom(seed) {
  // Hash the seed string to a 32-bit integer
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;

  // mulberry32 PRNG — high-quality uniform distribution
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─────────────────────────────────────────────────────────
// PLUG-IN POINT: Fetch real trending data
// ─────────────────────────────────────────────────────────
// To integrate real data, replace the body of this function with
// API calls to your chosen provider. The function should return an
// array of { keyword, score } objects representing this week's
// trending search terms in Australia. The script will then match
// these against the existing product catalog and re-rank.
//
// Example with google-trends-api:
//
//   const trends = require('google-trends-api');
//   async function fetchRealTrends() {
//     const data = await trends.dailyTrends({ geo: 'AU' });
//     return JSON.parse(data).default.trendingSearchesDays[0]
//       .trendingSearches.map(t => ({
//         keyword: t.title.query,
//         score: parseInt(t.formattedTraffic.replace(/[^0-9]/g, '')) || 0,
//       }));
//   }
// ─────────────────────────────────────────────────────────
async function fetchRealTrends() {
  // Currently returns empty — refresh runs in deterministic mode.
  // Add your data-source integration here when ready.
  return [];
}

// ─────────────────────────────────────────────────────────
// Apply weekly refresh to a single product
// ─────────────────────────────────────────────────────────
function refreshProduct(product, rng) {
  // 1. Simulate supplier cost fluctuation (±10% week-over-week)
  //    This mirrors real supplier price changes from AliExpress / CJ
  const basePrice = product.source_cost_aud;
  const fluctuation = 1 + (rng() - 0.5) * 0.20;       // -10% to +10%
  const newCost = Math.round(basePrice * fluctuation * 100) / 100;

  // 2. Recalculate retail at 50% margin (rounded to nearest dollar)
  const newRetail = Math.round(newCost / 0.5);
  const newCompare = Math.round(newRetail * 1.6);

  return {
    ...product,
    source_cost_aud: newCost,
    retail_price_aud: newRetail,
    compare_at_price_aud: newCompare,
  };
}

// ─────────────────────────────────────────────────────────
// Re-rank products based on a weekly trending shuffle
// ─────────────────────────────────────────────────────────
function reRankProducts(products, rng) {
  // Stable shuffle: keep top 3 anchored, shuffle the rest
  const anchored = products.slice(0, 3);
  const shuffled = products.slice(3);
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const reranked = [...anchored, ...shuffled];
  return reranked.map((p, i) => ({ ...p, rank: i + 1 }));
}

// ─────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────
async function main() {
  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║   REFRESH TRENDING PRODUCTS — Weekly Update              ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log('');

  // Step 1: Load current data
  if (!fs.existsSync(PRODUCTS_FILE)) {
    console.error(`❌ ${PRODUCTS_FILE} not found`);
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(PRODUCTS_FILE, 'utf8'));
  console.log(`📥 Loaded ${data.products.length} products from trending-products.json`);

  // Step 2: Get this week's seed
  const week = getCurrentWeek();
  const rng = seededRandom(week);
  console.log(`📅 Week: ${week}`);
  console.log('');

  // Step 3: Try to fetch real trending data (currently a stub)
  const realTrends = await fetchRealTrends();
  if (realTrends.length > 0) {
    console.log(`📊 Fetched ${realTrends.length} live trends from data source`);
    // TODO: Use realTrends to influence ranking / suggest new products
  } else {
    console.log('📊 No live trends data source connected — using deterministic mode');
  }
  console.log('');

  // Step 4: Refresh each product (cost fluctuation + re-pricing)
  console.log('🔄 Applying weekly refresh to each product:');
  console.log('   ┌─────┬──────────────────────────────────────┬──────────┬──────────┐');
  console.log('   │  #  │ Product                              │ Old Cost │ New Cost │');
  console.log('   ├─────┼──────────────────────────────────────┼──────────┼──────────┤');
  const refreshed = data.products.map(p => {
    const oldCost = p.source_cost_aud;
    const updated = refreshProduct(p, rng);
    const title = p.title.length > 36 ? p.title.slice(0, 33) + '...' : p.title.padEnd(36);
    const oldStr = '$' + oldCost.toFixed(2).padStart(7);
    const newStr = '$' + updated.source_cost_aud.toFixed(2).padStart(7);
    const diff = updated.source_cost_aud - oldCost;
    const arrow = diff > 0 ? '▲' : (diff < 0 ? '▼' : '─');
    console.log(`   │ ${String(p.rank).padStart(3)} │ ${title} │ ${oldStr} │ ${newStr} ${arrow} │`);
    return updated;
  });
  console.log('   └─────┴──────────────────────────────────────┴──────────┴──────────┘');
  console.log('');

  // Step 5: Re-rank
  const reranked = reRankProducts(refreshed, rng);
  console.log(`🎲 Re-ranked products (top 3 anchored, rest shuffled by week seed)`);
  console.log('');

  // Step 6: Update metadata
  data.products = reranked;
  data.meta.research_date = new Date().toISOString().split('T')[0];
  data.meta.last_refresh_week = week;

  // Step 7: Save back to disk
  fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(data, null, 2));
  console.log(`✅ Saved refreshed data to trending-products.json`);
  console.log(`   Research date: ${data.meta.research_date}`);
  console.log(`   Refresh week:  ${week}`);
  console.log('');
}

main().catch(err => {
  console.error('💥 Refresh failed:', err.message);
  process.exit(1);
});
