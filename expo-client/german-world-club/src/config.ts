import Constants from 'expo-constants';

/**
 * Where the API lives.
 *
 * `EXPO_PUBLIC_API_URL` wins when set (staging, production builds). In
 * development it falls back to the machine running Metro, on the API's port:
 * `localhost` would mean the phone itself on a device, and the Android
 * emulator's own loopback on Android — neither of which is where the server is.
 */
function resolveApiUrl() {
  const explicit = process.env.EXPO_PUBLIC_API_URL;
  if (explicit) return explicit.replace(/\/$/, '');
  const host = Constants.expoConfig?.hostUri?.split(':')[0];
  return `http://${host ?? 'localhost'}:3000`;
}

export const API_URL = resolveApiUrl();
