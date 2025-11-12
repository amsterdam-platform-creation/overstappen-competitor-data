#!/usr/bin/env node

/**
 * Test and validate contract-type mapping rules
 * Usage: node scripts/apply-mappings.js
 */

const fs = require('fs');
const path = require('path');
const { readCSV, ensureDirectoryExists } = require('./scrapers/utils');
const { createObjectCsvWriter } = require('csv-writer');

/**
 * Load mapping configuration
 */
function loadMappingConfig() {
  const configPath = path.join(__dirname, 'config/contract-type-mappings.json');
  return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
}

/**
 * Normalize Woolsocks deal to match CashbackXL format
 */
function normalizeWoolsocksDeal(woolsocksDeal) {
  return {
    provider: woolsocksDeal.entity_name_canonical,
    deal_description: woolsocksDeal.description,
    cashback_amount: `€${parseFloat(woolsocksDeal.amount).toFixed(2)}`,
    category: woolsocksDeal.vertical, // energy, car (auto), health (zorg)
    source_url: woolsocksDeal.url || '',
    scraped_at: woolsocksDeal.last_seen_at,
    source: 'woolsocks'
  };
}

/**
 * Normalize comparison site deal to unified format
 */
function normalizeComparisonSiteDeal(comparisonSiteDeal) {
  return {
    provider: 'GENERIC', // Mark as generic - applies to all providers
    comparison_site: comparisonSiteDeal.comparison_site,
    deal_description: comparisonSiteDeal.deal_description,
    cashback_amount: comparisonSiteDeal.cashback_amount,
    category: comparisonSiteDeal.category,
    applies_to: comparisonSiteDeal.applies_to || 'ALL_PROVIDERS',
    source_url: comparisonSiteDeal.source_url || '',
    scraped_at: comparisonSiteDeal.scraped_at || '',
    source: 'cashbackxl'
  };
}

/**
 * Apply mapping rules to a deal description
 */
function applyMappingRules(deal, mappingConfig) {
  const { provider, deal_description, category } = deal;

  // Look up provider-specific rules
  const categoryRules = mappingConfig[category];
  if (!categoryRules) {
    return {
      status: 'no_category',
      reason: `No rules for category: ${category}`
    };
  }

  const providerRules = categoryRules[provider];
  const defaultRules = categoryRules['_default'];

  const rules = providerRules?.rules || defaultRules?.rules || [];

  for (const rule of rules) {
    const regex = new RegExp(rule.pattern, 'i'); // Case-insensitive
    const match = deal_description.match(regex);

    if (match) {
      // Check if this rule says to ignore the deal
      if (rule.action === 'IGNORE') {
        return {
          status: 'ignored',
          reason: rule.reason || 'Deal ignored by rule',
          rule: rule.pattern
        };
      }

      // Extract contract type fields
      const mapped = {
        status: 'mapped',
        contract_type: rule.contract_type,
        coverage_type: rule.coverage_type,
        insurance_type: rule.insurance_type,
        duration: null,
        meter_type: rule.meter_type,
        rule_matched: rule.pattern,
        notes: rule.notes
      };

      // Extract duration if regex capture group exists
      if (rule.duration_regex) {
        const durationMatch = deal_description.match(new RegExp(rule.duration_regex, 'i'));
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
    status: 'unmapped',
    reason: 'No matching rule found'
  };
}

/**
 * Map comparison site deal (always generic, applies to all providers)
 */
function mapComparisonSiteDeal(deal) {
  // Comparison sites are always generic deals that apply to all providers
  // They don't need regex matching - they're already clearly generic
  return {
    status: 'mapped',
    contract_type: 'GENERIC',
    coverage_type: deal.category === 'car' ? 'GENERIC_CAR' : '',
    insurance_type: deal.category === 'health' ? 'HEALTH_INSURANCE' : '',
    duration: 'ANY',
    meter_type: deal.category === 'energy' ? 'BOTH' : '',
    rule_matched: 'COMPARISON_SITE_GENERIC',
    notes: `Generic comparison site deal from ${deal.comparison_site}`
  };
}

/**
 * Save mapping results to CSV
 */
async function saveMappingResults(mappedDeals, outputPath) {
  ensureDirectoryExists(path.dirname(outputPath));

  const csvWriter = createObjectCsvWriter({
    path: outputPath,
    header: [
      { id: 'source', title: 'source' },
      { id: 'provider', title: 'provider' },
      { id: 'category', title: 'category' },
      { id: 'deal_description', title: 'deal_description' },
      { id: 'cashback_amount', title: 'cashback_amount' },
      { id: 'mapping_status', title: 'mapping_status' },
      { id: 'contract_type', title: 'contract_type' },
      { id: 'duration', title: 'duration' },
      { id: 'meter_type', title: 'meter_type' },
      { id: 'coverage_type', title: 'coverage_type' },
      { id: 'insurance_type', title: 'insurance_type' },
      { id: 'applies_to', title: 'applies_to' },
      { id: 'comparison_site', title: 'comparison_site' },
      { id: 'rule_matched', title: 'rule_matched' },
      { id: 'ignore_reason', title: 'ignore_reason' },
      { id: 'source_url', title: 'source_url' },
      { id: 'scraped_at', title: 'scraped_at' }
    ]
  });

  await csvWriter.writeRecords(mappedDeals);
  console.log(`\n💾 Saved mapping results to: ${outputPath}`);
}

/**
 * Test mappings on scraped data
 */
async function testMappings() {
  console.log('🧪 Testing Contract-Type Mapping Rules\n');

  // Load config
  const mappingConfig = loadMappingConfig();
  console.log('✅ Loaded mapping config\n');

  // Determine date folder (use today or most recent)
  const { getTodayFolderPath } = require('./scrapers/utils');
  let dateFolder = getTodayFolderPath();
  
  // If today's folder doesn't have the required files, find most recent folder
  const historyPath = path.join(__dirname, '../output/history');
  if (!fs.existsSync(path.join(dateFolder, 'cashbackxl-providers-raw.csv'))) {
    // Find most recent folder with data
    const folders = fs.readdirSync(historyPath)
      .filter(f => {
        const fullPath = path.join(historyPath, f);
        return fs.statSync(fullPath).isDirectory() && 
               /^\d{4}-\d{2}-\d{2}$/.test(f) &&
               fs.existsSync(path.join(fullPath, 'cashbackxl-providers-raw.csv'));
      })
      .sort()
      .reverse();
    
    if (folders.length > 0) {
      dateFolder = path.join(historyPath, folders[0]);
      console.log(`📅 Using existing data folder: ${folders[0]}\n`);
    }
  }
  
  const dateStr = path.basename(dateFolder);

  // Load CashbackXL provider scraped data
  const cashbackxlPath = path.join(dateFolder, 'cashbackxl-providers-raw.csv');
  const woolsocksPath = path.join(dateFolder, 'woolsocks-normalized.csv');
  const comparisonSitesPath = path.join(dateFolder, 'cashbackxl-comparison-sites-raw.csv');

  if (!fs.existsSync(cashbackxlPath)) {
    console.error('❌ No CashbackXL provider data found. Run scraper first: npm run scrape:providers');
    console.error(`   Expected at: ${cashbackxlPath}`);
    process.exit(1);
  }

  if (!fs.existsSync(woolsocksPath)) {
    console.error('❌ No Woolsocks data found. Expected at: ' + woolsocksPath);
    process.exit(1);
  }

  const cashbackxlDeals = await readCSV(cashbackxlPath);
  console.log(`📦 Loaded ${cashbackxlDeals.length} CashbackXL provider deals`);

  // Load and normalize Woolsocks data
  const woolsocksRaw = await readCSV(woolsocksPath);
  const woolsocksDeals = woolsocksRaw.map(normalizeWoolsocksDeal);
  console.log(`📦 Loaded ${woolsocksDeals.length} Woolsocks deals`);

  // Load comparison sites (if available)
  let comparisonSiteDeals = [];
  if (fs.existsSync(comparisonSitesPath)) {
    const comparisonSitesRaw = await readCSV(comparisonSitesPath);
    comparisonSiteDeals = comparisonSitesRaw.map(normalizeComparisonSiteDeal);
    console.log(`📦 Loaded ${comparisonSiteDeals.length} comparison site deals`);
  } else {
    console.log(`⚠️  No comparison sites data found at: ${comparisonSitesPath}`);
    console.log(`   (This is optional - continuing without comparison sites)`);
  }

  // Combine all sources
  const deals = [
    ...cashbackxlDeals.map(d => ({ ...d, source: 'cashbackxl' })),
    ...woolsocksDeals,
    ...comparisonSiteDeals
  ];
  console.log(`📦 Total deals to process: ${deals.length}\n`);

  // Test mapping on priority providers (those we have mapping rules for)
  const priorityProviders = [
    // Energy providers
    'Engie', 'Vattenfall', 'Budget Energie', 'Essent', 'Energiedirect',
    'Powerpeers', 'Pure Energie', 'Eneco', 'Frank Energie', 'Vandebron',
    'Innova', 'Gewoon Energie', 'United Consumers',
    // Car insurance providers
    'OHRA', 'Centraal Beheer', 'FBTO', 'Unive',
    // Health insurance providers
    'Ohra', 'CZ'
  ];

  const stats = {
    total: 0,
    mapped: 0,
    ignored: 0,
    unmapped: 0
  };

  const results = {};
  const allMappedDeals = []; // Collect all deals with mapping results

  priorityProviders.forEach(provider => {
    results[provider] = {
      total: 0,
      mapped: 0,
      ignored: 0,
      unmapped: 0,
      samples: []
    };
  });

  // Apply mappings
  deals.forEach(deal => {
    // Handle comparison sites separately (they're always generic)
    if (deal.provider === 'GENERIC' && deal.applies_to === 'ALL_PROVIDERS') {
      // This is a comparison site deal - map it as generic
      const result = mapComparisonSiteDeal(deal);
      
      stats.total++;
      stats.mapped++; // Comparison sites are always mapped

      // Collect full result for CSV export
      allMappedDeals.push({
        source: deal.source || 'cashbackxl',
        provider: deal.provider,
        category: deal.category,
        deal_description: deal.deal_description,
        cashback_amount: deal.cashback_amount,
        mapping_status: result.status,
        contract_type: result.contract_type || '',
        duration: result.duration || '',
        meter_type: result.meter_type || '',
        coverage_type: result.coverage_type || '',
        insurance_type: result.insurance_type || '',
        applies_to: deal.applies_to || 'ALL_PROVIDERS',
        comparison_site: deal.comparison_site || '',
        rule_matched: result.rule_matched || '',
        ignore_reason: '',
        source_url: deal.source_url || '',
        scraped_at: deal.scraped_at || ''
      });
      return;
    }

    // Handle regular provider deals
    if (!priorityProviders.includes(deal.provider)) {
      // Still include non-priority providers in the output, but don't track stats
      const result = applyMappingRules(deal, mappingConfig);
      
      allMappedDeals.push({
        source: deal.source || 'unknown',
        provider: deal.provider,
        category: deal.category,
        deal_description: deal.deal_description,
        cashback_amount: deal.cashback_amount,
        mapping_status: result.status,
        contract_type: result.contract_type || '',
        duration: result.duration || '',
        meter_type: result.meter_type || '',
        coverage_type: result.coverage_type || '',
        insurance_type: result.insurance_type || '',
        applies_to: '',
        comparison_site: '',
        rule_matched: result.rule_matched || '',
        ignore_reason: result.reason || '',
        source_url: deal.source_url || '',
        scraped_at: deal.scraped_at || ''
      });
      return;
    }

    stats.total++;
    results[deal.provider].total++;

    const result = applyMappingRules(deal, mappingConfig);

    if (result.status === 'mapped') {
      stats.mapped++;
      results[deal.provider].mapped++;
    } else if (result.status === 'ignored') {
      stats.ignored++;
      results[deal.provider].ignored++;
    } else {
      stats.unmapped++;
      results[deal.provider].unmapped++;
    }

    // Collect full result for CSV export
    allMappedDeals.push({
      source: deal.source || 'unknown',
      provider: deal.provider,
      category: deal.category,
      deal_description: deal.deal_description,
      cashback_amount: deal.cashback_amount,
      mapping_status: result.status,
      contract_type: result.contract_type || '',
      duration: result.duration || '',
      meter_type: result.meter_type || '',
      coverage_type: result.coverage_type || '',
      insurance_type: result.insurance_type || '',
      applies_to: '',
      comparison_site: '',
      rule_matched: result.rule_matched || '',
      ignore_reason: result.reason || '',
      source_url: deal.source_url || '',
      scraped_at: deal.scraped_at || ''
    });

    // Store sample
    if (results[deal.provider].samples.length < 5) {
      results[deal.provider].samples.push({
        description: deal.deal_description,
        amount: deal.cashback_amount,
        result: result
      });
    }
  });

  // Print summary
  console.log('=' .repeat(60));
  console.log('📊 MAPPING TEST SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total deals tested: ${stats.total}`);
  console.log(`✅ Mapped: ${stats.mapped} (${Math.round(stats.mapped/stats.total*100)}%)`);
  console.log(`⚠️  Ignored: ${stats.ignored} (${Math.round(stats.ignored/stats.total*100)}%)`);
  console.log(`❌ Unmapped: ${stats.unmapped} (${Math.round(stats.unmapped/stats.total*100)}%)`);

  let inScopeDeals = stats.mapped + stats.unmapped;
  if (inScopeDeals > 0) {
    const inScopeCoverage = Math.round(stats.mapped / inScopeDeals * 100);
    console.log(`\n📈 In-Scope Coverage: ${stats.mapped}/${inScopeDeals} (${inScopeCoverage}%)`);
    console.log(`   (Calculated from mapped + unmapped deals only, excluding ignored out-of-scope products)`);
  }

  // Print per-provider breakdown
  console.log('\n\n' + '='.repeat(60));
  console.log('📋 PER-PROVIDER RESULTS');
  console.log('='.repeat(60));

  priorityProviders.forEach(provider => {
    const providerStats = results[provider];
    if (providerStats.total === 0) {
      console.log(`\n${provider}: No deals found`);
      return;
    }

    console.log(`\n${'─'.repeat(60)}`);
    console.log(`${provider} (${providerStats.total} deals)`);
    console.log(`${'─'.repeat(60)}`);
    console.log(`✅ Mapped: ${providerStats.mapped}/${providerStats.total}`);
    console.log(`⚠️  Ignored: ${providerStats.ignored}/${providerStats.total}`);
    console.log(`❌ Unmapped: ${providerStats.unmapped}/${providerStats.total}`);

    console.log(`\nSample results:`);
    providerStats.samples.forEach((sample, idx) => {
      console.log(`\n  ${idx + 1}. ${sample.amount} - "${sample.description.substring(0, 60)}..."`);
      if (sample.result.status === 'mapped') {
        console.log(`     ✅ MAPPED:`);
        if (sample.result.contract_type) console.log(`        Contract: ${sample.result.contract_type}`);
        if (sample.result.duration) console.log(`        Duration: ${sample.result.duration}`);
        if (sample.result.meter_type) console.log(`        Meter: ${sample.result.meter_type}`);
        if (sample.result.coverage_type) console.log(`        Coverage: ${sample.result.coverage_type}`);
        if (sample.result.insurance_type) console.log(`        Insurance: ${sample.result.insurance_type}`);
        console.log(`        Rule: "${sample.result.rule_matched}"`);
      } else if (sample.result.status === 'ignored') {
        console.log(`     ⚠️  IGNORED: ${sample.result.reason}`);
      } else {
        console.log(`     ❌ UNMAPPED: ${sample.result.reason}`);
      }
    });
  });

  // Print recommendations
  console.log('\n\n' + '='.repeat(60));
  console.log('💡 RECOMMENDATIONS');
  console.log('='.repeat(60));

  const unmappedProviders = priorityProviders.filter(p =>
    results[p].total > 0 && results[p].unmapped > 0
  );

  if (unmappedProviders.length > 0) {
    console.log('\n⚠️  Providers with unmapped deals:');
    unmappedProviders.forEach(provider => {
      console.log(`   - ${provider}: ${results[provider].unmapped}/${results[provider].total} unmapped`);
    });
    console.log('\nAction: Review these providers and add more specific mapping rules.');
  }

  const missingProviders = priorityProviders.filter(p => results[p].total === 0);
  if (missingProviders.length > 0) {
    console.log('\n⚠️  Priority providers not found in scraped data:');
    missingProviders.forEach(provider => {
      console.log(`   - ${provider}`);
    });
    console.log('\nAction: Verify provider names or check scraper output.');
  }

  // Use already calculated inScopeDeals from summary section above
  const inScopeCoverage = inScopeDeals > 0 ? stats.mapped / inScopeDeals : 0;

  if (stats.unmapped === 0) {
    console.log('\n✅ Success! All in-scope deals are mapped (100% coverage)');
    console.log('Next step: Build comparison script (Day 4)');
  } else if (inScopeCoverage >= 0.7) {
    console.log('\n✅ Success! In-scope mapping coverage is good (≥70%)');
    console.log('Next step: Build comparison script (Day 4)');
  } else {
    console.log('\n⚠️  In-scope mapping coverage below target (<70%)');
    console.log('Action: Add more mapping rules before proceeding to comparison.');
  }

  // Save mapping results to CSV (generic, unified competitors file)
  const outputPath = path.join(dateFolder, 'competitors-mapped.csv');
  await saveMappingResults(allMappedDeals, outputPath);

  console.log('\n');
}

// Run tests
testMappings().catch(error => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});
