import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';

import { COUNTRIES, PINNED, type Country } from '@gwc/contracts/countries';

import { ThemedText } from '@/components/themed-text';
import { TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useTranslations } from '@/i18n';

/** Search-as-you-type over every country, the pinned ones first. */
export function CountryPicker({ selected, onSelect }: { selected?: string; onSelect: (code: string) => void }) {
  const theme = useTheme();
  const { t, locale } = useTranslations();
  const [query, setQuery] = useState('');

  const items = useMemo(() => {
    const name = (c: Country) => c[locale];
    const sorted = [...COUNTRIES].sort((a, b) => name(a).localeCompare(name(b), locale));
    const pinned = PINNED.map((code) => COUNTRIES.find((c) => c.code === code)!).filter(Boolean);
    const all = [...pinned, ...sorted.filter((c) => !(PINNED as readonly string[]).includes(c.code))];
    const needle = query.trim().toLocaleLowerCase(locale);
    if (!needle) return all;
    // Both names match, so somebody typing "Deutsch" in the English interface
    // still finds Germany.
    return all.filter((c) => c.en.toLocaleLowerCase().includes(needle) || c.de.toLocaleLowerCase().includes(needle));
  }, [locale, query]);

  return (
    <View style={{ flex: 1, gap: Spacing.two }}>
      <TextField
        label={t.register.countrySearch}
        value={query}
        onChangeText={setQuery}
        autoCorrect={false}
        autoCapitalize="none"
      />
      <FlatList
        data={items}
        keyExtractor={(c) => c.code}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => {
          const isSelected = item.code === selected;
          return (
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ selected: isSelected }}
              onPress={() => onSelect(item.code)}
              style={[styles.row, { borderColor: theme.border, backgroundColor: isSelected ? theme.backgroundSelected : undefined }]}>
              <ThemedText style={{ flex: 1 }}>{item[locale]}</ThemedText>
              {isSelected ? <ThemedText style={{ color: theme.tint }}>✓</ThemedText> : null}
            </Pressable>
          );
        }}
      />
    </View>
  );
}

export const countryName = (code: string | null | undefined, locale: 'en' | 'de') =>
  (code && COUNTRIES.find((c) => c.code === code)?.[locale]) ?? code ?? '';

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
