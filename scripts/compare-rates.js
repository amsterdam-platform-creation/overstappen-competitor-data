#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { format, parseISO } = require('date-fns');
const { readCSV, ensureDirectoryExists, writeCSV } = require('./scrapers/utils');
const { searchMerchantsByName } = require('./api/woolsocks-client');

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { latest: true, date: null, category: 'all', cashbackxlPriority: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--latest') {
      opts.latest = true;
      opts.date = null;
    } else if (a === '--date') {
      const d = args[i + 1];
      if (!d) throw new Error('--date requires YYYY-MM-DD');
      opts.latest = false;
      opts.date = d;
      i++;
    } else if (a === '--category') {
      const c = args[i + 1];
      if (!c) throw new Error('--category requires energy|car|health|all');
      opts.category = c;
      i++;
    } else if (a === '--cashbackxl-priority') {
      opts.cashbackxlPriority = true;
    }
  }
  return opts;
}

function resolveSnapshotRoot(opts) {
  const projectRoot = path.join(__dirname, '..');
  const latestDir = path.join(projectRoot, 'output', 'latest');
  const historyDir = path.join(projectRoot, 'output', 'history');

  // Prefer output/latest when it contains the mapped competitors file
  const latestFile = path.join(latestDir, 'competitors-mapped.csv');
  if (fs.existsSync(latestFile)) {
    return { root: latestDir, dateFolder: 'latest' };
  }

  // Fallback: newest dated folder in output/history
  if (!fs.existsSync(historyDir)) {
    throw new Error('No output/latest or output/history found.');
  }
  const entries = fs.readdirSync(historyDir).filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name));
  if (entries.length === 0) throw new Error('No dated folders in output/history.');

  entries.sort((a, b) => (a < b ? 1 : -1));

  let chosen = entries[0];
  if (!opts.latest && opts.date) {
    if (!fs.existsSync(path.join(historyDir, opts.date))) {
      throw new Error(`Requested date folder not found: ${opts.date}`);
    }
    chosen = opts.date;
  }
  const root = path.join(historyDir, chosen);
  const file = path.join(root, 'competitors-mapped.csv');
  if (!fs.existsSync(file)) {
    throw new Error(`competitors-mapped.csv not found in ${root}`);
  }
  return { root, dateFolder: chosen };
}

function euroToNumber(euroStr) {
  if (euroStr == null || euroStr === '') return null;
  // Remove euro symbol and spaces
  let cleaned = String(euroStr).replace(/[€\s]/g, '');
  
  // Check if comma exists (European format: 1.250,00)
  if (cleaned.includes(',')) {
    // European format: remove dots (thousands), replace comma with dot (decimal)
    cleaned = cleaned.replace(/\./g, '').replace(',', '.');
  }
  // Otherwise assume US format: dot is decimal separator (e.g., 25.00)
  // No need to modify dots in this case
  
  const match = cleaned.match(/^-?\d+(\.\d+)?$/);
  if (!match) return Number.NaN;
  return parseFloat(cleaned);
}

function toCents(num) {
  if (num == null || Number.isNaN(num)) return null;
  return Math.round(Number(num) * 100);
}

function fromCents(cents) {
  if (cents == null) return null;
  return (cents / 100);
}

async function loadBaselineOffers(projectRoot, categoryFilter) {
  const inputs = {
    energy: path.join(projectRoot, 'Input', 'woolsocks-big-data.Overstappen.energy_offers.csv'),
    car: path.join(projectRoot, 'Input', 'woolsocks-big-data.Overstappen.car_insurance_offers.csv'),
    health: path.join(projectRoot, 'Input', 'woolsocks-big-data.Overstappen.health_insurance_offers.csv'),
  };
  const results = [];

  if (categoryFilter === 'all' || categoryFilter === 'energy') {
    const rows = await readCSV(inputs.energy);
    for (const r of rows) {
      const provider = r.provider?.trim();
      const term = r.term?.trim(); // ONE_YEAR, TWO_YEARS, THREE_YEARS, VARIABLE, etc.
      const meterType = r.meter_type?.trim(); // SINGLE, DUAL
      const commission = Number(r.commission_amount || 0);
      const current = Number(r.amount || 0);
      // Skip offers with no commission (no offer to compare)
      if (commission === 0) continue;
      results.push({
        category: 'energy',
        provider,
        attributes: { term, meterType },
        currentCents: toCents(current),
        commissionCents: toCents(commission),
        raw: r,
      });
    }
  }

  if (categoryFilter === 'all' || categoryFilter === 'car') {
    const rows = await readCSV(inputs.car);
    for (const r of rows) {
      const provider = r.provider?.trim();
      const coverageType = r.coverage_type?.trim(); // ALL_RISK | WA_PLUS | WA
      const commission = Number(r.commission_amount || 0);
      const current = Number(r.amount || 0);
      // Skip offers with no commission (no offer to compare)
      if (commission === 0) continue;
      results.push({
        category: 'car',
        provider,
        attributes: { coverageType },
        currentCents: toCents(current),
        commissionCents: toCents(commission),
        raw: r,
      });
    }
  }

  if (categoryFilter === 'all' || categoryFilter === 'health') {
    const rows = await readCSV(inputs.health);
    for (const r of rows) {
      const provider = r.provider?.trim();
      const commission = Number(r.commission_amount || 0);
      const current = Number(r.amount || 0);
      // Skip offers with no commission (no offer to compare)
      if (commission === 0) continue;
      results.push({
        category: 'health',
        provider,
        attributes: {},
        currentCents: toCents(current),
        commissionCents: toCents(commission),
        raw: r,
      });
    }
  }
  return results;
}

// Cache for merchant IDs to avoid repeated API calls
const merchantIdCache = new Map();

function cleanDomain(input) {
  if (!input) return '';
  try {
    let h = String(input).trim();
    if (!/^https?:\/\//i.test(h)) h = `https://${h}`;
    const u = new URL(h);
    return (u.hostname || '').replace(/^www\./i, '').toLowerCase();
  } catch {
    return String(input).replace(/^www\./i, '').toLowerCase();
  }
}

function tokenizeName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(Boolean);
}

function pickBestMerchant(providerName, targetDomain, merchants) {
  if (!Array.isArray(merchants) || merchants.length === 0) return null;
  
  const nameTokens = tokenizeName(providerName);
  const targetDomainClean = targetDomain ? cleanDomain(targetDomain) : '';
  
  const scored = merchants.map((m) => {
    const name = String(m?.name || '').toLowerCase();
    const merchantDomain = cleanDomain(m?.websiteUrl || '');
    let score = 0;
    
    // Exact name match gets high score
    if (name === providerName.toLowerCase()) score += 100;
    
    // Token matching
    for (const tok of nameTokens) {
      if (tok.length >= 3) {
        if (name.includes(tok)) score += 50;
        if (merchantDomain.includes(tok)) score += 80;
      }
    }
    
    // Domain matching (if we have a target domain)
    if (targetDomainClean && merchantDomain) {
      if (merchantDomain === targetDomainClean) score += 200;
      else if (merchantDomain.includes(targetDomainClean) || targetDomainClean.includes(merchantDomain)) score += 100;
    }
    
    // Prefer merchants with cashback
    const val = Number(m?.cashbackAmount?.amount?.value || 0);
    if (val > 0) score += 5;
    
    return { merchant: m, score, nameLen: name.length };
  });
  
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.nameLen - b.nameLen;
  });
  
  const best = scored.find(s => s.score > 0);
  return best ? best.merchant : (scored[0] ? scored[0].merchant : null);
}

async function findWoolsocksMerchantId(providerName, targetDomain = null) {
  const cacheKey = `${providerName}|${targetDomain || ''}`;
  if (merchantIdCache.has(cacheKey)) {
    return merchantIdCache.get(cacheKey);
  }
  
  try {
    const merchants = await searchMerchantsByName(providerName, 'NL');
    if (!merchants || merchants.length === 0) {
      merchantIdCache.set(cacheKey, null);
      return null;
    }
    
    const best = pickBestMerchant(providerName, targetDomain, merchants);
    const merchantId = best?.id || null;
    merchantIdCache.set(cacheKey, merchantId);
    return merchantId;
  } catch (err) {
    console.error(`Error finding merchant for ${providerName}:`, err.message);
    merchantIdCache.set(cacheKey, null);
    return null;
  }
}

async function loadCompetitors(snapshotRoot) {
  const file = path.join(snapshotRoot, 'competitors-mapped.csv');
  const rows = await readCSV(file);
  const normalized = rows
    .filter((r) => (r.mapping_status || '').trim().toLowerCase() === 'mapped')
    .map((r) => ({
      source: (r.source || '').trim(),
      provider: (r.provider || '').trim(),
      category: (r.category || '').trim(),
      cashbackCents: toCents(euroToNumber(r.cashback_amount)),
      contractType: (r.contract_type || '').trim(),
      duration: (r.duration || '').trim(),
      meterType: (r.meter_type || '').trim(),
      coverageType: (r.coverage_type || '').trim(),
      insuranceType: (r.insurance_type || '').trim(),
      appliesTo: (r.applies_to || '').trim(),
      comparisonSite: (r.comparison_site || '').trim(),
      sourceUrl: (r.source_url || '').trim(),
      scrapedAt: r.scraped_at,
      raw: r,
    }));
  
  // Construct Woolsocks source URL when missing or is a website URL (not a Woolsocks URL)
  const woolsocksEntries = normalized.filter(n => {
    if (n.source !== 'woolsocks' || !n.provider) return false;
    // Replace if empty, or if it's a website URL (not a Woolsocks cashback URL)
    if (!n.sourceUrl || n.sourceUrl.length === 0) return true;
    // Check if it's already a Woolsocks URL
    if (n.sourceUrl.includes('woolsocks.eu/cashback/')) return false;
    // Otherwise it's likely a website URL, replace it
    return true;
  });
  
  for (const n of woolsocksEntries) {
    const merchantId = await findWoolsocksMerchantId(n.provider);
    if (merchantId) {
      n.sourceUrl = `https://woolsocks.eu/nl-NL/cashback/${merchantId}`;
    }
    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  return normalized;
}

function bestCompetitorForEnergy(offer, competitors) {
  const provider = offer.provider;
  const { term, meterType } = offer.attributes;
  let best = null;
  const consider = [];

  // Providers that only offer DYNAMIC contracts
  const dynamicOnlyProviders = ['Next Energy', 'Frank Energy', 'Tibber'];
  const isDynamicOnlyProvider = dynamicOnlyProviders.includes(provider);

  for (const c of competitors) {
    if (c.category !== 'energy') continue;
    const isGeneric = c.provider === 'GENERIC' || c.appliesTo === 'ALL_PROVIDERS';
    const providerMatch = isGeneric || c.provider === provider;
    if (!providerMatch) continue;

    // Contract type matching: baseline meter_type (SINGLE/DUAL) vs competitor contract_type
    const isGenericContract = c.contractType === 'GENERIC' || !c.contractType || c.contractType === '';
    const contractTypeMatch = isGenericContract || 
      (meterType === 'SINGLE' && c.contractType === 'SINGLE') ||
      (meterType === 'DUAL' && c.contractType === 'DUAL');
    if (!contractTypeMatch) continue;

    // Duration matching: 
    // - For DYNAMIC-only providers, ANY/empty duration only matches DYNAMIC baseline offers
    // - For other providers, ANY/empty duration matches all durations
    // - Otherwise, strict matching applies
    const hasEmptyDuration = !c.duration || c.duration === '';
    const isAnyDuration = c.duration === 'ANY';
    const durationMatch = 
      (isAnyDuration && isDynamicOnlyProvider && term === 'DYNAMIC') || // ANY for DYNAMIC providers: only match DYNAMIC
      (isAnyDuration && !isDynamicOnlyProvider) || // ANY for other providers: matches all durations
      (hasEmptyDuration && isDynamicOnlyProvider && term === 'DYNAMIC') || // Empty duration for DYNAMIC providers: only match DYNAMIC
      (hasEmptyDuration && !isDynamicOnlyProvider) || // Empty duration for other providers: matches all durations
      c.duration === term || // Exact match
      (c.duration === 'ONE_OR_TWO_YEARS' && (term === 'ONE_YEAR' || term === 'TWO_YEARS')); // Special case
    if (!durationMatch) continue;

    // Meter type mapping: baseline DUAL ↔ competitor BOTH, SINGLE ↔ EITHER/ELECTRICITY/GAS
    const meterTypeMatch = 
      !c.meterType || c.meterType === '' || // No meter type specified (generic)
      (meterType === 'DUAL' && (c.meterType === 'BOTH' || c.meterType === '')) ||
      (meterType === 'SINGLE' && (c.meterType === 'EITHER' || c.meterType === 'ELECTRICITY' || c.meterType === 'GAS' || c.meterType === ''));
    if (!meterTypeMatch) continue;

    if (c.cashbackCents == null) continue;
    consider.push(c);
    if (!best || c.cashbackCents > best.cashbackCents) {
      best = c;
    }
  }
  return { best, considered: consider };
}

function bestCompetitorForCar(offer, competitors) {
  const provider = offer.provider;
  const { coverageType } = offer.attributes;
  let best = null;
  const consider = [];

  for (const c of competitors) {
    if (c.category !== 'car') continue;
    const isGeneric = c.provider === 'GENERIC' || c.appliesTo === 'ALL_PROVIDERS';
    const providerMatch = isGeneric || c.provider === provider;
    if (!providerMatch) continue;

    // Strict coverage type matching: exact match or GENERIC_CAR (matches all)
    const coverageMatch = 
      c.coverageType === coverageType || // Exact match
      c.coverageType === 'GENERIC_CAR'; // Generic: matches all coverage types (WA, WA_PLUS, ALL_RISK)
    if (!coverageMatch) continue;
    
    if (c.cashbackCents == null) continue;
    consider.push(c);
    if (!best || c.cashbackCents > best.cashbackCents) {
      best = c;
    }
  }
  return { best, considered: consider };
}

function bestCompetitorForHealth(offer, competitors) {
  const provider = offer.provider;
  let best = null;
  const consider = [];

  for (const c of competitors) {
    if (c.category !== 'health') continue;
    const isGeneric = c.provider === 'GENERIC' || c.appliesTo === 'ALL_PROVIDERS' || c.insuranceType === 'HEALTH_INSURANCE';
    const providerMatch = isGeneric || c.provider === provider;
    if (!providerMatch) continue;
    if (c.cashbackCents == null) continue;
    consider.push(c);
    if (!best || c.cashbackCents > best.cashbackCents) {
      best = c;
    }
  }
  return { best, considered: consider };
}

// CashbackXL Priority versions: prioritize CashbackXL over Woolsocks
function bestCompetitorForEnergyCashbackXLPriority(offer, competitors) {
  // First, try to find match in CashbackXL only
  const cashbackxlCompetitors = competitors.filter(c => c.source === 'cashbackxl');
  const cashbackxlMatch = bestCompetitorForEnergy(offer, cashbackxlCompetitors);
  
  // If found, return it
  if (cashbackxlMatch.best) {
    return cashbackxlMatch;
  }
  
  // Otherwise, try Woolsocks
  const woolsocksCompetitors = competitors.filter(c => c.source === 'woolsocks');
  return bestCompetitorForEnergy(offer, woolsocksCompetitors);
}

function bestCompetitorForCarCashbackXLPriority(offer, competitors) {
  // First, try to find match in CashbackXL only
  const cashbackxlCompetitors = competitors.filter(c => c.source === 'cashbackxl');
  const cashbackxlMatch = bestCompetitorForCar(offer, cashbackxlCompetitors);
  
  // If found, return it
  if (cashbackxlMatch.best) {
    return cashbackxlMatch;
  }
  
  // Otherwise, try Woolsocks
  const woolsocksCompetitors = competitors.filter(c => c.source === 'woolsocks');
  return bestCompetitorForCar(offer, woolsocksCompetitors);
}

function bestCompetitorForHealthCashbackXLPriority(offer, competitors) {
  // First, try to find match in CashbackXL only
  const cashbackxlCompetitors = competitors.filter(c => c.source === 'cashbackxl');
  const cashbackxlMatch = bestCompetitorForHealth(offer, cashbackxlCompetitors);
  
  // If found, return it
  if (cashbackxlMatch.best) {
    return cashbackxlMatch;
  }
  
  // Otherwise, try Woolsocks
  const woolsocksCompetitors = competitors.filter(c => c.source === 'woolsocks');
  return bestCompetitorForHealth(offer, woolsocksCompetitors);
}

function calculateRecommendation(currentCents, bestCents, commissionCents) {
  if (bestCents == null) {
    return { action: 'keep', newRateCents: currentCents, marginCents: commissionCents - currentCents, reason: 'No Competitor Data' };
  }
  if (bestCents <= currentCents) {
    return { action: 'keep', newRateCents: currentCents, marginCents: commissionCents - currentCents, reason: 'Already Competitive' };
  }
  if (bestCents <= commissionCents) {
    return { action: 'increase', newRateCents: bestCents, marginCents: commissionCents - bestCents, reason: 'Match best competitor under commission cap' };
  }
  // best > commission
  return { action: 'increase', newRateCents: commissionCents, marginCents: 0, reason: '0% margin - competitor exceeds commission' };
}

function formatEuro(num) {
  return `€${Number(num).toFixed(2)}`;
}

function formatContractType(category, attributes) {
  if (category === 'energy') {
    const { term, meterType } = attributes;
    if (term && meterType) {
      // Format: "ONE_YEAR DUAL", "THREE_YEARS SINGLE", etc.
      return `${term} ${meterType}`;
    }
    return '';
  } else if (category === 'car') {
    const { coverageType } = attributes;
    return coverageType || '';
  }
  // Health has no contract types
  return '';
}

function ensureReportsFolder(projectRoot, dateFolder) {
  const folder = path.join(projectRoot, 'reports', dateFolder === 'latest' ? format(new Date(), 'yyyy-MM-dd') : dateFolder);
  ensureDirectoryExists(folder);
  return folder;
}

// Helper function to get contract type priority for sorting
function getContractTypePriority(contractType) {
  if (!contractType) return 999; // Unknown types go to end
  
  const normalized = contractType.toUpperCase().trim().replace(/\s+/g, '_');
  
  // Priority order:
  // 1. ONE_YEAR DUAL (1Y DUAL)
  if (normalized.includes('ONE_YEAR') && normalized.includes('DUAL')) return 1;
  // 2. ONE_YEAR SINGLE (1Y SINGLE)
  if (normalized.includes('ONE_YEAR') && (normalized.includes('SINGLE') || normalized.includes('ELECTRICITY') || normalized.includes('GAS'))) return 2;
  // 3. DYNAMIC
  if (normalized.includes('DYNAMIC')) return 3;
  // 4. THREE_YEARS DUAL (3Y DUAL)
  if (normalized.includes('THREE_YEARS') && normalized.includes('DUAL')) return 4;
  // 5. THREE_YEARS SINGLE (3Y SINGLE)
  if (normalized.includes('THREE_YEARS') && (normalized.includes('SINGLE') || normalized.includes('ELECTRICITY') || normalized.includes('GAS'))) return 5;
  // 6. ALL OTHERS
  return 6;
}

// Helper function to format contract type for display
function formatContractTypeForGrouping(contractType) {
  if (!contractType) return 'N/A';
  
  const normalized = contractType.toUpperCase().trim();
  
  // Map to display format
  if (normalized.includes('ONE_YEAR') && normalized.includes('DUAL')) return '1Y DUAL';
  if (normalized.includes('ONE_YEAR') && (normalized.includes('SINGLE') || normalized.includes('ELECTRICITY') || normalized.includes('GAS'))) return '1Y SINGLE';
  if (normalized.includes('DYNAMIC')) return 'DYNAMIC';
  if (normalized.includes('THREE_YEARS') && normalized.includes('DUAL')) return '3Y DUAL';
  if (normalized.includes('THREE_YEARS') && (normalized.includes('SINGLE') || normalized.includes('ELECTRICITY') || normalized.includes('GAS'))) return '3Y SINGLE';
  
  // For others, return a cleaned version
  return contractType.replace(/_/g, ' ').replace(/\b(\w)/g, (c) => c.toUpperCase());
}

function generateReportMarkdown(results, snapshotInfo, outputPaths, genericTopByCategory, cashbackxlPriority = false) {
  const counts = {
    total: results.length,
    increased: results.filter(r => r.recommendation.action === 'increase' && r.recommendation.newRateCents > r.currentCents).length,
    kept: results.filter(r => r.recommendation.action === 'keep').length,
    noData: results.filter(r => r.recommendation.reason === 'No Competitor Data').length,
  };
  
  // Separate results by action type
  const increases = results.filter(r => r.recommendation.action === 'increase' && r.recommendation.newRateCents > r.currentCents);
  const exceedsCommission = increases.filter(r => r.recommendation.marginCents === 0);
  const withinCommission = increases.filter(r => r.recommendation.marginCents > 0);
  
  const lines = [];
  lines.push(`# Baseline vs Affiliate-Market Comparison`);
  if (cashbackxlPriority) {
    lines.push('');
    lines.push(`> **Analysis Mode:** CashbackXL Priority - CashbackXL deals (both provider-specific and generic comparison sites) are prioritized over Woolsocks. Woolsocks deals are only used when no CashbackXL alternative exists.`);
  }
  lines.push('');
  lines.push(`**Snapshot:** ${snapshotInfo.root}`);
  lines.push(`**Generated:** ${format(new Date(), 'yyyy-MM-dd HH:mm:ss')}`);
  lines.push('');
  
  lines.push(`## Executive Summary`);
  lines.push(`- **Total offers analyzed:** ${counts.total}`);
  lines.push(`- **⚠️ Recommended increases:** ${counts.increased}`);
  lines.push(`  - Within commission cap: ${withinCommission.length}`);
  lines.push(`  - Exceeds commission (0% margin): ${exceedsCommission.length}`);
  lines.push(`- **✅ Already competitive:** ${counts.kept}`);
  lines.push(`- **❓ No competitor data:** ${counts.noData}`);
  lines.push('');
  
  // Actionable section: All offers needing adjustment
  if (increases.length > 0) {
    lines.push(`## 🎯 Action Required: Offers Needing Adjustment`);
    lines.push('');
    lines.push(`**Total offers requiring adjustment:** ${increases.length}`);
    lines.push('');
    
    // Group by category
    for (const category of ['energy', 'car', 'health']) {
      const catIncreases = increases.filter(r => r.category === category);
      if (catIncreases.length === 0) continue;
      
      lines.push(`### ${category[0].toUpperCase()}${category.slice(1)} (${catIncreases.length} offers)`);
      lines.push('');
      
      // Group by contract type with priority order
      const byContractType = {};
      for (const r of catIncreases) {
        const contractType = r.contractType || 'N/A';
        if (!byContractType[contractType]) byContractType[contractType] = [];
        byContractType[contractType].push(r);
      }
      
      // Sort contract types by priority, then by name
      const contractTypes = Object.keys(byContractType).sort((a, b) => {
        const priorityA = getContractTypePriority(a);
        const priorityB = getContractTypePriority(b);
        if (priorityA !== priorityB) return priorityA - priorityB;
        return a.localeCompare(b);
      });
      
      for (const contractType of contractTypes) {
        const contractOffers = byContractType[contractType];
        const displayName = formatContractTypeForGrouping(contractType);
        
        lines.push(`#### ${displayName} (${contractOffers.length} offer${contractOffers.length > 1 ? 's' : ''})`);
        lines.push('');
        
        // Sort by provider name, then by margin impact (lowest margin = most urgent)
        contractOffers.sort((a, b) => {
          const providerCompare = a.provider.localeCompare(b.provider);
          if (providerCompare !== 0) return providerCompare;
          return a.recommendation.marginCents - b.recommendation.marginCents;
        });
        
        for (const r of contractOffers) {
          const current = formatEuro(fromCents(r.currentCents));
          const recommended = formatEuro(fromCents(r.recommendation.newRateCents));
          const competitor = r.bestCompetitorCents != null ? formatEuro(fromCents(r.bestCompetitorCents)) : 'N/A';
          const margin = formatEuro(fromCents(r.recommendation.marginCents));
          const marginPct = r.commissionCents > 0 ? Math.round((r.recommendation.marginCents / r.commissionCents) * 100) : 0;
          
          lines.push(`- **${r.provider}**`);
          lines.push(`  - Current: ${current} → Recommended: ${recommended}`);
          lines.push(`  - Competitor: ${competitor} (${r.bestSource || 'N/A'})`);
          if (r.bestSourceUrl) {
            lines.push(`  - [Verify deal ↗](${r.bestSourceUrl})`);
          }
          lines.push(`  - Margin after change: ${margin} (${marginPct}%)`);
          if (r.recommendation.marginCents === 0) {
            lines.push(`  - ⚠️ **WARNING:** Competitor exceeds commission cap - cannot fully match`);
          }
          lines.push('');
        }
      }
    }
  }
  
  // Summary by category
  lines.push(`## Summary by Category`);
  for (const category of ['energy', 'car', 'health']) {
    const catResults = results.filter(r => r.category === category);
    if (catResults.length === 0) continue;
    lines.push(`### ${category[0].toUpperCase()}${category.slice(1)}`);
    const inc = catResults.filter(r => r.recommendation.action === 'increase' && r.recommendation.newRateCents > r.currentCents);
    const kept = catResults.filter(r => r.recommendation.action === 'keep');
    const nodata = catResults.filter(r => r.recommendation.reason === 'No Competitor Data');
    lines.push(`- Total: ${catResults.length}`);
    lines.push(`- ⚠️ Needs adjustment: ${inc.length}`);
    lines.push(`- ✅ Already competitive: ${kept.length}`);
    lines.push(`- ❓ No competitor data: ${nodata.length}`);
    lines.push('');
  }
  
  // Generic rates used
  lines.push(`## Generic Comparison Rates Used`);
  for (const [category, items] of Object.entries(genericTopByCategory)) {
    if (items.length === 0) continue;
    lines.push(`### ${category[0].toUpperCase()}${category.slice(1)}`);
    for (const it of items.slice(0, 10)) {
      lines.push(`- ${formatEuro(fromCents(it.cashbackCents))} via ${it.comparisonSite || it.source} (${it.source})`);
    }
    lines.push('');
  }
  
  lines.push(`## Data Files`);
  lines.push(`- **Competitors mapped:** ${path.join(snapshotInfo.root, 'competitors-mapped.csv')}`);
  lines.push(`- **Comparison results (CSV):** ${path.join(outputPaths.folder, 'comparison-results.csv')}`);
  lines.push('');
  lines.push(`---`);
  lines.push(`*Report generated by comparison script*`);
  
  return lines.join('\n');
}

async function main() {
  const opts = parseArgs();
  const projectRoot = path.join(__dirname, '..');
  const snapshotInfo = resolveSnapshotRoot(opts);
  const dateFolder = snapshotInfo.dateFolder === 'latest' ? format(new Date(), 'yyyy-MM-dd') : snapshotInfo.dateFolder;
  const outputFolder = ensureReportsFolder(projectRoot, dateFolder);

  const [baselineOffers, competitors] = await Promise.all([
    loadBaselineOffers(projectRoot, opts.category),
    loadCompetitors(snapshotInfo.root),
  ]);

  const results = [];
  const genericUsed = { energy: [], car: [], health: [] };

  for (const offer of baselineOffers) {
    let match;
    if (opts.cashbackxlPriority) {
      // Use CashbackXL priority matching
      if (offer.category === 'energy') match = bestCompetitorForEnergyCashbackXLPriority(offer, competitors);
      else if (offer.category === 'car') match = bestCompetitorForCarCashbackXLPriority(offer, competitors);
      else if (offer.category === 'health') match = bestCompetitorForHealthCashbackXLPriority(offer, competitors);
    } else {
      // Use normal matching (all sources considered equally)
      if (offer.category === 'energy') match = bestCompetitorForEnergy(offer, competitors);
      else if (offer.category === 'car') match = bestCompetitorForCar(offer, competitors);
      else if (offer.category === 'health') match = bestCompetitorForHealth(offer, competitors);
    }

    const best = match?.best || null;
    // Track generic used
    if (best && (best.provider === 'GENERIC' || best.appliesTo === 'ALL_PROVIDERS')) {
      genericUsed[offer.category].push(best);
    }
    const recommendation = calculateRecommendation(offer.currentCents, best?.cashbackCents ?? null, offer.commissionCents);
    results.push({
      category: offer.category,
      provider: offer.provider,
      contractType: formatContractType(offer.category, offer.attributes),
      currentCents: offer.currentCents,
      commissionCents: offer.commissionCents,
      bestCompetitorCents: best?.cashbackCents ?? null,
      bestSource: best ? (best.comparisonSite || `${best.source}:${best.provider}`) : null,
      bestSourceUrl: best?.sourceUrl || '',
      recommendation,
    });
  }

  // Write CSV output
  const csvFilename = opts.cashbackxlPriority ? 'comparison-results-cashbackxl-priority.csv' : 'comparison-results.csv';
  const csvPath = path.join(outputFolder, csvFilename);
  const csvHeaders = [
    'category',
    'provider',
    'contract_type',
    'current',
    'commission',
    'best_competitor',
    'best_source',
    'best_source_url',
    'action',
    'new_rate',
    'margin',
    'reason',
  ];
  const csvRows = results.map(r => ({
    category: r.category,
    provider: r.provider,
    contract_type: r.contractType || '',
    current: fromCents(r.currentCents),
    commission: fromCents(r.commissionCents),
    best_competitor: r.bestCompetitorCents != null ? fromCents(r.bestCompetitorCents) : '',
    best_source: r.bestSource || '',
    best_source_url: r.bestSourceUrl || '',
    action: r.recommendation.action,
    new_rate: fromCents(r.recommendation.newRateCents),
    margin: fromCents(r.recommendation.marginCents),
    reason: r.recommendation.reason,
  }));
  await writeCSV(csvPath, csvHeaders, csvRows);

  // Report markdown
  const genericTopByCategory = {
    energy: genericUsed.energy.sort((a, b) => b.cashbackCents - a.cashbackCents),
    car: genericUsed.car.sort((a, b) => b.cashbackCents - a.cashbackCents),
    health: genericUsed.health.sort((a, b) => b.cashbackCents - a.cashbackCents),
  };
  const md = generateReportMarkdown(results, snapshotInfo, { folder: outputFolder }, genericTopByCategory, opts.cashbackxlPriority);
  const mdFilename = opts.cashbackxlPriority ? 'comparison-report-cashbackxl-priority.md' : 'comparison-report.md';
  const mdPath = path.join(outputFolder, mdFilename);
  fs.writeFileSync(mdPath, md, 'utf-8');

  console.log(`Wrote:\n- ${csvPath}\n- ${mdPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});


