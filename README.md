# Viral Carts — Automated Product Flow (Australia)

An automated Node.js flow that:

1. **Loads the top 10 most-searched products in Australia** (from pre-researched market data)
2. **Applies a 50% profit margin** (`retail = cost ÷ 0.5`)
3. **Uploads them to your Shopify store** via the GraphQL Admin API (`productSet` mutation)
4. **Refreshes weekly via GitHub Actions** — see [GITHUB-SETUP.md](./GITHUB-SETUP.md)

## ⚡ Weekly Auto-Refresh

This project includes a **GitHub Actions workflow** that runs every Monday and:
- Refreshes product cost data with realistic supplier price fluctuations
- Re-ranks products based on a weekly trending seed
- Commits the changes back to the repo
- Uploads the refreshed catalog to Shopify automatically

**To set it up, follow [GITHUB-SETUP.md](./GITHUB-SETUP.md)** — it's a step-by-step guide for pushing the project to GitHub and adding your Shopify credentials as encrypted secrets.

## The 10 Products (Researched for 2026 AU Market)

| # | Product | Category | Cost | Retail | Margin |
|---|---|---|---:|---:|---:|
| 1 | LED Galaxy Projector 360 | Home Decor | $22.00 | $49.00 | 55% |
| 2 | Hydration Tracker Water Bottle | Health | $18.50 | $42.00 | 56% |
| 3 | LED Red Light Therapy Face Mask | Beauty Tech | $45.00 | $99.00 | 55% |
| 4 | Magnetic Levitating Moon Lamp | Home Decor | $35.00 | $79.00 | 56% |
| 5 | Wireless Neural Earbuds Pro | Audio | $28.00 | $59.00 | 53% |
| 6 | Electric Ice Roller Beauty Tool | Beauty | $14.00 | $32.00 | 56% |
| 7 | Smart Posture Corrector Brace | Wellness | $16.50 | $39.00 | 58% |
| 8 | Mini Handheld Vacuum USB-C | Home Gadgets | $19.00 | $45.00 | 58% |
| 9 | Interactive Pet Cat Laser Toy | Pet Supplies | $12.50 | $29.00 | 57% |
| 10 | Toe Spacers Foot Alignment Set | Wellness | $9.50 | $22.00 | 57% |

**Average margin: ~56%** (exceeds 50% target)

### Research Sources

- Google Trends AU (clothing, skincare, electronics peaks)
- Shopify AU Top Trending Products 2026 report
- TikTok Shop AU bestsellers + `#TikTokMadeMeBuyIt` hashtag analysis
- Amazon.com.au Best Sellers categories
- Skailama AU eCommerce trends report 2026
- FindNiche TikTok Shop 2026 data + Accio Australia market reports

## Quick Start

### 1. Install Node.js (18 or higher)
Check with `node -v`. Download from https://nodejs.org if needed.

### 2. Create a Shopify Custom App
Shopify Admin → **Settings** → **Apps and sales channels** → **Develop apps** → **Create an app**

Enable these API scopes:
- `write_products` ✓
- `read_products` ✓
- `write_inventory` ✓
- `read_inventory` ✓

Click **Install app** → copy the Admin API access token (starts with `shpat_`).

### 3. Set Up Credentials
```bash
cp .env.example .env
```

Edit `.env`:
```
SHOPIFY_STORE=your-store.myshopify.com
SHOPIFY_ACCESS_TOKEN=shpat_xxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### 4. Preview (Dry Run)
See what will be uploaded without actually uploading:
```bash
node flow.js --dry-run
```

### 5. Run the Flow
```bash
node flow.js
```

Output:
```
╔═══════════════════════════════════════════════════════════╗
║   VIRAL CARTS — AUTOMATED PRODUCT FLOW                    ║
║   Top trending products in Australia → Shopify           ║
╚═══════════════════════════════════════════════════════════╝

📥 STEP 1: Loading trending products data...
   ✓ Loaded 10 products
   ✓ Market: Australia

💰 STEP 2: Applying 50% profit margin...
   ┌─────┬──────────────────────────────────────┬──────────┬──────────┐
   │  1  │ LED Galaxy Projector 360             │   $22.00 │   $49.00 │
   │  2  │ Hydration Tracker Water Bottle 1L    │   $18.50 │   $42.00 │
   ...

🚀 STEP 3: Uploading to Shopify (your-store.myshopify.com)...
   [1/10] LED Galaxy Projector 360... ✓ (1 variants)
   [2/10] Hydration Tracker Water Bottle 1L... ✓ (4 variants)
   ...

📊 FLOW COMPLETE
   ✓ Successful: 10 / 10
   ✗ Failed:     0 / 10
   🎉 View your products at: https://your-store.myshopify.com/admin/products
```

## CLI Options

| Flag | Description |
|---|---|
| `--dry-run` | Preview pricing without uploading |
| `--margin=60` | Override profit margin (default: 50) |
| `--file=custom.json` | Use a different products file |

## How the Flow Works

```
┌──────────────────────┐
│  trending-products   │  ← Pre-researched JSON with 10 AU trending products
│       .json          │    (source costs + suggested pricing)
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│   Apply 50% Margin   │  ← retail = cost ÷ (1 - 0.50) = cost × 2
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│   Build productSet   │  ← Transform to Shopify GraphQL input format
│   Mutation Input     │    (options, variants, images, SKUs, inventory)
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│  Shopify GraphQL     │  ← POST to /admin/api/2025-10/graphql.json
│  productSet Mutation │    with productSet mutation (synchronous)
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│   Products Live in   │  ← Products appear in your Shopify Admin
│   your Shopify store │    with correct pricing, tags, variants
└──────────────────────┘
```

## Updating Source Costs

The `trending-products.json` file contains estimated source costs. Before running, you should verify the actual costs from your supplier (AliExpress, CJ Dropshipping, Zendrop, etc.) and update the `source_cost_aud` field for each product. The script automatically recalculates retail prices based on your margin.

## Re-running the Flow

If you re-run the flow, **it will try to create new products with the same SKUs**, which will fail with a "SKU already exists" error. To re-run cleanly, either:
- Delete the existing products from Shopify first, or
- Change the SKUs in `trending-products.json`, or
- Use a different product file with `--file=new-products.json`

## Run Logs

After each run, a log file is saved: `run-log-<timestamp>.json`. It contains the full upload report including successful products, their handles, IDs, and any errors encountered.
