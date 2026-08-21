// Spend categories + a keyword-based classifier.
// Each category has an emoji icon and a color used across charts and lists.
// To add a merchant, drop a keyword into the matching `match` array.

export const CATEGORIES = {
  food: { key: 'food', label: 'Food & Dining', icon: '🍔', color: '#FF8A5C' },
  ecommerce: { key: 'ecommerce', label: 'E-commerce', icon: '📦', color: '#7C9CFF' },
  groceries: { key: 'groceries', label: 'Groceries', icon: '🛒', color: '#3BD9A6' },
  fuel: { key: 'fuel', label: 'Fuel', icon: '⛽', color: '#F4C25B' },
  travel: { key: 'travel', label: 'Travel', icon: '✈️', color: '#5CC8FF' },
  entertainment: { key: 'entertainment', label: 'Entertainment', icon: '🎬', color: '#C77CFF' },
  utilities: { key: 'utilities', label: 'Bills & Utilities', icon: '💡', color: '#8CD98C' },
  health: { key: 'health', label: 'Health', icon: '💊', color: '#FF7C9C' },
  cash: { key: 'cash', label: 'Cash / ATM', icon: '🏧', color: '#9AA4B2' },
  upi: { key: 'upi', label: 'UPI', icon: '📱', color: '#5B8DEF' },
  transfer: { key: 'transfer', label: 'Transfers', icon: '🔁', color: '#B0B8C4' },
  other: { key: 'other', label: 'Other', icon: '•', color: '#5E6874' },
};

const UPI_VPA_RE =
  /@[a-z0-9]*(?:ybl|oksbi|okhdfcbank|okicici|okaxis|okbizaxis|paytm|ptys|ibl|axl|apl|abfspay|upi|jkbank|indus|kbl|cub|dlb|fbi|sbi|icici|hdfcbank|axisbank|kotak|yesbank|idfcbank)\b/i;

const UPI_TEXT_RE =
  /\bupi\b|upi\s*transaction|upi\s*(?:ref|reference)|upi\/p2p|rupay\s+credit\s+card|paytmqr|phonepe|google pay|gpay|bharatpe/i;

/** True for RuPay/UPI alerts and VPA / UPI-app merchants. */
export function isUpiTransaction(merchant = '', raw = '') {
  const hay = `${merchant} ${raw}`;
  if (UPI_VPA_RE.test(hay)) return true;
  if (UPI_TEXT_RE.test(hay)) return true;
  if (/@[a-z0-9.\-_]+/i.test(merchant || '')) return true;
  return false;
}

// Ordered rules: first match wins. Keep specific brands above generic words.
// UPI is handled in categorize() before these rules.
const RULES = [
  { cat: 'food', match: ['zomato', 'swiggy', 'dominos', 'mcdonald', 'kfc', 'starbucks', 'cafe', 'restaurant', 'eatfit', 'faasos', 'behrouz', 'pizza', 'burger', 'chaayos', 'barbeque', 'dineout'] },
  { cat: 'ecommerce', match: ['amazon', 'flipkart', 'myntra', 'ajio', 'meesho', 'nykaa', 'snapdeal', 'tatacliq', 'firstcry', 'lenskart'] },
  { cat: 'groceries', match: ['bigbasket', 'blinkit', 'zepto', 'dmart', 'grofers', 'jiomart', 'instamart', 'more retail', 'grocery', 'supermarket', 'reliance fresh', 'spencer'] },
  { cat: 'fuel', match: ['petrol', 'diesel', 'fuel', 'hpcl', 'iocl', 'bpcl', 'indian oil', 'bharat petroleum', 'hp petrol', 'shell'] },
  { cat: 'travel', match: ['uber', 'ola', 'rapido', 'irctc', 'makemytrip', 'goibibo', 'cleartrip', 'redbus', 'indigo', 'vistara', 'air india', 'spicejet', 'railway', 'metro', 'yatra', 'oyo', 'airbnb'] },
  { cat: 'entertainment', match: ['netflix', 'spotify', 'hotstar', 'prime video', 'sony liv', 'zee5', 'bookmyshow', 'pvr', 'inox', 'youtube premium', 'gaana', 'jiocinema'] },
  { cat: 'utilities', match: ['electricity', 'water bill', 'gas bill', 'broadband', 'airtel', 'jio', 'vodafone', 'vi ', 'bsnl', 'act fibernet', 'recharge', 'dth', 'tata power', 'bescom', 'postpaid', 'prepaid'] },
  { cat: 'health', match: ['pharmacy', 'pharmeasy', '1mg', 'apollo', 'netmeds', 'hospital', 'clinic', 'diagnostic', 'medplus', 'practo', 'cult.fit', 'cultfit'] },
  { cat: 'cash', match: ['atm', 'cash withdrawal', 'cash wdl', 'nfs'] },
  // Bank wires only — UPI apps (Paytm / PhonePe / GPay) go to `upi`, not here
  { cat: 'transfer', match: ['neft', 'imps', 'rtgs', 'sent to', 'transfer to', 'fund transfer'] },
];

// Classify a merchant string (and optionally the raw email) into a category key.
export function categorize(merchant = '', raw = '') {
  // All UPI / RuPay-UPI / VPA spends → UPI (not Transfers / Other)
  if (isUpiTransaction(merchant, raw)) return 'upi';

  const hay = `${merchant} ${raw}`.toLowerCase();
  for (const rule of RULES) {
    if (rule.match.some((kw) => hay.includes(kw))) return rule.cat;
  }
  return 'other';
}

export function categoryMeta(key) {
  return CATEGORIES[key] || CATEGORIES.other;
}
