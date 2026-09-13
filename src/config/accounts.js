// Optional nicknames for cards you know by last-4.
// Real last-4s belong in accounts.local.js (gitignored) — never commit them.
// Copy accounts.example.js → accounts.local.js and fill in your cards.

import { MY_ACCOUNTS as EXAMPLE_ACCOUNTS } from './accounts.example';

let localAccounts = null;
try {
  // Resolved via metro.config.js — falls back to example if missing.
  localAccounts = require('./accounts.local').MY_ACCOUNTS;
} catch {
  localAccounts = null;
}

export const MY_ACCOUNTS =
  Array.isArray(localAccounts) && localAccounts.length > 0
    ? localAccounts
    : EXAMPLE_ACCOUNTS;

export function accountLast4s() {
  return MY_ACCOUNTS.map((a) => a.last4);
}

function labelCount(label) {
  return MY_ACCOUNTS.filter((x) => x.label === label).length;
}

export function accountLabel(last4) {
  if (!last4) return 'Unknown account';
  const a = MY_ACCOUNTS.find((x) => x.last4 === last4);
  if (!a) return `•••• ${last4}`;
  return labelCount(a.label) > 1 ? `${a.label} ••${last4}` : a.label;
}

export function accountShort(last4) {
  if (!last4) return '';
  const a = MY_ACCOUNTS.find((x) => x.last4 === last4);
  return a ? `${a.label} ••${last4}` : `•••• ${last4}`;
}
