#!/usr/bin/env node

/**
 * Scrape generic comparison site deals from CashbackXL (Track 2)
 * Usage: node scripts/scrapers/scrape-comparison-sites.js
 */

const { scrapeMultipleProviders } = require('./cashbackxl-scraper-v2');
const { getTodayFolderPath, writeCSV, writeJSON } = require('./utils');
const path = require('path');
const fs = require('fs');

async function scrapeComparisonSites() {
  console.log('🚀 Starting Track 2: Comparison Sites Scraper\n');

  // Load comparison sites from config
  const configPath = path.join(__dirname, '../config/competitors.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

  const comparisonSites = [
    ...config.comparison_sites.energy,
    ...config.comparison_sites.car,
    ...config.comparison_sites.health
  ];

  console.log(`📊 Comparison sites to scrape:`);
  console.log(`   Energy: ${config.comparison_sites.energy.length}`);
  console.log(`   Car: ${config.comparison_sites.car.length}`);
  console.log(`   Health: ${config.comparison_sites.health.length}`);
  console.log(`   Total: ${comparisonSites.length}\n`);

  console.log('Sites:');
  comparisonSites.forEach(site => {
    console.log(`   - ${site.name} (${site.category})`);
  });

  console.log('\n⏱️  Estimated time: ~' + Math.ceil(comparisonSites.length * 1.5 / 60) + ' minutes\n');
  console.log('Starting scrape in 3 seconds...\n');

  await new Promise(resolve => setTimeout(resolve, 3000));

  // Scrape all comparison sites
  console.log('🔍 Scraping comparison sites (1 second delay between requests)...\n');

  const startTime = Date.now();
  const results = await scrapeMultipleProviders(comparisonSites, 1000);
  const endTime = Date.now();

  // Collect all deals
  const allDeals = [];
  const scrapeLogs = {
    scrape_date: new Date().toISOString(),
    total_urls: results.length,
    successful: 0,
    failed: 0,
    not_found: 0,
    duration_seconds: Math.round((endTime - startTime) / 1000),
    results: {}
  };

  results.forEach(result => {
    if (result.status === 'success' || result.status === 'no_deals') {
      scrapeLogs.successful++;
      if (result.deals && result.deals.length > 0) {
        // Mark these as comparison site deals
        result.deals.forEach(deal => {
          deal.comparison_site = deal.provider;
          deal.applies_to = 'ALL_PROVIDERS';
        });
        allDeals.push(...result.deals);
      }
    } else if (result.status === 'not_found') {
      scrapeLogs.not_found++;
    } else {
      scrapeLogs.failed++;
    }

    scrapeLogs.results[result.url] = {
      status: result.status,
      deals_found: result.deals?.length || 0,
      error: result.error || null
    };
  });

  // Filter out empty descriptions universally
  const nonEmptyDeals = allDeals.filter(d => typeof d.deal_description === 'string' && d.deal_description.trim().length > 0);

  // Deduplicate: keep one best row per (site, category, amount)
  const GENERIC_PATTERNS = [
    /max\.?\s*€|max\s*€/i,
    /^€?\s*\d+(?:[,.]\d{2})?\s*$/i,
    /cashback\s*$/i,
    /^cashback overzicht/i
  ];
  const SPECIFIC_KEYWORDS = [
    // Car insurance variants
    /autoverzekering/i, /wa\b/i, /wa\+|wa\s*\+/i, /waplus/i, /all\s*risk/i, /allrisk/i,
    /motorverzekering/i, /bromfiets/i, /brommerverzekering/i, /camper/i, /caravan/i,
    /pleziervaartuig/i, /fietsverzekering/i, /aansprakelijkheidsverzekering/i, /rechtsbijstand/i,
    /inboedelverzekering/i, /opstalverzekering/i, /woonhuisverzekering/i, /doorlopende\s*reis/i,
    /reisverzekering/i, /annuleringsverzekering/i, /huisdierenverzekering/i, /kilometerverzekering/i,

    // Health insurance variants
    /zorgverzekering/i, /basisverzekering/i, /aanvullend(e)?\s*zorg/i, /tand(arts)?\s*verzekering/i,
    /eigen\s*risico/i, /polis/i,

    // Energy variants
    /energiecontract/i, /(stroom|elektriciteit)\s*(?:&|\+|en)\s*gas/i, /(gas|stroom)\s*(?:of|\/)\s*(gas|stroom)/i,
    /stroom|elektriciteit|gas|energie/i, /jaar\s*vast/i, /verleng/i, /contract/i, /variabel/i,
  ];
  function isGeneric(desc) {
    const d = (desc || '').trim();
    return GENERIC_PATTERNS.some(rx => rx.test(d));
  }
  function hasSpecific(desc) {
    return SPECIFIC_KEYWORDS.some(rx => rx.test(desc || ''));
  }
  function scoreDeal(d) {
    let score = 0;
    const desc = (d.deal_description || '').trim();
    const descLower = desc.toLowerCase();
    const words = desc.split(/\s+/).filter(Boolean);
    if (d.confidence === 'high') score += 4; // slightly higher weight
    if (d.confidence === 'medium') score += 2;
    if (hasSpecific(d.deal_description)) score += 3; // higher preference for specific
    if (!isGeneric(d.deal_description)) score += 1;
    // Prefer informative descriptions: at least 2-3 words and not just the product name
    if (words.length >= 3) score += 1;
    if (desc.length >= 20 && desc.length <= 100) score += 1; // sweet spot
    // Penalize points token in description (amount is already normalized in euros)
    if (/\bptn\.?|punten\b/i.test(desc)) score -= 2;
    // Penalize overly generic one-word descriptions
    if (words.length <= 1) score -= 2;
    return score;
  }
  const keyToBest = new Map();
  nonEmptyDeals.forEach(d => {
    const amt = (d.cashback_amount || '').replace(/\s/g, '').toLowerCase();
    const key = `${(d.comparison_site || '').toLowerCase()}|${(d.category || '').toLowerCase()}|${amt}`;
    const current = keyToBest.get(key);
    if (!current || scoreDeal(d) > scoreDeal(current)) {
      keyToBest.set(key, d);
    }
  });
  const dedupedDeals = Array.from(keyToBest.values());

  // Save results
  const outputFolder = getTodayFolderPath();
  const csvPath = path.join(outputFolder, 'cashbackxl-comparison-sites-raw.csv');
  const logPath = path.join(outputFolder, 'scrape-log-comparison-sites.json');

  if (dedupedDeals.length > 0) {
    await writeCSV(csvPath, [
      'comparison_site',
      'deal_description',
      'cashback_amount',
      'category',
      'applies_to',
      'source_url',
      'scraped_at',
      'confidence'
    ], dedupedDeals.map(deal => ({
      comparison_site: deal.comparison_site,
      deal_description: deal.deal_description,
      cashback_amount: deal.cashback_amount,
      category: deal.category,
      applies_to: deal.applies_to,
      source_url: deal.source_url,
      scraped_at: deal.scraped_at,
      confidence: deal.confidence
    })));
  }

  writeJSON(logPath, scrapeLogs);

  // Print summary
  console.log('\n\n' + '='.repeat(60));
  console.log('📊 SCRAPING COMPLETE');
  console.log('='.repeat(60));
  console.log(`✅ Successful: ${scrapeLogs.successful}`);
  console.log(`❌ Failed: ${scrapeLogs.failed}`);
  console.log(`❌ Not Found: ${scrapeLogs.not_found}`);
  console.log(`\n📦 Total deals found: ${allDeals.length}`);
  console.log(`⏱️  Duration: ${scrapeLogs.duration_seconds} seconds`);
  console.log(`\n💾 Output files:`);
  console.log(`   ${csvPath}`);
  console.log(`   ${logPath}`);

  // Show breakdown by category
  const energyDeals = allDeals.filter(d => d.category === 'energy').length;
  const carDeals = allDeals.filter(d => d.category === 'car').length;
  const healthDeals = allDeals.filter(d => d.category === 'health').length;

  console.log(`\n📈 Deals by category:`);
  console.log(`   Energy: ${energyDeals} deals`);
  console.log(`   Car: ${carDeals} deals`);
  console.log(`   Health: ${healthDeals} deals`);

  // Show all deals
  console.log(`\n📝 All comparison site deals:`);
  allDeals.forEach((deal, idx) => {
    console.log(`\n${idx + 1}. ${deal.comparison_site} (${deal.category})`);
    console.log(`   ${deal.cashback_amount} - ${deal.deal_description.substring(0, 80)}...`);
  });

  console.log('\n✅ Done!\n');
}

// Run scraper
scrapeComparisonSites().catch(error => {
  console.error('❌ Scraping failed:', error);
  process.exit(1);
});
