// Formatting helpers. Defaults to INR since bank alerts here are ₹-denominated.

export function formatINR(amount, { compact = false } = {}) {
  const n = Number(amount) || 0;
  if (compact && Math.abs(n) >= 1000) {
    if (Math.abs(n) >= 10000000) return '₹' + (n / 10000000).toFixed(2) + 'Cr';
    if (Math.abs(n) >= 100000) return '₹' + (n / 100000).toFixed(2) + 'L';
    if (Math.abs(n) >= 1000) return '₹' + (n / 1000).toFixed(1) + 'k';
  }
  // Indian grouping (lakh/crore): 12,34,567.89
  const parts = Math.abs(n).toFixed(2).split('.');
  let intPart = parts[0];
  const last3 = intPart.slice(-3);
  const rest = intPart.slice(0, -3);
  const grouped =
    (rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' : '') + last3;
  const sign = n < 0 ? '-' : '';
  return `${sign}₹${grouped}.${parts[1]}`;
}

export function formatShort(amount) {
  return formatINR(amount, { compact: true });
}
