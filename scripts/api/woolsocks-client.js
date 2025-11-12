const axios = require('axios');

// Lightweight Node client for public Woolsocks API via the site proxy.
// Mirrors the browser extension approach:
// - Base: https://woolsocks.eu/api/wsProxy
// - Anonymous headers: x-application-name + x-user-id
// - Public endpoints only (no credentials/cookies)

const SITE_BASE = 'https://woolsocks.eu';
const PROXY_BASE = `${SITE_BASE}/api/wsProxy`;

let cachedAnonUserId = null;
function randomId() {
  // Simple RFC4122-ish random string without external deps
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}
function getAnonUserId() {
  if (!cachedAnonUserId) cachedAnonUserId = randomId();
  return cachedAnonUserId;
}

function getAnonHeaders(extra = {}) {
  return {
    'x-application-name': 'WOOLSOCKS_WEB',
    'x-user-id': getAnonUserId(),
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function fetchPublic(endpoint, options = {}) {
  const url = `${PROXY_BASE}${endpoint}`;
  const method = (options.method || 'GET').toUpperCase();
  const headers = getAnonHeaders(options.headers || {});
  const data = options.data || undefined;
  const params = options.params || undefined;
  const timeout = options.timeout || 20000;

  try {
    const resp = await axios.request({ url, method, headers, data, params, timeout, validateStatus: () => true });
    return { status: resp.status, ok: resp.status >= 200 && resp.status < 300, data: resp.data };
  } catch (err) {
    return { status: 0, ok: false, data: null, error: String(err && err.message ? err.message : err) };
  }
}

function toRate(amount, amountType) {
  if (!amount) return 0;
  const value = typeof amount.value === 'number' ? amount.value : 0;
  const scale = typeof amount.scalingFactor === 'number' ? amount.scalingFactor : 2;
  const base = value / Math.pow(10, scale);
  // PERCENTAGE returns percentage value; FIXED returns fixed amount
  return base;
}

function classifyDealType(dealType) {
  const t = String(dealType || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (t === 'GIFTCARD' || t === 'GIFTCARDPAYLATER') return 'VOUCHERS';
  if (t === 'CASHBACK') return 'ONLINE_CASHBACK';
  if (t.includes('AUTO') || t.includes('POINT')) return 'AUTOREWARDS';
  if (t.includes('GIFT') && !t.includes('PAY') && !t.includes('LATER')) return 'VOUCHERS';
  if (t.includes('CASH')) return 'ONLINE_CASHBACK';
  return 'OTHER';
}

async function searchMerchantsByName(name, country = 'NL') {
  const params = new URLSearchParams({ name: String(name || ''), country: String(country || 'NL') });
  const res = await fetchPublic(`/merchants-overview/api/v0.0.1/merchants?${params.toString()}`);
  if (!res.ok) return [];
  const list = (res.data && res.data.data && Array.isArray(res.data.data.merchants)) ? res.data.data.merchants : [];
  return list.map(m => m.data || m).filter(Boolean);
}

async function getDealsForMerchant(merchantId, country = 'NL') {
  const res = await fetchPublic(`/merchants-overview/api/v0.0.1/v2/deals`, { params: { merchantId, country } });
  if (!res.ok) return [];
  const deals = (res.data && res.data.data && Array.isArray(res.data.data.deals)) ? res.data.data.deals : [];
  return deals;
}

async function getCashbackRewards(providerMerchantId, language = 'nl') {
  // Accept-Language header influences localized payload
  const headers = { 'Accept-Language': language };
  const res = await fetchPublic(`/cashback/api/v1/merchants/${encodeURIComponent(String(providerMerchantId))}?sortRewardsBy=amount%3Adesc&language=${encodeURIComponent(language)}`, { headers });
  if (!res.ok) return { merchant: null, rewards: [] };
  const merchant = (res.data && res.data.data && res.data.data.merchant) || res.data.merchant || null;
  const rewards = (res.data && res.data.data && Array.isArray(res.data.data.rewards)) ? res.data.data.rewards : [];
  return { merchant, rewards };
}

function extractObMerchantIdFromImageUrl(url) {
  if (!url) return null;
  try {
    const m = String(url).match(/\/stores(?:\/square)?\/(\d+)(?:[-.]|\/)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

module.exports = {
  fetchPublic,
  searchMerchantsByName,
  getDealsForMerchant,
  getCashbackRewards,
  toRate,
  classifyDealType,
  extractObMerchantIdFromImageUrl,
  constants: { SITE_BASE, PROXY_BASE },
};


