# Getting Started - Cashback Rate Scraper

## 🎉 Setup Complete!

Your scraping system is ready to use. Here's how to run it.

---

## Quick Commands

```bash
# 1. Test on 5 sample providers (30 seconds)
npm run scrape:test

# 2. Scrape ALL providers - Track 1 (2-3 minutes)
npm run scrape:providers

# 3. Scrape comparison sites - Track 2 (15 seconds)
npm run scrape:comparison-sites

# 4. Scrape EVERYTHING (both tracks)
npm run scrape:all
```

---

## What Gets Scraped

### Track 1: Provider-Specific Deals
**78 providers** from your Input CSV files:
- 23 Energy providers (Vattenfall, Engie, Budget Energie, etc.)
- 13 Car insurance providers (Centraal Beheer, OHRA, FBTO, etc.)
- 42 Health insurance providers (Ohra, CZ, Menzis, etc.)

**Example output:**
```csv
provider,deal_description,cashback_amount,category
Engie,"Gas + elektriciteit 1 jaar vast",€40.00,energy
Engie,"Gas: 3 jaar vast",€25.00,energy
OHRA,"Autoverzekering - All risk",€75.00,car
```

### Track 2: Comparison Site Deals
**8 comparison sites** (generic rates):
- Independer Energie, Zorgverzekering, Auto
- Overstappen.nl
- Zorgkiezer
- GasLicht.com

**Example output:**
```csv
comparison_site,deal_description,cashback_amount,applies_to
Independer Energie,"Op het afsluiten van een energiecontract",€18.00,ALL_PROVIDERS
Zorgkiezer,"Zorgverzekering vergelijken",€45.00,ALL_PROVIDERS
```

---

## Output Location

All data saved to dated folders:

```
output/
└── history/
    └── 2025-11-11/
        ├── cashbackxl-providers-raw.csv          # Track 1 results
        ├── cashbackxl-comparison-sites-raw.csv   # Track 2 results
        ├── scrape-log-providers.json             # Success/failure log
        └── scrape-log-comparison-sites.json      # Success/failure log
```

---

## Example: Running Full Scrape

```bash
$ npm run scrape:all

🎯 FULL CASHBACK RATE SCRAPER
This will scrape:
  Track 1: All provider-specific deals (~78 providers)
  Track 2: All comparison site deals (~8 sites)

Estimated total time: 2-3 minutes

[... scraping progress ...]

🎉 ALL SCRAPING COMPLETE
⏱️  Total duration: 142 seconds

📊 Results:
   Track 1 (Providers): ✅ Success
   Track 2 (Comparison Sites): ✅ Success

💾 Output files saved to:
   output/history/2025-11-11/cashbackxl-providers-raw.csv
   output/history/2025-11-11/cashbackxl-comparison-sites-raw.csv

✅ All done!
```

---

## What You'll See

### Successful Scrape
```
✅ Successful: 75
❌ Failed: 0
❌ Not Found: 3

📦 Total deals found: 234
```

**Not Found** providers exist in your CSV but aren't on CashbackXL (normal).

### Sample Deals Found

**Energy:**
- Engie: €50 (3Y dual), €40 (1Y dual), €25 (3Y gas), €20 (1Y gas)
- Vattenfall: €45 (generic), €18 (renewal)

**Car:**
- OHRA: €75 (All Risk), €70 (WA+), €17.50 (WA)
- Centraal Beheer: €80 (variable)

**Health:**
- Ohra: €50
- Comparison sites: €45 (Zorgkiezer), €18 (Independer)

---

## Reviewing Results

### 1. Open CSV Files

```bash
# On Mac
open output/history/2025-11-11/cashbackxl-providers-raw.csv
open output/history/2025-11-11/cashbackxl-comparison-sites-raw.csv
```

### 2. Check Scrape Logs

```bash
# View JSON logs
cat output/history/2025-11-11/scrape-log-providers.json
```

**Example log:**
```json
{
  "scrape_date": "2025-11-11T08:00:00Z",
  "total_urls": 78,
  "successful": 75,
  "failed": 0,
  "not_found": 3,
  "duration_seconds": 120,
  "results": {
    "https://www.cashbackxl.nl/webshops/engie": {
      "status": "success",
      "deals_found": 4
    }
  }
}
```

---

## Next Steps

### Phase 1: ✅ Data Collection (COMPLETE!)
Raw competitor data collection is fully implemented and working.

### Phase 2: ✅ Comparison & Mapping (COMPLETE!)
1. ✅ **Mapping rules** (`scripts/config/contract-type-mappings.json`)
   - Maps deal descriptions to standardized contract types
   - Handles variations in naming conventions
   - Provider-specific and default rules

2. ✅ **Comparison script** (`scripts/compare-rates.js`)
   - Loads scraped data + Woolsocks rates
   - Applies mapping rules
   - Generates recommendations with margin analysis

3. ✅ **Reports generated** (`reports/YYYY-MM-DD/`)
   - `comparison-report.md` - Full detailed comparison
   - `woolsocks-vs-cashbackxl-report.md` - Focused CashbackXL comparison
   - `comparison-results.csv` - Machine-readable results

---

## Weekly Workflow

**Every Monday:**

```bash
# 1. Scrape fresh data (~2-3 minutes)
npm run scrape:all

# 2. Review scrape logs
cat output/history/$(date +%Y-%m-%d)/scrape-log-*.json

# 3. Run comparison and generate reports (~1 minute)
npm run compare                    # Default: compares against all sources
npm run compare:cashbackxl         # Alternative: CashbackXL priority mode

# 4. Review recommendations
open reports/$(date +%Y-%m-%d)/comparison-report.md
open reports/$(date +%Y-%m-%d)/comparison-report-cashbackxl-priority.md  # If using priority mode
open reports/$(date +%Y-%m-%d)/woolsocks-vs-cashbackxl-report.md

# 5. Review CSV results for detailed analysis
open reports/$(date +%Y-%m-%d)/comparison-results.csv

# 6. Approve and implement rate changes (manual)
# Review recommendations and update rates in Overstappen dashboard
```

---

## Troubleshooting

### "ECONNREFUSED" or timeout errors
- CashbackXL may be temporarily down
- Try again in a few minutes
- Check internet connection

### Too many/too few deals found
- Check `scrape-log-*.json` for specific URL issues
- Some providers may have no deals on CashbackXL (normal)

### CSV looks messy
- Open in Excel/Google Sheets for better formatting
- Or use: `column -t -s, < file.csv` in terminal

---

## Need Help?

- **Full documentation**: See [PLAN.md](./PLAN.md)
- **Project overview**: See [README.md](./README.md)
- **Current rates analysis**: See [Analysis/current_woolsocks_rates_summary.md](./Analysis/current_woolsocks_rates_summary.md)

---

## Current Status

**Last Updated:** 2025-11-11

**Scraping Results:**
- ✅ Provider scraping: 20/78 successful (58 providers not found on CashbackXL)
- ✅ Comparison sites: 8/10 successful
- ✅ Total deals scraped: 234 deals

**Comparison Results:**
- ✅ 264 offers analyzed across all categories
- ✅ Reports generated with recommendations
- ✅ Mapping rules applied to standardize contract types

**Ready to use?** 
- Run: `npm run scrape:all` to get fresh data
- Run: `npm run compare` to generate comparison reports (default mode)
- Run: `npm run compare:cashbackxl` for CashbackXL priority analysis

## Comparison Analysis Modes

### Default Mode (`npm run compare`)
Compares against the **best rate from ALL sources** (CashbackXL + Woolsocks.eu), taking the maximum across all competitors.

**Use when:** You want to understand overall market competitiveness including all available rates.

**Output files:**
- `comparison-report.md`
- `comparison-results.csv`

### CashbackXL Priority Mode (`npm run compare:cashbackxl`)
**Prioritizes CashbackXL deals** first. Only uses Woolsocks.eu rates as a fallback when no CashbackXL alternative exists.

**Use when:** You want to focus specifically on CashbackXL as the primary competitor, excluding Woolsocks.eu rates unless necessary.

**Output files:**
- `comparison-report-cashbackxl-priority.md`
- `comparison-results-cashbackxl-priority.csv`

**Key difference:** In priority mode, if CashbackXL has a rate for an offer, it will use that rate even if Woolsocks.eu has a higher rate. This helps focus analysis on CashbackXL specifically.
