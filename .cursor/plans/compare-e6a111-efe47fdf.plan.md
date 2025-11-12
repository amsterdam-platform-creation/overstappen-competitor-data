<!-- efe47fdf-df54-4882-b102-66d22ddeffc5 cf971a7e-6a56-4861-bd36-574742c8c0da -->
# Build Baseline vs Affiliate-Market Comparison

## Overview

Compare Overstappen baseline (Input CSVs) against the best competitor cashbacks from a unified mapped file containing all affiliate sources (Woolsocks API + CashbackXL provider-specific + CashbackXL generic comparison sites). Recommend new in-app rates capped at Overstappen commission and emit a clear report.

## Data Sources

- Baseline (optimize these):
- `Input/woolsocks-big-data.Overstappen.energy_offers.csv`
- `Input/woolsocks-big-data.Overstappen.car_insurance_offers.csv`
- `Input/woolsocks-big-data.Overstappen.health_insurance_offers.csv`
- Fields include `provider`, contract attributes, `cashback_amount` (current), and `commission_amount` (cap)
- Competitors (affiliate market - unified mapped file):
- Single source: `output/latest/competitors-mapped.csv` (or most recent dated folder)
- Contains all competitor deals already mapped:
- CashbackXL provider-specific deals (source="cashbackxl", specific provider)
- Woolsocks API deals (source="woolsocks", specific provider)
- CashbackXL generic comparison sites (source="cashbackxl", provider="GENERIC" or applies_to="ALL_PROVIDERS")
 

## Logic Flow

For each baseline offer in the Input CSVs:
1) Normalize baseline record (category, provider, attributes, current, commission)
2) Find best competitor cashback = max of:

- Best provider-specific match (any source in unified file)
- Best generic comparison-site deal for the category (applies to all providers)
3) Compute recommendation under commission cap
4) Collect per-category results and aggregate metrics

## Matching Details

- Common filters: filter competitor rows where `mapping_status="mapped"`; parse euro strings to numeric cents.
- Energy matching:
- Provider-specific: exact provider match from unified mapped file (source="cashbackxl" or "woolsocks")
- Attribute tolerance: duration exact or ANY/GENERIC; meter_type exact or EITHER/GENERIC; contract_type mapping via `scripts/config/contract-type-mappings.json`
- Generic comparison sites: highest `cashback_amount` where `category=energy` AND (provider="GENERIC" OR applies_to="ALL_PROVIDERS") - applies to ALL providers
- Car insurance matching:
- Provider-specific: exact provider match; coverage type exact or GENERIC_CAR
- Generic comparison sites: highest where `category=car` AND (provider="GENERIC" OR applies_to="ALL_PROVIDERS")
- Health insurance matching:
- Provider-specific: exact provider match; insurance_type `HEALTH_INSURANCE` or generic
- Generic comparison sites: highest where `category=health` AND (provider="GENERIC" OR applies_to="ALL_PROVIDERS")
- Best competitor = MAX(provider-specific rate, generic comparison rate) across all sources in unified file

## Recommendation Logic

- Inputs: current (baseline), bestCompetitor (max affiliate), commission (cap)
- If no competitor match: Status = No Competitor Data; keep current
- Else if bestCompetitor <= current: Status = Already Competitive; keep current
- Else if bestCompetitor <= commission: Recommend increase to bestCompetitor; margin = commission - bestCompetitor
- Else (bestCompetitor > commission): Recommend increase to commission; margin = 0; flag warning "0% margin - competitor exceeds commission"

## Outputs

- Report: `output/history/<date>/comparison-report.md`
- Executive summary (counts, recommended increases, potential margin impact, coverage %)
- Per category sections: Recommended Increases, Max Commission, Already Competitive, No Competitor Data
- Data appendix: top generic rates used per category; data snapshots used (folder paths)
- CSV export (optional): `output/history/<date>/comparison-results.csv`

## Implementation Steps

1) Create `scripts/compare-rates.js`

- CLI: accepts `--date YYYY-MM-DD` or `--latest` (default: latest), `--category energy|car|health|all` (default: all)
- Auto-resolve snapshot folder: prefer `output/latest/`; else most recent dated folder in `output/history/`
2) Loaders
- `loadBaselineOffers()` read three Input CSVs; normalize fields and numeric amounts
- `loadCompetitors()` read single unified mapped file (`competitors-mapped.csv`); filter by `mapping_status="mapped"`; handle generic comparison sites (provider="GENERIC" with `applies_to="ALL_PROVIDERS"`) as applying to all providers in category
3) Matching
- `findBestCompetitorForOffer(offer, competitors)` dispatch per category-specific matcher; return best amount and provenance
4) Recommendation engine
- `calculateRecommendation(current, best, commission)` returning action, newRate, margin, reason, source(s)
5) Reporting
- `generateReport(results, snapshotInfo)` to markdown with sections above
- (Optional) CSV writer for detailed rows
6) NPM script
- Add to `package.json`: `"compare": "node scripts/compare-rates.js --latest"`

## Edge Cases

- Multiple matches across sources → choose max, record tie-break with all sources contributing
- Mixed currencies/formatting → robust euro parsing; treat missing as null
- GENERIC/ANY/EITHER handling as described per category
- Missing unified mapped file in `output/latest` → fallback to newest dated folder
- Provider aliases → use `contract-type-mappings.json` and a small alias map if needed
- Generic comparison sites → ✅ Already included in unified mapped file (mapping step complete)

## Success Criteria

- All baseline offers processed with coverage and recommendations
- Competitor pool includes all sources from unified mapped file (Woolsocks API + CashbackXL provider-specific + CashbackXL generic comparison sites)
- Recommendations respect commission cap and are clearly justified
- Runnable via `npm run compare`
- Note: If comparison sites not yet in unified mapped file, mapping step enhancement is prerequisite (separate task)

### To-dos

- [ ] Create scripts/compare-rates.js with CLI and snapshot resolution
- [ ] Implement loaders for baseline and unified competitor file (parse and normalize)
- [ ] Implement per-category matching including generic comparison-site rates from unified file
- [ ] Implement recommendation calculation with commission cap and provenance
- [ ] Generate markdown report and optional CSV output in history folder
- [ ] Add npm script compare to package.json