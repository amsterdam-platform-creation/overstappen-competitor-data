const axios = require('axios');
const cheerio = require('cheerio');
const { delay } = require('./../utils');

/**
 * NOTE: Archived. Replaced by cashbackxl-scraper-v2.js
 * This original scraper is kept for reference only.
 */
async function scrapeCashbackXLProvider(providerSlug, category, providerName = null) {
  const url = `https://www.cashbackxl.nl/webshops/${providerSlug}`;

  try {
    console.log(`Scraping: ${url}`);

    // Fetch HTML
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'nl-NL,nl;q=0.9,en;q=0.8'
      },
      timeout: 15000
    });

    const $ = cheerio.load(response.data);
    const deals = [];

    // Pattern 1: look for euro amounts anywhere in the body
    $('body').find('*').each((i, elem) => {
      const text = $(elem).text();
      const amountMatches = text.match(/€\s*(\d+(?:[,.]\d{2})?)/g);
      if (amountMatches && amountMatches.length > 0) {
        const parent = $(elem).parent();
        let dealDescription = parent.text().trim().replace(/\s+/g, ' ').substring(0, 200);
        if (dealDescription.length > 10 && dealDescription.length < 500) {
          amountMatches.forEach(amount => {
            deals.push({
              provider: providerName || providerSlug,
              deal_description: dealDescription,
              cashback_amount: amount.trim(),
              category: category,
              source_url: url,
              scraped_at: new Date().toISOString()
            });
          });
        }
      }
    });

    // Pattern 2: structured deal cards
    ['.deal', '.offer', '.webshop-deal', '[class*="deal"]', '[class*="offer"]'].forEach(selector => {
      $(selector).each((i, elem) => {
        const dealText = $(elem).text().trim();
        const amountMatch = dealText.match(/€\s*(\d+(?:[,.]\d{2})?)/);
        if (amountMatch) {
          deals.push({
            provider: providerName || providerSlug,
            deal_description: dealText.replace(/\s+/g, ' ').substring(0, 200),
            cashback_amount: amountMatch[0],
            category: category,
            source_url: url,
            scraped_at: new Date().toISOString()
          });
        }
      });
    });

    // Dedup
    const uniqueDeals = [];
    const seen = new Set();
    deals.forEach(deal => {
      const key = `${deal.deal_description}:${deal.cashback_amount}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueDeals.push(deal);
      }
    });

    return {
      status: 'success',
      deals: uniqueDeals,
      url: url
    };
  } catch (error) {
    if (error.response?.status === 404) {
      return { status: 'not_found', error: '404', url, deals: [] };
    }
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      return { status: 'timeout', error: 'Request timed out', url, deals: [] };
    }
    return { status: 'error', error: error.message, url, deals: [] };
  }
}

async function scrapeMultipleProviders(providers, delayMs = 500) {
  const results = [];
  for (const provider of providers) {
    const result = await scrapeCashbackXLProvider(
      provider.slug,
      provider.category,
      provider.name
    );
    results.push(result);
    if (delayMs > 0) {
      await delay(delayMs);
    }
  }
  return results;
}

module.exports = {
  scrapeCashbackXLProvider,
  scrapeMultipleProviders
};


