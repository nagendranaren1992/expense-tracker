// Gmail + Google Sign-In (login gate + bank-alert sync).
//
// Login and Sync both use the same OAuth clients. Identity scopes identify the
// user; gmail.readonly pulls transaction alerts. Tokens stay on the device.
//
// ─────────────────────────────────────────────────────────────────────────
// ONE-TIME SETUP (each takes a few minutes):
// 1. Go to https://console.cloud.google.com/ → create a project.
// 2. "APIs & Services" → Enable the **Gmail API**.
// 3. "OAuth consent screen" → External → add Google accounts as Test users
//    (friends you share the app with must be listed while in Testing mode).
// 4. "Credentials" → Create OAuth client IDs:
//      - Web application    (for running on web)
//      - iOS                (bundle id: com.example.expensetracker)
//      - Android            (package + SHA-1 from `expo credentials`/EAS)
// 5. Paste the client IDs into CLIENT_IDS below.
//
// Scope used is READ-ONLY (gmail.readonly) plus openid/email/profile for login.
// ─────────────────────────────────────────────────────────────────────────

import { Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as Google from 'expo-auth-session/providers/google';
import { BANK_SENDERS, parseTransactionEmail } from './emailParser';

WebBrowser.maybeCompleteAuthSession();

export const CLIENT_IDS = {
  webClientId: '56109597189-agdhfu0l7l9evpd32auc2bu89mt1p691.apps.googleusercontent.com',
  // Google Cloud → Credentials → Create OAuth client → iOS
  // Bundle ID must match app.json: com.example.expensetracker
  iosClientId: '56109597189-nmqg8r73me0relv8idjr674c6pulh4dc.apps.googleusercontent.com', // <-- paste iOS client ID (required for iPhone / Expo Go on iOS)
  // Google Cloud → Credentials → Create OAuth client → Android
  // Package: com.example.expensetracker
  androidClientId: '', // <-- paste Android client ID (required on Android)
};

// Identity scopes for login + read-only Gmail for bank-alert sync.
export const GMAIL_SCOPES = [
  'openid',
  'profile',
  'email',
  'https://www.googleapis.com/auth/gmail.readonly',
];

/** Client ID required for the platform you are running on right now. */
export function platformClientId() {
  if (Platform.OS === 'ios') return CLIENT_IDS.iosClientId;
  if (Platform.OS === 'android') return CLIENT_IDS.androidClientId;
  return CLIENT_IDS.webClientId;
}

export function isGmailConfigured() {
  return Boolean(platformClientId());
}

export function gmailSetupHint() {
  if (Platform.OS === 'ios') {
    return (
      'Add an iOS OAuth client ID in src/services/gmail.js. ' +
      'Google Cloud Console → Credentials → Create OAuth client → iOS, ' +
      'bundle ID: com.example.expensetracker. Or run on web (press w) using the Web client ID.'
    );
  }
  if (Platform.OS === 'android') {
    return (
      'Add an Android OAuth client ID in src/services/gmail.js. ' +
      'Google Cloud Console → Credentials → Create OAuth client → Android, ' +
      'package: com.example.expensetracker. Or run on web (press w) using the Web client ID.'
    );
  }
  return 'Add your Gmail Web client ID in src/services/gmail.js, then tap Sync.';
}

// Hook must always run. When this platform's client ID is missing, pass a
// placeholder so Google.useAuthRequest does not throw on mount — Sync is blocked
// separately by isGmailConfigured() / gmailSetupHint().
export function useGmailAuth() {
  const placeholder = '000000000000-placeholder.apps.googleusercontent.com';
  return Google.useAuthRequest({
    webClientId: CLIENT_IDS.webClientId || undefined,
    iosClientId: CLIENT_IDS.iosClientId || (Platform.OS === 'ios' ? placeholder : undefined),
    androidClientId:
      CLIENT_IDS.androidClientId || (Platform.OS === 'android' ? placeholder : undefined),
    scopes: GMAIL_SCOPES,
  });
}

// Builds a Gmail search that pulls likely bank/card alerts from known senders
// within a time window, so we don't scan the whole mailbox.
const GMAIL_PROMO_EXCLUDE =
  '-from:mailers.hdfcbank -from:mailers -subject:offer -subject:voucher ' +
  '-subject:discount -subject:"waiting for you" -"on spends of" -"offer update" ' +
  '-"check offer" -"offer valid" -"discount up to" -"shop smarter"';

function buildSenderQuery({ days = 7 } = {}) {
  const fromClause = BANK_SENDERS.map((s) => `from:${s}`).join(' OR ');
  return `(${fromClause}) ${GMAIL_PROMO_EXCLUDE} newer_than:${days}d`;
}

// Fallback used when the sender query finds nothing: search by the phrases that
// show up in transaction alerts, regardless of who sent them.
function buildKeywordQuery({ days = 7 } = {}) {
  // Keep this bank-agnostic. HSBC OTP filtering is done in emailParser
  // BANK_RULES, not by excluding "otp" globally (real alerts mention OTP in footers).
  return (
    `("has been used for a transaction" OR "debited" OR "credited" OR ` +
    `"spent" OR "debited from" OR "has been done" OR "ending with" OR ` +
    `"payment was made" OR "payment of" OR towards OR ` +
    `BOBCARD OR subject:"Credit Card Transaction Alert from HSBC" OR ` +
    `subject:(transaction OR debited OR spent OR payment OR BOBCARD)) ` +
    `-cashback -"amazon pay" -from:amazonpay -from:amazon.in ` +
    `-"standing instruction" -"will be debited" -"is due on" ` +
    `${GMAIL_PROMO_EXCLUDE} newer_than:${days}d`
  );
}

async function api(path, accessToken) {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Gmail API ${res.status}: ${await res.text()}`);
  return res.json();
}

function decodeBase64Url(data) {
  if (!data) return '';
  const b64 = data.replace(/-/g, '+').replace(/_/g, '/');
  try {
    if (typeof atob === 'function') return decodeURIComponent(escape(atob(b64)));
    // Node/Hermes fallback
    // eslint-disable-next-line no-undef
    return Buffer.from(b64, 'base64').toString('utf-8');
  } catch {
    return '';
  }
}

// Turn an HTML email body into clean readable text.
function htmlToText(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ') // strip tags
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&rs?;|&#8377;/gi, '₹')
    .replace(/&[a-z0-9#]+;/gi, ' ') // any other entity -> space
    .replace(/\s+/g, ' ')
    .trim();
}

// Pull the readable text out of a Gmail message payload (walks MIME parts).
// Large HTML parts often only have attachmentId — fetch those too.
async function fetchPartData(part, accessToken, messageId) {
  if (!part?.body) return '';
  if (part.body.data) return decodeBase64Url(part.body.data);
  if (part.body.attachmentId && accessToken && messageId) {
    try {
      const att = await api(
        `/messages/${messageId}/attachments/${part.body.attachmentId}`,
        accessToken
      );
      return decodeBase64Url(att.data);
    } catch (e) {
      console.warn('attachment fetch failed', e.message);
    }
  }
  return '';
}

async function extractBody(payload, accessToken, messageId) {
  if (!payload) return '';
  if (payload.body?.data && (!payload.parts || payload.mimeType === 'text/plain' || payload.mimeType === 'text/html')) {
    const raw = decodeBase64Url(payload.body.data);
    return payload.mimeType === 'text/html' ? htmlToText(raw) : raw;
  }
  let plain = '';
  let htmlText = '';
  const walk = async (part) => {
    if (!part) return;
    if (part.mimeType === 'text/plain') {
      plain += (await fetchPartData(part, accessToken, messageId)) + '\n';
    } else if (part.mimeType === 'text/html') {
      htmlText += htmlToText(await fetchPartData(part, accessToken, messageId)) + '\n';
    }
    for (const child of part.parts || []) await walk(child);
  };
  await walk(payload);
  return (plain.trim() || htmlText.trim());
}

function header(headers = [], name) {
  const h = headers.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : '';
}

async function listMessageIds(query, accessToken, max) {
  const q = encodeURIComponent(query);
  const list = await api(`/messages?q=${q}&maxResults=${max}`, accessToken);
  return (list.messages || []).map((m) => m.id);
}

/**
 * Fetch recent bank alerts and parse them into transactions.
 * @param {string} accessToken - from the OAuth flow
 * @param {{days?:number, max?:number}} opts
 * @returns {Promise<{transactions:object[], scanned:number, parsed:number, usedFallback:boolean}>}
 */
export async function fetchAndParse(accessToken, { days = 7, max = 100 } = {}) {
  // Run BOTH searches and merge: known bank senders, plus a keyword search that
  // catches alerts from senders we don't recognize (e.g. some card alerts come
  // from a separate domain). Dedupe by message id.
  const [senderIds, keywordIds] = await Promise.all([
    listMessageIds(buildSenderQuery({ days }), accessToken, max),
    listMessageIds(buildKeywordQuery({ days }), accessToken, max),
  ]);
  const ids = Array.from(new Set([...senderIds, ...keywordIds]));

  const txs = [];
  for (const id of ids) {
    try {
      const msg = await api(`/messages/${id}?format=full`, accessToken);
      const headers = msg.payload?.headers || [];
      const email = {
        from: header(headers, 'From'),
        subject: header(headers, 'Subject'),
        body: await extractBody(msg.payload, accessToken, id),
        date: msg.internalDate ? new Date(Number(msg.internalDate)) : new Date(),
      };
      const tx = parseTransactionEmail(email);
      if (tx) txs.push(tx);
    } catch (e) {
      console.warn('parse message failed', id, e.message);
    }
  }
  return {
    transactions: txs,
    scanned: ids.length,
    parsed: txs.length,
    fromSenders: senderIds.length,
    fromKeywords: keywordIds.length,
  };
}