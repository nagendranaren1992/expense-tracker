export const MY_ACCOUNTS = [
  { last4: '6008', label: 'ICICI', type: 'credit' },
  { last4: '7773', label: 'HDFC', type: 'credit' },
  { last4: '2358', label: 'HSBC', type: 'credit' },
  { last4: '3471', label: 'BOBCARD', type: 'credit' },
  { last4: '7023', label: 'BOBCARD', type: 'credit' },
];

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
  // Duplicate names (two BOBCARDs) get last-4 so chips stay distinct.
  return labelCount(a.label) > 1 ? `${a.label} ••${last4}` : a.label;
}

export function accountShort(last4) {
  if (!last4) return '';
  const a = MY_ACCOUNTS.find((x) => x.last4 === last4);
  return a ? `${a.label} ••${last4}` : `•••• ${last4}`;
}
