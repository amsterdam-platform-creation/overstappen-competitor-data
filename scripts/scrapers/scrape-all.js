#!/usr/bin/env node

/**
 * Main scraper orchestrator - runs both Track 1 and Track 2
 * Usage: node scripts/scrapers/scrape-all.js
 */

const { exec } = require('child_process');
const path = require('path');
const util = require('util');

const execPromise = util.promisify(exec);

async function runCommand(command, description) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🚀 ${description}`);
  console.log(`${'='.repeat(60)}\n`);

  const startTime = Date.now();

  try {
    const { stdout, stderr } = await execPromise(command, {
      cwd: path.join(__dirname, '../../'),
      maxBuffer: 10 * 1024 * 1024 // 10MB buffer
    });

    if (stdout) console.log(stdout);
    if (stderr) console.error(stderr);

    const duration = Math.round((Date.now() - startTime) / 1000);
    console.log(`\n✅ ${description} completed in ${duration} seconds`);

    return { success: true, duration };
  } catch (error) {
    console.error(`\n❌ ${description} failed:`, error.message);
    return { success: false, error: error.message };
  }
}

async function scrapeAll() {
  console.log('\n' + '='.repeat(60));
  console.log('🎯 FULL CASHBACK RATE SCRAPER');
  console.log('='.repeat(60));
  console.log('\nThis will scrape:');
  console.log('  Track 1: All provider-specific deals (~78 providers)');
  console.log('  Track 2: All comparison site deals (~8 sites)');
  console.log('\nEstimated total time: 2-3 minutes\n');

  const startTime = Date.now();

  // Track 1: Provider-specific deals
  const track1Result = await runCommand(
    'node scripts/scrapers/scrape-providers.js',
    'Track 1: Scraping Provider-Specific Deals'
  );

  // Track 2: Comparison sites
  const track2Result = await runCommand(
    'node scripts/scrapers/scrape-comparison-sites.js',
    'Track 2: Scraping Comparison Site Deals'
  );

  // Final summary
  const totalDuration = Math.round((Date.now() - startTime) / 1000);

  console.log('\n\n' + '='.repeat(60));
  console.log('🎉 ALL SCRAPING COMPLETE');
  console.log('='.repeat(60));
  console.log(`\n⏱️  Total duration: ${totalDuration} seconds`);
  console.log(`\n📊 Results:`);
  console.log(`   Track 1 (Providers): ${track1Result.success ? '✅ Success' : '❌ Failed'}`);
  console.log(`   Track 2 (Comparison Sites): ${track2Result.success ? '✅ Success' : '❌ Failed'}`);

  console.log(`\n💾 Output files saved to:`);
  console.log(`   output/history/[today]/cashbackxl-providers-raw.csv`);
  console.log(`   output/history/[today]/cashbackxl-comparison-sites-raw.csv`);
  console.log(`   output/history/[today]/scrape-log-*.json`);

  console.log('\n📋 Next steps:');
  console.log('   1. Review the CSV files to verify data quality');
  console.log('   2. Run comparison script: npm run compare (coming soon)');
  console.log('   3. Review unmapped deals and update mapping rules\n');

  if (!track1Result.success || !track2Result.success) {
    console.error('⚠️  Some scraping tasks failed. Check logs above for details.\n');
    process.exit(1);
  }

  console.log('✅ All done!\n');
}

// Run main scraper
scrapeAll().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
