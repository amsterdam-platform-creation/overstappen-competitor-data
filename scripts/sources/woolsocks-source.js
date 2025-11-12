#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { format } = require('date-fns');
const {
  ensureDirectoryExists,
  getTodayFolderPath,
  writeCSV,
  writeJSON,
  readCSV,
  extractProvidersFromCSV,
} = require('../scrapers/utils');
const {
  searchMerchantsByName,
  getDealsForMerchant,
  getCashbackRewards,
  toRate,
  classifyDealType,
  extractObMerchantIdFromImageUrl,
} = require('../api/woolsocks-client');

/**
 * CLI:
 *  node scripts/sources/woolsocks-source.js --vertical energy|car|health|all
 *
 * Outputs (per run date folder):
 *  - woolsocks-raw.json
 *  - woolsocks-normalized.csv
 */

const VALID_VERTICALS = new Set(['energy', 'car', 'health', 'all']);

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { vertical: 'all' };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if ((a === '--vertical' || a === '-v') && args[i + 1]) {
      out.vertical = String(args[i + 1]).toLowerCase();
      i++;
    }
  }
  if (!VALID_VERTICALS.has(out.vertical)) {
    console.log(`Unknown --vertical ${out.vertical}. Use one of: energy|car|health|all. Defaulting to 'all'.`);
    out.vertical = 'all';
  }
  return out;
}

function loadCompetitorsConfig() {
  const fp = path.join(__dirname, '../config/competitors.json');
  const raw = fs.readFileSync(fp, 'utf-8');
  return JSON.parse(raw);
}

function uniqueBy(list, keyFn) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const key = keyFn(item);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

async function buildTargets(vertical) {
  const targets = [];

  // Providers from Input CSVs
  if (vertical === 'all' || vertical === 'energy') {
    const providers = await extractProvidersFromCSV('energy').catch(() => []);
    for (const p of providers) {
      targets.push({ vertical: 'energy', entityType: 'provider', name: p.name });
    }
  }
  if (vertical === 'all' || vertical === 'car') {
    const providers = await extractProvidersFromCSV('car').catch(() => []);
    for (const p of providers) {
      targets.push({ vertical: 'car', entityType: 'provider', name: p.name });
    }
  }
  if (vertical === 'all' || vertical === 'health') {
    const providers = await extractProvidersFromCSV('health').catch(() => []);
    for (const p of providers) {
      targets.push({ vertical: 'health', entityType: 'provider', name: p.name });
    }
  }

  // Comparison sites from config
  const competitors = loadCompetitorsConfig();
  const cs = competitors?.comparison_sites || {};
  for (const [cat, arr] of Object.entries(cs)) {
    if (vertical !== 'all' && vertical !== cat) continue;
    for (const c of arr || []) {
      if (!c?.name) continue;
      targets.push({ vertical: cat, entityType: 'comparison_site', name: c.name });
    }
  }

  // Dedup by vertical + entityType + name (case-insensitive)
  return uniqueBy(targets, (t) => `${t.vertical}::${t.entityType}::${String(t.name || '').toLowerCase()}`);
}

function cleanDomain(input) {
  if (!input) return '';
  try {
    let h = String(input).trim();
    if (!/^https?:\/\//i.test(h)) h = `https://${h}`;
    const u = new URL(h);
    return (u.hostname || '').replace(/^www\./i, '').toLowerCase();
  } catch {
    return String(input).replace(/^www\./i, '').toLowerCase();
  }
}

function tokenizeName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(Boolean);
}

const COMPARISON_MARKERS = ['gaslicht', 'overstappen', 'independer', 'zorgkiezer'];

function looksLikeComparisonSite(merchant) {
  const nm = String(merchant?.name || '').toLowerCase();
  const dom = cleanDomain(merchant?.websiteUrl || merchant?.data?.websiteUrl || '');
  return COMPARISON_MARKERS.some(m => nm.includes(m) || dom.includes(m));
}

function pickBestMerchantForTarget(target, merchants) {
  if (!Array.isArray(merchants) || merchants.length === 0) return null;
  const tTokens = tokenizeName(target.name);
  const scored = merchants.map((m) => {
    const name = String(m?.name || '').toLowerCase();
    const dom = cleanDomain(m?.websiteUrl);
    let score = 0;
    if (target.entityType === 'provider' && looksLikeComparisonSite(m)) {
      score -= 1000;
    }
    for (const tok of tTokens) {
      if (tok.length >= 3) {
        if (name.includes(tok)) score += 50;
        if (dom.includes(tok)) score += 80;
      }
    }
    if (name.startsWith(String(target.name).toLowerCase())) score += 30;
    const val = Number(m?.cashbackAmount?.amount?.value || 0);
    if (val > 0) score += 5;
    return { m, score, nameLen: name.length };
  });
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.nameLen - b.nameLen;
  });
  // Prefer positive scores; if none and provider target, skip to avoid wrong mapping
  const positive = scored.filter(s => s.score > 0);
  if (positive.length) return positive[0].m || null;
  if (target.entityType === 'provider') return null;
  return scored[0].m || null;
}

function normalizeOffer({
  source,
  vertical,
  entityType,
  entityNameCanonical,
  entityOriginal,
  offerType,
  amount,
  currency,
  description,
  conditions,
  url,
}) {
  return {
    source,
    vertical,
    entity_type: entityType,
    entity_name_canonical: entityNameCanonical,
    entity_original: entityOriginal,
    offer_type: offerType,
    amount,
    currency,
    description,
    conditions,
    url,
    last_seen_at: new Date().toISOString(),
  };
}

async function fetchWoolsocksDealsForName(name, country = 'NL') {
  // 1) Search merchants
  const merchants = await searchMerchantsByName(name, country);
  if (!merchants || merchants.length === 0) return { merchant: null, deals: [], rewards: [], providerMerchantId: null };

  // Pick the first merchant (browser extension does candidate ranking; we keep simple here since we don't know domains)
  const merchant = merchants[0];

  // 2) Fetch deals (v2)
  const deals = await getDealsForMerchant(merchant.id, country);
  const onlineCashbackDeals = (deals || []).filter(d => classifyDealType(d?.dealType) === 'ONLINE_CASHBACK');

  // 3) Try to resolve providerMerchantId to fetch rewards (rich OC rewards include rewardId)
  let providerMerchantId = null;
  for (const d of onlineCashbackDeals) {
    if (d && d.providerMerchantId) { providerMerchantId = String(d.providerMerchantId); break; }
    const fromImg = extractObMerchantIdFromImageUrl(d && d.imageUrl);
    if (fromImg) { providerMerchantId = fromImg; break; }
  }

  let rewards = [];
  if (providerMerchantId) {
    const r = await getCashbackRewards(providerMerchantId, 'nl');
    rewards = Array.isArray(r?.rewards) ? r.rewards : [];
  }

  return { merchant, deals, rewards, providerMerchantId };
}

async function fetchWoolsocksDealsForMerchant(merchant, country = 'NL') {
  if (!merchant || !merchant.id) return { merchant: null, deals: [], rewards: [], providerMerchantId: null };
  const deals = await getDealsForMerchant(merchant.id, country);
  const onlineCashbackDeals = (deals || []).filter(d => classifyDealType(d?.dealType) === 'ONLINE_CASHBACK');
  let providerMerchantId = null;
  for (const d of onlineCashbackDeals) {
    if (d && d.providerMerchantId) { providerMerchantId = String(d.providerMerchantId); break; }
    const fromImg = extractObMerchantIdFromImageUrl(d && d.imageUrl);
    if (fromImg) { providerMerchantId = fromImg; break; }
  }
  let rewards = [];
  if (providerMerchantId) {
    const r = await getCashbackRewards(providerMerchantId, 'nl');
    rewards = Array.isArray(r?.rewards) ? r.rewards : [];
  }
  return { merchant, deals, rewards, providerMerchantId };
}

async function run() {
  const { vertical } = parseArgs();
  const targets = await buildTargets(vertical);
  const todayFolder = getTodayFolderPath();
  const rawOutPath = path.join(todayFolder, 'woolsocks-raw.json');
  const normOutPath = path.join(todayFolder, 'woolsocks-normalized.csv');

  const rawItems = [];
  const normalizedRows = [];

  for (const t of targets) {
    try {
      // search and re-rank against target to avoid comparison-site mismatches
      const searched = await searchMerchantsByName(t.name, 'NL');
      let chosen = pickBestMerchantForTarget(t, searched);
      if (!chosen && searched && searched.length && t.entityType === 'comparison_site') chosen = searched[0];
      if (!chosen) {
        rawItems.push({ target: t, error: 'no_merchant_found' });
        continue;
      }
      const { merchant, deals, rewards, providerMerchantId } = await fetchWoolsocksDealsForMerchant(chosen, 'NL');
      rawItems.push({
        target: t,
        merchant,
        deals,
        rewards,
        providerMerchantId,
      });

      // Prefer rewards (they provide clear amountType and rate)
      if (Array.isArray(rewards) && rewards.length) {
        for (const r of rewards) {
          const isPercent = String((r?.cashbackType || '')).toLowerCase() === 'percent';
          const amount = typeof r?.cashBack === 'number' ? r.cashBack : 0;
          const currency = r?.currencyCode || 'EUR';
          const desc = (r?.title || '').toString();
          normalizedRows.push(
            normalizeOffer({
              source: 'woolsocks',
              vertical: t.vertical,
              entityType: t.entityType,
              entityNameCanonical: t.name,
              entityOriginal: merchant?.name || t.name,
              offerType: isPercent ? 'percent' : 'fixed_amount',
              amount,
              currency,
              description: desc,
              conditions: '',
              url: merchant?.websiteUrl || '',
            })
          );
        }
        continue;
      }

      // Fallback: map online cashback deals directly
      const ocDeals = (deals || []).filter(d => classifyDealType(d?.dealType) === 'ONLINE_CASHBACK');
      for (const d of ocDeals) {
        const amount = toRate(d?.amount, d?.amountType || '');
        const amountType = String(d?.amountType || '').toUpperCase() === 'PERCENTAGE' ? 'percent' : 'fixed_amount';
        const currency = (d?.amount && d.amount.currency) || 'EUR';
        const desc = (d?.title || d?.description || (Array.isArray(d?.siteContents) && d.siteContents[0]) || '').toString();
        normalizedRows.push(
          normalizeOffer({
            source: 'woolsocks',
            vertical: t.vertical,
            entityType: t.entityType,
            entityNameCanonical: t.name,
            entityOriginal: (merchant && merchant.name) || t.name,
            offerType: amountType,
            amount,
            currency,
            description: desc,
            conditions: Array.isArray(d?.siteContents) ? d.siteContents.join(' | ') : '',
            url: (merchant && merchant.websiteUrl) || '',
          })
        );
      }
    } catch (e) {
      rawItems.push({ target: t, error: String(e && e.message ? e.message : e) });
    }
  }

  // Ensure folder exists and write outputs
  ensureDirectoryExists(todayFolder);
  writeJSON(rawOutPath, rawItems);

  const headers = [
    'source',
    'vertical',
    'entity_type',
    'entity_name_canonical',
    'entity_original',
    'offer_type',
    'amount',
    'currency',
    'description',
    'conditions',
    'url',
    'last_seen_at',
  ];
  await writeCSV(normOutPath, headers, normalizedRows);

  console.log(`Woolsocks API fetch done. Raw: ${rawOutPath}, Normalized: ${normOutPath}, Targets: ${targets.length}, Rows: ${normalizedRows.length}`);
}

if (require.main === module) {
  run().catch((err) => {
    console.error('Woolsocks fetch failed:', err);
    process.exit(1);
  });
}


