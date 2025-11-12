#!/usr/bin/env node

/**
 * Test specific providers mentioned by user
 */

const { scrapeCashbackXLProvider } = require('./cashbackxl-scraper-v2');
const { delay } = require('./utils');

const TEST_PROVIDERS = [
  { name: 'Eneco', slug: 'eneco', category: 'energy' },
  { name: 'Gewoon Energie', slug: 'gewoon-energie', category: 'energy' },
  { name: 'OHRA', slug: 'ohra', category: 'car' },
  { name: 'FBTO', slug: 'fbto', category: 'car' },
  { name: 'United Consumers', slug: 'unitedconsumers', category: 'energy' },
  { name: 'Next Energy', slug: 'next-energy', category: 'energy' }
];

async function runTest() {
  console.log('🧪 Testing Specific Providers\n');

  for (const provider of TEST_PROVIDERS) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Testing: ${provider.name} (${provider.category})`);
    console.log(`URL: https://www.cashbackxl.nl/webshops/${provider.slug}`);
    console.log(`${'='.repeat(60)}`);

    const result = await scrapeCashbackXLProvider(
      provider.slug,
      provider.category,
      provider.name
    );

    console.log(`Status: ${result.status}`);
    
    if (result.status === 'success') {
      console.log(`✅ Found ${result.deals.length} deals:`);
      result.deals.forEach((deal, idx) => {
        console.log(`\n  Deal ${idx + 1}:`);
        console.log(`    Amount: ${deal.cashback_amount}`);
        console.log(`    Description: ${deal.deal_description.substring(0, 120)}`);
      });
    } else {
      console.log(`❌ ${result.error || result.status}`);
    }

    await delay(1000);
  }

  console.log('\n✅ Test complete!\n');
}

runTest().catch(error => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});

