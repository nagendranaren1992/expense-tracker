// UPI ID → display name. Real VPAs belong in upiMerchants.local.js (gitignored).
// Copy upiMerchants.example.js → upiMerchants.local.js and fill in mappings.

import { UPI_MERCHANTS as EXAMPLE_MERCHANTS } from './upiMerchants.example';

let localMerchants = null;
try {
  localMerchants = require('./upiMerchants.local').UPI_MERCHANTS;
} catch {
  localMerchants = null;
}

export const UPI_MERCHANTS =
  localMerchants && typeof localMerchants === 'object' && Object.keys(localMerchants).length > 0
    ? localMerchants
    : EXAMPLE_MERCHANTS;

const GENERIC_APP_RE = /^(paytm|phonepe|google pay|bharatpe|amazon pay|unknown|credit)$/i;

const VPA_IN_TEXT_RE =
  /\b([a-z0-9.\-_]{2,}@(?:ybl|oksbi|okhdfcbank|okicici|okaxis|okbizaxis|paytm|ptys|ibl|axl|apl|abfspay|upi|jkbank|indus|kbl|cub|dlb|fbi|sbi|icici|hdfcbank|axisbank|kotak|yesbank|idfcbank))\b/gi;

function normalizeVpa(vpa) {
  return String(vpa || '')
    .trim()
    .toLowerCase();
}

function vpaPrefixMatch(a, b) {
  const [aUser, aHost] = a.split('@');
  const [bUser, bHost] = b.split('@');
  if (!aUser || !bUser || !aHost || !bHost) return false;
  if (aHost !== bHost) return false;
  const overlap = Math.min(aUser.length, bUser.length);
  if (overlap < 8) return false;
  return aUser.startsWith(bUser) || bUser.startsWith(aUser);
}

export function lookupUpiMerchant(vpa) {
  if (!vpa || !String(vpa).includes('@')) return null;
  const key = normalizeVpa(vpa);
  if (!key.includes('@')) return null;

  for (const [mapKey, name] of Object.entries(UPI_MERCHANTS)) {
    if (typeof name !== 'string' || !name.trim()) continue;
    const nk = normalizeVpa(mapKey);
    if (nk === key || vpaPrefixMatch(key, nk)) return name.trim();
  }
  return null;
}

function findMappedVpaInBlob(blob) {
  if (!blob) return null;
  const text = String(blob).toLowerCase();

  const entries = Object.entries(UPI_MERCHANTS)
    .filter(([, name]) => String(name || '').trim())
    .sort((a, b) => b[0].length - a[0].length);

  for (const [vpa, name] of entries) {
    const nk = normalizeVpa(vpa);
    if (text.includes(nk)) return String(name).trim();
  }

  const found = text.match(VPA_IN_TEXT_RE) || [];
  for (const hit of found) {
    const mapped = lookupUpiMerchant(hit);
    if (mapped) return mapped;
  }

  for (const [vpa, name] of entries) {
    const local = normalizeVpa(vpa).split('@')[0];
    if (local.length >= 8 && text.includes(local)) return String(name).trim();
  }
  return null;
}

export function resolveStoredMerchant(t) {
  if (!t) return t?.merchant;

  const direct = lookupUpiMerchant(t.merchant);
  if (direct) return direct;

  const fromRaw = findMappedVpaInBlob(`${t.merchant || ''} ${t.raw || ''}`);
  if (fromRaw) return fromRaw;

  if (GENERIC_APP_RE.test(t.merchant || '')) return t.merchant;
  return t.merchant;
}

export function shouldUpgradeMerchant(oldName, newName) {
  if (!newName || !String(newName).trim()) return false;
  if (!oldName) return true;
  if (GENERIC_APP_RE.test(oldName) && !GENERIC_APP_RE.test(newName)) return true;
  if (/@/.test(oldName) && !/@/.test(newName)) return true;
  return false;
}

export function pendingUpiMerchants() {
  return Object.entries(UPI_MERCHANTS)
    .filter(([, name]) => !String(name || '').trim())
    .map(([vpa]) => vpa);
}
