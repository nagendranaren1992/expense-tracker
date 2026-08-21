// Lightweight date helpers. All work in the device's local timezone.

export function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function endOfDay(d) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

export function isSameDay(a, b) {
  return startOfDay(a).getTime() === startOfDay(b).getTime();
}

// Returns an array of the last `count` days (oldest -> newest), each at 00:00.
export function lastNDays(count, ref = new Date()) {
  const days = [];
  const base = startOfDay(ref);
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(base);
    d.setDate(base.getDate() - i);
    days.push(d);
  }
  return days;
}

/** Inclusive calendar days from `from` through `to` (oldest → newest). Caps at 62. */
export function daysInRange(from, to) {
  if (!from || !to) return [];
  let a = startOfDay(from);
  let b = startOfDay(to);
  if (a > b) [a, b] = [b, a];
  const days = [];
  const cur = new Date(a);
  while (cur <= b && days.length < 62) {
    days.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

// Is `date` within the last 7 days (including today) relative to ref?
export function isWithinLastNDays(date, count, ref = new Date()) {
  const start = startOfDay(ref);
  start.setDate(start.getDate() - (count - 1));
  const end = startOfDay(ref);
  end.setDate(end.getDate() + 1); // exclusive upper bound
  const t = new Date(date).getTime();
  return t >= start.getTime() && t < end.getTime();
}

/** Inclusive from–to range (local calendar days). */
export function isWithinRange(date, from, to) {
  if (!from || !to) return false;
  let a = startOfDay(from).getTime();
  let b = startOfDay(to).getTime();
  if (a > b) [a, b] = [b, a];
  const t = startOfDay(date).getTime();
  return t >= a && t <= b;
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

export function dayLabel(d) {
  return DOW[new Date(d).getDay()];
}

export function dayNumber(d) {
  return new Date(d).getDate();
}

export function prettyDate(d) {
  const x = new Date(d);
  return `${x.getDate()} ${MON[x.getMonth()]}`;
}

export function prettyDateYear(d) {
  const x = new Date(d);
  return `${x.getDate()} ${MON[x.getMonth()]} ${x.getFullYear()}`;
}

export function monthYearLabel(d) {
  const x = new Date(d);
  return `${MON[x.getMonth()]} ${x.getFullYear()}`;
}

/** Compact range label: "12–16 Aug" or "28 Jul – 3 Aug". */
export function prettyRange(from, to) {
  if (!from || !to) return 'Custom';
  let a = startOfDay(from);
  let b = startOfDay(to);
  if (a > b) [a, b] = [b, a];
  if (isSameDay(a, b)) return prettyDate(a);
  const sameMonth = a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();
  if (sameMonth) return `${a.getDate()}–${b.getDate()} ${MON[a.getMonth()]}`;
  return `${prettyDate(a)} – ${prettyDate(b)}`;
}

export function prettyTime(d) {
  const x = new Date(d);
  let h = x.getHours();
  const m = String(x.getMinutes()).padStart(2, '0');
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m} ${ap}`;
}

// "Today", "Yesterday", or "12 Aug"
export function relativeDay(d, ref = new Date()) {
  if (isSameDay(d, ref)) return 'Today';
  const y = new Date(ref);
  y.setDate(y.getDate() - 1);
  if (isSameDay(d, y)) return 'Yesterday';
  return prettyDate(d);
}
