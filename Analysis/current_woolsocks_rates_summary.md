# Current Woolsocks Cashback Rates (via Overstappen Partnership)

**Data Source**: Woolsocks-Overstappen commission structure
**Date**: 2025-11-10
**Analysis**: Current rates being paid to end users

---

## Understanding the Data

- **Commission Amount**: What Woolsocks receives from Overstappen/providers
- **Amount (Cashback)**: What Woolsocks pays out to end users
- **Margin**: Commission - Cashback = Woolsocks profit

**Key Rule**: Cashback to end users can NEVER exceed commission received

---

## 1. Energy Cashback Rates

### Providers & Rate Structure

| Provider | Provider ID | Contract Types | Rate Range (Cashback) | Commission Range |
|----------|-------------|----------------|----------------------|------------------|
| Budget Energie | 200 | 1Y-5Y, Dynamic, Single/Dual | €22.50 - €45.37 | €31.41 - €99.71 |
| Mega | 395 | 1Y-5Y, Single/Dual | €22.50 | €41.02 - €163.06 |
| Coolblue | 368 | 1Y-5Y, Single/Dual | €22.50 | €39.20 - €121.60 |
| Vattenfall | 22 | 1Y-5Y, Single/Dual | €22.50 - €47.50 | €42.60 - €106.50 |

### Analysis
- **Most offers**: Fixed €22.50 cashback regardless of contract type
- **Budget Energie**: Variable rates (€22.50 - €45.37) based on contract
- **Vattenfall**: Higher rates for some contracts (up to €47.50)
- **Zero offers**: Many contract types have €0.00 (4Y/5Y for some, VARIABLE/DYNAMIC for others)

### Current Woolsocks Strategy
- **Conservative**: Most contracts pay €22.50 flat
- **Margin**: Very healthy (40-85% depending on contract)
- **Gaps**: Not offering anything for many contract types (€0 cashback)

---

## 2. Car Insurance Cashback Rates

### Providers & Coverage Types

| Provider | ALL_RISK (Cashback) | WA (Cashback) | WA_PLUS (Cashback) |
|----------|---------------------|---------------|-------------------|
| Centraal Beheer | €75 | €35 | €50 |
| FBTO | €55 | €55 | €55 |
| OHRA | €75 | €35 | €70 |
| ABN AMRO | €36 | €35 | €35 |
| ING | €36 | €35 | €35 |
| Allianz Direct | €36 | €35 | €35 |
| Lancyr | €36 | €35 | €35 |
| ASR Ik Kies Zelf | €36 | €35 | €35 |
| Auto brands* | €36 | €35 | €35 |

*Auto brands: Seat, Skoda, VW, Audi (all same rates)

### Analysis
- **Highest cashback**:
  - ALL_RISK: €75 (Centraal Beheer, OHRA)
  - WA: €55 (FBTO)
  - WA_PLUS: €70 (OHRA)
- **Most common cashback**: €35-€36 across all types
- **Strategy**: Varies significantly by provider (€35-€75 range)

### Current Woolsocks Strategy
- **Differentiated**: Different rates by provider AND coverage type
- **Competitive**: Higher rates for traditional insurers (CB, OHRA)
- **Lower rates**: Banks and niche insurers (€35-€36)

---

## 3. Health Insurance Cashback Rates

### Providers & Tiers

| Tier | Cashback | Providers | Commission |
|------|----------|-----------|------------|
| **Zero** | €0 | Aevitae | €0 |
| **Low** | €2 | Aevitae (EUCARE), Bewuzt, DSW, HEMA, inTwente, Jaaah, Stad Holland, Studenten Goed Verzekerd, VGZ, VvAA, Zekur, Zorg en Zekerheid | €5 |
| **Mid-Low** | €12.50 | Interpolis | €12.50 |
| **Mid** | €16-€20 | ONVZ variants, Nationale Nederlanden, Unive, De Friesland, FBTO variants, Zilveren Kruis variants | €16-€46 |
| **High** | €20 | Anderzorg, De Christelijke, FBTO, Menzis, VinkVink, Zilveren Kruis, Salland, VGZ Bewust, CZ, CZdirect, Just, Nationale-Nederlanden, ASR, Ikkieszelf | €50-€90 |
| **Premium** | €50 | Ohra, Ohra Online Gemak | €80 |

### Analysis
- **Most common**: €20 cashback (26 providers)
- **Highest cashback**: €50 (Ohra)
- **Lowest margin**: Interpolis (€12.50/€12.50 = 0% margin!)
- **Best margin**: VGZ group (€2/€5 = 60% margin)

### Current Woolsocks Strategy
- **Volume play**: €20 standard rate for most major insurers
- **Budget options**: €2 for low-commission insurers
- **Premium**: €50 for Ohra (high commission)
- **Zero margin**: Interpolis at exact commission pass-through

---

## Summary: Current Positioning

### Energy
- ✅ **Margin**: Very healthy (50-70% average)
- ✅ **Competitiveness**: Analyzed (see comparison reports)
- ❌ **Coverage gaps**: Many contract types at €0
- 📊 **Latest Analysis**: 115 offers recommended for increase (see `reports/2025-11-11/comparison-report.md`)

### Car Insurance
- ✅ **Differentiation**: Variable rates by provider/coverage
- ✅ **Competitiveness**: Analyzed (see comparison reports)
- ✅ **Coverage**: All major providers covered
- 📊 **Latest Analysis**: 10 offers recommended for reduction (see `reports/2025-11-11/woolsocks-vs-cashbackxl-report.md`)

### Health Insurance
- ✅ **Coverage**: 43 providers
- ⚠️ **Margin risk**: Interpolis at 0%, many at thin margins
- ✅ **Competitiveness**: Analyzed (see comparison reports)
- 📊 **Latest Analysis**: 16 offers analyzed, all already competitive (see `reports/2025-11-11/woolsocks-vs-cashbackxl-report.md`)

---

## Next Steps

1. ✅ Document current Woolsocks rates
2. ✅ Scrape CashbackXL rates (health, car, energy)
3. ✅ Scrape Woolsocks.eu public rates (verify consistency)
4. ✅ Compare Woolsocks vs CashbackXL (identify gaps)
5. ✅ Generate recommendations (match best rate, respect commission cap)
6. ⬜ Review recommendations and implement approved rate changes
7. ⬜ Continue weekly comparison workflow

## Latest Comparison Results

**Date:** 2025-11-11

**Reports Generated:**
- `reports/2025-11-11/comparison-report.md` - Full detailed comparison (264 offers analyzed, default mode: all sources)
- `reports/2025-11-11/comparison-report-cashbackxl-priority.md` - CashbackXL priority analysis (if generated)
- `reports/2025-11-11/woolsocks-vs-cashbackxl-report.md` - Focused CashbackXL comparison
- `reports/2025-11-11/comparison-results.csv` - Machine-readable results

**Analysis Modes:**
- **Default mode** (`npm run compare`): Compares against best rate from ALL sources (CashbackXL + Woolsocks.eu)
- **CashbackXL Priority mode** (`npm run compare:cashbackxl`): Prioritizes CashbackXL deals, only uses Woolsocks.eu as fallback

**Key Findings:**
- **Energy**: 115 offers recommended for increase (some at 0% margin due to commission constraints)
- **Car**: 10 offers can be reduced (currently paying above market rates)
- **Health**: All 16 analyzed offers already competitive

**Action Required:**
- Review recommendations in comparison reports
- Approve and implement rate changes in Overstappen dashboard
- Continue weekly scraping and comparison workflow

---

**Constraint**: End-user cashback can NEVER exceed commission received from Overstappen
**Strategy**: Match the best market rate within commission constraints
**Approval**: All changes require manual review
