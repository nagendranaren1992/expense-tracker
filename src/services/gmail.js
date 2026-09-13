// Gmail + Google Sign-In (login gate + bank-alert sync).
//
// Login and Sync both use the same OAuth clients. Identity scopes identify the
// user; gmail.readonly pulls transaction alerts. Tokens stay on the device.
//
// Sync network strategy (minimize round-trips):
// - One Gmail search (sender ∪ keyword combined)
// - Native: one multipart batch for all message bodies
// - Web: Google's batch endpoint is CORS-blocked, so we fetch format=metadata
//   (snippet + headers only) — enough for most bank alerts, and no attachment
//   storm. Already-synced message ids are skipped on later syncs.
// ─────────────────────────────────────────────────────────────────────────

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as WebBrowser from 'expo-web-browser';
import * as Google from 'expo-auth-session/providers/google';
import { BANK_SENDERS, parseTransactionEmail } from './emailParser';
import { applyFxToTransactions } from './fx';

WebBrowser.maybeCompleteAuthSession();

export const CLIENT_IDS = {
  webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || '',
  iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || '',
  androidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID || '',
};

export const GMAIL_SCOPES = [
  'openid',
  'profile',
  'email',
  'https://www.googleapis.com/auth/gmail.readonly',
];

const SEEN_IDS_KEY = 'expenses.gmail.seenIds.v1';

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
      'Set EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID in .env (copy from .env.example). ' +
      'Google Cloud → Credentials → iOS client, bundle ID: com.example.expensetracker. ' +
      'Or run on web (press w) with the Web client ID.'
    );
  }
  if (Platform.OS === 'android') {
    return (
      'Set EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID in .env (copy from .env.example). ' +
      'Google Cloud → Credentials → Android client, package: com.example.expensetracker. ' +
      'Or run on web (press w) with the Web client ID.'
    );
  }
  return 'Set EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID in .env (copy from .env.example), then tap Sync.';
}

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

const GMAIL_PROMO_EXCLUDE =
  '-from:mailers.hdfcbank -from:mailers -subject:offer -subject:voucher ' +
  '-subject:discount -subject:"waiting for you" -"on spends of" -"offer update" ' +
  '-"check offer" -"offer valid" -"discount up to" -"shop smarter"';

/** One combined search — avoids two list API calls. */
function buildCombinedQuery({ days = 7 } = {}) {
  const fromClause = BANK_SENDERS.map((s) => `from:${s}`).join(' OR ');
  const keywords =
    `"has been used for a transaction" OR "debited" OR "credited" OR ` +
    `"spent" OR "debited from" OR "has been done" OR "ending with" OR ` +
    `"payment was made" OR "payment of" OR towards OR BOBCARD OR ` +
    `subject:"Credit Card Transaction Alert from HSBC" OR ` +
    `subject:(transaction OR debited OR spent OR payment OR BOBCARD) OR ` +
    `"USD." OR "USD "`;

  return (
    `((${fromClause}) OR (${keywords})) ` +
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

const GMAIL_BATCH_URL = 'https://www.googleapis.com/batch/gmail/v1';
const GMAIL_BATCH_SIZE = 50;

function buildGmailBatchBody(messageIds, boundary, format = 'full') {
  const parts = messageIds.map((id, i) => {
    return [
      `--${boundary}`,
      'Content-Type: application/http',
      `Content-ID: <msg-${i}>`,
      '',
      `GET /gmail/v1/users/me/messages/${id}?format=${format} HTTP/1.1`,
      '',
    ].join('\r\n');
  });
  parts.push(`--${boundary}--`);
  return parts.join('\r\n');
}

function parseGmailBatchResponse(text, boundary) {
  const marker = `--${boundary}`;
  const chunks = text.split(marker).slice(1);
  const messages = [];

  for (const chunk of chunks) {
    if (!chunk || chunk.trim() === '--') continue;
    const jsonStart = chunk.indexOf('{');
    const jsonEnd = chunk.lastIndexOf('}');
    if (jsonStart === -1 || jsonEnd <= jsonStart) continue;
    try {
      const msg = JSON.parse(chunk.slice(jsonStart, jsonEnd + 1));
      if (msg?.id) messages.push(msg);
    } catch (e) {
      console.warn('batch part parse failed', e?.message || e);
    }
  }
  return messages;
}

/** Native-only: one HTTP request for many messages. Web CORS blocks this. */
async function batchGetMessages(messageIds, accessToken, format = 'full') {
  if (!messageIds.length) return [];

  const all = [];
  for (let i = 0; i < messageIds.length; i += GMAIL_BATCH_SIZE) {
    const chunk = messageIds.slice(i, i + GMAIL_BATCH_SIZE);
    const boundary = `batch_gmail_${Date.now()}_${i}`;
    const body = buildGmailBatchBody(chunk, boundary, format);

    const res = await fetch(GMAIL_BATCH_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/mixed; boundary=${boundary}`,
      },
      body,
    });

    if (!res.ok) {
      throw new Error(`Gmail batch ${res.status}: ${await res.text()}`);
    }

    const responseText = await res.text();
    const responseBoundary =
      res.headers.get('content-type')?.match(/boundary=([^;\s]+)/i)?.[1] || boundary;
    const parsed = parseGmailBatchResponse(responseText, responseBoundary);
    const byId = new Map(parsed.map((m) => [m.id, m]));
    for (const id of chunk) {
      const msg = byId.get(id);
      if (msg) all.push(msg);
    }
  }
  return all;
}

function decodeBase64Url(data) {
  if (!data) return '';
  const b64 = data.replace(/-/g, '+').replace(/_/g, '/');
  try {
    if (typeof atob === 'function') return decodeURIComponent(escape(atob(b64)));
    // eslint-disable-next-line no-undef
    return Buffer.from(b64, 'base64').toString('utf-8');
  } catch {
    return '';
  }
}

function htmlToText(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&rs?;|&#8377;/gi, '₹')
    .replace(/&[a-z0-9#]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Inline body only — never fetch attachments (those caused dozens of APIs). */
function extractInlineBody(payload) {
  if (!payload) return '';
  if (
    payload.body?.data &&
    (!payload.parts || payload.mimeType === 'text/plain' || payload.mimeType === 'text/html')
  ) {
    const raw = decodeBase64Url(payload.body.data);
    return payload.mimeType === 'text/html' ? htmlToText(raw) : raw;
  }
  let plain = '';
  let htmlText = '';
  const walk = (part) => {
    if (!part) return;
    if (part.mimeType === 'text/plain' && part.body?.data) {
      plain += decodeBase64Url(part.body.data) + '\n';
    } else if (part.mimeType === 'text/html' && part.body?.data) {
      htmlText += htmlToText(decodeBase64Url(part.body.data)) + '\n';
    }
    for (const child of part.parts || []) walk(child);
  };
  walk(payload);
  return (plain.trim() || htmlText.trim());
}

function header(headers = [], name) {
  const h = headers.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : '';
}

function emailFromMessage(msg) {
  const headers = msg.payload?.headers || [];
  const subject = header(headers, 'Subject');
  const from = header(headers, 'From');
  const inline = extractInlineBody(msg.payload);
  // metadata format has snippet; full format may too
  const body = inline || msg.snippet || '';
  return {
    from,
    subject,
    body,
    date: msg.internalDate ? new Date(Number(msg.internalDate)) : new Date(),
  };
}

async function listMessageIds(query, accessToken, max) {
  const q = encodeURIComponent(query);
  const list = await api(`/messages?q=${q}&maxResults=${max}`, accessToken);
  return (list.messages || []).map((m) => m.id);
}

async function loadSeenIds() {
  try {
    const raw = await AsyncStorage.getItem(SEEN_IDS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

async function saveSeenIds(ids) {
  // Keep a bounded ring so storage doesn't grow forever
  const list = [...ids].slice(-500);
  await AsyncStorage.setItem(SEEN_IDS_KEY, JSON.stringify(list));
}

/**
 * Web: fetch metadata (headers + snippet) for many ids with limited concurrency.
 * Still N requests (Gmail has no CORS-safe batch), but tiny payloads and no
 * attachment follow-ups — typically what filled the Network tab before.
 */
async function fetchMessagesMetadata(messageIds, accessToken, concurrency = 6) {
  const out = [];
  let i = 0;
  async function worker() {
    while (i < messageIds.length) {
      const id = messageIds[i++];
      try {
        const msg = await api(
          `/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`,
          accessToken
        );
        out.push(msg);
      } catch (e) {
        console.warn('metadata fetch failed', id, e?.message || e);
      }
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, messageIds.length) }, () =>
    worker()
  );
  await Promise.all(workers);
  return out;
}

async function fetchMessages(messageIds, accessToken) {
  if (!messageIds.length) return [];

  // Native: one batch HTTP call.
  if (Platform.OS !== 'web') {
    try {
      return await batchGetMessages(messageIds, accessToken, 'full');
    } catch (e) {
      console.warn('Gmail batch failed, using metadata fetches', e?.message || e);
    }
  }

  // Web (or batch failure): metadata + snippet only — no format=full, no attachments.
  return fetchMessagesMetadata(messageIds, accessToken);
}

/**
 * Fetch recent bank alerts and parse them into transactions.
 * @param {string} accessToken
 * @param {{days?:number, max?:number, forceFull?:boolean}} opts
 */
export async function fetchAndParse(accessToken, { days = 14, max = 100, forceFull = false } = {}) {
  const ids = await listMessageIds(buildCombinedQuery({ days }), accessToken, max);
  const seen = forceFull ? new Set() : await loadSeenIds();
  const freshIds = ids.filter((id) => !seen.has(id));

  // Nothing new — 1 list call total, zero message gets.
  if (!freshIds.length) {
    return {
      transactions: [],
      scanned: ids.length,
      parsed: 0,
      skippedSeen: ids.length,
      fromSenders: ids.length,
      fromKeywords: 0,
    };
  }

  const messages = await fetchMessages(freshIds, accessToken);
  const parsed = [];

  for (const msg of messages) {
    try {
      const tx = parseTransactionEmail(emailFromMessage(msg));
      if (tx) {
        tx.gmailId = msg.id;
        parsed.push(tx);
      }
    } catch (e) {
      console.warn('parse message failed', msg?.id, e.message);
    }
  }

  const txs = await applyFxToTransactions(parsed);

  for (const id of freshIds) seen.add(id);
  await saveSeenIds(seen);

  return {
    transactions: txs,
    scanned: ids.length,
    parsed: txs.length,
    skippedSeen: ids.length - freshIds.length,
    fetched: freshIds.length,
    fromSenders: ids.length,
    fromKeywords: 0,
  };
}

export async function clearGmailSeenIds() {
  await AsyncStorage.removeItem(SEEN_IDS_KEY);
}
