#!/usr/bin/env node

/**
 * Scrape all provider-specific deals from CashbackXL (Track 1)
 * Usage: node scripts/scrapers/scrape-providers.js
 */

const { scrapeMultipleProviders } = require('./cashbackxl-scraper-v2');
const { extractProvidersFromCSV, getTodayFolderPath, writeCSV, writeJSON } = require('./utils');
const path = require('path');

async function scrapeAllProviders() {
  console.log('🚀 Starting Track 1: Provider-Specific Deals Scraper\n');
  console.log('This will scrape all providers from your Input CSV files...\n');

  // Extract providers from CSV files
  console.log('📂 Reading provider lists from CSV files...');

  const energyProviders = await extractProvidersFromCSV('energy');
  const carProviders = await extractProvidersFromCSV('car');
  const healthProviders = await extractProvidersFromCSV('health');

  const allProviders = [
    ...energyProviders,
    ...carProviders,
    ...healthProviders
  ];

  console.log(`\n📊 Provider counts:`);
  console.log(`   Energy: ${energyProviders.length} providers`);
  console.log(`   Car: ${carProviders.length} providers`);
  console.log(`   Health: ${healthProviders.length} providers`);
  console.log(`   Total: ${allProviders.length} providers\n`);

  console.log('⏱️  Estimated time: ~' + Math.ceil(allProviders.length * 1.5 / 60) + ' minutes\n');
  console.log('Starting scrape in 3 seconds...\n');

  await new Promise(resolve => setTimeout(resolve, 3000));

  // Scrape all providers
  console.log('🔍 Scraping providers (~1.5s + jitter delay between requests)...\n');

  const startTime = Date.now();
  const results = await scrapeMultipleProviders(allProviders, 1500);
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
        allDeals.push(...result.deals);
      }
    } else if (result.status === 'not_found') {
      scrapeLogs.not_found++;
    } else if (result.status === 'not_available') {
      // Page exists but no real deals available (like Next Energy)
      scrapeLogs.not_found++; // Count as not_found for reporting
    } else {
      scrapeLogs.failed++;
    }

    scrapeLogs.results[result.url] = {
      status: result.status,
      deals_found: result.deals?.length || 0,
      error: result.error || null
    };
  });

  // Save results
  const outputFolder = getTodayFolderPath();
  const csvPath = path.join(outputFolder, 'cashbackxl-providers-raw.csv');
  const logPath = path.join(outputFolder, 'scrape-log-providers.json');

  if (allDeals.length > 0) {
    await writeCSV(csvPath, [
      'provider',
      'deal_description',
      'cashback_amount',
      'category',
      'source_url',
      'scraped_at',
      'confidence'
    ], allDeals);
  }

  writeJSON(logPath, scrapeLogs);

  // Print summary
  console.log('\n\n' + '='.repeat(60));
  console.log('📊 SCRAPING COMPLETE');
  console.log('='.repeat(60));
  console.log(`✅ Successful: ${scrapeLogs.successful}`);
  console.log(`❌ Failed: ${scrapeLogs.failed}`);
  console.log(`❌ Not Found/Not Available: ${scrapeLogs.not_found}`);
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

  // Show sample deals
  console.log(`\n📝 Sample deals (first 10):`);
  allDeals.slice(0, 10).forEach((deal, idx) => {
    console.log(`\n${idx + 1}. ${deal.provider} (${deal.category})`);
    console.log(`   ${deal.cashback_amount} - ${deal.deal_description.substring(0, 80)}...`);
  });

  console.log('\n✅ Done!\n');
}

// Run scraper
scrapeAllProviders().catch(error => {
  console.error('❌ Scraping failed:', error);
  process.exit(1);
});
