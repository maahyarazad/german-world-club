import { StyleSheet, View, type ViewProps } from 'react-native';

import { ThemeColor } from '@/constants/theme';
import { useThemedStyles, type AppTheme } from '@/hooks/use-themed-styles';

export type ThemedViewProps = ViewProps & {
  lightColor?: string;
  darkColor?: string;
  type?: ThemeColor;
};

export function ThemedView({ style, lightColor, darkColor, type, ...otherProps }: ThemedViewProps) {
  const backgrounds = useThemedStyles(makeBackgrounds);

  return <View style={[backgrounds[type ?? 'background'], style]} {...otherProps} />;
}

/** One background per theme token, so `type` picks a style instead of building one. */
const makeBackgrounds = (theme: AppTheme) =>
  StyleSheet.create({
    text: { backgroundColor: theme.text },
    background: { backgroundColor: theme.background },
    backgroundElement: { backgroundColor: theme.backgroundElement },
    backgroundSelected: { backgroundColor: theme.backgroundSelected },
    textSecondary: { backgroundColor: theme.textSecondary },
    tint: { backgroundColor: theme.tint },
    onTint: { backgroundColor: theme.onTint },
    accent: { backgroundColor: theme.accent },
    accentText: { backgroundColor: theme.accentText },
    border: { backgroundColor: theme.border },
    danger: { backgroundColor: theme.danger },
    success: { backgroundColor: theme.success },
  });
