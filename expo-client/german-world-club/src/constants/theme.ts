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
    accent: '#C9A227',
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
    accent: '#E0BD4A',
    border: '#30343A',
    danger: '#EF7B7B',
    success: '#7BC47F',
  },
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
