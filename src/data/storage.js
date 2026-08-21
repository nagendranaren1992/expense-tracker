// Local persistence for transactions using AsyncStorage.
// For a first version this is plenty; swap to expo-sqlite later if the list
// grows into the thousands and you need indexed queries.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { generateMockTransactions } from './mockTransactions';
import { accountLast4s } from '../config/accounts';
import { resolveStoredMerchant, shouldUpgradeMerchant } from '../config/upiMerchants';
import { isBadMerchant, isJunkStoredTransaction } from '../services/emailParser';
import { categorize } from '../services/categories';

const TX_KEY = 'expenses.transactions.v1';
const META_KEY = 'expenses.meta.v1';

export async function getTransactions() {
  try {
    const raw = await AsyncStorage.getItem(TX_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    const known = accountLast4s();
    let changed = false;
    const clean = [];
    for (const t of list) {
      if (
        !t ||
        !t.account ||
        !known.includes(t.account) ||
        isBadMerchant(t.merchant) ||
        isJunkStoredTransaction(t)
      ) {
        changed = true;
        continue;
      }
      const label = resolveStoredMerchant(t) || t.merchant;
      if (label && label !== t.merchant) {
        t.merchant = label;
        changed = true;
      }
      // Re-run classifier so rule changes (e.g. UPI vs Transfers) apply on load
      const nextCat = categorize(t.merchant, t.raw || '');
      if (nextCat && nextCat !== t.category) {
        t.category = nextCat;
        changed = true;
      }
      clean.push(t);
    }
    if (changed) {
      await AsyncStorage.setItem(TX_KEY, JSON.stringify(clean));
    }
    return clean;
  } catch (e) {
    console.warn('getTransactions failed', e);
    return [];
  }
}

export async function saveTransactions(list) {
  await AsyncStorage.setItem(TX_KEY, JSON.stringify(list));
}

// Same spend across re-parses (merchant name may improve).
function softFingerprint(t) {
  return `${String(t.date || '').slice(0, 16)}|${t.amount}|${t.account || ''}|${t.type || ''}`;
}

function preferMerchant(oldName, newName) {
  const oldBad = isBadMerchant(oldName) || !oldName || /^(unknown|credit)$/i.test(oldName);
  const newBad = isBadMerchant(newName) || !newName;
  if (oldBad && !newBad) return newName;
  // Upgrade raw UPI id / generic "Paytm" → friendly name from upiMerchants.js
  if (shouldUpgradeMerchant(oldName, newName)) return newName;
  return null;
}

// Merge new transactions, skipping ids we already have. Returns the added count.
// Also upgrades boilerplate merchant names when the same spend is re-synced.
export async function addTransactions(incoming = []) {
  const existing = await getTransactions();
  const seen = new Set(existing.map((t) => t.id));
  const bySoft = new Map(existing.map((t) => [softFingerprint(t), t]));
  const fresh = [];
  let upgraded = false;

  for (const t of incoming) {
    if (!t || !t.id) continue;

    const soft = softFingerprint(t);
    const old = bySoft.get(soft) || (seen.has(t.id) ? existing.find((e) => e.id === t.id) : null);

    if (old) {
      let changed = false;
      if (!old.account && t.account) {
        old.account = t.account;
        changed = true;
      }
      const better = preferMerchant(old.merchant, t.merchant);
      if (better) {
        old.merchant = better;
        if (t.category) old.category = t.category;
        if (t.raw) old.raw = t.raw;
        changed = true;
      }
      // Migrate to stable id (without merchant).
      if (old.id !== t.id) {
        seen.delete(old.id);
        old.id = t.id;
        seen.add(t.id);
        changed = true;
      }
      if (changed) upgraded = true;
      continue;
    }

    if (seen.has(t.id)) continue;
    fresh.push(t);
    seen.add(t.id);
    bySoft.set(soft, t);
  }

  if (fresh.length === 0) {
    const pruned = existing.filter(
      (t) =>
        t.account &&
        accountLast4s().includes(t.account) &&
        !isBadMerchant(t.merchant) &&
        !isJunkStoredTransaction(t)
    );
    if (pruned.length !== existing.length || upgraded) {
      await saveTransactions(pruned);
    }
    return 0;
  }
  const merged = [...fresh, ...existing]
    .filter(
      (t) =>
        t.account &&
        accountLast4s().includes(t.account) &&
        !isBadMerchant(t.merchant) &&
        !isJunkStoredTransaction(t)
    )
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  await saveTransactions(merged);
  return fresh.length;
}

export async function clearAll() {
  await AsyncStorage.multiRemove([TX_KEY, META_KEY]);
}

// Clear stored transactions but KEEP the seed flag, so sample data does not
// come back. Use this to wipe bad/stale rows, then re-sync from Gmail.
export async function clearTransactions() {
  await AsyncStorage.removeItem(TX_KEY);
}

// Remove only the seeded sample rows (source: 'sample'), keeping real data.
// Called after the first successful Gmail sync so only live data remains.
export async function removeSampleData() {
  const list = await getTransactions();
  const real = list.filter((t) => t.source !== 'sample');
  await saveTransactions(real);
  return list.length - real.length; // how many samples were removed
}

// Seed sample data the first time the app runs so the UI isn't empty.
export async function ensureSeeded() {
  const meta = await AsyncStorage.getItem(META_KEY);
  if (meta) return;
  const existing = await getTransactions();
  if (existing.length === 0) {
    await saveTransactions(generateMockTransactions());
  }
  await AsyncStorage.setItem(
    META_KEY,
    JSON.stringify({ seededAt: new Date().toISOString() })
  );
}

// Filter chips: always the user's cards, then any extra last-4s found in data.
export function distinctAccounts(txs) {
  const set = new Set(accountLast4s());
  txs.forEach((t) => t.account && set.add(t.account));
  const configured = accountLast4s();
  const extra = Array.from(set)
    .filter((a) => !configured.includes(a))
    .sort();
  return [...configured, ...extra];
}