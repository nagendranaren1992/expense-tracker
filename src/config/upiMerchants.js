// UPI ID → display name for "Paid to …" alerts (HDFC RuPay UPI, etc.).
//
// HOW TO USE
// 1. When a transaction shows a raw UPI id (e.g. q690077135@ybl), copy it here.
// 2. Put the name you want in the list as the value.
// 3. Save and refresh — labels apply on load (no full Reset needed).
//
// Keys are matched case-insensitively. Paytm QR ids also match by prefix
// (short key ↔ longer id from the email), so a truncated copy still works.

export const UPI_MERCHANTS = {
  'q690077135@ybl': 'Shubham Steel Lingampalli',
  'paytmqr6hzq87@ptys': 'SHA-SHA Shandar Shawarma',
  'q844774861@ybl': 'Haryana Jilebi',
  'paytmqr6q7w6d@ptys': 'Pooja Kirana Store',
  'q067223228@ybl': 'Gensis Petrol Pump',
};

const GENERIC_APP_RE = /^(paytm|phonepe|google pay|bharatpe|amazon pay|unknown|credit)$/i;

const VPA_IN_TEXT_RE =
  /\b([a-z0-9.\-_]{2,}@(?:ybl|oksbi|okhdfcbank|okicici|okaxis|okbizaxis|paytm|ptys|ibl|axl|apl|abfspay|upi|jkbank|indus|kbl|cub|dlb|fbi|sbi|icici|hdfcbank|axisbank|kotak|yesbank|idfcbank))\b/gi;

function normalizeVpa(vpa) {
  return String(vpa || '')
    .trim()
    .toLowerCase();
}

/** Same PSP host + overlapping local-part (handles truncated Paytm QR ids). */
function vpaPrefixMatch(a, b) {
  const [aUser, aHost] = a.split('@');
  const [bUser, bHost] = b.split('@');
  if (!aUser || !bUser || !aHost || !bHost) return false;
  if (aHost !== bHost) return false;
  const overlap = Math.min(aUser.length, bUser.length);
  if (overlap < 8) return false;
  return aUser.startsWith(bUser) || bUser.startsWith(aUser);
}

/** @returns {string|null} mapped merchant label, or null if not set */
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

  // Prefer entries that appear in the text (longest local-part first).
  const entries = Object.entries(UPI_MERCHANTS)
    .filter(([, name]) => String(name || '').trim())
    .sort((a, b) => b[0].length - a[0].length);

  for (const [vpa, name] of entries) {
    const nk = normalizeVpa(vpa);
    if (text.includes(nk)) return String(name).trim();
  }

  // Extract VPAs from raw text and fuzzy-match the map.
  const found = text.match(VPA_IN_TEXT_RE) || [];
  for (const hit of found) {
    const mapped = lookupUpiMerchant(hit);
    if (mapped) return mapped;
  }

  // Soft: map key local-part appears even if host was truncated in raw.
  for (const [vpa, name] of entries) {
    const local = normalizeVpa(vpa).split('@')[0];
    if (local.length >= 8 && text.includes(local)) return String(name).trim();
  }
  return null;
}

/**
 * Resolve display name for a stored transaction using upiMerchants.js.
 * Checks the merchant field and the raw email snippet for a known UPI id.
 * Also upgrades generic "Paytm" / "PhonePe" labels when raw still has the VPA.
 */
export function resolveStoredMerchant(t) {
  if (!t) return t?.merchant;

  const direct = lookupUpiMerchant(t.merchant);
  if (direct) return direct;

  const fromRaw = findMappedVpaInBlob(`${t.merchant || ''} ${t.raw || ''}`);
  if (fromRaw) return fromRaw;

  // Generic app label with no recoverable VPA — keep as-is.
  if (GENERIC_APP_RE.test(t.merchant || '')) return t.merchant;
  return t.merchant;
}

/** True when a stored name should be replaced by a better mapped label. */
export function shouldUpgradeMerchant(oldName, newName) {
  if (!newName || !String(newName).trim()) return false;
  if (!oldName) return true;
  if (GENERIC_APP_RE.test(oldName) && !GENERIC_APP_RE.test(newName)) return true;
  if (/@/.test(oldName) && !/@/.test(newName)) return true;
  return false;
}

/** All UPI ids still waiting for a merchant name (empty string in the map). */
export function pendingUpiMerchants() {
  return Object.entries(UPI_MERCHANTS)
    .filter(([, name]) => !String(name || '').trim())
    .map(([vpa]) => vpa);
}
