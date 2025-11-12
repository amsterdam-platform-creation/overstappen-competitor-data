const fs = require('fs');
const path = require('path');
const { format } = require('date-fns');
const slugify = require('slugify');

/**
 * Provider slug overrides for special cases
 */
const SLUG_OVERRIDES = {
  'United Consumers': 'unitedconsumers',
  // Add more overrides as needed
};

/**
 * Generate a URL-friendly slug from provider name
 */
function generateProviderSlug(providerName) {
  // Check for override first
  if (SLUG_OVERRIDES[providerName]) {
    return SLUG_OVERRIDES[providerName];
  }
  
  return slugify(providerName, {
    lower: true,
    strict: true,
    locale: 'nl'
  }).replace(/\s+/g, '-');
}

/**
 * Ensure directory exists, create if not
 */
function ensureDirectoryExists(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Get today's date folder path
 */
function getTodayFolderPath() {
  const today = format(new Date(), 'yyyy-MM-dd');
  const folderPath = path.join(__dirname, '../../output/history', today);
  ensureDirectoryExists(folderPath);
  return folderPath;
}

/**
 * Write CSV file
 */
function writeCSV(filePath, headers, rows) {
  const createCsvWriter = require('csv-writer').createObjectCsvWriter;

  const csvWriter = createCsvWriter({
    path: filePath,
    header: headers.map(h => ({ id: h, title: h }))
  });

  return csvWriter.writeRecords(rows);
}

/**
 * Write JSON file
 */
function writeJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Read CSV file
 */
async function readCSV(filePath) {
  return new Promise((resolve, reject) => {
    const csv = require('csv-parser');
    const results = [];

    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (data) => results.push(data))
      .on('end', () => resolve(results))
      .on('error', (error) => reject(error));
  });
}

/**
 * Delay execution (for rate limiting)
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Extract providers from Woolsocks CSV files
 */
async function extractProvidersFromCSV(category) {
  const csvFiles = {
    energy: 'Input/woolsocks-big-data.Overstappen.energy_offers.csv',
    car: 'Input/woolsocks-big-data.Overstappen.car_insurance_offers.csv',
    health: 'Input/woolsocks-big-data.Overstappen.health_insurance_offers.csv'
  };

  const filePath = path.join(__dirname, '../../', csvFiles[category]);
  const rows = await readCSV(filePath);

  // Extract unique providers
  const providers = [...new Set(rows.map(row => row.provider).filter(p => p))];

  return providers.map(provider => ({
    name: provider,
    slug: generateProviderSlug(provider),
    category: category
  }));
}

module.exports = {
  generateProviderSlug,
  ensureDirectoryExists,
  getTodayFolderPath,
  writeCSV,
  writeJSON,
  readCSV,
  delay,
  extractProvidersFromCSV
};
