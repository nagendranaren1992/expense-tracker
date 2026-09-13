// Per-user local persistence. Keys are namespaced by Google user id so two
// people on the same device never share transactions.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { generateMockTransactions } from './mockTransactions';
import { accountLast4s } from '../config/accounts';
import { resolveStoredMerchant, shouldUpgradeMerchant } from '../config/upiMerchants';
import { isBadMerchant, isJunkStoredTransaction } from '../services/emailParser';
import { categorize } from '../services/categories';
import { repairUsdTransactions } from '../services/fx';

const LEGACY_TX_KEY = 'expenses.transactions.v1';
const LEGACY_META_KEY = 'expenses.meta.v1';
const LEGACY_MIGRATED_KEY = 'expenses.legacyMigrated.v1';

let activeUserId = null;

export function setActiveUser(userId) {
  activeUserId = userId ? String(userId) : null;
}

export function getActiveUser() {
  return activeUserId;
}

function requireUser() {
  if (!activeUserId) {
    throw new Error('No signed-in user — cannot read or write transactions.');
  }
  return activeUserId;
}

function txKey(userId = activeUserId) {
  return `expenses.${userId}.transactions.v1`;
}

function metaKey(userId = activeUserId) {
  return `expenses.${userId}.meta.v1`;
}

function keepTransaction(t) {
  return (
    t &&
    t.account &&
    !isBadMerchant(t.merchant) &&
    !isJunkStoredTransaction(t)
  );
}

/** One-time: move pre-auth local data to the first user who signs in on this device. */
export async function migrateLegacyIfNeeded(userId) {
  if (!userId) return;
  try {
    const already = await AsyncStorage.getItem(LEGACY_MIGRATED_KEY);
    if (already) return;

    const legacy = await AsyncStorage.getItem(LEGACY_TX_KEY);
    const userRaw = await AsyncStorage.getItem(txKey(userId));
    if (legacy && !userRaw) {
      await AsyncStorage.setItem(txKey(userId), legacy);
      const legacyMeta = await AsyncStorage.getItem(LEGACY_META_KEY);
      if (legacyMeta) {
        await AsyncStorage.setItem(metaKey(userId), legacyMeta);
      }
    }
    await AsyncStorage.setItem(LEGACY_MIGRATED_KEY, String(userId));
  } catch (e) {
    console.warn('migrateLegacyIfNeeded failed', e);
  }
}

export async function getTransactions() {
  try {
    const uid = requireUser();
    const raw = await AsyncStorage.getItem(txKey(uid));
    if (!raw) return [];
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    let changed = false;
    const kept = [];
    for (const t of list) {
      if (!keepTransaction(t)) {
        changed = true;
        continue;
      }
      kept.push(t);
    }

    let clean = await repairUsdTransactions(kept);
    if (clean.some((row, i) => row !== kept[i])) changed = true;

    clean = clean.map((row) => {
      let next = row;
      const label = resolveStoredMerchant(row) || row.merchant;
      if (label && label !== row.merchant) {
        next = { ...next, merchant: label };
        changed = true;
      }
      const nextCat = categorize(next.merchant, next.raw || '');
      if (nextCat && nextCat !== next.category) {
        next = { ...next, category: nextCat };
        changed = true;
      }
      return next;
    });
    if (changed) {
      await AsyncStorage.setItem(txKey(uid), JSON.stringify(clean));
    }
    return clean;
  } catch (e) {
    console.warn('getTransactions failed', e);
    return [];
  }
}

export async function saveTransactions(list) {
  const uid = requireUser();
  await AsyncStorage.setItem(txKey(uid), JSON.stringify(list));
}

function softFingerprint(t) {
  return `${String(t.date || '').slice(0, 16)}|${t.amount}|${t.account || ''}|${t.type || ''}`;
}

function merchantNorm(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** Same card + day + type + similar merchant — used to replace limit-as-amount USD misparses. */
function findUsdMisparseTwin(existing, incoming) {
  if (String(incoming.originalCurrency || '').toUpperCase() !== 'USD') return null;
  const day = String(incoming.date || '').slice(0, 10);
  const mIn = merchantNorm(incoming.merchant);
  if (!day || !incoming.account || !mIn) return null;

  return (
    existing.find((e) => {
      if (!e || e.id === incoming.id) return false;
      if (e.account !== incoming.account || e.type !== incoming.type) return false;
      if (String(e.date || '').slice(0, 10) !== day) return false;
      const mEx = merchantNorm(e.merchant);
      if (!mEx) return false;
      const similar =
        mEx.includes(mIn) ||
        mIn.includes(mEx) ||
        (mEx.length >= 6 && mIn.length >= 6 && (mEx.startsWith(mIn.slice(0, 6)) || mIn.startsWith(mEx.slice(0, 6))));
      if (!similar) return false;
      // Old row looks like available-limit INR; new is the converted USD spend.
      return Number(e.amount) > Number(incoming.amount) * 1.5;
    }) || null
  );
}

function preferMerchant(oldName, newName) {
  const oldBad = isBadMerchant(oldName) || !oldName || /^(unknown|credit)$/i.test(oldName);
  const newBad = isBadMerchant(newName) || !newName;
  if (oldBad && !newBad) return newName;
  if (shouldUpgradeMerchant(oldName, newName)) return newName;
  return null;
}

function applyIncomingOnto(old, t) {
  let changed = false;
  if (!old.account && t.account) {
    old.account = t.account;
    changed = true;
  }
  const better = preferMerchant(old.merchant, t.merchant);
  if (better) {
    old.merchant = better;
    if (t.category) old.category = t.category;
    changed = true;
  }
  if (t.raw && (!old.raw || t.raw.length >= (old.raw || '').length)) {
    old.raw = t.raw;
    changed = true;
  }
  if (
    t.originalCurrency &&
    t.currency === 'INR' &&
    (old.amount !== t.amount ||
      old.originalCurrency !== t.originalCurrency ||
      old.originalAmount !== t.originalAmount)
  ) {
    old.amount = t.amount;
    old.currency = t.currency;
    old.originalAmount = t.originalAmount;
    old.originalCurrency = t.originalCurrency;
    if (t.fxRate != null) old.fxRate = t.fxRate;
    if (t.fxDate) old.fxDate = t.fxDate;
    changed = true;
  }
  return changed;
}

export async function addTransactions(incoming = []) {
  const existing = await getTransactions();
  const seen = new Set(existing.map((t) => t.id));
  const bySoft = new Map(existing.map((t) => [softFingerprint(t), t]));
  const fresh = [];
  let upgraded = false;

  for (const t of incoming) {
    if (!t || !t.id) continue;

    const soft = softFingerprint(t);
    let old =
      bySoft.get(soft) ||
      (seen.has(t.id) ? existing.find((e) => e.id === t.id) : null) ||
      findUsdMisparseTwin(existing, t);

    if (old) {
      let changed = applyIncomingOnto(old, t);
      if (old.id !== t.id) {
        seen.delete(old.id);
        old.id = t.id;
        seen.add(t.id);
        changed = true;
      }
      bySoft.set(softFingerprint(old), old);
      if (changed) upgraded = true;
      continue;
    }

    if (seen.has(t.id)) continue;
    fresh.push(t);
    seen.add(t.id);
    bySoft.set(soft, t);
  }

  if (fresh.length === 0) {
    const pruned = existing.filter(keepTransaction);
    if (pruned.length !== existing.length || upgraded) {
      await saveTransactions(pruned);
    }
    return 0;
  }
  const merged = [...fresh, ...existing]
    .filter(keepTransaction)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  await saveTransactions(merged);
  return fresh.length;
}

export async function clearAll() {
  const uid = requireUser();
  await AsyncStorage.multiRemove([txKey(uid), metaKey(uid)]);
}

export async function clearTransactions() {
  const uid = requireUser();
  await AsyncStorage.removeItem(txKey(uid));
  try {
    const { clearGmailSeenIds } = await import('../services/gmail');
    await clearGmailSeenIds();
  } catch (e) {
    console.warn('clearGmailSeenIds failed', e);
  }
}

export async function removeSampleData() {
  const list = await getTransactions();
  const real = list.filter((t) => t.source !== 'sample');
  await saveTransactions(real);
  return list.length - real.length;
}

// Sample seed is opt-in / legacy — new signed-in users start empty until Sync.
export async function ensureSeeded() {
  const uid = requireUser();
  const meta = await AsyncStorage.getItem(metaKey(uid));
  if (meta) return;
  const existing = await getTransactions();
  if (existing.length === 0) {
    // Do not auto-seed for multi-user; leave empty until Gmail sync.
    await AsyncStorage.setItem(
      metaKey(uid),
      JSON.stringify({ seededAt: null, initializedAt: new Date().toISOString() })
    );
    return;
  }
  await AsyncStorage.setItem(
    metaKey(uid),
    JSON.stringify({ seededAt: new Date().toISOString() })
  );
}

/** Dev helper: fill sample rows for the active user. */
export async function seedSampleData() {
  await saveTransactions(generateMockTransactions());
  const uid = requireUser();
  await AsyncStorage.setItem(
    metaKey(uid),
    JSON.stringify({ seededAt: new Date().toISOString() })
  );
}

// Chips: accounts seen in this user's data. Prefer nicknamed cards first.
export function distinctAccounts(txs) {
  const fromData = [];
  const seen = new Set();
  for (const t of txs) {
    if (!t?.account || seen.has(t.account)) continue;
    seen.add(t.account);
    fromData.push(t.account);
  }
  const preferred = accountLast4s().filter((a) => seen.has(a));
  const rest = fromData.filter((a) => !preferred.includes(a)).sort();
  return [...preferred, ...rest];
}
