// Turns a raw bank/credit-card alert email into a structured transaction.
//
// Shared parsing (amount / type / last-4 / merchant) is generic.
// Bank-specific accept/reject rules live in BANK_RULES so an HSBC fix
// cannot break HDFC / ICICI / BOBCARD alerts.

import { categorize } from './categories';
import { MY_ACCOUNTS } from '../config/accounts';
import { lookupUpiMerchant } from '../config/upiMerchants';

// ---- Amount --------------------------------------------------------------
const AMOUNT_RE = /(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?)/i;
// Prefer the spend amount when the mail also lists available limit / amount due.
const TXN_AMOUNT_RE =
  /(?:transaction of|used for(?: a transaction of)?|spent|debited|charged|payment\s+of)\s*(?:of\s*)?(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?)/i;
// HDFC InstaAlert: "Rs. 3855.00 has been debited from your … Credit Card"
const AMOUNT_THEN_DEBIT_RE =
  /(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?)\s+(?:has\s+been\s+|was\s+)?(?:debited|spent|charged|paid)\b/i;

function extractAmount(text) {
  const preferred = text.match(TXN_AMOUNT_RE) || text.match(AMOUNT_THEN_DEBIT_RE);
  if (preferred) return cleanAmount(preferred[1]);
  const m = text.match(AMOUNT_RE);
  return m ? cleanAmount(m[1]) : null;
}

// ---- Debit vs credit -----------------------------------------------------
// HDFC InstaAlert: "A payment was made using your Credit Card" / "Payment of Rs.…"
// Avoid bare "using"/"used" — promo mailers say "using your … Credit Card 7773".
const DEBIT_RE =
  /\b(debited|spent|withdrawn|purchase|purchased|paid|sent|charged|deducted)\b|used for|has been done|payment\s+was\s+made|payment\s+of\s*(?:rs\.?|inr|₹)/i;
const CREDIT_RE = /\b(credited|received|refund|deposited)\b/;

// ---- Shared not-a-transaction guard (all banks) -------------------------
// Keep this list free of OTP / auth words — most real alerts say
// "Never share your OTP" in the footer, which would false-reject spends.
// Soft billing / statement phrases — only reject when the mail is NOT a clear spend.
// HSBC transaction alerts include "Amount due" / "Available limit" in the same email.
const BILLING_PHRASES = [
  'outstanding of', 'outstanding balance', 'outstanding amount', 'total outstanding',
  'amount due', 'minimum due', 'min amount due', 'total amount due', 'payment due',
  'e-statement', 'estatement', 'your statement', 'statement is', 'statement generated',
  'monthly statement', 'due date',
];

const HARD_NON_TXN_PHRASES = [
  'indiabonds', 'india bonds',
  // Wallet / promo credits — not bank card spends
  'cashback', 'cash back', 'amazon pay', 'amazonpay',
  // Marketing-only copy (HDFC mailers / offer banners)
  'on spends of',
  'voucher on',
  'offer update',
  'check offer',
  'offer valid',
  'discount up to',
  '% discount',
  'shop smarter',
  'save bigger',
  'something special is waiting',
  'waiting for you',
  // Upcoming SI / mandate reminders — not completed spends
  'standing instruction',
  'will be debited',
  'is due on',
  'cancel this debit',
  'cancel this standing',
];

// Appear in real InstaAlert banners/footers — only reject when mail is NOT a spend.
const SOFT_NON_TXN_PHRASES = [
  'smartemi', 'smart emi',
  'easyemi', 'easy emi',
  'pre-approved', 'preapproved',
  'is available',
];

const PROMO_SUBJECT_RE =
  /\b(offer|voucher|promo|promotion|discount|special is waiting|waiting for you|exclusive for you|festive)\b/i;

const PROMO_BODY_RE =
  /(?:rs\.?|inr|₹)\s*[\d,]+\s*voucher|\bon spends of\b|\boffer update\b|\bcheck offer\b|\boffer valid\b|\bdiscount up to\b|\d+\s*%\s*discount\b|\bshop smarter\b|\bsave bigger\b|\bdiscover what.?s waiting\b|\bsomething special is waiting\b/i;

/** Promo / wallet mails that must never become transactions (now or later). */
function isIgnoredSenderOrMail(from = '', subject = '', text = '') {
  const f = (from || '').toLowerCase();
  const s = (subject || '').toLowerCase();
  const blob = `${subject}\n${text}`.toLowerCase();
  if (f.includes('amazonpay') || f.includes('amazon.in') || f.includes('amazon pay')) {
    return true;
  }
  // HDFC/ICICI marketing mailers — not InstaAlerts
  if (f.includes('mailers.') || f.includes('@mailers') || f.includes('mailers@')) return true;
  if (PROMO_SUBJECT_RE.test(s)) return true;
  if (PROMO_BODY_RE.test(blob)) return true;
  if (HARD_NON_TXN_PHRASES.some((p) => blob.includes(p))) {
    // Only use marketing phrases here — skip SI phrases already covered elsewhere
    const marketing = [
      'on spends of', 'voucher on', 'offer update', 'check offer', 'offer valid',
      'discount up to', '% discount', 'shop smarter', 'save bigger',
      'something special is waiting', 'waiting for you',
    ];
    if (marketing.some((p) => blob.includes(p))) return true;
  }
  if (/\bcash\s*back\b/.test(blob)) return true;
  if (blob.includes('amazon pay') || blob.includes('amazonpay')) return true;
  return false;
}

function isNonTransaction(text) {
  const t = text.toLowerCase().replace(/\b(credit|debit)\s+card/g, ' card ');
  if (HARD_NON_TXN_PHRASES.some((p) => t.includes(p))) return true;

  const looksLikeSpend = DEBIT_RE.test(t) || CREDIT_RE.test(t);
  // Promo EMI / "is available" banners sit on real InstaAlerts — don't hard-reject.
  if (!looksLikeSpend && SOFT_NON_TXN_PHRASES.some((p) => t.includes(p))) return true;
  if (!looksLikeSpend && BILLING_PHRASES.some((p) => t.includes(p))) return true;

  const pointsMail = t.includes('reward point') || t.includes('reward points');
  if (pointsMail && !looksLikeSpend) return true;
  return false;
}

// ---- Bank identity + per-bank gates -------------------------------------
// match: detect which bank the mail belongs to
// accept: if present, mail must pass this; only that bank is affected
const BANK_RULES = [
  {
    id: 'hsbc',
    match: (from, subject, text) =>
      from.includes('hsbc') || subject.includes('hsbc') || /\bhsbc\b/.test(text),
    // Real spend only — OTP-for-transaction mails must not count.
    // Subject is "Credit Card Transaction Alert" (sender name is HSBC).
    accept: (_from, subject) =>
      subject.includes('credit card transaction alert'),
  },
  {
    id: 'bobcard',
    match: (from, subject, text) =>
      from.includes('bobcard') ||
      from.includes('bobfinancial') ||
      subject.includes('bobcard') ||
      /\bbobcard\b/.test(text),
  },
  {
    id: 'hdfcbank',
    match: (from, subject, text) =>
      from.includes('hdfc') || subject.includes('hdfc') || /\bhdfc\b/.test(text),
    // Block marketing mailers; require real alert language.
    accept: (from, subject, text) => {
      if (from.includes('mailers')) return false;
      const blob = `${subject} ${text}`;
      return (
        /\b(debited|credited|payment was made|towards\s+\w|upi transaction|has been done|used for)\b/i.test(
          blob
        ) || from.includes('alerts@') || from.includes('insta')
      );
    },
  },
  {
    id: 'icicibank',
    match: (from, subject, text) =>
      from.includes('icici') || subject.includes('icici') || /\bicici\b/.test(text),
  },
];

function resolveBank(from, subject, text) {
  const f = (from || '').toLowerCase();
  const s = (subject || '').toLowerCase();
  const t = (text || '').toLowerCase();
  return BANK_RULES.find((b) => b.match(f, s, t)) || null;
}

/** @returns {false|null} false = reject this mail; null = no bank-specific veto */
function bankAccepts(bank, from, subject, text) {
  if (!bank || typeof bank.accept !== 'function') return null;
  return bank.accept((from || '').toLowerCase(), (subject || '').toLowerCase(), (text || '').toLowerCase())
    ? null
    : false;
}

// ---- Last 4 of account / card -------------------------------------------
const LAST4_PATTERNS = [
  /ending(?:\s+with|\s+in)?\s+(\d{4})\b/i,
  /(?:a\/c|acct|account|ac)\s*(?:no\.?)?\s*(?:x+|\*+)?[-\s]*(\d{4})\b/i,
  /(?:card)\s*(?:no\.?)?\s*(?:ending(?:\s+with|\s+in)?|xx|x+|\*+)?[-\s]*(\d{4})\b/i,
  /(?:x{2,}|\*{2,})[-\s]*(\d{4})\b/i,
  /\bxx\s*(\d{4})\b/i,
  /last\s*4(?:\s*digits)?\s*(?:is|:)?\s*(\d{4})\b/i,
];

// ---- Merchant / payee ----------------------------------------------------
// Order matters: explicit Info: / Paid to / VPA first. Never use bare "to …"
// (bank footers: "to report it please call", "what you can do if…").
const MERCHANT_PATTERNS = [
  // ICICI: "Info: KPN FF 2049 MADHAVAPURI"
  /\binfo\s*:\s*([A-Z0-9][A-Za-z0-9&.\-'*/ ]{2,60}?)(?:\s*[.|]|\s+never\b|\s+if\b|\s*$)/i,
  /\binfo\s*:\s*([A-Z0-9][A-Za-z0-9&.\-'*/ ]{2,60})/i,
  /paid\s+to\s+([a-z0-9.\-_]+@[a-z0-9.\-_]+)/i,
  /paid\s+to\s+([A-Z0-9][A-Za-z0-9&.\-'* ]{2,60}?)(?:\s*(?:on|dated|date|upi|ref|txn|\.|$))/i,
  /(?:vpa|upi(?:\s*id)?|upi\s*handle)[:\s]+([a-z0-9.\-_]+@[a-z0-9.\-_]+)/i,
  // Real UPI handles only — NOT mailbox addresses like contactus@indiabonds
  /\b([a-z0-9.\-_]{2,}@(?:ybl|oksbi|okhdfcbank|okicici|okaxis|okbizaxis|paytm|ptys|ibl|axl|apl|abfspay|upi|jkbank|indus|kbl|cub|dlb|fbi|sbi|icici|hdfcbank|axisbank|kotak|yesbank|idfcbank))\b/i,
  // Merchant after "at … on DATE" — require a letter so "at 12:36:31" is skipped
  /\bat\s+([A-Za-z][A-Za-z0-9&.\-'* ]{2,40}?)\s+on\b/i,
  // HDFC: "towards FIRSTCRY on 16 Aug" / "towards FIRSTCRY."
  /\btowards\s+([A-Za-z][A-Za-z0-9&.\-'* ]{2,40}?)(?:\s+on\b|\s+at\b|\s*[.|,]|\s*$)/i,
  // HDFC: "for Rs.3855.00 … at FIRSTCRY" (merchant after amount)
  /(?:rs\.?|inr|₹)\s*[\d,]+(?:\.\d{1,2})?\s+(?:at|towards)\s+([A-Za-z][A-Za-z0-9&.\-'* ]{2,40}?)(?:\s+on\b|\s*[.|,]|\s*$)/i,
  /(?:merchant|payee)\s*[:\s]\s*([A-Za-z0-9&.\-'* ]{2,40})/i,
];

const BAD_MERCHANT_RE =
  /\b(not you|can do if|click here|dear customer|greetings|transaction details|reference number|available limit|amount due|never share|customer care|hotline|report it|please call|know more|offered|unsubscribe|disclaimer|fraud|block (?:your )?card|sms|whatsapp|call us|team|regarding|update|alert)\b/i;

const UPI_APP_LABELS = [
  { test: /^paytm/i, label: 'Paytm' },
  { test: /^phonepe|^ybl$/i, label: 'PhonePe' },
  { test: /^gpay|^ok(axis|hdfc|icici)/i, label: 'Google Pay' },
  { test: /^bharatpe/i, label: 'BharatPe' },
  { test: /^amazon/i, label: 'Amazon Pay' },
];

function titleCaseMerchant(s) {
  return s
    .split(/\s+/)
    .filter(Boolean)
    // Drop pure numeric store codes: "KPN FF 2049 MADHAVAPURI" → "KPN FF MADHAVAPURI"
    .filter((w) => !/^\d{3,}$/.test(w))
    .map((w) => {
      if (/^[A-Z0-9]{2,4}$/.test(w) && w === w.toUpperCase()) return w; // keep KPN, FF
      if (w.includes('@') || /\d/.test(w)) return w;
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(' ');
}

function displayMerchant(name) {
  if (!name) return name;
  if (name.includes('@')) {
    // Your custom label from src/config/upiMerchants.js wins.
    const mapped = lookupUpiMerchant(name);
    if (mapped) return mapped;

    const handle = name.split('@')[0];
    for (const app of UPI_APP_LABELS) {
      // Only map obvious app prefixes (paytmqr…), not every @ybl QR id.
      if (app.test.test(handle)) return app.label;
    }
    // Unmapped UPI — show the id so you can add it to upiMerchants.js
    return name.toLowerCase();
  }
  return titleCaseMerchant(name);
}

function cleanMerchant(name) {
  let s = name.trim().replace(/\s{2,}/g, ' ');
  s = s.replace(/^(vpa|upi|info)\s+/i, '');
  s = s.split(/[.;]/)[0];
  s = s.replace(/\s+[-–]\s*[A-Za-z]{2,}$/, '');
  s = s.replace(/\b(on|dated|ref|txn|info|via|the|date|never|if you)\b.*$/i, '');
  return s.trim();
}

function isUpiHandle(name) {
  return /@[a-z0-9]+$/i.test(name) &&
    /@(?:ybl|oksbi|okhdfcbank|okicici|okaxis|okbizaxis|paytm|ptys|ibl|axl|apl|abfspay|upi|jkbank|indus|kbl|cub|dlb|fbi|sbi|icici|hdfcbank|axisbank|kotak|yesbank|idfcbank)\b/i.test(name);
}

function isBadMerchant(name) {
  if (!name || name.length < 2) return true;
  if (/^\d+([:.]\d+)*$/.test(name)) return true; // times / numbers
  if (/^(a\/c|ac|acct|account|card|rupay|credit|debit|inr|rs)\b/i.test(name)) return true;
  if (BAD_MERCHANT_RE.test(name)) return true;
  // Mailbox addresses (contactus@…, noreply@…) are not merchants / not UPI
  if (name.includes('@') && !isUpiHandle(name)) return true;
  if (/^(contact|noreply|no-reply|support|care|info|hello|admin)@/i.test(name)) return true;
  const letters = (name.match(/[a-zA-Z]/g) || []).length;
  if (letters < 3) return true;
  return false;
}

function extractMerchant(text) {
  for (const re of MERCHANT_PATTERNS) {
    const m = text.match(re);
    if (m && m[1]) {
      const name = cleanMerchant(m[1]);
      if (isBadMerchant(name)) continue;
      return displayMerchant(name);
    }
  }
  return null;
}

const BANK_SENDERS = [
  'hdfcbank', 'icicibank', 'icici.bank.in', 'sbi', 'axisbank', 'kotak', 'yesbank',
  'idfcfirst', 'pnb', 'bankofbaroda', 'bobcard', 'bobfinancial',
  'canarabank', 'unionbank', 'indusind', 'rblbank',
  'aubank', 'federalbank', 'citibank', 'hsbc', 'standardchartered', 'americanexpress',
  'onecard', 'slice', 'cred', 'paytm', 'phonepe', 'gpay',
  'bank.in',
];

function cleanAmount(s) {
  return parseFloat(String(s).replace(/,/g, ''));
}

function detectType(text) {
  const t = text.toLowerCase().replace(/\b(credit|debit)\s+card/g, ' card ');
  const isDebit = DEBIT_RE.test(t);
  const isCredit = CREDIT_RE.test(t);
  if (isDebit && !isCredit) return 'debit';
  if (isCredit && !isDebit) return 'credit';
  if (!isDebit && !isCredit) return null;
  const di = t.search(DEBIT_RE);
  const ci = t.search(CREDIT_RE);
  return di <= ci ? 'debit' : 'credit';
}

function extractLast4(text) {
  const known = [];
  for (const { last4 } of MY_ACCOUNTS) {
    if (!last4) continue;
    const re = new RegExp(
      `(?:[x*]{2,}[x*\\s-]*|ending(?:\\s+(?:with|in))?\\s+|` +
        `card(?:\\s+no\\.?)?\\s*(?:[x*]+)?[\\s-]*|bobcard\\D{0,16})` +
        `${last4}\\b`,
      'i'
    );
    if (re.test(text)) known.push(last4);
  }
  if (known.length > 0) return known[0];

  for (const re of LAST4_PATTERNS) {
    const m = text.match(re);
    if (m) return m[1];
  }
  return null;
}

function makeId(parts) {
  const s = parts.join('|');
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return 'tx_' + Math.abs(h).toString(36);
}

/**
 * @param {{from?:string, subject?:string, body:string, date?:Date|string|number}} email
 * @returns {object|null} transaction
 */
export function parseTransactionEmail(email) {
  const { from = '', subject = '', body = '', date } = email || {};
  const text = `${subject}\n${body}`.replace(/\s+/g, ' ').trim();
  if (!text) return null;

  // Amazon Pay cashback / wallet promos — never store as card transactions.
  if (isIgnoredSenderOrMail(from, subject, text)) return null;

  const bank = resolveBank(from, subject, text);

  // Per-bank gate (e.g. HSBC subject allowlist). Other banks are untouched.
  if (bankAccepts(bank, from, subject, text) === false) return null;

  // Shared skips: statements / offers / EMI / due notices.
  if (isNonTransaction(text)) return null;

  const amount = extractAmount(text);
  if (!amount || amount <= 0) return null;

  const type = detectType(text);
  if (!type) return null;

  const account = extractLast4(text);
  // Only keep spends that map to one of the user's cards — drops promo /
  // investment mails (e.g. India Bonds) that have no card last-4.
  const knownCard = account && MY_ACCOUNTS.some((a) => a.last4 === account);
  if (!knownCard) return null;

  const merchant = extractMerchant(text) || (type === 'credit' ? 'Credit' : 'Unknown');
  if (isBadMerchant(merchant) && merchant !== 'Credit' && merchant !== 'Unknown') return null;
  const when = date ? new Date(date) : new Date();
  const category = categorize(merchant, text);

  return {
    // Merchant left out of id so re-sync can upgrade a bad name to the real payee.
    id: makeId([when.toISOString().slice(0, 16), amount, account || '', type]),
    amount,
    type,
    merchant,
    account,
    category,
    date: when.toISOString(),
    source: bank?.id || guessBank(from) || 'email',
    raw: text.slice(0, 240),
  };
}

function guessBank(from) {
  const f = (from || '').toLowerCase();
  return BANK_SENDERS.find((b) => f.includes(b)) || null;
}

export function parseEmails(emails = []) {
  return emails.map(parseTransactionEmail).filter(Boolean);
}

/** Drop already-stored wallet/cashback rows (e.g. Amazon Pay +₹200). */
export function isJunkStoredTransaction(t) {
  if (!t) return true;
  const blob = `${t.merchant || ''} ${t.raw || ''} ${t.source || ''}`.toLowerCase();
  if (/\bcash\s*back\b/.test(blob)) return true;
  if (blob.includes('amazon pay') || blob.includes('amazonpay')) return true;
  if (blob.includes('standing instruction')) return true;
  if (blob.includes('will be debited') || blob.includes('is due on')) return true;
  if (blob.includes('mailers.') || blob.includes('@mailers')) return true;
  // Marketing / offer mailers that slipped through as spends
  if (PROMO_BODY_RE.test(blob) || PROMO_SUBJECT_RE.test(blob)) return true;
  if (
    blob.includes('offer update') ||
    blob.includes('on spends of') ||
    blob.includes('check offer') ||
    blob.includes('offer valid') ||
    blob.includes('discount up to') ||
    blob.includes('% discount') ||
    blob.includes('shop smarter') ||
    blob.includes('save bigger') ||
    blob.includes('waiting for you')
  ) {
    return true;
  }
  // Promo parse leftovers: "Unknown" with no real debit/towards language
  if (
    /^(unknown)$/i.test(t.merchant || '') &&
    !/\b(debited|towards|payment was made|upi transaction|used for)\b/i.test(blob)
  ) {
    return true;
  }
  // Generic "Credit" with no real payee — usually wallet/promo, not a card alert
  if (t.type === 'credit' && /^(credit|unknown)$/i.test(t.merchant || '')) return true;
  return false;
}

export { BANK_SENDERS, BANK_RULES, isBadMerchant };
