#!/usr/bin/env node

/**
 * Test scraper on a few sample providers
 * Usage: node scripts/scrapers/scrape-test.js
 */

const { scrapeCashbackXLProvider } = require('./cashbackxl-scraper-v2');
const { delay } = require('./utils');

const TEST_PROVIDERS = [
  { name: 'Vattenfall', slug: 'vattenfall', category: 'energy' },
  { name: 'Engie', slug: 'engie', category: 'energy' },
  { name: 'Centraal Beheer', slug: 'centraal-beheer', category: 'car' },
  { name: 'OHRA', slug: 'ohra', category: 'health' },
  { name: 'Independer Energie', slug: 'independer-energie', category: 'energy' }
];

async function runTest() {
  console.log('🧪 Testing CashbackXL Scraper\n');
  console.log(`Testing ${TEST_PROVIDERS.length} providers...\n`);

  const results = [];

  for (const provider of TEST_PROVIDERS) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Testing: ${provider.name} (${provider.category})`);
    console.log(`${'='.repeat(60)}`);

    const result = await scrapeCashbackXLProvider(
      provider.slug,
      provider.category,
      provider.name
    );

    results.push(result);

    console.log(`Status: ${result.status}`);
    console.log(`URL: ${result.url}`);

    if (result.status === 'success') {
      console.log(`✅ Found ${result.deals.length} deals:`);
      result.deals.forEach((deal, idx) => {
        console.log(`\n  Deal ${idx + 1}:`);
        console.log(`    Amount: ${deal.cashback_amount}`);
        console.log(`    Description: ${deal.deal_description.substring(0, 100)}...`);
      });
    } else if (result.status === 'suspicious') {
      console.log(`⚠️  Suspicious result: ${result.warning}`);
      console.log(`    Found ${result.deals.length} deals (may include false positives)`);
    } else if (result.status === 'not_found') {
      console.log(`❌ ${result.error}`);
    } else {
      console.log(`❌ Error: ${result.error}`);
    }

    // Rate limiting
    await delay(1000);
  }

  // Summary
  console.log(`\n\n${'='.repeat(60)}`);
  console.log('📊 TEST SUMMARY');
  console.log(`${'='.repeat(60)}`);

  const successCount = results.filter(r => r.status === 'success').length;
  const notFoundCount = results.filter(r => r.status === 'not_found').length;
  const errorCount = results.filter(r => r.status === 'error' || r.status === 'timeout').length;
  const suspiciousCount = results.filter(r => r.status === 'suspicious').length;

  console.log(`✅ Success: ${successCount}`);
  console.log(`⚠️  Suspicious: ${suspiciousCount}`);
  console.log(`❌ Not Found: ${notFoundCount}`);
  console.log(`❌ Errors: ${errorCount}`);

  const totalDeals = results.reduce((sum, r) => sum + (r.deals?.length || 0), 0);
  console.log(`\n📦 Total deals found: ${totalDeals}`);

  // Show sample deals
  console.log(`\n\n${'='.repeat(60)}`);
  console.log('📝 SAMPLE DEALS (first 5)');
  console.log(`${'='.repeat(60)}`);

  const allDeals = results.flatMap(r => r.deals || []);
  allDeals.slice(0, 5).forEach((deal, idx) => {
    console.log(`\n${idx + 1}. ${deal.provider} (${deal.category})`);
    console.log(`   Amount: ${deal.cashback_amount}`);
    console.log(`   Description: ${deal.deal_description.substring(0, 80)}...`);
  });

  console.log('\n\n✅ Test complete!');
  console.log('\nNext steps:');
  console.log('1. Review the deals found above');
  console.log('2. If results look good, run full scraper: npm run scrape:all');
  console.log('3. If results are suspicious, check output/debug/ folder for HTML samples\n');
}

// Run test
runTest().catch(error => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});
