#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { format } = require('date-fns');
const { readCSV, ensureDirectoryExists, writeCSV } = require('./scrapers/utils');

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { latest: true, date: null, category: 'all' };
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

/**
 * Load Woolsocks baseline offers from competitors-mapped.csv
 * Filter for source="woolsocks" and mapping_status="mapped"
 */
async function loadWoolsocksBaseline(snapshotRoot, categoryFilter) {
  const file = path.join(snapshotRoot, 'competitors-mapped.csv');
  const rows = await readCSV(file);
  
  const woolsocksRows = rows.filter(r => {
    const source = (r.source || '').trim().toLowerCase();
    const mappingStatus = (r.mapping_status || '').trim().toLowerCase();
    const category = (r.category || '').trim().toLowerCase();
    
    if (source !== 'woolsocks') return false;
    if (mappingStatus !== 'mapped') return false;
    if (categoryFilter !== 'all' && category !== categoryFilter) return false;
    
    return true;
  });
  
  const results = [];
  
  for (const r of woolsocksRows) {
    const category = (r.category || '').trim().toLowerCase();
    const provider = (r.provider || '').trim();
    const cashbackCents = toCents(euroToNumber(r.cashback_amount));
    
    if (cashbackCents == null) continue;
    
    if (category === 'energy') {
      const duration = (r.duration || '').trim();
      const meterType = (r.meter_type || '').trim();
      const contractType = (r.contract_type || '').trim();
      
      // Map contract_type to meter_type if needed
      let meterTypeAttr = meterType;
      if (!meterTypeAttr && contractType) {
        if (contractType === 'SINGLE') meterTypeAttr = 'SINGLE';
        else if (contractType === 'DUAL') meterTypeAttr = 'DUAL';
      }
      
      // Map duration
      let term = duration;
      if (!term && contractType === 'RENEWAL') {
        term = 'RENEWAL';
      }
      
      // Store contract type info for better formatting
      results.push({
        category: 'energy',
        provider,
        attributes: { term, meterType: meterTypeAttr, contractType },
        currentCents: cashbackCents,
        raw: r,
      });
    } else if (category === 'car') {
      let coverageType = (r.coverage_type || '').trim();
      const dealDescription = (r.deal_description || '').trim().toLowerCase();
      
      // If coverage type is GENERIC_CAR but description contains specific coverage types,
      // extract the specific type from the description
      if (coverageType === 'GENERIC_CAR' || !coverageType) {
        if (/all\s*risk|allrisk|volledig\s*casco/i.test(dealDescription)) {
          coverageType = 'ALL_RISK';
        } else if (/wa\s*plus|wa\+|beperkt\s*casco/i.test(dealDescription)) {
          coverageType = 'WA_PLUS';
        } else if (/\bwa\b(?![\s-]?plus|\+)/i.test(dealDescription)) {
          coverageType = 'WA';
        }
        // If still generic or empty, keep it as GENERIC_CAR
        if (!coverageType) {
          coverageType = 'GENERIC_CAR';
        }
      }
      
      results.push({
        category: 'car',
        provider,
        attributes: { coverageType },
        currentCents: cashbackCents,
        raw: r,
      });
    } else if (category === 'health') {
      // Filter out car insurance deals that were incorrectly categorized as health
      const dealDescription = (r.deal_description || '').trim().toLowerCase();
      const coverageType = (r.coverage_type || '').trim();
      
      // Skip car insurance deals (they should be in car category, not health)
      if (/autoverzekering|car\s*insurance|wa\s*plus|all\s*risk|wa\b/i.test(dealDescription) || 
          coverageType === 'ALL_RISK' || coverageType === 'WA_PLUS' || coverageType === 'WA' || coverageType === 'GENERIC_CAR') {
        // This is a car insurance deal, skip it
        continue;
      }
      
      results.push({
        category: 'health',
        provider,
        attributes: {},
        currentCents: cashbackCents,
        raw: r,
      });
    }
  }
  
  return results;
}

/**
 * Load Cashback XL competitors from competitors-mapped.csv
 * Filter for source="cashbackxl" and mapping_status="mapped"
 */
async function loadCashbackXLCompetitors(snapshotRoot) {
  const file = path.join(snapshotRoot, 'competitors-mapped.csv');
  const rows = await readCSV(file);
  
  const normalized = rows
    .filter((r) => {
      const source = (r.source || '').trim().toLowerCase();
      const mappingStatus = (r.mapping_status || '').trim().toLowerCase();
      if (source !== 'cashbackxl' || mappingStatus !== 'mapped') return false;
      
      // Filter out car insurance deals from health category
      const category = (r.category || '').trim().toLowerCase();
      if (category === 'health') {
        const dealDescription = (r.deal_description || '').trim().toLowerCase();
        const coverageType = (r.coverage_type || '').trim();
        if (/autoverzekering|car\s*insurance|wa\s*plus|all\s*risk|wa\b/i.test(dealDescription) || 
            coverageType === 'ALL_RISK' || coverageType === 'WA_PLUS' || coverageType === 'WA' || coverageType === 'GENERIC_CAR') {
          return false; // Skip car insurance deals in health category
        }
      }
      
      return true;
    })
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

/**
 * Calculate recommendation for reduction
 * Find cases where Woolsocks > Cashback XL and recommend lowering
 */
function calculateReductionRecommendation(woolsocksCents, cashbackXLCents) {
  if (cashbackXLCents == null) {
    return { 
      action: 'keep', 
      newRateCents: woolsocksCents, 
      reductionCents: 0,
      reason: 'No Cashback XL Data' 
    };
  }
  
  if (woolsocksCents <= cashbackXLCents) {
    return { 
      action: 'keep', 
      newRateCents: woolsocksCents, 
      reductionCents: 0,
      reason: 'Already matching or below Cashback XL' 
    };
  }
  
  // Woolsocks > Cashback XL: recommend lowering to match
  return { 
    action: 'reduce', 
    newRateCents: cashbackXLCents, 
    reductionCents: woolsocksCents - cashbackXLCents,
    reason: 'Woolsocks exceeds Cashback XL - can reduce to match' 
  };
}

function formatEuro(num) {
  return `€${Number(num).toFixed(2)}`;
}

function formatContractType(category, attributes) {
  if (category === 'energy') {
    const { term, meterType, contractType } = attributes;
    
    // If we have both term and meterType, use them
    if (term && meterType) {
      // Format: "ONE_YEAR DUAL", "THREE_YEARS SINGLE", etc.
      return `${term} ${meterType}`;
    }
    
    // Fallback: use contractType if available
    if (contractType && contractType !== 'GENERIC') {
      if (term) {
        return `${term} ${contractType}`;
      }
      return contractType;
    }
    
    // If we only have term
    if (term) {
      return term;
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
  
  const normalized = contractType.toUpperCase().trim().replace(/\s+/g, '_');
  
  // Map to display format
  if (normalized.includes('ONE_YEAR') && normalized.includes('DUAL')) return '1Y DUAL';
  if (normalized.includes('ONE_YEAR') && (normalized.includes('SINGLE') || normalized.includes('ELECTRICITY') || normalized.includes('GAS'))) return '1Y SINGLE';
  if (normalized.includes('DYNAMIC')) return 'DYNAMIC';
  if (normalized.includes('THREE_YEARS') && normalized.includes('DUAL')) return '3Y DUAL';
  if (normalized.includes('THREE_YEARS') && (normalized.includes('SINGLE') || normalized.includes('ELECTRICITY') || normalized.includes('GAS'))) return '3Y SINGLE';
  
  // For others, return a cleaned version
  return contractType.replace(/_/g, ' ').replace(/\b(\w)/g, (c) => c.toUpperCase());
}

function generateReportMarkdown(results, snapshotInfo, outputPaths) {
  const counts = {
    total: results.length,
    reductions: results.filter(r => r.recommendation.action === 'reduce').length,
    kept: results.filter(r => r.recommendation.action === 'keep').length,
    noData: results.filter(r => r.recommendation.reason === 'No Cashback XL Data').length,
  };
  
  // Separate results by action type
  const reductions = results.filter(r => r.recommendation.action === 'reduce');
  const totalReductionCents = reductions.reduce((sum, r) => sum + r.recommendation.reductionCents, 0);
  const totalReduction = fromCents(totalReductionCents);
  
  const lines = [];
  lines.push(`# Woolsocks vs Cashback XL Comparison`);
  lines.push('');
  lines.push(`**Snapshot:** ${snapshotInfo.root}`);
  lines.push(`**Generated:** ${format(new Date(), 'yyyy-MM-dd HH:mm:ss')}`);
  lines.push('');
  
  lines.push(`## Executive Summary`);
  lines.push(`- **Total offers analyzed:** ${counts.total}`);
  lines.push(`- **💰 Reduction opportunities:** ${counts.reductions}`);
  lines.push(`- **✅ Already matching or below:** ${counts.kept}`);
  lines.push(`- **❓ No Cashback XL data:** ${counts.noData}`);
  lines.push('');
  
  // Actionable section: All offers that can be reduced
  if (reductions.length > 0) {
    lines.push(`## 🎯 Reduction Opportunities: Offers That Can Be Lowered`);
    lines.push('');
    lines.push(`**Total offers that can be reduced:** ${reductions.length}`);
    lines.push('');
    
    // Group by category
    for (const category of ['energy', 'car', 'health']) {
      const catReductions = reductions.filter(r => r.category === category);
      if (catReductions.length === 0) continue;
      
      lines.push(`### ${category[0].toUpperCase()}${category.slice(1)} (${catReductions.length} offers)`);
      lines.push('');
      
      // Group by contract type with priority order
      const byContractType = {};
      for (const r of catReductions) {
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
        
        // Sort by provider name, then by reduction amount (highest first)
        contractOffers.sort((a, b) => {
          const providerCompare = a.provider.localeCompare(b.provider);
          if (providerCompare !== 0) return providerCompare;
          return b.recommendation.reductionCents - a.recommendation.reductionCents;
        });
        
        for (const r of contractOffers) {
          const current = formatEuro(fromCents(r.currentCents));
          const recommended = formatEuro(fromCents(r.recommendation.newRateCents));
          const cashbackXL = r.cashbackXLCents != null ? formatEuro(fromCents(r.cashbackXLCents)) : 'N/A';
          const reduction = formatEuro(fromCents(r.recommendation.reductionCents));
          
          lines.push(`- **${r.provider}**`);
          lines.push(`  - Current Woolsocks: ${current} → Recommended: ${recommended}`);
          lines.push(`  - Cashback XL rate: ${cashbackXL}`);
          if (r.cashbackXLSource) {
            lines.push(`  - Source: ${r.cashbackXLSource}`);
          }
          if (r.cashbackXLSourceUrl) {
            lines.push(`  - [Verify deal ↗](${r.cashbackXLSourceUrl})`);
          }
          lines.push(`  - Reduction: ${reduction}`);
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
    const red = catResults.filter(r => r.recommendation.action === 'reduce');
    const kept = catResults.filter(r => r.recommendation.action === 'keep');
    const nodata = catResults.filter(r => r.recommendation.reason === 'No Cashback XL Data');
    const catTotal = fromCents(red.reduce((sum, r) => sum + r.recommendation.reductionCents, 0));
    
    lines.push(`- Total: ${catResults.length}`);
    lines.push(`- 💰 Can reduce: ${red.length}`);
    lines.push(`- ✅ Already matching or below: ${kept.length}`);
    lines.push(`- ❓ No Cashback XL data: ${nodata.length}`);
    lines.push('');
  }
  
  lines.push(`## Data Files`);
  lines.push(`- **Competitors mapped:** ${path.join(snapshotInfo.root, 'competitors-mapped.csv')}`);
  lines.push(`- **Comparison results (CSV):** ${path.join(outputPaths.folder, 'woolsocks-vs-cashbackxl-results.csv')}`);
  lines.push('');
  lines.push(`---`);
  lines.push(`*Report generated by Woolsocks vs Cashback XL comparison script*`);
  
  return lines.join('\n');
}

async function main() {
  const opts = parseArgs();
  const projectRoot = path.join(__dirname, '..');
  const snapshotInfo = resolveSnapshotRoot(opts);
  const dateFolder = snapshotInfo.dateFolder === 'latest' ? format(new Date(), 'yyyy-MM-dd') : snapshotInfo.dateFolder;
  const outputFolder = ensureReportsFolder(projectRoot, dateFolder);

  const [woolsocksBaseline, cashbackXLCompetitors] = await Promise.all([
    loadWoolsocksBaseline(snapshotInfo.root, opts.category),
    loadCashbackXLCompetitors(snapshotInfo.root),
  ]);

  console.log(`Loaded ${woolsocksBaseline.length} Woolsocks baseline offers`);
  console.log(`Loaded ${cashbackXLCompetitors.length} Cashback XL competitor deals`);

  const results = [];

  for (const offer of woolsocksBaseline) {
    let match;
    if (offer.category === 'energy') match = bestCompetitorForEnergy(offer, cashbackXLCompetitors);
    else if (offer.category === 'car') match = bestCompetitorForCar(offer, cashbackXLCompetitors);
    else if (offer.category === 'health') match = bestCompetitorForHealth(offer, cashbackXLCompetitors);

    const best = match?.best || null;
    const recommendation = calculateReductionRecommendation(offer.currentCents, best?.cashbackCents ?? null);
    
    results.push({
      category: offer.category,
      provider: offer.provider,
      contractType: formatContractType(offer.category, offer.attributes),
      currentCents: offer.currentCents,
      cashbackXLCents: best?.cashbackCents ?? null,
      cashbackXLSource: best ? (best.comparisonSite || `${best.source}:${best.provider}`) : null,
      cashbackXLSourceUrl: best?.sourceUrl || '',
      recommendation,
    });
  }

  // Write CSV output
  const csvPath = path.join(outputFolder, 'woolsocks-vs-cashbackxl-results.csv');
  const csvHeaders = [
    'category',
    'provider',
    'contract_type',
    'current_woolsocks',
    'cashbackxl_rate',
    'action',
    'recommended_rate',
    'reduction_amount',
    'reason',
    'cashbackxl_source',
    'cashbackxl_source_url',
  ];
  const csvRows = results.map(r => ({
    category: r.category,
    provider: r.provider,
    contract_type: r.contractType || '',
    current_woolsocks: fromCents(r.currentCents),
    cashbackxl_rate: r.cashbackXLCents != null ? fromCents(r.cashbackXLCents) : '',
    action: r.recommendation.action,
    recommended_rate: fromCents(r.recommendation.newRateCents),
    reduction_amount: fromCents(r.recommendation.reductionCents),
    reason: r.recommendation.reason,
    cashbackxl_source: r.cashbackXLSource || '',
    cashbackxl_source_url: r.cashbackXLSourceUrl || '',
  }));
  await writeCSV(csvPath, csvHeaders, csvRows);

  // Report markdown
  const md = generateReportMarkdown(results, snapshotInfo, { folder: outputFolder });
  const mdPath = path.join(outputFolder, 'woolsocks-vs-cashbackxl-report.md');
  fs.writeFileSync(mdPath, md, 'utf-8');

  console.log(`\n✅ Comparison complete!`);
  console.log(`Wrote:\n- ${csvPath}\n- ${mdPath}`);
  
  const reductions = results.filter(r => r.recommendation.action === 'reduce');
  const totalReduction = fromCents(reductions.reduce((sum, r) => sum + r.recommendation.reductionCents, 0));
  console.log(`\n💰 Found ${reductions.length} reduction opportunities with total savings of ${formatEuro(totalReduction)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

