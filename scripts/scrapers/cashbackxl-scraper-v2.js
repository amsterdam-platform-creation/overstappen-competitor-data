const axios = require('axios');
const cheerio = require('cheerio');
const { delay } = require('./utils');

/**
 * Fetch URL with retry and exponential backoff.
 * Retries on 429, 503 and common transient network errors.
 */
async function getWithRetry(url, axiosOptions, maxRetries = 3, baseDelayMs = 1000) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await axios.get(url, axiosOptions);
    } catch (error) {
      const status = error.response?.status;
      const isRetryableStatus = status === 429 || status === 503 || status === 502 || status === 504;
      const isRetryableNetwork =
        error.code === 'ECONNABORTED' ||
        error.code === 'ETIMEDOUT' ||
        error.code === 'ECONNRESET' ||
        error.code === 'ENOTFOUND';

      if ((isRetryableStatus || isRetryableNetwork) && attempt < maxRetries) {
        // Honor Retry-After header if present
        const retryAfterHeader = error.response?.headers?.['retry-after'];
        let waitMs = retryAfterHeader ? parseFloat(retryAfterHeader) * 1000 : baseDelayMs * Math.pow(2, attempt);
        // add jitter (+/- 200ms)
        const jitter = Math.floor(Math.random() * 400) - 200;
        waitMs = Math.max(500, waitMs + jitter);
        await delay(waitMs);
        continue;
      }
      throw error;
    }
  }
}

/**
 * Convert points to euros (points = eurocents, so divide by 100)
 * Handles Dutch number format where periods are thousands separators
 */
function convertPointsToEuros(pointsText) {
  // Extract numeric value from points text (e.g., "11.433 ptn." -> 11433)
  // In Dutch: "8.000" = 8000 (period is thousands separator)
  const pointsMatch = pointsText.match(/(\d{1,3}(?:\.\d{3})*(?:,\d+)?)\s*(?:ptn|punten)/i);
  if (pointsMatch) {
    // Remove thousands separators (periods), keep decimal comma
    let pointsStr = pointsMatch[1].replace(/\./g, '').replace(',', '.');
    const points = parseFloat(pointsStr);
    const euros = points / 100; // Points = eurocents
    return `€${euros.toFixed(2)}`;
  }
  return null;
}

// Remove any explicit amount token from description and tidy whitespace/punctuation
function cleanDescription(desc, amountToken) {
  try {
    let d = String(desc || '');
    if (amountToken) {
      const amt = String(amountToken).replace(/\s+/g, '');
      // Remove exact token and common spaced variants
      const rx = new RegExp(String(amountToken).replace(/([.*+?^${}()|[\]\\])/g, '\\$1'), 'gi');
      d = d.replace(rx, ' ');
      const rxNoSpace = new RegExp(amt.replace(/([.*+?^${}()|[\]\\])/g, '\\$1'), 'gi');
      d = d.replace(rxNoSpace, ' ');
    }
    // Collapse multiple spaces and trim separators
    d = d.replace(/\s+/g, ' ').replace(/^[:;,.\-\s]+|[:;,.\-\s]+$/g, '').trim();
    return d;
  } catch {
    return desc;
  }
}

/**
 * Check if page uses points system (FBTO style)
 */
function isPointsSystem($) {
  const pageText = $('body').text().toLowerCase();
  return pageText.includes('ptn.') || pageText.includes('punten') || 
         pageText.includes('1 punt vertegenwoordigt');
}

/**
 * Check if deals are actually available (not just generic placeholder content)
 */
function hasRealDeals($, deals) {
  // If no deals found, definitely not available
  if (deals.length === 0) {
    return false;
  }

  // Keywords that indicate a real deal even if description is short
  const SPECIFIC_KEYWORDS = [
    /zorgverzekering/i, /autoverzekering/i, /energiecontract/i,
    /stroom|elektriciteit|gas|energie/i, /contract/i, /verleng/i
  ];

  // If we found deals with specific descriptions (not just "max cashback"), it's real
  const hasSpecificDeals = deals.some(deal => {
    const desc = deal.deal_description.toLowerCase();
    const isGeneric = desc.includes('max. cashback') || desc.includes('max cashback');
    const hasKeyword = SPECIFIC_KEYWORDS.some(rx => rx.test(desc));
    // Allow if: (has keyword OR length >= 15) AND not generic
    return !isGeneric && (hasKeyword || desc.length >= 15);
  });

  // Also check if page has "Cashback overzicht" section with actual content
  const hasOverview = $('h2:contains("Cashback overzicht"), h3:contains("Cashback overzicht")').length > 0;
  
  // If we have specific deals OR (overview section AND at least one deal), it's real
  // Allow single deal if it's from overview section (might be the only deal type)
  return hasSpecificDeals || (hasOverview && deals.length >= 1);
}

/**
 * Scrape a single CashbackXL provider page (refined version)
 * Returns raw deal data without interpretation
 */
async function scrapeCashbackXLProvider(providerSlug, category, providerName = null) {
  const url = `https://www.cashbackxl.nl/webshops/${providerSlug}`;

  try {
    console.log(`Scraping: ${url}`);

    // Fetch HTML
    const response = await getWithRetry(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'nl-NL,nl;q=0.9,en;q=0.8'
      },
      timeout: 15000
    }, 3, 1200);

    // Detect redirect to the generic webshops index (page doesn't exist)
    // Axios (follow-redirects) exposes the final URL via response.request.res.responseUrl
    const finalUrl = response?.request?.res?.responseUrl || url;
    const redirectedToIndex = /\/webshops\/?$/.test(finalUrl) && !new RegExp(`/webshops/${providerSlug}(?:/|$)`).test(finalUrl);
    if (redirectedToIndex) {
      return {
        status: 'not_found',
        error: 'Redirected to webshops index - provider page does not exist',
        url: finalUrl,
        deals: []
      };
    }

    const $ = cheerio.load(response.data);
    const deals = [];
    const usesPoints = isPointsSystem($);

    // Strategy 0: OHRA-style column cashbacks box
    // Structure:
    // #webshop-detail-columns > .column.column33 > .border-box.cashbacks
    //   .row.row-header > h2
    //   .row > <span>€amount</span> Description text
    const cashbacksBox = $('#webshop-detail-columns .column.column33 .border-box.cashbacks');
    if (cashbacksBox.length) {
      cashbacksBox.find('.row').not('.row-header').each((i, row) => {
        const $row = $(row);
        const amountRaw = $row.find('span').first().text().replace(/\s+/g, ' ').trim();
        // Description is the remaining text when removing the span
        const desc = $row
          .clone()
          .children('span')
          .remove()
          .end()
          .text()
          .replace(/\s+/g, ' ')
          .trim();

        if (/€\s*\d+/.test(amountRaw) && desc.length > 0) {
          deals.push({
            provider: providerName || providerSlug,
            deal_description: cleanDescription(desc, amountRaw),
            cashback_amount: amountRaw,
            category: category,
            source_url: url,
            scraped_at: new Date().toISOString(),
            confidence: 'high'
          });
        }
      });
    }

    // Strategy 1: Robust "Cashback overzicht" parsing
    // On some pages the list/table sits in siblings after the heading; include them
    const overviewHeading = $('h2:contains("Cashback overzicht"), h3:contains("Cashback overzicht")').first();
    if (overviewHeading.length > 0) {
      const overviewBlocks = [];
      const added = new Set();
      function addBlock($el) {
        if (!$el || $el.length === 0) return;
        const key = $el.get(0);
        if (!added.has(key)) {
          added.add(key);
          overviewBlocks.push($el);
        }
      }
      // Primary container around the heading
      const primary = overviewHeading.closest('section, .content, .container, .wrapper, .columns, .row, .grid, div');
      if (primary.length) overviewBlocks.push(primary);
      // also traverse following siblings until next major section heading
      overviewHeading.parent().nextAll().each((i, el) => {
        const $el = $(el);
        if ($el.find('h2, h3').length) return false;
        addBlock($el);
      });
      // include heading's own next siblings (sometimes the list is directly after h2/h3)
      overviewHeading.nextAll().each((i, el) => {
        const $el = $(el);
        if ($el.is('h2, h3')) return false;
        addBlock($el);
      });
      // include siblings of primary container (columns layout)
      if (primary.length) {
        primary.siblings().each((i, el) => {
          const $el = $(el);
          // skip if it contains another main heading
          if ($el.find('h2, h3').length) return;
          // prefer blocks that appear to hold rows (lists/tables)
          if ($el.find('li, tr, dl, dd, dt, .row, p').length >= 2) {
            addBlock($el);
          }
        });
      }
      // include grandparent siblings (some pages nest heading deep in a column)
      const grand = overviewHeading.parent().parent();
      if (grand.length) {
        grand.siblings().each((i, el) => {
          const $el = $(el);
          if ($el.find('h2, h3').length) return;
          if ($el.find('li, tr, dl, dd, dt, .row, p').length >= 2) {
            addBlock($el);
          }
        });
      }

      // Look for list items (li), table rows (tr), or divs with deal information
      // Each deal typically has: description + amount
      $(overviewBlocks).each((_, $block) => {
        $block.find('li, tr, dd, dt, .row, p, div').each((i, elem) => {
        const text = $(elem).text().trim();
        
        // Skip if it's just the heading or empty
        if (text.length < 5 || text.toLowerCase().includes('cashback overzicht')) {
          return;
        }

        let amount = null;
        let description = text;

        if (usesPoints) {
          // Handle points system (FBTO)
          // In Dutch, periods are thousands separators: "8.000" = 8000, not 8.000
          const pointsMatch = text.match(/(\d{1,3}(?:\.\d{3})*(?:,\d+)?)\s*(?:ptn|punten)/i);
          if (pointsMatch) {
            // Remove thousands separators (periods), keep decimal comma
            let pointsStr = pointsMatch[1].replace(/\./g, '').replace(',', '.');
            const points = parseFloat(pointsStr);
            const euros = points / 100; // Points = eurocents
            amount = `€${euros.toFixed(2)}`;
            description = text.replace(/\d{1,3}(?:\.\d{3})*(?:,\d+)?\s*(?:ptn|punten)/i, amount).trim();
          }
        } else {
          // Handle euro amounts
          const amountMatch = text.match(/€\s*(\d+(?:[,.]\d{2})?)/);
          if (amountMatch) {
            amount = amountMatch[0];
          }
        }

        if (amount && description.length > 0) {
          const descClean = cleanDescription(description, amount);
          deals.push({
            provider: providerName || providerSlug,
            deal_description: descClean.replace(/\s+/g, ' ').substring(0, 200),
            cashback_amount: amount,
            category: category,
            source_url: url,
            scraped_at: new Date().toISOString(),
            confidence: 'high'
          });
        }
        });
      });

      // Also check for direct text patterns in the overview section
      // Sometimes deals are in plain text format: "Stroom & Gas: €45.00"
      // Look for patterns like "Description: €Amount" or "Description €Amount"
      const overviewText = $(overviewBlocks).text();
      const lines = overviewText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
      
      // Also check the overview heading's parent/siblings directly for points patterns
      // Some pages have the deal text directly after the heading
      if (usesPoints && overviewHeading.length) {
        // Check next siblings of the heading's parent
        const headingParent = overviewHeading.parent();
        headingParent.nextAll().each((i, el) => {
          const $el = $(el);
          const text = $el.text().trim();
          const pointsMatch = text.match(/(\d{1,3}(?:\.\d{3})*(?:,\d+)?)\s*(?:ptn|punten)/i);
          if (pointsMatch && text.length < 200 && !text.includes('Recente transacties')) {
            let pointsStr = pointsMatch[1].replace(/\./g, '').replace(',', '.');
            const points = parseFloat(pointsStr);
            const euros = points / 100;
            const amount = `€${euros.toFixed(2)}`;
            const descClean = cleanDescription(text, amount);
            if (descClean.length > 0) {
              deals.push({
                provider: providerName || providerSlug,
                deal_description: descClean.replace(/\s+/g, ' ').substring(0, 200),
                cashback_amount: amount,
                category: category,
                source_url: url,
                scraped_at: new Date().toISOString(),
                confidence: 'high'
              });
            }
          }
        });
        
        // Also check the heading's own next siblings (sometimes the content is directly after h2/h3)
        overviewHeading.nextAll().each((i, el) => {
          const $el = $(el);
          const text = $el.text().trim();
          const pointsMatch = text.match(/(\d{1,3}(?:\.\d{3})*(?:,\d+)?)\s*(?:ptn|punten)/i);
          if (pointsMatch && text.length < 200 && !text.includes('Recente transacties') && !text.includes('Cashback overzicht')) {
            let pointsStr = pointsMatch[1].replace(/\./g, '').replace(',', '.');
            const points = parseFloat(pointsStr);
            const euros = points / 100;
            const amount = `€${euros.toFixed(2)}`;
            const descClean = cleanDescription(text, amount);
            if (descClean.length > 0) {
              deals.push({
                provider: providerName || providerSlug,
                deal_description: descClean.replace(/\s+/g, ' ').substring(0, 200),
                cashback_amount: amount,
                category: category,
                source_url: url,
                scraped_at: new Date().toISOString(),
                confidence: 'high'
              });
            }
          }
        });
        
        // Also check the entire section containing the heading for any points patterns
        const headingSection = overviewHeading.closest('section, div, article, .content, .container');
        if (headingSection.length) {
          const sectionText = headingSection.text();
          const pointsMatches = sectionText.match(/(\d{1,3}(?:\.\d{3})*(?:,\d+)?)\s*(?:ptn|punten)\s*([^\n]{0,100})/gi);
          if (pointsMatches) {
            pointsMatches.forEach(match => {
              const pointsMatch = match.match(/(\d{1,3}(?:\.\d{3})*(?:,\d+)?)\s*(?:ptn|punten)/i);
              if (pointsMatch && !match.includes('Recente transacties') && !match.includes('Datum Orderwaarde')) {
                let pointsStr = pointsMatch[1].replace(/\./g, '').replace(',', '.');
                const points = parseFloat(pointsStr);
                const euros = points / 100;
                const amount = `€${euros.toFixed(2)}`;
                const descClean = cleanDescription(match, amount);
                if (descClean.length > 0 && descClean.length < 150) {
                  deals.push({
                    provider: providerName || providerSlug,
                    deal_description: descClean.replace(/\s+/g, ' ').substring(0, 200),
                    cashback_amount: amount,
                    category: category,
                    source_url: url,
                    scraped_at: new Date().toISOString(),
                    confidence: 'high'
                  });
                }
              }
            });
          }
        }
      }
      
      lines.forEach(line => {
        if (line.toLowerCase().includes('cashback overzicht')) return;
        if (line.length < 5) return;
        
        let amount = null;
        let description = line;

        if (usesPoints) {
          // In Dutch, periods are thousands separators: "8.000" = 8000
          const pointsMatch = line.match(/(\d{1,3}(?:\.\d{3})*(?:,\d+)?)\s*(?:ptn|punten)/i);
          if (pointsMatch) {
            let pointsStr = pointsMatch[1].replace(/\./g, '').replace(',', '.');
            const points = parseFloat(pointsStr);
            const euros = points / 100; // Points = eurocents
            amount = `€${euros.toFixed(2)}`;
          }
        } else {
          // Try multiple patterns: "€45.00", "€ 45.00", "45.00", etc.
          const amountMatch = line.match(/€\s*(\d+(?:[,.]\d{2})?)/);
          if (amountMatch) {
            amount = amountMatch[0];
          } else {
            // Try pattern without € symbol at start (might be in middle: "Stroom & Gas: €45.00")
            const amountMatch2 = line.match(/(?:[:]|&|en|of)\s*€\s*(\d+(?:[,.]\d{2})?)/i);
            if (amountMatch2) {
              amount = `€${amountMatch2[1]}`;
            }
          }
        }

        // Extract description - remove the amount from it for cleaner description
        if (amount) {
          description = line.replace(amount, '').replace(/^[:]\s*/, '').trim();
          // If description is empty or too short, use the full line
          if (description.length < 3) {
            description = line;
          }
        }

        if (amount && line.length > 5 && !line.includes('Recente transacties')) {
          const descClean = cleanDescription(description, amount);
          deals.push({
            provider: providerName || providerSlug,
            deal_description: descClean.replace(/\s+/g, ' ').substring(0, 200),
            cashback_amount: amount,
            category: category,
            source_url: url,
            scraped_at: new Date().toISOString(),
            confidence: 'high'
          });
        }
      });

      // Also look for structured patterns like "Stroom & Gas" followed by amount
      // This handles cases where description and amount are in separate elements
      $(overviewBlocks).each((_, $block) => {
        $block.find('*').each((i, elem) => {
          const text = $(elem).text().trim();
          // Look for energy-related keywords followed by amounts
          if ((text.includes('Stroom') || text.includes('Gas') || text.includes('energie')) && 
              !usesPoints && text.length < 100) {
            const amountMatch = text.match(/€\s*(\d+(?:[,.]\d{2})?)/);
            if (amountMatch && !text.includes('max.') && !text.includes('max ')) {
              const amt = amountMatch[0];
              const descClean = cleanDescription(text, amt);
              deals.push({
                provider: providerName || providerSlug,
                deal_description: descClean.replace(/\s+/g, ' ').substring(0, 200),
                cashback_amount: amt,
                category: category,
                source_url: url,
                scraped_at: new Date().toISOString(),
                confidence: 'high'
              });
            }
          }
        });
      });
    }

    // Strategy 2: Look for points-based deals (FBTO style)
    if (usesPoints) {
      // First try to find deals in elements that contain both points and product keywords
      const productKeywords = /zorgverzekering|autoverzekering|energiecontract|stroom|gas|energie|contract/i;
      $('*').filter(function() {
        const text = $(this).text();
        return /(\d{1,3}(?:\.\d{3})*(?:,\d+)?)\s*(?:ptn|punten)/i.test(text) && productKeywords.test(text);
      }).each((i, elem) => {
        const text = $(elem).text().trim();
        // In Dutch, periods are thousands separators: "8.000" = 8000
        const pointsMatch = text.match(/(\d{1,3}(?:\.\d{3})*(?:,\d+)?)\s*(?:ptn|punten)/i);
        
        if (pointsMatch && 
            !text.includes('Recente transacties') &&
            !text.includes('Datum Orderwaarde') &&
            !text.includes('Totaal uitgekeerd') &&
            !text.includes('1 punt vertegenwoordigt') && // Skip explanation text
            text.length < 500) { // Increased limit for comparison sites
          
          // Remove thousands separators (periods), keep decimal comma
          let pointsStr = pointsMatch[1].replace(/\./g, '').replace(',', '.');
          const points = parseFloat(pointsStr);
          const euros = points / 100; // Points = eurocents
          const amount = `€${euros.toFixed(2)}`;
          const descClean = cleanDescription(text, amount);
          
          if (descClean.length > 0) {
            deals.push({
              provider: providerName || providerSlug,
              deal_description: descClean.replace(/\s+/g, ' ').substring(0, 200),
              cashback_amount: amount,
              category: category,
              source_url: url,
              scraped_at: new Date().toISOString(),
              confidence: 'high'
            });
          }
        }
      });
      
      // Fallback: also check all elements with points (original logic)
      $('*').filter(function() {
        const text = $(this).text();
        return /(\d{1,3}(?:\.\d{3})*(?:,\d+)?)\s*(?:ptn|punten)/i.test(text);
      }).each((i, elem) => {
        const text = $(elem).text().trim();
        // In Dutch, periods are thousands separators: "8.000" = 8000
        const pointsMatch = text.match(/(\d{1,3}(?:\.\d{3})*(?:,\d+)?)\s*(?:ptn|punten)/i);
        
        if (pointsMatch && 
            !text.includes('Recente transacties') &&
            !text.includes('Datum Orderwaarde') &&
            !text.includes('Totaal uitgekeerd') &&
            !text.includes('1 punt vertegenwoordigt') && // Skip explanation text
            text.length < 300) {
          
          // Remove thousands separators (periods), keep decimal comma
          let pointsStr = pointsMatch[1].replace(/\./g, '').replace(',', '.');
          const points = parseFloat(pointsStr);
          const euros = points / 100; // Points = eurocents
          const amount = `€${euros.toFixed(2)}`;
          const descClean = cleanDescription(text, amount);
          
          if (descClean.length > 0) {
            deals.push({
              provider: providerName || providerSlug,
              deal_description: descClean.replace(/\s+/g, ' ').substring(0, 200),
              cashback_amount: amount,
              category: category,
              source_url: url,
              scraped_at: new Date().toISOString(),
              confidence: 'high'
            });
          }
        }
      });
    }

    // Strategy 3: Look for euro-based deals in structured content
    if (!usesPoints) {
      $('*').filter(function() {
        const text = $(this).text();
        return text.includes('verzekering') || 
               text.includes('contract') || 
               text.includes('jaar vast') ||
               text.includes('verlenging') ||
               text.includes('stroom') ||
               text.includes('gas');
      }).each((i, elem) => {
        const text = $(elem).text().trim();
        const amountMatch = text.match(/€\s*(\d+(?:[,.]\d{2})?)/);

        if (amountMatch &&
            !text.includes('Recente transacties') &&
            !text.includes('Datum Orderwaarde') &&
            !text.includes('Totaal uitgekeerd') &&
            text.length < 300) {

          const amt = amountMatch[0];
          const descClean = cleanDescription(text, amt);
          deals.push({
            provider: providerName || providerSlug,
            deal_description: descClean.replace(/\s+/g, ' ').substring(0, 200),
            cashback_amount: amt,
            category: category,
            source_url: url,
            scraped_at: new Date().toISOString(),
            confidence: 'medium'
          });
        }
      });
    }

    // Strategy 4: Look for hero/banner amounts (fallback)
    // But only if we haven't found specific deals in overview section
    if (deals.length === 0 || !deals.some(d => d.confidence === 'high')) {
      const heroSections = $('.hero, .banner, .main-offer, [class*="hero"], [class*="banner"]');
      heroSections.each((i, elem) => {
        const text = $(elem).text();
        const amounts = text.match(/€\s*(\d+(?:[,.]\d{2})?)/g);

        if (amounts && amounts.length > 0) {
          const mainAmount = amounts[0];
          let description = text.trim().replace(/\s+/g, ' ').substring(0, 150);

          deals.push({
            provider: providerName || providerSlug,
            deal_description: description,
            cashback_amount: mainAmount,
            category: category,
            source_url: url,
            scraped_at: new Date().toISOString(),
            confidence: 'medium'
          });
        }
      });
    }

    // Strategy 5.5: Last resort for points-based pages with "Cashback overzicht"
    // Extract points patterns from the entire page text
    if (usesPoints && overviewHeading.length > 0) {
      const pageText = $('body').text();
      // First try: Look for patterns like "850 ptn. Zorgverzekering" or "2.500 ptn. Zorgverzekering"
      // More flexible: allow description to be on same line or next line, and be shorter
      const pointsPattern = /(\d{1,3}(?:\.\d{3})*(?:,\d+)?)\s*(?:ptn|punten)[.\s]*([A-Za-z][^\n]{0,150})/gi;
      const matches = [...pageText.matchAll(pointsPattern)];
      matches.forEach(match => {
        const fullMatch = match[0];
        if (!fullMatch.includes('Recente transacties') && 
            !fullMatch.includes('Datum Orderwaarde') &&
            !fullMatch.includes('Totaal uitgekeerd') &&
            !fullMatch.includes('1 punt vertegenwoordigt') &&
            !fullMatch.toLowerCase().includes('cashback overzicht')) {
          const pointsMatch = match[1];
          const descPart = (match[2] || '').trim();
          let pointsStr = pointsMatch.replace(/\./g, '').replace(',', '.');
          const points = parseFloat(pointsStr);
          if (isNaN(points) || points <= 0) return;
          const euros = points / 100;
          const amount = `€${euros.toFixed(2)}`;
          // Build description from the match - use descPart if available, otherwise try to extract from fullMatch
          let description = descPart || fullMatch;
          const descClean = cleanDescription(description, amount);
          // Only add if description contains product keywords OR if it's a short specific term
          const hasKeyword = /zorgverzekering|autoverzekering|energie|stroom|gas|contract|verzekering/i.test(descClean);
          if (descClean.length > 0 && (hasKeyword || (descClean.length >= 10 && descClean.length <= 50))) {
            deals.push({
              provider: providerName || providerSlug,
              deal_description: descClean.replace(/\s+/g, ' ').substring(0, 200),
              cashback_amount: amount,
              category: category,
              source_url: url,
              scraped_at: new Date().toISOString(),
              confidence: 'high'
            });
          }
        }
      });
      
      // Second try: Also search for points and then look for nearby keywords
      // This handles cases where points and description are in separate elements/lines
      // Run this even if some deals were found, as they might get filtered out later
      {
        const pointsOnlyPattern = /(\d{1,3}(?:\.\d{3})*(?:,\d+)?)\s*(?:ptn|punten)/gi;
        const pointsMatches = [...pageText.matchAll(pointsOnlyPattern)];
        pointsMatches.forEach(match => {
          const matchIndex = match.index;
          const pointsMatch = match[1];
          const contextStart = Math.max(0, matchIndex - 50);
          const contextEnd = Math.min(pageText.length, matchIndex + match[0].length + 100);
          const context = pageText.substring(contextStart, contextEnd);
          
          if (!context.includes('Recente transacties') && 
              !context.includes('Datum Orderwaarde') &&
              !context.includes('Totaal uitgekeerd') &&
              !context.includes('1 punt vertegenwoordigt')) {
            let pointsStr = pointsMatch.replace(/\./g, '').replace(',', '.');
            const points = parseFloat(pointsStr);
            if (isNaN(points) || points <= 0 || points > 100000) return; // Sanity check
            const euros = points / 100;
            const amount = `€${euros.toFixed(2)}`;
            
            // Look for product keywords in the context
            const keywordMatch = context.match(/(zorgverzekering|autoverzekering|energie|stroom|gas|contract|verzekering)/i);
            if (keywordMatch) {
              // Extract a clean description from context
              let description = context.replace(/\d{1,3}(?:\.\d{3})*(?:,\d+)?\s*(?:ptn|punten)/gi, '').trim();
              // Try to find the keyword and extract surrounding text
              const keywordIndex = description.toLowerCase().indexOf(keywordMatch[0].toLowerCase());
              if (keywordIndex >= 0) {
                const start = Math.max(0, keywordIndex - 20);
                const end = Math.min(description.length, keywordIndex + keywordMatch[0].length + 30);
                description = description.substring(start, end).trim();
              }
              const descClean = cleanDescription(description, amount);
              if (descClean.length > 0 && descClean.length < 100) {
                deals.push({
                  provider: providerName || providerSlug,
                  deal_description: descClean.replace(/\s+/g, ' ').substring(0, 200),
                  cashback_amount: amount,
                  category: category,
                  source_url: url,
                  scraped_at: new Date().toISOString(),
                  confidence: 'high'
                });
              }
            }
          }
        });
      }
    }

    // Strategy 5: Look for "Tot €X.XX" patterns in main headline (Eneco style)
    // This captures deals like "Tot €45.00 Cashback op eneco.nl"
    const mainHeadline = $('h1, h2').first().text();
    const totMatch = mainHeadline.match(/tot\s+€\s*(\d+(?:[,.]\d{2})?)/i);
    if (totMatch && !usesPoints) {
      const amount = `€${totMatch[1]}`;
      // Check if this amount is already captured in a specific deal
      const alreadyCaptured = deals.some(d => 
        d.cashback_amount.replace(/\s/g, '') === amount.replace(/\s/g, '') && 
        d.confidence === 'high'
      );
      
      if (!alreadyCaptured) {
        // Try to find a matching description in overview section
        const overviewText = $('h2:contains("Cashback overzicht"), h3:contains("Cashback overzicht")').parent().text();
        let description = 'Stroom & Gas'; // Default
        
        // Look for "Stroom" patterns in overview
        if (overviewText.includes('Stroom') || overviewText.includes('Gas')) {
          const stroomMatch = overviewText.match(/(Stroom\s*(?:&|én|en)\s*Gas[^€]*)/i);
          if (stroomMatch) {
            description = stroomMatch[1].trim();
          }
        }
        
        deals.push({
          provider: providerName || providerSlug,
          deal_description: description,
          cashback_amount: amount,
          category: category,
          source_url: url,
          scraped_at: new Date().toISOString(),
          confidence: 'high'
        });
      }
    }

    // Deduplicate deals (by amount + description similarity)
    const uniqueDeals = [];
    const seen = new Set();

    deals.forEach(deal => {
      // Create key based on normalized amount and description
      const amountKey = deal.cashback_amount.replace(/\s/g, '').toLowerCase();
      const descKey = deal.deal_description.substring(0, 50).toLowerCase().replace(/\s+/g, ' ');
      const key = `${amountKey}|${descKey}`;
      
      if (!seen.has(key)) {
        seen.add(key);
        uniqueDeals.push(deal);
      }
    });

    // Sort by confidence
    uniqueDeals.sort((a, b) => {
      const confidenceOrder = { 'high': 0, 'medium': 1, 'low': 2 };
      return confidenceOrder[a.confidence] - confidenceOrder[b.confidence];
    });

    // Suppress generic duplicates: if for a given amount we have any specific
    // overview rows, drop the generic hero/amount-only lines for that amount.
    const GENERIC_PATTERNS = [
      /max\.?\s*€|max\s*€/i,
      /^€?\s*\d+(?:[,.]\d{2})?\s*$/i,
      /cashback\s*$/i,
      /altijd de hoogste cashback/i,
      /punten cashback bij/i,
      /^cashback overzicht/i
    ];
    const SPECIFIC_KEYWORDS = [
      // insurance
      /autoverzekering/i, /zorgverzekering/i, /overlijdensrisico/i, /opstal/i, /inboedel/i, /kilometerverzekering/i,
      /huisdierenverzekering/i, /doorlopende\s*reis/i, /caravan/i, /camper/i, /motorverzekering/i,
      /rechtsbijstand/i, /aansprakelijkheidsverzekering/i, /pleziervaartuig/i, /bromfiets/i,
      // energy
      /stroom|elektriciteit|gas|energie/i, /jaar\s*vast/i, /verleng/i, /contract/i,
    ];
    function isGeneric(desc) {
      const d = desc.trim();
      return GENERIC_PATTERNS.some(rx => rx.test(d));
    }
    function isSpecific(desc) {
      return SPECIFIC_KEYWORDS.some(rx => rx.test(desc));
    }
    // Group by normalized amount
    const amountToDeals = new Map();
    uniqueDeals.forEach(d => {
      const amt = d.cashback_amount.replace(/\s/g, '').toLowerCase();
      if (!amountToDeals.has(amt)) amountToDeals.set(amt, []);
      amountToDeals.get(amt).push(d);
    });
    const prunedDeals = [];
    amountToDeals.forEach(group => {
      const hasSpecific = group.some(d => isSpecific(d.deal_description));
      if (!hasSpecific) {
        // keep all if nothing specific (we'll still clean 'max' later)
        prunedDeals.push(...group);
      } else {
        // keep specifics; drop generics for this amount
        group.forEach(d => {
          if (!isGeneric(d.deal_description)) {
            prunedDeals.push(d);
          }
        });
      }
    });

    // Post-filter: drop generic "max" hero amounts if we already captured specific rows
    const hasSpecificForAmount = new Map();
    prunedDeals.forEach(d => {
      const amt = d.cashback_amount.replace(/\s/g, '').toLowerCase();
      const isGeneric = /max\.?\s*€|max\s*€/i.test(d.deal_description);
      if (!isGeneric) hasSpecificForAmount.set(amt, true);
    });
    const cleanedDeals = prunedDeals.filter(d => {
      const amt = d.cashback_amount.replace(/\s/g, '').toLowerCase();
      const isGeneric = /max\.?\s*€|max\s*€/i.test(d.deal_description);
      return !(isGeneric && hasSpecificForAmount.get(amt));
    });

    // Universal rule: only keep deals that include specific product/contract keywords
    const finalDeals = cleanedDeals.filter(d => isSpecific(d.deal_description));

    // Check if deals are actually available
    if (!hasRealDeals($, finalDeals)) {
      return {
        status: 'not_available',
        error: 'Page exists but no real deals found (may be placeholder or unavailable)',
        url: url,
        deals: []
      };
    }

    // If still no deals found after all strategies, return no_deals
    if (finalDeals.length === 0) {
      return {
        status: 'no_deals',
        error: 'No deals found on page',
        url: url,
        deals: []
      };
    }

    return {
      status: 'success',
      deals: finalDeals.slice(0, 30), // Increased limit to capture all deals
      url: url
    };

  } catch (error) {
    if (error.response?.status === 404) {
      return {
        status: 'not_found',
        error: '404 - Provider not available on CashbackXL',
        url: url,
        deals: []
      };
    }

    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      return {
        status: 'timeout',
        error: 'Request timed out',
        url: url,
        deals: []
      };
    }

    return {
      status: 'error',
      error: error.message,
      url: url,
      deals: []
    };
  }
}

/**
 * Scrape multiple providers with rate limiting
 */
async function scrapeMultipleProviders(providers, delayMs = 500) {
  const results = [];

  for (const provider of providers) {
    const result = await scrapeCashbackXLProvider(
      provider.slug,
      provider.category,
      provider.name
    );

    results.push(result);

    // Rate limiting
    if (delayMs > 0) {
      // add small jitter (+/- 250ms)
      const jitter = Math.floor(Math.random() * 500) - 250;
      await delay(Math.max(250, delayMs + jitter));
    }
  }

  return results;
}

module.exports = {
  scrapeCashbackXLProvider,
  scrapeMultipleProviders
};
