import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

/**
 * Module-scope notification setup (feature 011, research R9). Imported once,
 * from the root layout, so it runs before any notification can arrive.
 *
 * In the foreground the OS banner is shown and listed, silently (FR-007): a
 * member looking at the app already has its attention, and a sound on top of
 * the banner would be noise. The banner is the OS's own, so no in-app
 * component duplicates it.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

/**
 * The Android channel every push names (`channelId: 'default'` on the server).
 *
 * Must exist before the permission request: from Android 13 the system shows
 * the prompt only once the app has created a channel, and a push to a channel
 * that does not exist is dropped without a trace.
 */
export async function ensureAndroidChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('default', {
    name: 'German World Club',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}
