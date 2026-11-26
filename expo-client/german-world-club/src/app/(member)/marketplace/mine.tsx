import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlashList } from '@shopify/flash-list';
import { View, StyleSheet } from 'react-native';

import type { OwnListingSummary } from '@gwc/contracts/marketplace';

import { ApiError } from '@/api/client';
import { marketplaceApi } from '@/api/endpoints';
import { ScreenLoader } from '@/components/screen-loader';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, Message, styles as uiStyles } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTranslations } from '@/i18n';

/**
 * Your own listings, in every state (feature 037, US1).
 *
 * `GET /marketplace/mine` includes drafts, sold, withdrawn and staff-disabled
 * listings, which the browse tab never shows. What to offer on a row comes from
 * the server's flags: Edit only where `canEdit`, a note where `moderated`. A
 * disabled listing is shown as disabled with no reason — the member is told it
 * was taken down, never by whom or why. Reloaded on every focus, so coming back
 * from an edit shows what changed.
 */
export default function MyListings() {
  const { t, formatDate } = useTranslations();
  const [items, setItems] = useState<OwnListingSummary[] | null>(null);
  // Stops the loader and says why; the refusal itself goes to the console.
  const [failed, setFailed] = useState(false);

  useFocusEffect(useCallback(() => {
    setFailed(false);
    marketplaceApi.mine().then(
      (res) => setItems(res.items),
      (e) => {
        console.error('MyListings.load', e instanceof ApiError ? e.problem : e);
        setFailed(true);
      },
    );
  }, []));

  if (failed) {
    return (
      <View style={styles.padded}>
        <Message tone="info" text={t.marketplace.myListingsLoadFailed} />
      </View>
    );
  }
  if (items === null) return <ScreenLoader />;

  return (
    <FlashList
      data={items}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.content}
      ItemSeparatorComponent={() => <View style={styles.heightTwo} />}
      renderItem={({ item }) => (
        <Card onPress={item.canEdit ? () => router.push(`/marketplace/edit/${item.id}`) : undefined}>
          <View style={[uiStyles.row, styles.justifySpacebetween]}>
            <ThemedText type="smallBold" style={styles.flex1} numberOfLines={1}>{item.title}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">{t.marketplace.states[item.state]}</ThemedText>
          </View>
          <ThemedText type="small" themeColor="textSecondary">
            {[t.marketplace.categories[item.category], formatDate(item.createdAt)].join(' · ')}
          </ThemedText>
          {item.moderated ? <ThemedText type="small">{t.marketplace.publishDisabledByStaff}</ThemedText> : null}
          {item.canEdit ? (
            <Button label={t.marketplace.edit} variant="secondary" onPress={() => router.push(`/marketplace/edit/${item.id}`)} />
          ) : null}
        </Card>
      )}
      ListEmptyComponent={
        <ThemedText themeColor="textSecondary" style={styles.empty}>{t.marketplace.myListingsEmpty}</ThemedText>
      }
    />
  );
}

const styles = StyleSheet.create({
  padded: { padding: Spacing.three },
  content: { paddingHorizontal: Spacing.three, paddingTop: Spacing.three, paddingBottom: Spacing.four },
  heightTwo: { height: Spacing.two },
  justifySpacebetween: { justifyContent: 'space-between' },
  flex1: { flex: 1 },
  empty: { padding: Spacing.four, textAlign: 'center' },
});
