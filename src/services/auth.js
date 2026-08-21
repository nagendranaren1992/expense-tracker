// Google identity session — login gate for multi-user Spends.
// Tokens stay on-device; each Google account gets its own local data namespace.

import AsyncStorage from '@react-native-async-storage/async-storage';

const SESSION_KEY = 'expenses.session.v1';

/**
 * @typedef {{
 *   userId: string,
 *   email: string,
 *   name?: string,
 *   picture?: string,
 *   accessToken?: string,
 *   signedInAt: string,
 * }} Session
 */

/** @returns {Promise<Session|null>} */
export async function getSession() {
  try {
    const raw = await AsyncStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s?.userId || !s?.email) return null;
    return s;
  } catch (e) {
    console.warn('getSession failed', e);
    return null;
  }
}

/** @param {Session} session */
export async function saveSession(session) {
  await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export async function clearSession() {
  await AsyncStorage.removeItem(SESSION_KEY);
}

/** Fetch Google profile from an OAuth access token. */
export async function fetchGoogleProfile(accessToken) {
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Could not load Google profile (${res.status})`);
  }
  const data = await res.json();
  if (!data.sub) throw new Error('Google profile missing user id');
  return {
    userId: String(data.sub),
    email: data.email || '',
    name: data.name || '',
    picture: data.picture || '',
  };
}

export function isAuthError(err) {
  const msg = String(err?.message || err || '');
  return /\b401\b|\b403\b|invalid.?token|unauthor/i.test(msg);
}
