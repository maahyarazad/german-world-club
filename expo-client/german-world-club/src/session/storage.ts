import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

import type { Principal } from '@gwc/contracts/auth';

/**
 * What the app keeps between launches, in the platform keychain/keystore.
 *
 * The refresh token is a credential that outlives the app process (90 days on
 * the mobile face), so it belongs in SecureStore and nowhere else — not in
 * AsyncStorage, which is a plain file on disk.
 */

const KEYS = {
  session: 'gwc.session',
  deviceId: 'gwc.device-id',
  locale: 'gwc.locale',
} as const;

export type StoredSession = {
  accessToken: string;
  refreshToken: string;
  principal: Principal;
};

export async function loadSession(): Promise<StoredSession | null> {
  const raw = await SecureStore.getItemAsync(KEYS.session);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredSession;
  } catch {
    // A corrupt entry is a signed-out app, not a crash on launch.
    await SecureStore.deleteItemAsync(KEYS.session);
    return null;
  }
}

export const saveSession = (session: StoredSession) =>
  SecureStore.setItemAsync(KEYS.session, JSON.stringify(session));

export const clearSession = () => SecureStore.deleteItemAsync(KEYS.session);

/**
 * This installation's device id, minted once and kept.
 *
 * The server binds approval to it (§6.1, §12.6): approving an application
 * approves this device, and a new device is simply one with no approval. So it
 * must be stable across launches and must not be derived from anything that
 * identifies the person — a random UUID is exactly that.
 */
export async function deviceId(): Promise<string> {
  const existing = await SecureStore.getItemAsync(KEYS.deviceId);
  if (existing) return existing;
  const minted = Crypto.randomUUID();
  await SecureStore.setItemAsync(KEYS.deviceId, minted);
  return minted;
}

export const loadLocale = () => SecureStore.getItemAsync(KEYS.locale);
export const saveLocale = (locale: string) => SecureStore.setItemAsync(KEYS.locale, locale);
