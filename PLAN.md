# Weekly Cashback Rate Scraping & Comparison System

**Project:** Overstappen Competitor Data Analysis
**Last Updated:** 2025-11-11
**Owner:** Jochem (CPO, Woolsocks)
**Status:** ✅ Phase 1 & Phase 2 Complete - System Operational

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Business Objective](#business-objective)
3. [Data Sources](#data-sources)
4. [Core Challenge: Non-Standardized Contract Types](#core-challenge)
5. [Solution Architecture](#solution-architecture)
6. [Two-Track Scraping Strategy](#two-track-scraping-strategy)
7. [Phase 1: Raw Data Collection](#phase-1-raw-data-collection)
8. [Phase 2: Mapping & Comparison](#phase-2-mapping--comparison)
9. [Project Structure](#project-structure)
10. [Implementation Details](#implementation-details)
11. [Mapping Rules System](#mapping-rules-system)
12. [Comparison Logic](#comparison-logic)
13. [Weekly Workflow](#weekly-workflow)
14. [Initial Setup Timeline](#initial-setup-timeline)
15. [Maintenance & Iteration](#maintenance--iteration)

---

## Executive Summary

This document outlines a repeatable weekly process to:

1. ✅ **Scrape competitor cashback rates** from CashbackXL (primary competitor) - **IMPLEMENTED**
2. ✅ **Compare against Woolsocks current rates** (via Overstappen partnership) - **IMPLEMENTED**
3. ✅ **Generate recommendations** to match best market rates while protecting margins - **IMPLEMENTED**
4. ✅ **Ensure compliance** with commission constraints (cashback ≤ commission received) - **IMPLEMENTED**

**Key Principle:** Our cashback for end users should **match the best available rate in the market** (regardless if it's a direct provider deal or generic comparison site deal), but it can **never exceed the commission** we receive from Overstappen.

**Current Status:** System is fully operational. Last run on 2025-11-11 analyzed 264 offers and generated comparison reports with actionable recommendations.

---

## Business Objective

### Goal
Maintain competitive cashback rates across three product categories:
- **Health Insurance** (42 providers)
- **Car Insurance** (13 providers)
- **Energy** (23 providers)

### Strategy
- **Match best market rate** within commission constraints
- **Protect margins** by never exceeding commission received
- **Weekly cadence** to stay competitive
- **Manual approval** required for all rate changes

### Current State
**Woolsocks Rates (via Overstappen Partnership):**

| Category | Current Strategy | Margin Profile |
|----------|-----------------|----------------|
| **Energy** | Conservative: €22.50 flat rate for most contracts | High margin (40-85%) |
| **Car Insurance** | Differentiated: €35-€75 by provider/coverage | Variable margin |
| **Health Insurance** | Volume play: €20 standard rate for major insurers | Mixed (some 0% margin like Interpolis) |

**Challenge:** Unknown how competitive these rates are vs. market (CashbackXL, Woolsocks.eu public rates, etc.)

---

## Data Sources

### Internal Data (Current Woolsocks Rates)

**Location:** `Input/` folder

**Files:**
1. `woolsocks-big-data.Overstappen.energy_offers.csv` (238 rows)
   - Columns: `provider`, `provider_id`, `term`, `meter_type`, `commission_amount`, `amount`
   - **23 unique providers**

2. `woolsocks-big-data.Overstappen.car_insurance_offers.csv` (38 rows)
   - Columns: `provider`, `coverage_type`, `commission_amount`, `amount`
   - **13 unique providers**

3. `woolsocks-big-data.Overstappen.health_insurance_offers.csv` (43 rows)
   - Columns: `provider`, `commission_amount`, `amount`
   - **42 unique providers**

**Key Fields:**
- `commission_amount`: Revenue Woolsocks receives from Overstappen/providers
- `amount`: Cashback paid to end users
- **Margin** = `commission_amount` - `amount`

### External Data (Competitor Rates)

**Primary Source:** CashbackXL (https://www.cashbackxl.nl)
- Largest cashback competitor in Netherlands
- Offers both provider-specific deals AND generic comparison site deals

**Secondary Source:** Woolsocks.eu public rates
- Our own public-facing cashback rates (for verification/consistency check)

---

## Core Challenge: Non-Standardized Contract Types

### The Problem

Each provider uses **different naming conventions** for contract types on CashbackXL:

#### Energy Examples:
- **Vattenfall:** "Stroom én gas particulier (nieuwe klant)" = DUAL, any duration
- **Vattenfall:** "Stroom én gas Zakelijk (nieuwe klant)" = Business deal (should IGNORE)
- **Engie:** "Gas + elektriciteit 1 jaar vast" = 1Y DUAL
- **Engie:** "Elektriciteit: 1 jaar vast" = 1Y SINGLE (electricity only)
- **Engie:** "Gas: 1 jaar vast" = 1Y SINGLE (gas only)

#### Car Insurance Examples:
- **Centraal Beheer:** "WA Autoverzekering" = WA (liability)
- **OHRA:** "Beperkt Casco" = WA+ (limited comprehensive)
- **ING:** "Volledig Casco" = ALL_RISK (full comprehensive)

#### Key Variations:
- Duration: "1 jaar", "1-jaar", "één jaar", "1 year", "12 maanden"
- Single/Dual: "elektriciteit", "stroom", "gas", "stroom én gas", "gas + elektriciteit"
- Coverage: "WA", "WA+", "WA Plus", "Beperkt Casco", "All Risk", "Volledig Casco"
- Business vs Personal: "particulier", "zakelijk", "business"

**Why it matters:** To compare rates accurately, we must match:
- CashbackXL "Gas + elektriciteit 3 jaar vast" → Woolsocks CSV row `Engie,THREE_YEARS,DUAL`

---

## Solution Architecture

### Two-Phase Approach

```
┌─────────────────────────────────────────────────────────────┐
│ PHASE 1: RAW DATA COLLECTION (Scraping)                    │
│ • Scrape CashbackXL pages                                   │
│ • Store EXACT text from website                             │
│ • NO interpretation or standardization                      │
│ • Output: Raw CSV files                                     │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│ PHASE 2: MAPPING & COMPARISON (Analysis)                   │
│ • Load raw scraped data                                     │
│ • Apply regex mapping rules (JSON config)                  │
│ • Match to Woolsocks offers                                 │
│ • Generate comparison report with recommendations          │
└─────────────────────────────────────────────────────────────┘
```

**Benefits:**
- ✅ **Separation of concerns:** Scraping = dumb data collection, Mapping = smart interpretation
- ✅ **Maintainable:** Mapping rules in JSON, easy to update without touching scraper code
- ✅ **Auditable:** Raw data preserved, can always re-run comparison with updated mappings
- ✅ **Iterative:** Start with 10 high-priority providers, expand coverage over time
- ✅ **Flexible:** Regex patterns handle variations ("1 jaar" vs "1-jaar" vs "één jaar")

---

## Two-Track Scraping Strategy

### Track 1: Provider-Specific Deals

**Objective:** Scrape CashbackXL pages for the **78 providers** in our CSV files.

**Example URLs:**
- `https://www.cashbackxl.nl/webshops/vattenfall`
- `https://www.cashbackxl.nl/webshops/engie`
- `https://www.cashbackxl.nl/webshops/centraal-beheer`
- `https://www.cashbackxl.nl/webshops/ohra`
- `https://www.cashbackxl.nl/webshops/frank-energie`

**What to scrape:**
- Provider name
- Deal description (exact text: "Gas + elektriciteit 1 jaar vast")
- Cashback amount (€40.00)
- Category (energy/car/health)

**Provider List:**
- **Energy:** 23 providers (Budget Energie, Mega, Coolblue, Vattenfall, Delta, Powerpeers, Essent, Energiedirect, Vandebron, Noord Energie, Innova, Gewoon Energie, Engie, Pure Energie, Greenchoice, Eneco, Oxxio, Clean Energy, VrijopNaam, Frank Energie, Next Energy, Tibber, United Consumers)
- **Car:** 13 providers (ABN AMRO, Allianz Direct, ASR Ik Kies Zelf, Audi-autoverzekering, Centraal Beheer, DutchInsurance-autoverzekering, FBTO, ING, Lancyr, OHRA, Seat-autoverzekering, Skoda-autoverzekering, Volkswagen-autoverzekering)
- **Health:** 42 providers (Aevitae, Aevitae (EUCARE), Anderzorg, ASR, Bewuzt, CZ, CZdirect, De Christelijke Zorgverzekeraar, De Friesland, DSW, FBTO, FBTO (Basis), FBTO (Basis Vrij), HEMA, Ikkieszelf, inTwente, Interpolis, Jaaah, Just (onderdeel CZ), Menzis, Nationale Nederlanden (Zorg Vrij), Nationale Nederlanden Zorg Voordelig, Nationale-Nederlanden, Ohra, Ohra (Online Gemak), ONVZ, ONVZ Bewuste Keuze, Salland, Salland / Eno, Stad Holland, Studenten Goed Verzekerd, United Consumers, Unive, VGZ, VGZ Bewust, VGZbewuzt, VinkVink, VvAA, Zekur, Ziezo van Zilveren Kruis, Zilveren Kruis, Zorg en Zekerheid)

**Output:** `output/latest/cashbackxl-providers-raw.csv`

---

### Track 2: Generic Comparison Site Deals

**Objective:** Scrape CashbackXL pages for **comparison/switching platforms** (our competitors).

**Key difference:** These pages show **one generic cashback rate** that applies to **ANY provider** switched through that platform.

**Example URLs:**

**Energy comparison sites:**
- `https://www.cashbackxl.nl/webshops/independer-energie` → €18 for any energy contract
- `https://www.cashbackxl.nl/webshops/overstappennl` → Generic switching deals
- `https://www.cashbackxl.nl/webshops/gaslichtcom` → Energy comparison platform

**Health insurance comparison sites:**
- `https://www.cashbackxl.nl/webshops/independer-zorgverzekering` → €20 for any health insurance
- `https://www.cashbackxl.nl/webshops/zorgkiezer` → €27.50 for any health insurance
- `https://www.cashbackxl.nl/webshops/overstappennl-verzekeringen` → Generic insurance switching

**Car insurance comparison sites:**
- `https://www.cashbackxl.nl/webshops/independer-auto` → €31.50 for any car insurance
- `https://www.cashbackxl.nl/webshops/overstappennl-verzekeringen` → Generic insurance switching

**What to scrape:**
- Comparison site name
- Cashback amount (€18.00)
- Category (energy/car/health)
- Contract types offered (if specified)

**Output:** `output/latest/cashbackxl-comparison-sites-raw.csv`

---

## Phase 1: Raw Data Collection

### Objective
Collect **all text exactly as shown** on CashbackXL pages without trying to interpret or standardize.

### Scraping Rules

**DO:**
- ✅ Extract exact text from deal descriptions
- ✅ Scrape ALL deals (including business deals, all contract types)
- ✅ Keep original formatting and wording
- ✅ Log scraping success/failures
- ✅ Store timestamp for each scrape
- ✅ Handle rate limiting (500ms delay between requests)

**DON'T:**
- ❌ Try to detect contract type (SINGLE/DUAL, WA/ALL_RISK, duration)
- ❌ Filter out any deals
- ❌ Standardize naming conventions
- ❌ Make assumptions about what deals mean

### Output Format: Track 1 (Providers)

**File:** `output/history/YYYY-MM-DD/cashbackxl-providers-raw.csv`

```csv
provider,deal_description,cashback_amount,category,source_url,scraped_at
Vattenfall,Stroom én gas particulier (nieuwe klant),€35.00,energy,https://www.cashbackxl.nl/webshops/vattenfall,2025-11-11T10:00:00Z
Vattenfall,Stroom én gas Zakelijk (nieuwe klant),€30.00,energy,https://www.cashbackxl.nl/webshops/vattenfall,2025-11-11T10:00:01Z
Engie,Gas + elektriciteit 1 jaar vast,€40.00,energy,https://www.cashbackxl.nl/webshops/engie,2025-11-11T10:00:02Z
Engie,Elektriciteit: 1 jaar vast,€25.00,energy,https://www.cashbackxl.nl/webshops/engie,2025-11-11T10:00:03Z
Engie,Gas: 1 jaar vast,€25.00,energy,https://www.cashbackxl.nl/webshops/engie,2025-11-11T10:00:04Z
Centraal Beheer,WA Autoverzekering,€35.00,car,https://www.cashbackxl.nl/webshops/centraal-beheer,2025-11-11T10:00:05Z
Centraal Beheer,All Risk Autoverzekering,€75.00,car,https://www.cashbackxl.nl/webshops/centraal-beheer,2025-11-11T10:00:06Z
Ohra,Zorgverzekering,€50.00,health,https://www.cashbackxl.nl/webshops/ohra,2025-11-11T10:00:07Z
```

### Output Format: Track 2 (Comparison Sites)

**File:** `output/history/YYYY-MM-DD/cashbackxl-comparison-sites-raw.csv`

```csv
comparison_site,deal_description,cashback_amount,category,applies_to,source_url,scraped_at
Independer Energie,Energie vergelijken en overstappen,€18.00,energy,ALL_PROVIDERS,https://www.cashbackxl.nl/webshops/independer-energie,2025-11-11T10:00:00Z
Zorgkiezer,Zorgverzekering vergelijken,€27.50,health,ALL_PROVIDERS,https://www.cashbackxl.nl/webshops/zorgkiezer,2025-11-11T10:00:01Z
Independer Auto,Autoverzekering vergelijken,€31.50,car,ALL_PROVIDERS,https://www.cashbackxl.nl/webshops/independer-auto,2025-11-11T10:00:02Z
```

### Scrape Log

**File:** `output/history/YYYY-MM-DD/scrape-log.json`

```json
{
  "scrape_date": "2025-11-11T10:00:00Z",
  "total_urls": 93,
  "successful": 87,
  "failed": 6,
  "results": {
    "https://www.cashbackxl.nl/webshops/vattenfall": {
      "status": "success",
      "deals_found": 8,
      "scraped_at": "2025-11-11T10:00:00Z"
    },
    "https://www.cashbackxl.nl/webshops/noord-energie": {
      "status": "not_found",
      "error": "404 - Provider not available on CashbackXL",
      "scraped_at": "2025-11-11T10:05:00Z"
    },
    "https://www.cashbackxl.nl/webshops/frank-energie": {
      "status": "parse_error",
      "error": "Unexpected HTML structure",
      "html_saved": "output/debug/frank-energie-2025-11-11.html",
      "scraped_at": "2025-11-11T10:06:00Z"
    }
  }
}
```

### Error Handling

**404 Errors (Provider not on CashbackXL):**
- Log as "not_found"
- Continue with other providers
- Include in weekly report as "No competitor rate available"

**Parse Errors (Unexpected HTML structure):**
- Log as "parse_error"
- Save full HTML to `output/debug/` for manual inspection
- Flag for manual review

**Rate Limiting:**
- 500ms delay between requests (default)
- Exponential backoff if rate limited (429 error)
- Max 3 retries per URL

---

## Phase 2: Mapping & Comparison

### Objective
Transform raw scraped data into standardized contract types and compare against Woolsocks current rates.

### Step 1: Load Data

**Inputs:**
1. `output/latest/cashbackxl-providers-raw.csv` (Track 1)
2. `output/latest/cashbackxl-comparison-sites-raw.csv` (Track 2)
3. `Input/woolsocks-big-data.Overstappen.*.csv` (Current Woolsocks rates)
4. `scripts/config/contract-type-mappings.json` (Mapping rules)

### Step 2: Apply Mapping Rules

For each raw scraped deal:
1. Identify provider
2. Look up provider in mapping config
3. Apply regex pattern matching to `deal_description`
4. Extract standardized fields:
   - **Energy:** `duration` (ONE_YEAR, TWO_YEARS, etc.), `meter_type` (SINGLE, DUAL)
   - **Car:** `coverage_type` (WA, WA_PLUS, ALL_RISK)
   - **Health:** `insurance_type` (HEALTH_INSURANCE)
5. If no mapping found → add to `unmapped_deals` list

### Step 3: Match to Woolsocks Offers

For each mapped competitor deal:
1. Find corresponding Woolsocks offer in CSV
2. Match by: `provider` + contract type fields (duration, meter_type, coverage_type)
3. If no match found → flag as "New deal type not in our portfolio"

### Step 4: Calculate Best Competitor Rate

The system supports two analysis modes:

#### Default Mode (All Sources)
For each Woolsocks offer:
1. **Provider-specific rate:** Find in Track 1 data (if available)
2. **Generic comparison rate:** Find in Track 2 data (if available)
3. **Woolsocks.eu rate:** Find in Woolsocks public rates (if available)
4. **Best competitor rate:** MAX(provider_specific, generic_comparison, woolsocks_public)

**Example:**
- Woolsocks offer: Engie 1Y DUAL
- Provider-specific rate (CashbackXL/Engie page): €45
- Generic comparison rate (Independer Energie): €18
- Woolsocks.eu public rate: €57
- **Best competitor rate:** €57 (maximum across all sources)

#### CashbackXL Priority Mode
For each Woolsocks offer:
1. **First, try CashbackXL only:**
   - Provider-specific rate: Find in Track 1 data (CashbackXL only)
   - Generic comparison rate: Find in Track 2 data (CashbackXL only)
   - **Best CashbackXL rate:** MAX(provider_specific, generic_comparison)
2. **If CashbackXL rate found:** Use it
3. **If no CashbackXL rate:** Fall back to Woolsocks.eu public rate

**Example (Priority Mode):**
- Woolsocks offer: Engie 1Y DUAL
- Provider-specific rate (CashbackXL/Engie page): €45
- Generic comparison rate (Independer Energie): €18
- Woolsocks.eu public rate: €57
- **Best competitor rate:** €45 (CashbackXL prioritized, Woolsocks.eu ignored when CashbackXL exists)

**Use Priority Mode when:** You want to focus specifically on CashbackXL as the primary competitor, excluding Woolsocks.eu rates unless no CashbackXL alternative exists.

### Step 5: Generate Recommendations

For each Woolsocks offer:
- **Current cashback:** Our current rate
- **Best competitor:** Highest rate in market
- **Commission:** Revenue we receive from Overstappen
- **Available margin:** Commission - Current cashback

**Decision logic:**
```
IF best_competitor > current_cashback AND best_competitor <= commission:
  RECOMMEND: Increase to best_competitor
  NEW_MARGIN: commission - best_competitor

ELIF best_competitor > commission:
  RECOMMEND: Increase to commission (max possible)
  NEW_MARGIN: 0 (break-even)
  WARNING: "Competitor exceeds our commission - cannot match fully"

ELIF best_competitor < current_cashback:
  RECOMMEND: Keep current (we're already competitive)

ELSE:
  RECOMMEND: No change (already matched)
```

---

## Project Structure

```
/Users/jochem/projects/Overstappen competitor data/
├── Input/                                    # Existing Woolsocks rates (DO NOT MODIFY)
│   ├── woolsocks-big-data.Overstappen.energy_offers.csv
│   ├── woolsocks-big-data.Overstappen.car_insurance_offers.csv
│   └── woolsocks-big-data.Overstappen.health_insurance_offers.csv
│
├── Analysis/                                 # Manual analysis documents
│   └── current_woolsocks_rates_summary.md
│
├── scripts/                                  # NEW: Automation scripts
│   ├── config/
│   │   ├── competitors.json                 # List of comparison sites to scrape
│   │   └── contract-type-mappings.json      # Provider-specific regex mapping rules
│   │
│   ├── scrapers/
│   │   ├── scrape-all.js                    # Main orchestrator
│   │   ├── scrape-providers.js              # Track 1: Provider-specific deals
│   │   ├── scrape-comparison-sites.js       # Track 2: Generic comparison deals
│   │   ├── cashbackxl-scraper.js            # Core CashbackXL scraping logic
│   │   └── utils.js                         # URL generation, CSV writing, logging
│   │
│   ├── compare-rates.js                     # Phase 2: Mapping + comparison
│   ├── extract-providers.js                 # Helper: Read providers from CSVs
│   └── validate-mappings.js                 # Helper: Test mapping rules
│
├── output/                                   # NEW: Scraped data storage
│   ├── history/                             # Historical snapshots
│   │   ├── 2025-11-11/
│   │   │   ├── cashbackxl-providers-raw.csv
│   │   │   ├── cashbackxl-comparison-sites-raw.csv
│   │   │   └── scrape-log.json
│   │   ├── 2025-11-18/
│   │   └── 2025-11-25/
│   │
│   ├── latest/                              # Symlinks to most recent
│   │   ├── cashbackxl-providers-raw.csv -> ../history/2025-11-11/...
│   │   ├── cashbackxl-comparison-sites-raw.csv -> ../history/2025-11-11/...
│   │   └── scrape-log.json -> ../history/2025-11-11/...
│   │
│   └── debug/                               # Failed scrapes for manual review
│       ├── frank-energie-2025-11-11.html
│       └── noordenergie-2025-11-11.html
│
├── reports/                                  # NEW: Generated analysis
│   ├── comparison-2025-11-11.md             # Main comparison report
│   ├── unmapped-deals-2025-11-11.csv        # Deals needing mapping rules
│   └── recommendations-2025-11-11.md        # Executive summary
│
├── package.json                              # NEW: Node.js project config
├── package-lock.json
├── node_modules/
├── README.md                                 # NEW: Usage instructions
└── PLAN.md                                   # This document
```

---

## Implementation Details

### Technology Stack

**Runtime:** Node.js (v18+)

**Dependencies:**
- `axios` - HTTP requests
- `cheerio` - HTML parsing (jQuery-like API)
- `csv-parser` - Parse CSV files
- `csv-writer` - Write CSV files
- `date-fns` - Date formatting
- `slug` - Generate URL slugs from provider names

### npm Scripts

**File:** `package.json`

```json
{
  "name": "overstappen-competitor-data",
  "version": "1.0.0",
  "scripts": {
    "scrape:all": "node scripts/scrapers/scrape-all.js",
    "scrape:providers": "node scripts/scrapers/scrape-providers.js",
    "scrape:comparison-sites": "node scripts/scrapers/scrape-comparison-sites.js",
    "compare": "node scripts/compare-rates.js",
    "list-providers": "node scripts/extract-providers.js",
    "validate-mappings": "node scripts/validate-mappings.js"
  },
  "dependencies": {
    "axios": "^1.6.0",
    "cheerio": "^1.0.0-rc.12",
    "csv-parser": "^3.0.0",
    "csv-writer": "^1.6.0",
    "date-fns": "^3.0.0",
    "slug": "^9.0.0"
  }
}
```

### Scraper Implementation (Pseudo-code)

**File:** `scripts/scrapers/cashbackxl-scraper.js`

```javascript
const axios = require('axios');
const cheerio = require('cheerio');

async function scrapeCashbackXLProvider(providerSlug, category) {
  const url = `https://www.cashbackxl.nl/webshops/${providerSlug}`;

  try {
    // Fetch HTML
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; WoolsocksBot/1.0)'
      }
    });

    const $ = cheerio.load(response.data);
    const deals = [];

    // Find all deal containers (adjust selectors based on actual HTML)
    $('.cashback-deal, .deal-item, .offer').each((i, elem) => {
      const dealDescription = $(elem).find('h3, .deal-title').text().trim();
      const cashbackAmount = $(elem).find('.amount, .cashback-amount').text().trim();

      if (dealDescription && cashbackAmount) {
        deals.push({
          provider: providerSlug,
          deal_description: dealDescription,
          cashback_amount: cashbackAmount,
          category: category,
          source_url: url,
          scraped_at: new Date().toISOString()
        });
      }
    });

    return {
      status: 'success',
      deals: deals,
      url: url
    };

  } catch (error) {
    if (error.response?.status === 404) {
      return {
        status: 'not_found',
        error: '404 - Provider not available on CashbackXL',
        url: url
      };
    }

    return {
      status: 'error',
      error: error.message,
      url: url
    };
  }
}
```

**Note:** Actual HTML selectors will be determined during implementation by inspecting CashbackXL pages.

---

## Mapping Rules System

### Config File Structure

**File:** `scripts/config/contract-type-mappings.json`

```json
{
  "energy": {
    "Vattenfall": {
      "rules": [
        {
          "pattern": "Stroom én gas particulier",
          "contract_type": "DUAL",
          "duration": "ANY",
          "notes": "Generic dual contract, applies to all durations"
        },
        {
          "pattern": "Zakelijk|Bedrijven|Business",
          "action": "IGNORE",
          "reason": "Business deals excluded (B2B only)"
        }
      ]
    },
    "Engie": {
      "rules": [
        {
          "pattern": "Gas \\+ elektriciteit (\\d+) jaar vast",
          "contract_type": "DUAL",
          "duration_regex": "(\\d+) jaar",
          "duration_mapping": {
            "1": "ONE_YEAR",
            "2": "TWO_YEARS",
            "3": "THREE_YEARS",
            "4": "FOUR_YEARS",
            "5": "FIVE_YEARS"
          }
        },
        {
          "pattern": "Elektriciteit:? (\\d+) jaar vast",
          "contract_type": "SINGLE",
          "meter_type": "ELECTRICITY",
          "duration_regex": "(\\d+) jaar",
          "duration_mapping": {
            "1": "ONE_YEAR",
            "2": "TWO_YEARS",
            "3": "THREE_YEARS",
            "4": "FOUR_YEARS",
            "5": "FIVE_YEARS"
          }
        },
        {
          "pattern": "Gas:? (\\d+) jaar vast",
          "contract_type": "SINGLE",
          "meter_type": "GAS",
          "duration_regex": "(\\d+) jaar",
          "duration_mapping": {
            "1": "ONE_YEAR",
            "2": "TWO_YEARS",
            "3": "THREE_YEARS",
            "4": "FOUR_YEARS",
            "5": "FIVE_YEARS"
          }
        }
      ]
    },
    "Budget Energie": {
      "rules": [
        {
          "pattern": "Dual|Stroom en gas|Gas en stroom",
          "contract_type": "DUAL",
          "duration_regex": "(\\d+) jaar",
          "duration_mapping": {
            "1": "ONE_YEAR",
            "2": "TWO_YEARS",
            "3": "THREE_YEARS",
            "4": "FOUR_YEARS",
            "5": "FIVE_YEARS"
          }
        }
      ]
    }
  },
  "car": {
    "Centraal Beheer": {
      "rules": [
        {
          "pattern": "WA[\\s-]?Autoverzekering|WA[\\s-]?verzekering|Wettelijke aansprakelijkheid(?! [Pp]lus)",
          "coverage_type": "WA"
        },
        {
          "pattern": "WA[\\s-]?\\+|WA[\\s-]?[Pp]lus",
          "coverage_type": "WA_PLUS"
        },
        {
          "pattern": "All[\\s-]?Risk|Volledig Casco|Allrisk",
          "coverage_type": "ALL_RISK"
        }
      ]
    },
    "OHRA": {
      "rules": [
        {
          "pattern": "WA(?!\\+|\\s[Pp]lus)",
          "coverage_type": "WA"
        },
        {
          "pattern": "WA\\+|Beperkt Casco",
          "coverage_type": "WA_PLUS"
        },
        {
          "pattern": "All Risk|Volledig Casco",
          "coverage_type": "ALL_RISK"
        }
      ]
    },
    "_default": {
      "rules": [
        {
          "pattern": "WA(?!\\+|\\s[Pp]lus)",
          "coverage_type": "WA"
        },
        {
          "pattern": "WA\\+|WA Plus|Beperkt Casco",
          "coverage_type": "WA_PLUS"
        },
        {
          "pattern": "All Risk|Allrisk|Volledig Casco",
          "coverage_type": "ALL_RISK"
        }
      ]
    }
  },
  "health": {
    "_default": {
      "rules": [
        {
          "pattern": ".*",
          "contract_type": "HEALTH_INSURANCE",
          "notes": "Health insurance typically doesn't have contract type variations"
        }
      ]
    }
  }
}
```

### Mapping Logic (Pseudo-code)

```javascript
function applyMappingRules(rawDeal, mappingConfig) {
  const { provider, deal_description, category } = rawDeal;

  // Look up provider-specific rules
  const providerRules = mappingConfig[category]?.[provider];
  const defaultRules = mappingConfig[category]?.["_default"];

  const rules = providerRules?.rules || defaultRules?.rules || [];

  for (const rule of rules) {
    const regex = new RegExp(rule.pattern, 'i'); // Case-insensitive
    const match = deal_description.match(regex);

    if (match) {
      // Check if this rule says to ignore the deal
      if (rule.action === "IGNORE") {
        return {
          status: "ignored",
          reason: rule.reason
        };
      }

      // Extract contract type fields
      const mapped = {
        status: "mapped",
        contract_type: rule.contract_type,
        coverage_type: rule.coverage_type,
        duration: null,
        meter_type: rule.meter_type
      };

      // Extract duration if regex capture group exists
      if (rule.duration_regex) {
        const durationMatch = deal_description.match(new RegExp(rule.duration_regex));
        if (durationMatch && durationMatch[1]) {
          const durationNum = durationMatch[1];
          mapped.duration = rule.duration_mapping?.[durationNum] || rule.duration;
        }
      } else {
        mapped.duration = rule.duration;
      }

      return mapped;
    }
  }

  // No mapping rule matched
  return {
    status: "unmapped",
    reason: "No matching rule found"
  };
}
```

---

## Comparison Logic

### Comparison Algorithm

For each Woolsocks offer in `Input/woolsocks-big-data.*.csv`:

```
1. IDENTIFY WOOLSOCKS OFFER
   - Provider: "Engie"
   - Duration: "THREE_YEARS"
   - Meter type: "DUAL"
   - Current cashback: €50.00
   - Commission: €112.00

2. FIND PROVIDER-SPECIFIC COMPETITOR RATE (Track 1)
   - Search: cashbackxl-providers-raw.csv
   - Match: provider="Engie" AND mapped_duration="THREE_YEARS" AND mapped_contract_type="DUAL"
   - Result: €50.00 (if found)

3. FIND GENERIC COMPARISON RATE (Track 2)
   - Search: cashbackxl-comparison-sites-raw.csv
   - Match: category="energy" (applies to ALL providers)
   - Result: €18.00 (Independer Energie)

4. DETERMINE BEST COMPETITOR RATE
   - Provider-specific: €50.00
   - Generic comparison: €18.00
   - Best competitor: MAX(€50.00, €18.00) = €50.00

5. CALCULATE RECOMMENDATION
   - Current: €50.00
   - Best competitor: €50.00
   - Commission: €112.00
   - Recommendation: ✅ KEEP (already matched)
   - Current margin: €112 - €50 = €62 (55%)
```

### Recommendation Categories

**✅ KEEP** - Already competitive
- `best_competitor <= current_cashback`
- No action needed

**⬆️ INCREASE** - Match competitor (within commission)
- `best_competitor > current_cashback AND best_competitor <= commission`
- Action: Increase cashback to match competitor
- Calculate new margin

**⚠️ INCREASE TO MAX** - Competitor exceeds commission
- `best_competitor > commission`
- Action: Increase to commission (max possible)
- Warning: Cannot fully match competitor, margin = 0%

**⬇️ DECREASE** - Overpaying vs market (optional, conservative)
- `best_competitor < current_cashback` AND `margin < threshold`
- Action: Consider decrease to improve margin
- Note: Usually we prefer to KEEP higher rate for customer satisfaction

**❌ NO COMPETITOR DATA** - No rate found
- No provider-specific or generic comparison rate available
- Action: Keep current, flag for manual research

---

## Comparison Report Format

### Main Report

**Files:** 
- `reports/comparison-YYYY-MM-DD.md` (default mode)
- `reports/comparison-cashbackxl-priority-YYYY-MM-DD.md` (priority mode)

```markdown
# Cashback Rate Comparison Report
**Date:** 2025-11-11
**Data Source:** CashbackXL (Track 1 + Track 2)
**Total Woolsocks Offers Analyzed:** 319 (238 energy + 38 car + 43 health)

---

## Executive Summary

| Category | Total Offers | Matched | Unmapped | Recommendations |
|----------|-------------|---------|----------|----------------|
| Energy   | 238         | 215     | 23       | 45 increases   |
| Car      | 38          | 38      | 0        | 8 increases    |
| Health   | 43          | 42      | 1        | 12 increases   |
| **Total**| **319**     | **295** | **24**   | **65 increases**|

**Potential Revenue Impact:**
- Current total margin: €12,450/week
- New total margin (after increases): €10,200/week
- Margin decrease: -€2,250/week (-18%)
- Expected volume increase: +25% (more competitive rates)
- Net impact: Positive (higher conversion outweighs lower margin)

---

## Energy - Detailed Comparison

### Recommended Increases (45 offers)

| Provider | Contract | Current | Best Competitor | Commission | Recommendation | New Margin |
|----------|----------|---------|----------------|------------|----------------|------------|
| Engie | 1Y DUAL | €22.50 | €45.00 (Engie direct) | €72.00 | ⬆️ Increase to €45 | €27 (38%) |
| Vattenfall | 1Y DUAL | €47.50 | €50.00 (Vattenfall direct) | €55.38 | ⬆️ Increase to €50 | €5.38 (10%) |
| Budget Energie | 2Y DUAL | €22.50 | €42.00 (Budget direct) | €54.85 | ⬆️ Increase to €42 | €12.85 (23%) |
| ... | ... | ... | ... | ... | ... | ... |

### Already Competitive (170 offers)

| Provider | Contract | Current | Best Competitor | Commission | Status |
|----------|----------|---------|----------------|------------|--------|
| Engie | 3Y DUAL | €50.00 | €50.00 (Engie direct) | €112.00 | ✅ Matched |
| Vattenfall | 5Y DUAL | €22.50 | €18.00 (Independer) | €149.10 | ✅ Better than market |
| ... | ... | ... | ... | ... | ... |

### No Competitor Data (23 offers)

| Provider | Contract | Current | Status |
|----------|----------|---------|--------|
| Noord Energie | ALL | €0.00 | ❌ Not found on CashbackXL |
| VrijopNaam | 1Y-5Y | €0.00 | ❌ Not found on CashbackXL |
| ... | ... | ... | ... |

---

## Car Insurance - Detailed Comparison

### Recommended Increases (8 offers)

| Provider | Coverage | Current | Best Competitor | Commission | Recommendation | New Margin |
|----------|----------|---------|----------------|------------|----------------|------------|
| ABN AMRO | WA | €35.00 | €40.00 (Independer Auto) | €141.65 | ⬆️ Increase to €40 | €101.65 (72%) |
| Allianz Direct | WA_PLUS | €35.00 | €40.00 (Independer Auto) | €98.80 | ⬆️ Increase to €40 | €58.80 (60%) |
| ... | ... | ... | ... | ... | ... | ... |

### Already Competitive (30 offers)

| Provider | Coverage | Current | Best Competitor | Commission | Status |
|----------|----------|---------|----------------|------------|--------|
| OHRA | ALL_RISK | €75.00 | €75.00 (OHRA direct) | €112.50 | ✅ Matched |
| Centraal Beheer | ALL_RISK | €75.00 | €75.00 (CB direct) | €105.00 | ✅ Matched |
| ... | ... | ... | ... | ... | ... |

---

## Health Insurance - Detailed Comparison

### Recommended Increases (12 offers)

| Provider | Current | Best Competitor | Commission | Recommendation | New Margin |
|----------|---------|----------------|------------|----------------|------------|
| Unive | €20.00 | €25.00 (Zorgkiezer) | €40.00 | ⬆️ Increase to €25 | €15 (38%) |
| De Friesland | €20.00 | €27.50 (Zorgkiezer) | €46.00 | ⬆️ Increase to €27.50 | €18.50 (40%) |
| ... | ... | ... | ... | ... | ... |

### Already Competitive (30 offers)

| Provider | Current | Best Competitor | Commission | Status |
|----------|---------|----------------|------------|--------|
| Ohra | €50.00 | €50.00 (Ohra direct) | €80.00 | ✅ Matched |
| CZ | €20.00 | €20.00 (Independer) | €75.00 | ✅ Matched |
| ... | ... | ... | ... | ... |

### Zero Margin Warning (1 offer)

| Provider | Current | Commission | Status |
|----------|---------|------------|--------|
| Interpolis | €12.50 | €12.50 | ⚠️ 0% margin (break-even) |

---

## Unmapped Deals Report

The following scraped deals could not be matched to Woolsocks offers due to missing mapping rules:

| Provider | Deal Description | Cashback | Category | Suggested Mapping | Action Needed |
|----------|------------------|----------|----------|-------------------|---------------|
| Frank Energie | Dynamic contract | €52.50 | energy | DYNAMIC, DUAL | Add mapping rule |
| Gewoon Energie | Stroom 2 jaar | €40.00 | energy | TWO_YEARS, SINGLE | Add mapping rule |
| ... | ... | ... | ... | ... | ... |

**Total unmapped:** 24 deals
**Action:** Review and update `scripts/config/contract-type-mappings.json`

---

## Next Steps

1. **Review recommendations** (manual approval required)
2. **Update mapping rules** for 24 unmapped deals
3. **Re-run comparison** after updating mappings
4. **Implement approved rate changes** in Overstappen dashboard
5. **Schedule next scrape** for 2025-11-18
```

---

## Weekly Workflow

### Week 1: Initial Setup (One-time, ~4 hours) ✅ COMPLETE

1. ✅ **Setup project** (30 min) - **DONE**
   ```bash
   cd "/Users/jochem/projects/Overstappen competitor data"
   npm init -y
   npm install axios cheerio csv-parser csv-writer date-fns slug
   ```

2. ✅ **Implement scrapers** (90 min) - **DONE**
   - ✅ Built `scrape-providers.js` (Track 1)
   - ✅ Built `scrape-comparison-sites.js` (Track 2)
   - ✅ Built `scrape-all.js` orchestrator
   - ✅ Tested on sample providers

3. ✅ **Build initial mapping rules** (60 min) - **DONE**
   - ✅ Inspected CashbackXL pages for providers
   - ✅ Documented patterns in `contract-type-mappings.json`
   - ✅ Coverage for major providers

4. ✅ **Implement comparison script** (60 min) - **DONE**
   - ✅ Built `compare-rates.js` with mapping logic
   - ✅ Generates comparison report
   - ✅ Generates unmapped deals report
   - ✅ Built `compare-woolsocks-vs-cashbackxl.js` for focused analysis

5. ✅ **Test end-to-end** (30 min) - **DONE**
   ```bash
   npm run scrape:all       # Scrape all providers + comparison sites
   npm run compare          # Generate comparison report
   ```

### Week 2+: Routine Weekly Execution (30-45 min) ✅ OPERATIONAL

**Every Monday morning:**

```bash
# 1. Scrape fresh data (2-3 min runtime)
npm run scrape:all

# 2. Review scrape log for errors
cat output/history/$(date +%Y-%m-%d)/scrape-log-*.json

# 3. Generate comparison reports (~1 min runtime)
npm run compare                    # Default: all sources
npm run compare:cashbackxl         # Alternative: CashbackXL priority

# 4. Review comparison reports (10 min)
open reports/$(date +%Y-%m-%d)/comparison-report.md
open reports/$(date +%Y-%m-%d)/comparison-report-cashbackxl-priority.md  # If using priority mode
open reports/$(date +%Y-%m-%d)/woolsocks-vs-cashbackxl-report.md

# 5. Review CSV results for detailed analysis
open reports/$(date +%Y-%m-%d)/comparison-results.csv
open reports/$(date +%Y-%m-%d)/comparison-results-cashbackxl-priority.csv  # If using priority mode

# 6. Update mapping rules if needed (5-10 min)
# Edit: scripts/config/contract-type-mappings.json

# 7. Re-run comparison if mappings updated
npm run compare

# 8. Approve and implement rate changes (manual, outside this system)
```

**Last Execution:** 2025-11-11
- Scraped 78 provider URLs (20 successful, 58 not found)
- Scraped 10 comparison site URLs (8 successful)
- Generated comparison reports for 264 offers
- Reports available in `reports/2025-11-11/`

**Monthly maintenance:**
- Review scraping success rate (target: >90%)
- Update mapping rules for new providers
- Archive old reports (keep last 3 months)

---

## Initial Setup Timeline

### Phase 1: Development (Week 1) ✅ COMPLETE

**Day 1-2: Scraping (3 hours)** ✅
- ✅ Initialized Node.js project
- ✅ Implemented Track 1 scraper (provider-specific)
- ✅ Implemented Track 2 scraper (comparison sites)
- ✅ Tested on sample providers
- ✅ Handled edge cases (404s, parse errors)

**Day 3: Mapping Rules (2 hours)** ✅
- ✅ Inspected CashbackXL pages
- ✅ Documented patterns for providers
- ✅ Built `contract-type-mappings.json`
- ✅ Tested mapping logic

**Day 4: Comparison Logic (2 hours)** ✅
- ✅ Implemented `compare-rates.js`
- ✅ Built recommendation engine
- ✅ Generates comparison report
- ✅ Generates unmapped deals report
- ✅ Built `compare-woolsocks-vs-cashbackxl.js` for focused analysis

**Day 5: Testing & Refinement (1 hour)** ✅
- ✅ End-to-end tested
- ✅ Fixed bugs
- ✅ Documented usage in README.md

**Total: ~8 hours over 5 days** ✅ COMPLETE

### Phase 2: Expansion (Week 2-4)

**Week 2:**
- Add mapping rules for 20 more providers
- Coverage target: 30 providers (40% of total)

**Week 3:**
- Add mapping rules for 25 more providers
- Coverage target: 55 providers (70% of total)

**Week 4:**
- Add mapping rules for remaining 23 providers
- Coverage target: 78 providers (100% of total)

---

## Maintenance & Iteration

### Ongoing Tasks

**Weekly (30-45 min):**
- Run scrapers
- Review comparison report
- Update mapping rules for new deals
- Approve rate changes

**Monthly (60 min):**
- Review scraping success rate
- Update provider list (add new providers, remove discontinued)
- Optimize mapping rules (reduce false positives)
- Archive old reports

**Quarterly (2 hours):**
- Review overall margin trends
- Analyze competitor rate changes over time
- A/B test impact of rate changes on conversion
- Adjust strategy based on learnings

### Success Metrics

**Coverage:**
- Provider scraping success rate: >90%
- Mapping coverage: >95% of offers matched
- Unmapped deals: <5% per week

**Competitiveness:**
- Offers matching best market rate: >80%
- Offers exceeding market rate: >10%
- Offers below market rate: <10%

**Margin:**
- Average margin maintained: >25%
- Zero-margin offers: <5%
- Negative margin offers: 0%

---

## Key Constraints & Rules

### Non-Negotiable Rules

1. **Commission Cap:** Cashback to end users can NEVER exceed commission received from Overstappen
   - Formula: `cashback <= commission`
   - Enforced in comparison script

2. **Manual Approval:** All rate changes require manual review and approval
   - No automatic rate updates
   - Reports are advisory only

3. **Margin Protection:** Maintain healthy margins
   - Target: >25% average margin
   - Flag: Any offer with <10% margin
   - Warning: Any offer with 0% margin

4. **Business vs Personal:** Only scrape personal (particulier) deals
   - Ignore: "Zakelijk", "Bedrijven", "Business" deals
   - Reason: Woolsocks focuses on B2C

### Strategic Preferences

1. **Match best rate:** When competitor rate > current rate AND within commission
   - Maximize competitiveness

2. **Keep higher rates:** When current rate > competitor rate
   - Prefer customer satisfaction over margin optimization
   - Don't decrease unless explicitly needed

3. **Generic vs specific:** Trust provider-specific rates over generic comparison rates
   - Provider-specific deals more targeted and relevant

---

## Appendix: Example Scenarios

### Scenario 1: Clear Increase Opportunity

**Woolsocks Offer:** Engie 1Y DUAL
- Current cashback: €22.50
- Commission: €72.00
- Current margin: €49.50 (69%)

**Competitor Rates:**
- CashbackXL/Engie page: "Gas + elektriciteit 1 jaar vast" → €45.00
- Independer Energie: "Any contract" → €18.00
- Best competitor: €45.00

**Recommendation:**
- ⬆️ **INCREASE to €45.00**
- New margin: €27.00 (38%)
- Rationale: Competitor offers 2x our current rate, we have plenty of margin to match

---

### Scenario 2: Already Competitive

**Woolsocks Offer:** OHRA All Risk Car Insurance
- Current cashback: €75.00
- Commission: €112.50
- Current margin: €37.50 (33%)

**Competitor Rates:**
- CashbackXL/OHRA page: "All Risk Autoverzekering" → €75.00
- Independer Auto: "Any car insurance" → €31.50
- Best competitor: €75.00

**Recommendation:**
- ✅ **KEEP at €75.00**
- Rationale: Already matched best competitor rate

---

### Scenario 3: Competitor Exceeds Commission

**Woolsocks Offer:** Fictional example
- Current cashback: €30.00
- Commission: €50.00
- Current margin: €20.00 (40%)

**Competitor Rates:**
- CashbackXL competitor: €65.00 (somehow)
- Best competitor: €65.00

**Recommendation:**
- ⚠️ **INCREASE to €50.00 (max possible)**
- New margin: €0.00 (0%)
- Warning: "Competitor exceeds commission by €15 - cannot match fully"
- Rationale: Match as closely as possible without going negative

---

### Scenario 4: No Competitor Data

**Woolsocks Offer:** Noord Energie (all contracts)
- Current cashback: €0.00
- Commission: €0.00

**Competitor Rates:**
- CashbackXL: 404 Not Found
- No generic comparison rate applies

**Recommendation:**
- ❌ **NO ACTION** (No competitor data available)
- Note: Provider not available on CashbackXL
- Action: Manual research needed or keep current

---

### Scenario 5: Unmapped Deal

**Scraped Data:**
- Provider: Frank Energie
- Deal description: "Dynamic contract voor particulieren"
- Cashback: €52.50

**Mapping Attempt:**
- No matching rule in `contract-type-mappings.json`
- Cannot determine: Duration (DYNAMIC), Meter type (DUAL/SINGLE?)

**Result:**
- Added to `unmapped-deals-YYYY-MM-DD.csv`
- Suggested mapping: DYNAMIC, DUAL (best guess)
- Action needed: Add mapping rule, re-run comparison

---

## Summary

This plan provides a **complete, repeatable system** for:

1. ✅ **Scraping competitor rates** (CashbackXL) - **IMPLEMENTED**
   - 78 provider-specific pages
   - ~10 comparison site pages
   - Raw data stored with exact text

2. ✅ **Mapping to standardized contract types** - **IMPLEMENTED**
   - Provider-specific regex rules
   - Handles Dutch naming variations
   - Mapping rules in `scripts/config/contract-type-mappings.json`

3. ✅ **Comparing against Woolsocks rates** - **IMPLEMENTED**
   - Match provider + contract type
   - Find best competitor rate (provider vs generic)
   - Generate actionable recommendations

4. ✅ **Protecting margins** - **IMPLEMENTED**
   - Enforce commission cap
   - Flag low-margin offers
   - Manual approval required

## Current Implementation Status

**System Status:** ✅ **FULLY OPERATIONAL**

**Last Run:** 2025-11-11

**Scraping Results:**
- Provider URLs: 78 attempted, 20 successful, 58 not found on CashbackXL
- Comparison site URLs: 10 attempted, 8 successful
- Total deals scraped: 234 deals

**Comparison Results:**
- Total offers analyzed: 264 offers
- Categories: Energy (238), Car (38), Health (43)
- Reports generated:
  - `comparison-report.md` - Full detailed analysis
  - `woolsocks-vs-cashbackxl-report.md` - Focused CashbackXL comparison
  - `comparison-results.csv` - Machine-readable results

**Key Findings:**
- 160 offers recommended for increase (134 within commission cap, 26 at 0% margin)
- 93 offers already competitive
- 50 offers with no competitor data available

**Files Generated:**
- Raw scraped data: `output/history/2025-11-11/cashbackxl-*-raw.csv`
- Mapped data: `output/history/2025-11-11/competitors-mapped.csv`
- Normalized Woolsocks data: `output/history/2025-11-11/woolsocks-normalized.csv`
- Reports: `reports/2025-11-11/*.md` and `*.csv`

**Next Steps:**
1. ✅ System implemented and operational
2. ✅ First comparison report generated
3. ⬜ Review recommendations and implement approved rate changes
4. ⬜ Continue weekly workflow
5. ⬜ Expand mapping rules for additional providers as needed

---

**System is ready for weekly use.** Run `npm run scrape:all` followed by `npm run compare` every Monday.
