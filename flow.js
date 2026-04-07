#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════
 *  VIRAL CARTS — AUTOMATED PRODUCT FLOW (AUSTRALIA EDITION)
 * ═══════════════════════════════════════════════════════════════════
 *
 *  What this script does:
 *  ──────────────────────
 *  1. Loads the top 10 most-searched products in Australia from
 *     `trending-products.json` (pre-researched from Google Trends AU,
 *      TikTok Shop AU, Shopify AU 2026 reports, Amazon.com.au bestsellers)
 *
 *  2. Applies a 50% profit margin to every product:
 *       retail_price = source_cost × 2
 *     (This is the gross margin before fees, ads, and shipping.)
 *
 *  3. Uploads each product to your Shopify store using the modern
 *     GraphQL Admin API (productSet mutation, version 2025-10).
 *     This creates the product, options, variants, prices, SKUs,
 *     inventory tracking, and image files in a single API call.
 *
 *  4. Logs a detailed report of successes and failures.
 *
 *  Usage:
 *  ──────
 *    1. cp .env.example .env   (then fill in your store + token)
 *    2. node flow.js
 *
 *  Options:
 *  ────────
 *    --dry-run       Print what would be created without uploading
 *    --margin=50     Override the default profit margin (0-99)
 *    --file=path     Use a different products JSON file
 * ═══════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');

// ─────────────────────────────────────────────────────────
//  STEP 0 — Parse CLI args + load environment
// ─────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const MARGIN_ARG = args.find(a => a.startsWith('--margin='));
const FILE_ARG = args.find(a => a.startsWith('--file='));

const PROFIT_MARGIN = MARGIN_ARG ? parseFloat(MARGIN_ARG.split('=')[1]) / 100 : 0.50;
const PRODUCTS_FILE = FILE_ARG ? FILE_ARG.split('=')[1] : 'trending-products.json';

if (PROFIT_MARGIN < 0 || PROFIT_MARGIN >= 1) {
  console.error('❌ Margin must be between 0 and 99');
  process.exit(1);
}

function loadEnv() {
  // In CI environments (GitHub Actions), env vars are already set —
  // skip the .env file requirement
  if (process.env.SHOPIFY_STORE && process.env.SHOPIFY_ACCESS_TOKEN) {
    return;
  }
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) {
    if (DRY_RUN) return; // dry-run doesn't need credentials
    console.error('❌ .env file not found. Copy .env.example to .env and fill in credentials.');
    process.exit(1);
  }
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const m = line.match(/^([A-Z_]+)=(.+)$/);
    if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}
loadEnv();

const STORE = process.env.SHOPIFY_STORE;
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const API_VERSION = '2025-10';

if (!DRY_RUN && (!STORE || !TOKEN)) {
  console.error('❌ Missing SHOPIFY_STORE or SHOPIFY_ACCESS_TOKEN in .env');
  console.error('   (Use --dry-run to preview without uploading)');
  process.exit(1);
}

const ENDPOINT = STORE ? `https://${STORE}/admin/api/${API_VERSION}/graphql.json` : null;

// ─────────────────────────────────────────────────────────
//  STEP 1 — Load trending products from JSON
// ─────────────────────────────────────────────────────────
function loadProducts() {
  const filePath = path.join(__dirname, PRODUCTS_FILE);
  if (!fs.existsSync(filePath)) {
    console.error(`❌ Products file not found: ${filePath}`);
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return data;
}

// ─────────────────────────────────────────────────────────
//  STEP 2 — Apply profit margin pricing
// ─────────────────────────────────────────────────────────
//  retail = cost / (1 - margin)
//  For margin = 0.50:  retail = cost × 2
//  For margin = 0.60:  retail = cost × 2.5
// ─────────────────────────────────────────────────────────
function applyMargin(cost, margin) {
  if (cost <= 0) return 0;
  return Math.round((cost / (1 - margin)) * 100) / 100;
}

function enrichProducts(data) {
  return data.products.map(p => {
    const cost = p.source_cost_aud;

    // Use pre-calculated retail if it already meets the margin,
    // otherwise recalculate from cost to hit the exact margin target.
    const targetRetail = applyMargin(cost, PROFIT_MARGIN);
    const actualRetail = p.retail_price_aud >= targetRetail ? p.retail_price_aud : targetRetail;
    const actualCompare = p.compare_at_price_aud || Math.round(actualRetail * 1.6 * 100) / 100;

    const realMargin = ((actualRetail - cost) / actualRetail * 100).toFixed(1);

    return {
      ...p,
      _computed: {
        cost,
        retail: actualRetail,
        compareAt: actualCompare,
        marginPct: realMargin,
      },
    };
  });
}

// ─────────────────────────────────────────────────────────
//  STEP 3 — Shopify GraphQL helpers
// ─────────────────────────────────────────────────────────
async function gql(query, variables = {}) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) {
    throw new Error(`GraphQL errors: ${JSON.stringify(json.errors, null, 2)}`);
  }
  return json.data;
}

const PRODUCT_SET_MUTATION = `
  mutation CreateProduct($productSet: ProductSetInput!, $synchronous: Boolean!) {
    productSet(synchronous: $synchronous, input: $productSet) {
      product {
        id
        title
        handle
        status
        variants(first: 50) {
          nodes { id title price sku }
        }
      }
      userErrors { field message code }
    }
  }
`;

// ─────────────────────────────────────────────────────────
//  STEP 4 — Build productSet input from a product definition
// ─────────────────────────────────────────────────────────
function buildProductInput(product) {
  const { _computed: c } = product;

  return {
    title: product.title,
    descriptionHtml: product.descriptionHtml.trim(),
    vendor: product.vendor,
    productType: product.productType,
    tags: product.tags,
    status: 'ACTIVE',
    productOptions: product.options.map((opt, i) => ({
      name: opt.name,
      position: i + 1,
      values: opt.values.map(v => ({ name: v })),
    })),
    files: product.images.map((url, i) => ({
      originalSource: url,
      alt: `${product.title} image ${i + 1}`,
      contentType: 'IMAGE',
    })),
    variants: product.variants.map(v => ({
      optionValues: v.options.map((value, idx) => ({
        optionName: product.options[idx].name,
        name: value,
      })),
      price: c.retail.toFixed(2),
      compareAtPrice: c.compareAt.toFixed(2),
      sku: v.sku,
      inventoryPolicy: 'DENY',
      inventoryItem: { tracked: true },
    })),
  };
}

// ─────────────────────────────────────────────────────────
//  STEP 5 — Main flow
// ─────────────────────────────────────────────────────────
async function runFlow() {
  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║   VIRAL CARTS — AUTOMATED PRODUCT FLOW                    ║');
  console.log('║   Top trending products in Australia → Shopify           ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log('');

  // Step 1: Load
  console.log('📥 STEP 1: Loading trending products data...');
  const data = loadProducts();
  console.log(`   ✓ Loaded ${data.products.length} products`);
  console.log(`   ✓ Market: ${data.meta.market}`);
  console.log(`   ✓ Research date: ${data.meta.research_date}`);
  console.log(`   ✓ Sources:`);
  data.meta.sources_reference.forEach(src => console.log(`     • ${src}`));
  console.log('');

  // Step 2: Apply margin
  console.log(`💰 STEP 2: Applying ${(PROFIT_MARGIN * 100).toFixed(0)}% profit margin...`);
  const products = enrichProducts(data);
  console.log('');
  console.log('   ┌─────┬──────────────────────────────────────┬──────────┬──────────┬──────────┬─────────┐');
  console.log('   │  #  │ Product                              │     Cost │   Retail │  Compare │  Margin │');
  console.log('   ├─────┼──────────────────────────────────────┼──────────┼──────────┼──────────┼─────────┤');
  let totalCost = 0, totalRetail = 0;
  products.forEach(p => {
    const title = p.title.length > 36 ? p.title.slice(0, 33) + '...' : p.title.padEnd(36);
    const cost = '$' + p._computed.cost.toFixed(2).padStart(7);
    const retail = '$' + p._computed.retail.toFixed(2).padStart(7);
    const compare = '$' + p._computed.compareAt.toFixed(2).padStart(7);
    const margin = (p._computed.marginPct + '%').padStart(7);
    console.log(`   │ ${String(p.rank).padStart(3)} │ ${title} │ ${cost} │ ${retail} │ ${compare} │ ${margin} │`);
    totalCost += p._computed.cost;
    totalRetail += p._computed.retail;
  });
  console.log('   └─────┴──────────────────────────────────────┴──────────┴──────────┴──────────┴─────────┘');
  const avgMargin = products.reduce((sum, p) => sum + parseFloat(p._computed.marginPct), 0) / products.length;
  console.log(`   Total cost:   $${totalCost.toFixed(2)} AUD`);
  console.log(`   Total retail: $${totalRetail.toFixed(2)} AUD`);
  console.log(`   Avg margin:   ${avgMargin.toFixed(1)}%`);
  console.log('');

  // Step 3: Upload
  if (DRY_RUN) {
    console.log('🏃 STEP 3: DRY RUN — skipping Shopify upload');
    console.log('');
    console.log('   To actually upload, run without --dry-run:');
    console.log('     node flow.js');
    console.log('');
    return;
  }

  console.log(`🚀 STEP 3: Uploading to Shopify (${STORE})...`);
  console.log('');

  let success = 0;
  let failed = 0;
  const results = [];

  for (let i = 0; i < products.length; i++) {
    const product = products[i];
    const num = `[${i + 1}/${products.length}]`;
    process.stdout.write(`   ${num} ${product.title}... `);

    try {
      const input = buildProductInput(product);
      const resp = await gql(PRODUCT_SET_MUTATION, {
        productSet: input,
        synchronous: true,
      });

      const errors = resp.productSet.userErrors;
      if (errors && errors.length > 0) {
        console.log('❌');
        errors.forEach(e => console.log(`        • ${(e.field || []).join('.')}: ${e.message}`));
        failed++;
        results.push({ title: product.title, status: 'failed', errors });
        continue;
      }

      const created = resp.productSet.product;
      console.log(`✓ (${created.variants.nodes.length} variants)`);
      results.push({
        title: product.title,
        status: 'success',
        handle: created.handle,
        id: created.id,
        variants: created.variants.nodes.length,
      });
      success++;

      // Rate limit: 500ms between products
      await new Promise(r => setTimeout(r, 500));

    } catch (err) {
      console.log('❌');
      console.log(`        Exception: ${err.message}`);
      failed++;
      results.push({ title: product.title, status: 'error', error: err.message });
    }
  }

  // Step 4: Report
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('📊 FLOW COMPLETE');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`   ✓ Successful: ${success} / ${products.length}`);
  console.log(`   ✗ Failed:     ${failed} / ${products.length}`);
  console.log('');

  if (success > 0) {
    console.log(`   🎉 View your products at:`);
    console.log(`      https://${STORE}/admin/products`);
    console.log('');
  }

  // Save run log
  const logFile = `run-log-${Date.now()}.json`;
  fs.writeFileSync(path.join(__dirname, logFile), JSON.stringify({
    timestamp: new Date().toISOString(),
    store: STORE,
    margin: PROFIT_MARGIN,
    total: products.length,
    success,
    failed,
    results,
  }, null, 2));
  console.log(`   📝 Full log saved to: ${logFile}`);
  console.log('');
}

// ─────────────────────────────────────────────────────────
// Run
// ─────────────────────────────────────────────────────────
runFlow().catch(err => {
  console.error('\n💥 Fatal error:', err.message);
  console.error(err.stack);
  process.exit(1);
});
