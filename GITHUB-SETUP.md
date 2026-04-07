# GitHub Setup Guide — Weekly Auto-Refresh

This guide walks you through pushing this project to GitHub and enabling the automated weekly trending-products refresh.

## What You'll Get

Once set up, every Monday at 8 AM UTC (≈ 6 PM Melbourne) GitHub will automatically:

1. ✅ Run `refresh-trends.js` to update product costs and re-rank
2. ✅ Commit the updated `trending-products.json` back to your repo
3. ✅ Run `flow.js` to upload the refreshed products to your Shopify store
4. ✅ Save a run log artifact you can download for debugging

You can also trigger it manually anytime from the GitHub Actions tab.

---

## Part 1: Push the Project to GitHub (one-time)

### Step 1 — Install Git
If you don't have it: https://git-scm.com/downloads

Verify with:
```bash
git --version
```

### Step 2 — Create a new GitHub repo
1. Go to https://github.com/new
2. Repository name: `viral-carts-flow` (or whatever you prefer)
3. Set visibility to **Private** (recommended — your script handles store data)
4. **Do NOT** initialize with README, .gitignore, or license (we already have them)
5. Click **Create repository**
6. Copy the repo URL from the next page (looks like `https://github.com/yourusername/viral-carts-flow.git`)

### Step 3 — Push the code from your computer
Open a terminal in the unzipped `viral-flow-v2` folder and run:

```bash
git init
git add .
git commit -m "Initial commit: viral carts automated flow"
git branch -M main
git remote add origin https://github.com/yourusername/viral-carts-flow.git
git push -u origin main
```

Replace the URL on line 5 with your actual repo URL.

> **⚠️ IMPORTANT — Never commit your `.env` file!**
> The `.gitignore` file already excludes it, but double-check before pushing.
> Run `git status` and make sure `.env` does NOT appear in the list of staged files.

---

## Part 2: Add Your Shopify Credentials as Secrets

The workflow needs your Shopify store URL and API token, but those should never be committed to the repo. Instead, GitHub stores them encrypted as **Secrets**.

### Step 1 — Open the Secrets settings
1. On your GitHub repo page, click **Settings** (top right)
2. In the left sidebar, click **Secrets and variables** → **Actions**
3. Click the green **New repository secret** button

### Step 2 — Add the first secret
- **Name:** `SHOPIFY_STORE`
- **Value:** Your store domain like `your-store.myshopify.com` (no `https://`, no trailing slash)
- Click **Add secret**

### Step 3 — Add the second secret
Click **New repository secret** again:
- **Name:** `SHOPIFY_ACCESS_TOKEN`
- **Value:** Your Admin API access token (starts with `shpat_`)
- Click **Add secret**

You should now see both secrets listed (their values are hidden — that's normal).

### Where do I get the access token?
1. Shopify Admin → Settings → Apps and sales channels → Develop apps
2. Create a new app called "Product Uploader"
3. Configure Admin API scopes: enable `write_products`, `read_products`, `write_inventory`, `read_inventory`
4. Click Install app
5. Copy the Admin API access token (starts with `shpat_`) — Shopify only shows it once!

---

## Part 3: Verify the Workflow

### Step 1 — Check the Actions tab
1. Go to your repo on GitHub
2. Click the **Actions** tab at the top
3. You should see "Weekly Trending Products Update" listed in the left sidebar

If you don't see it: make sure `.github/workflows/weekly-update.yml` was pushed to the `main` branch.

### Step 2 — Run it manually for the first time
1. Click **Weekly Trending Products Update** in the left sidebar
2. Click the **Run workflow** dropdown on the right
3. Select **Branch: main** → click the green **Run workflow** button
4. Wait ~30 seconds, then refresh the page
5. You should see a new run appear (yellow circle = running, green check = success, red X = failed)

### Step 3 — View the results
Click on the run to see:
- ✅ Each step's output (refresh, commit, upload)
- ✅ Any errors with full stack traces
- ✅ A downloadable artifact with the full run log

If everything is green: ✨ **You're done!** It will now run every Monday automatically.

---

## Part 4: How to Make Updates Later

### Update the product catalog
Edit `trending-products.json` locally, then push:
```bash
git add trending-products.json
git commit -m "Update product catalog"
git push
```

### Change the schedule
Edit `.github/workflows/weekly-update.yml` and change the cron line:
```yaml
- cron: '0 8 * * 1'    # Every Monday 08:00 UTC
```

Common patterns:
| Cron | When |
|---|---|
| `'0 8 * * 1'` | Mondays 8 AM UTC (default) |
| `'0 8 * * *'` | Every day 8 AM UTC |
| `'0 8 1 * *'` | 1st of every month 8 AM UTC |
| `'0 */6 * * *'` | Every 6 hours |

Use https://crontab.guru to build custom schedules.

### Disable the automation temporarily
Comment out the `schedule:` block in the workflow file. The manual "Run workflow" button still works.

---

## Troubleshooting

**❌ Workflow run shows "Permission denied" when pushing back to repo**
Go to Settings → Actions → General → Workflow permissions → enable **Read and write permissions**.

**❌ "Secret SHOPIFY_STORE not found"**
Make sure you added the secrets at the **repository** level (Settings → Secrets → Actions), not at the organization or environment level.

**❌ "GraphQL errors: ... access denied"**
Your Shopify access token doesn't have the right scopes. Recreate the custom app with `write_products`, `read_products`, `write_inventory`, `read_inventory`.

**❌ Products fail to upload because SKUs already exist**
This happens on re-runs because the SKUs are the same. Either delete the old products first, or modify `flow.js` to use `productUpdate` instead of `productSet` for existing products.

**❌ "Refusing to merge unrelated histories"**
You initialized the GitHub repo with a README. To fix:
```bash
git pull origin main --allow-unrelated-histories
git push
```

---

## Security Reminders

- ✅ Your `.env` file is in `.gitignore` — never commit it
- ✅ GitHub Secrets are encrypted at rest and only exposed to workflow runs
- ✅ Use a **private** repo if you have any sensitive product data
- ✅ Rotate your Shopify access token if you ever suspect exposure
- ✅ The workflow only runs on `main` branch — no untrusted PRs can trigger it
