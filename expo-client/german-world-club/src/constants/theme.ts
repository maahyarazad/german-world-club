/** Design tokens: colours for light and dark, spacing, fonts. Components read them through `useTheme()`. */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#11181C',
    background: '#ffffff',
    backgroundElement: '#F2F3F5',
    backgroundSelected: '#E3E5E8',
    textSecondary: '#60646C',
    // The club's deep navy, with a warm gold for emphasis.
    tint: '#0B2545',
    onTint: '#ffffff',
    // The confirm buttons (Sign in, Continue, …): the club's navy by day.
    primary: '#0B2545',
    accent: '#C9A227',
    // Gold that may carry text. `accent` is 2.42:1 on white, below even the 3:1
    // large-text floor; this is the smallest darkening of the same hue that
    // reaches 5.10:1 on `background` (4.60:1 on `backgroundElement`).
    accentText: '#856B1A',
    border: '#D9DCE0',
    danger: '#C62828',
    success: '#2E7D32',
  },
  dark: {
    text: '#ECEDEE',
    background: '#0B0D10',
    backgroundElement: '#1A1D21',
    backgroundSelected: '#2A2E33',
    textSecondary: '#A0A5AB',
    tint: '#8FB3E8',
    onTint: '#0B0D10',
    // …and its gold at night, where the pale-blue `tint` read as washed out on the backdrop.
    // `onTint` (near black) on it is about 10:1.
    primary: '#E0BD4A',
    accent: '#E0BD4A',
    // Already 10.7:1 on `background`, so the dark scheme reuses `accent`.
    accentText: '#E0BD4A',
    border: '#30343A',
    danger: '#EF7B7B',
    success: '#7BC47F',
  },
} as const;

/**
 * The wash laid over the backdrop image (`AppBackground`), measured against the art
 * (feature 043, specs/043-expo-password-reset/research.md R13; contrast is WCAG, 4.5:1 is
 * the minimum for text).
 *
 * The two schemes have different art, so they get different treatment:
 *  - light: cream (#FFF5E6) with fine gold lines. Body text is already 16.6:1 on it and
 *    secondary text 5.5:1, so NO wash. (The old white veil, written for grey art, would only
 *    bleach the gold lines.) Written `transparent`, never an empty string, which is not a colour.
 *  - dark: slate (#60646C) with yellow lines. Body text is 5.1:1 and secondary text only 2.4:1
 *    with no wash; the 0.5 black wash below makes them 11.0:1 and 5.2:1.
 *
 * Do not lower the dark alpha below about 0.45 to show more of the art: secondary text falls
 * under 4.5:1 (it is 4.1:1 at 0.35). If you want it lighter, recolour `textSecondary` for the
 * dark theme first, and change client/tests/assets/expo-backdrop.test.ts with it.
 */
export const BackdropScrim = {
  light: 'transparent',
  dark: 'rgba(0, 0, 0, 0.5)',
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
