// Turns a flat transaction list into the numbers the dashboard needs.

import {
  isSameDay,
  isWithinLastNDays,
  isWithinRange,
  lastNDays,
  daysInRange,
  startOfDay,
} from './dates';
import { categoryMeta } from '../services/categories';

// Keep only spends (debits). Income is handled separately.
export function onlySpends(txs) {
  return txs.filter((t) => t.type === 'debit');
}

export function filterByAccount(txs, account) {
  if (!account || account === 'all') return txs;
  return txs.filter((t) => t.account === account);
}

/**
 * period: 'daily' | 'weekly' | 'custom'
 * range: { from: Date, to: Date } required when period === 'custom'
 */
export function filterByPeriod(txs, period, ref = new Date(), range = null) {
  if (period === 'daily') return txs.filter((t) => isSameDay(t.date, ref));
  if (period === 'custom' && range?.from && range?.to) {
    return txs.filter((t) => isWithinRange(t.date, range.from, range.to));
  }
  return txs.filter((t) => isWithinLastNDays(t.date, 7, ref));
}

export function total(txs) {
  return txs.reduce((s, t) => s + t.amount, 0);
}

// [{ key, label, icon, color, amount, pct }] sorted desc, only nonzero.
export function byCategory(txs) {
  const map = {};
  for (const t of txs) map[t.category] = (map[t.category] || 0) + t.amount;
  const grand = Object.values(map).reduce((s, v) => s + v, 0) || 1;
  return Object.entries(map)
    .map(([key, amount]) => {
      const m = categoryMeta(key);
      return { key, label: m.label, icon: m.icon, color: m.color, amount, pct: amount / grand };
    })
    .sort((a, b) => b.amount - a.amount);
}

// Day buckets for the bar chart (oldest → newest).
export function byDay(txs, ref = new Date(), range = null) {
  const days = range?.from && range?.to ? daysInRange(range.from, range.to) : lastNDays(7, ref);
  return days.map((d) => {
    const dayTxs = txs.filter((t) => isSameDay(t.date, d));
    return { date: d, amount: total(dayTxs), count: dayTxs.length };
  });
}

// Same-length comparison window immediately before the current one.
export function previousPeriodTotal(txs, period, ref = new Date(), range = null) {
  const spends = onlySpends(txs);
  if (period === 'daily') {
    const y = new Date(ref);
    y.setDate(y.getDate() - 1);
    return total(spends.filter((t) => isSameDay(t.date, y)));
  }
  if (period === 'custom' && range?.from && range?.to) {
    let a = startOfDay(range.from);
    let b = startOfDay(range.to);
    if (a > b) [a, b] = [b, a];
    const span = Math.round((b - a) / 86400000) + 1;
    const prevTo = new Date(a);
    prevTo.setDate(prevTo.getDate() - 1);
    const prevFrom = new Date(prevTo);
    prevFrom.setDate(prevFrom.getDate() - (span - 1));
    return total(spends.filter((t) => isWithinRange(t.date, prevFrom, prevTo)));
  }
  const prevRef = new Date(ref);
  prevRef.setDate(prevRef.getDate() - 7);
  return total(spends.filter((t) => isWithinLastNDays(t.date, 7, prevRef)));
}
