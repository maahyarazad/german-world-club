import type { StoredSession } from './storage';

/**
 * Web has no SecureStore, and the member web client (`client/`) is the web
 * face — this app's web build exists for development previews only. So on web
 * nothing is persisted: a reload signs you out. Putting a 90-day refresh token
 * in localStorage to make a preview convenient is the trade this declines.
 */

let session: StoredSession | null = null;
let device: string | null = null;
let locale: string | null = null;
let pushAsked = false;
let pushDevice: string | null = null;

export type { StoredSession };

export const loadSession = async () => session;
export const saveSession = async (next: StoredSession) => { session = next; };
export const clearSession = async () => { session = null; };
export async function deviceId() {
  device ??= globalThis.crypto.randomUUID();
  return device;
}
export const loadLocale = async () => locale;
export const saveLocale = async (next: string) => { locale = next; };
// Push is native-only (the web build never registers), kept for the shared interface.
export const loadPushAsked = async () => pushAsked;
export const savePushAsked = async () => { pushAsked = true; };
export const loadPushDeviceId = async () => pushDevice;
export const savePushDeviceId = async (id: string) => { pushDevice = id; };
export const clearPushDeviceId = async () => { pushDevice = null; };
