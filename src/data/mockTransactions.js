// Realistic sample data so the dashboard is populated before you connect Gmail.
// Generated relative to "today" each launch, spread across the last 10 days.

import { categorize } from '../services/categories';

const MERCHANTS = [
  { name: 'Zomato', min: 180, max: 650 },
  { name: 'Swiggy', min: 150, max: 700 },
  { name: 'Amazon', min: 300, max: 4500 },
  { name: 'Flipkart', min: 250, max: 3200 },
  { name: 'BigBasket', min: 400, max: 2200 },
  { name: 'Blinkit', min: 120, max: 900 },
  { name: 'HPCL Petrol', min: 800, max: 3000 },
  { name: 'Uber', min: 90, max: 480 },
  { name: 'Ola', min: 80, max: 420 },
  { name: 'Netflix', min: 199, max: 649 },
  { name: 'BookMyShow', min: 250, max: 1200 },
  { name: 'Airtel Recharge', min: 239, max: 999 },
  { name: 'PharmEasy', min: 150, max: 1400 },
  { name: 'Starbucks', min: 220, max: 600 },
  { name: 'DMart', min: 500, max: 2800 },
  { name: 'Myntra', min: 400, max: 2600 },
];

const ACCOUNTS = ['5678', '1234']; // e.g. debit a/c 5678, credit card 1234

function rand(min, max) {
  return Math.round(min + Math.random() * (max - min));
}
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function generateMockTransactions() {
  const txs = [];
  const now = new Date();
  let counter = 0;

  for (let dayOffset = 0; dayOffset < 10; dayOffset++) {
    const perDay = rand(1, 5); // some days busier than others
    for (let i = 0; i < perDay; i++) {
      const m = pick(MERCHANTS);
      const d = new Date(now);
      d.setDate(now.getDate() - dayOffset);
      d.setHours(rand(8, 22), rand(0, 59), 0, 0);
      const amount = rand(m.min, m.max);
      const account = pick(ACCOUNTS);
      txs.push({
        id: `mock_${dayOffset}_${i}_${counter++}`,
        amount,
        type: 'debit',
        merchant: m.name,
        account,
        category: categorize(m.name),
        date: d.toISOString(),
        source: 'sample',
        raw: `Sample: Rs.${amount} spent at ${m.name} on card ${account}`,
      });
    }
  }

  // A couple of income entries for realism.
  const salary = new Date(now);
  salary.setDate(now.getDate() - 3);
  salary.setHours(10, 0, 0, 0);
  txs.push({
    id: 'mock_income_1',
    amount: 85000,
    type: 'credit',
    merchant: 'ACME Corp Salary',
    account: '5678',
    category: 'transfer',
    date: salary.toISOString(),
    source: 'sample',
    raw: 'Sample: Rs.85000 credited (salary)',
  });

  return txs.sort((a, b) => new Date(b.date) - new Date(a.date));
}
