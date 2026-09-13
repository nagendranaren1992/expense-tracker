// App lock + session. Unlock is device biometrics / passcode (no shared secret).
// Gmail OAuth access tokens live in SecureStore (encrypted on device).

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import * as LocalAuthentication from 'expo-local-authentication';

const SESSION_KEY = 'expenses.session.v1';
const TOKEN_KEY = 'expenses.accessToken.v1';

/** Fixed local namespace for on-device data. */
export const LOCAL_USER_ID = 'local';

/**
 * @typedef {{
 *   userId: string,
 *   email?: string,
 *   name?: string,
 *   picture?: string,
 *   accessToken?: string,
 *   signedInAt: string,
 * }} Session
 */

async function secureGet(key) {
  if (Platform.OS === 'web') {
    return AsyncStorage.getItem(key);
  }
  try {
    return await SecureStore.getItemAsync(key);
  } catch (e) {
    console.warn('SecureStore get failed, falling back', e?.message || e);
    return AsyncStorage.getItem(key);
  }
}

async function secureSet(key, value) {
  if (Platform.OS === 'web') {
    await AsyncStorage.setItem(key, value);
    return;
  }
  try {
    await SecureStore.setItemAsync(key, value);
  } catch (e) {
    console.warn('SecureStore set failed, falling back', e?.message || e);
    await AsyncStorage.setItem(key, value);
  }
}

async function secureDelete(key) {
  if (Platform.OS === 'web') {
    await AsyncStorage.removeItem(key);
    return;
  }
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {
    await AsyncStorage.removeItem(key);
  }
}

/** @returns {Promise<Session|null>} */
export async function getSession() {
  try {
    let raw = await secureGet(SESSION_KEY);
    // One-time migration from legacy plaintext AsyncStorage session.
    if (!raw && Platform.OS !== 'web') {
      try {
        raw = await AsyncStorage.getItem(SESSION_KEY);
        if (raw) {
          const legacy = JSON.parse(raw);
          await saveSession(legacy);
          await AsyncStorage.removeItem(SESSION_KEY);
        }
      } catch {
        /* ignore */
      }
    }
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s?.userId || !s?.signedInAt) return null;
    const token = (await secureGet(TOKEN_KEY)) || s.accessToken;
    if (token) s.accessToken = token;
    else delete s.accessToken;
    return s;
  } catch (e) {
    console.warn('getSession failed', e);
    return null;
  }
}

/** @param {Session} session */
export async function saveSession(session) {
  const { accessToken, ...meta } = session || {};
  await secureSet(SESSION_KEY, JSON.stringify(meta));
  if (accessToken) {
    await secureSet(TOKEN_KEY, accessToken);
  } else {
    await secureDelete(TOKEN_KEY);
  }
}

export async function clearSession() {
  await secureDelete(SESSION_KEY);
  await secureDelete(TOKEN_KEY);
  // Clear legacy plaintext session if present
  try {
    await AsyncStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Prompt Face ID / fingerprint / device passcode.
 * Web has no device biometrics — unlock is allowed (treat browser as unlocked).
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
export async function unlockWithDeviceAuth() {
  if (Platform.OS === 'web') {
    return { success: true };
  }

  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Unlock Spends',
      cancelLabel: 'Cancel',
      fallbackLabel: 'Use passcode',
      disableDeviceFallback: false,
    });
    if (result.success) return { success: true };
    return {
      success: false,
      error: result.error || 'Authentication failed',
    };
  } catch (e) {
    return { success: false, error: String(e?.message || e) };
  }
}

export async function getUnlockLabel() {
  if (Platform.OS === 'web') return 'Continue';
  try {
    const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
    if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
      return 'Unlock with Face ID';
    }
    if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
      return 'Unlock with fingerprint';
    }
  } catch {
    /* ignore */
  }
  return 'Unlock with device passcode';
}

export function isAuthError(err) {
  const msg = String(err?.message || err || '');
  return /\b401\b|\b403\b|invalid.?token|unauthor/i.test(msg);
}
