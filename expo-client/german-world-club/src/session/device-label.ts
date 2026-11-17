import * as Device from 'expo-device';
import { Platform } from 'react-native';

/**
 * What this phone calls itself in the member's device list (feature 026).
 * The model name only ("iPhone 15"), never the user's own device name, which
 * usually contains their name. The server caps and cleans it again.
 */
export const deviceLabel = (): string => (Device.modelName || Platform.OS || 'Phone').slice(0, 64);
