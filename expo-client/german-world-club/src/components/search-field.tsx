import { memo } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useThemedStyles, type AppTheme } from '@/hooks/use-themed-styles';

/**
 * A compact search box with a clear button (feature 042), for the top of a list.
 *
 * No visible label: on a list screen a bold caption above the box is noise, and the
 * placeholder says what it is. The label is still there for a screen reader
 * (`accessibilityLabel`). Every string is a prop, so the screen translates it.
 *
 * Keep it **mounted** while the list under it reloads: a screen that swaps the whole list
 * for a loader must put this above that swap, or the box unmounts on every keystroke and
 * the keyboard closes.
 */
export const SearchField = memo(function SearchField({
  value, onChangeText, label, placeholder, clearLabel,
}: {
  value: string;
  onChangeText: (next: string) => void;
  label: string;
  placeholder: string;
  clearLabel: string;
}) {
  const themed = useThemedStyles(makeStyles);
  const theme = useTheme();
  return (
    <View style={styles.wrap}>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.textSecondary}
        accessibilityLabel={label}
        returnKeyType="search"
        autoCapitalize="none"
        autoCorrect={false}
        style={[styles.input, themed.input]}
      />
      {value !== '' ? (
        <Pressable accessibilityRole="button" accessibilityLabel={clearLabel} hitSlop={Spacing.two} onPress={() => onChangeText('')} style={styles.clear}>
          <ThemedText themeColor="textSecondary">✕</ThemedText>
        </Pressable>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { justifyContent: 'center' },
  input: { borderWidth: 1, borderRadius: 10, paddingLeft: Spacing.three, paddingRight: 44, paddingVertical: 12, fontSize: 16 },
  clear: { position: 'absolute', right: Spacing.three },
});

const makeStyles = (theme: AppTheme) =>
  StyleSheet.create({
    input: { color: theme.text, backgroundColor: theme.backgroundElement, borderColor: theme.border },
  });
