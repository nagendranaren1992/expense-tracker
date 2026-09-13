// Historical FX rates (USD → INR). One network call max, then on-device cache.
// Web uses open.er-api.com (CORS-safe). Never hits Frankfurter in the browser.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const FX_CACHE_KEY = 'expenses.fx.v1';
/** Safe mid-market fallback so USD rows still convert if the network call fails. */
const FALLBACK_USD_INR = 94.5;

const memoryCache = new Map();
let diskCache = null;
let inflightLatest = null; // dedupe concurrent latest fetches into 1 request

function ymd(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  return d.toISOString().slice(0, 10);
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function cacheKey(from, to, day) {
  return `${from}:${to}:${day}`;
}

async function loadDiskCache() {
  if (diskCache) return diskCache;
  try {
    const raw = await AsyncStorage.getItem(FX_CACHE_KEY);
    diskCache = raw ? JSON.parse(raw) : {};
  } catch {
    diskCache = {};
  }
  return diskCache;
}

async function saveDiskCache() {
  if (!diskCache) return;
  try {
    await AsyncStorage.setItem(FX_CACHE_KEY, JSON.stringify(diskCache));
  } catch (e) {
    console.warn('fx cache save failed', e?.message || e);
  }
}

function getCachedRate(from, to, day) {
  const key = cacheKey(from, to, day);
  if (memoryCache.has(key)) return memoryCache.get(key);
  if (diskCache?.[key] > 0) {
    memoryCache.set(key, diskCache[key]);
    return diskCache[key];
  }
  return null;
}

async function storeRate(from, to, day, rate) {
  if (!(rate > 0)) return;
  const key = cacheKey(from, to, day);
  memoryCache.set(key, rate);
  if (!diskCache) await loadDiskCache();
  diskCache[key] = rate;
  await saveDiskCache();
}

async function fetchLatestUsdInr() {
  // Deduplicate parallel callers (sync + repair) into a single in-flight request.
  if (inflightLatest) return inflightLatest;

  inflightLatest = (async () => {
    try {
      const res = await fetch('https://open.er-api.com/v6/latest/USD');
      if (res.ok) {
        const data = await res.json();
        const rate = Number(data?.rates?.INR);
        if (rate > 0) return rate;
      }
    } catch (e) {
      console.warn('open.er-api fx failed', e?.message || e);
    }

    if (Platform.OS !== 'web') {
      try {
        const res = await fetch('https://api.frankfurter.app/latest?from=USD&to=INR');
        if (res.ok) {
          const data = await res.json();
          const rate = Number(data?.rates?.INR);
          if (rate > 0) return rate;
        }
      } catch (e) {
        console.warn('frankfurter fx failed', e?.message || e);
      }
    }

    return FALLBACK_USD_INR;
  })();

  try {
    return await inflightLatest;
  } finally {
    inflightLatest = null;
  }
}

/**
 * Prefetch USD→INR for many days using a single latest-rate request.
 * Same rate is reused for every missing day (good enough for spend tracking).
 */
export async function prefetchFxRates(days = [], from = 'USD', to = 'INR') {
  const base = String(from || 'USD').toUpperCase();
  const quote = String(to || 'INR').toUpperCase();
  if (base === quote) return;
  if (base !== 'USD' || quote !== 'INR') return;

  await loadDiskCache();

  const unique = [...new Set(days.map((d) => ymd(d)).filter(Boolean))];
  const missing = unique.filter((day) => !getCachedRate(base, quote, day));
  if (!missing.length) return;

  const latest =
    getCachedRate(base, quote, 'latest') || (await fetchLatestUsdInr());
  await storeRate(base, quote, 'latest', latest);
  for (const day of missing) await storeRate(base, quote, day, latest);
}

export async function getFxRate(date, from = 'USD', to = 'INR') {
  const base = String(from || 'USD').toUpperCase();
  const quote = String(to || 'INR').toUpperCase();
  if (base === quote) return 1;

  await loadDiskCache();
  const day = ymd(date);
  const hit = getCachedRate(base, quote, day);
  if (hit > 0) return hit;

  await prefetchFxRates([day], base, quote);
  return getCachedRate(base, quote, day) || FALLBACK_USD_INR;
}

export async function convertToInr(amount, currency, date) {
  const cur = String(currency || 'INR').toUpperCase();
  const value = Number(amount);
  if (!(value > 0)) throw new Error('Invalid amount for FX conversion');
  if (cur === 'INR') return { amountInr: round2(value), rate: 1, currency: cur };

  const rate = await getFxRate(date, cur, 'INR');
  return { amountInr: round2(value * rate), rate, currency: cur };
}

function applyFxFromCache(tx) {
  if (!tx) return null;
  const cur = String(tx.originalCurrency || tx.currency || 'INR').toUpperCase();
  if (cur === 'INR') return { ...tx, currency: 'INR' };

  const originalAmount = Number(tx.originalAmount ?? tx.amount);
  const rate = getCachedRate(cur, 'INR', ymd(tx.date)) || FALLBACK_USD_INR;

  return {
    ...tx,
    amount: round2(originalAmount * rate),
    currency: 'INR',
    originalAmount,
    originalCurrency: cur,
    fxRate: rate,
    fxDate: ymd(tx.date),
  };
}

export async function applyFxToTransactions(transactions = []) {
  if (!transactions.length) return [];

  const foreign = transactions.filter((t) => {
    const cur = String(t.originalCurrency || t.currency || 'INR').toUpperCase();
    return cur !== 'INR';
  });

  if (foreign.length) {
    await prefetchFxRates(
      foreign.map((t) => t.date),
      'USD',
      'INR'
    );
  }

  return transactions.map((t) => applyFxFromCache(t)).filter(Boolean);
}

export async function applyFxToTransaction(tx) {
  if (!tx) return null;
  const [one] = await applyFxToTransactions([tx]);
  return one ?? null;
}

function looksUnconvertedForeign(tx, usdAmt, amountInr) {
  const stored = Number(tx.amount);
  if (!(stored > 0) || !(amountInr > 0)) return false;
  if (Math.abs(stored - usdAmt) < 0.02) return true;
  return Math.abs(stored - amountInr) > Math.max(5, amountInr * 0.05);
}

function repairOneFromCache(tx, usdAmt, amountInr, rate) {
  if (!looksUnconvertedForeign(tx, usdAmt, amountInr)) {
    if (
      String(tx.originalCurrency || '').toUpperCase() === 'USD' &&
      Math.abs(Number(tx.originalAmount) - usdAmt) < 0.02 &&
      tx.currency === 'INR'
    ) {
      return tx;
    }
    return {
      ...tx,
      currency: 'INR',
      originalAmount: usdAmt,
      originalCurrency: 'USD',
      fxRate: rate,
      fxDate: ymd(tx.date),
    };
  }

  return {
    ...tx,
    amount: amountInr,
    currency: 'INR',
    originalAmount: usdAmt,
    originalCurrency: 'USD',
    fxRate: rate,
    fxDate: ymd(tx.date),
    fxRepaired: true,
  };
}

export async function repairUsdTransactions(transactions = []) {
  if (!transactions.length) return transactions;

  const { extractUsdFromText } = await import('./emailParser');
  const jobs = transactions.map((tx, index) => {
    let usdAmt = extractUsdFromText(`${tx.raw || ''} ${tx.merchant || ''}`);
    if (!(usdAmt > 0) && String(tx.originalCurrency || '').toUpperCase() === 'USD') {
      usdAmt = Number(tx.originalAmount);
    }
    return { index, tx, usdAmt };
  });

  const needsFx = jobs.filter((j) => j.usdAmt > 0);
  if (needsFx.length) {
    await prefetchFxRates(
      needsFx.map((j) => j.tx.date),
      'USD',
      'INR'
    );
  }

  const out = [...transactions];
  for (const { index, tx, usdAmt } of needsFx) {
    const rate = getCachedRate('USD', 'INR', ymd(tx.date)) || FALLBACK_USD_INR;
    const amountInr = round2(usdAmt * rate);
    out[index] = repairOneFromCache(tx, usdAmt, amountInr, rate);
  }
  return out;
}

export async function repairMisparsedUsdTransaction(tx) {
  const [one] = await repairUsdTransactions([tx]);
  return one ?? tx;
}
