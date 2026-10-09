import { router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { FlatList, RefreshControl, ScrollView, View } from 'react-native';

import { MARKETPLACE_CATEGORIES, MARKETPLACE_MODES } from '@gwc/contracts/marketplace';
import type { Listing, MarketplaceCategory, MarketplaceMode } from '@gwc/contracts/marketplace';

import { ApiError } from '@/api/client';
import { authApi, marketplaceApi } from '@/api/endpoints';
import { ThemedText } from '@/components/themed-text';
import { Card, Chip, Loading, styles } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { usePaged } from '@/hooks/use-paged';
import { useTheme } from '@/hooks/use-theme';
import { useTranslations } from '@/i18n';

/**
 * The marketplace tab (008 US6, delivered by feature 017): the same listings,
 * filters and order the web shows, because both faces call one API. Filters
 * are the contract's enums; which listings match is the server's answer.
 */
export default function Marketplace() {
  const theme = useTheme();
  const { t, formatDate } = useTranslations();
  const [category, setCategory] = useState<MarketplaceCategory | ''>('');
  const [mode, setMode] = useState<MarketplaceMode | ''>('');

  const fetchPage = useCallback(
    (cursor: string | null) => marketplaceApi.list({ category: category || undefined, mode: mode || undefined, cursor }),
    [category, mode],
  );
  const listings = usePaged<Listing>(fetchPage, [category, mode]);

  // Whether to SHOW "New listing" — display only. The server refuses a post
  // without `marketplace_post` whatever this says (Principle I). Re-read on
  // every focus, so a revoked flag hides the button on the next visit, the way
  // the server's refusal takes effect on the next request.
  const [canPost, setCanPost] = useState(false);
  useFocusEffect(useCallback(() => {
    authApi.me().then(
      (me) => setCanPost(me.kind === 'member' && me.permissions.includes('marketplace_post')),
      (e) => console.error('Marketplace.loadMe', e instanceof ApiError ? e.problem : e),
    );
  }, []));

  // Coming back from a listing or from posting one: show what changed. Skipped
  // on the first focus, which the initial load already covers.
  const focusedOnce = useRef(false);
  useFocusEffect(useCallback(() => {
    if (focusedOnce.current) void listings.reload(true);
    focusedOnce.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listings.reload]));

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <Stack.Screen options={{
        headerRight: canPost ? () => (
          <ThemedText accessibilityRole="button" style={{ color: theme.tint, fontWeight: '600' }}
            onPress={() => router.push('/marketplace/new')}>
            {t.marketplace.newListing}
          </ThemedText>
        ) : undefined,
      }} />
      {/* Horizontal: five category chips do not fit a phone's width. */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }}
        contentContainerStyle={[styles.row, { paddingHorizontal: Spacing.three, paddingTop: Spacing.three }]}
        accessibilityRole="radiogroup">
        <Chip label={t.marketplace.allCategories} selected={category === ''} onPress={() => setCategory('')} />
        {MARKETPLACE_CATEGORIES.map((c) => (
          <Chip key={c} label={t.marketplace.categories[c]} selected={category === c} onPress={() => setCategory(c)} />
        ))}
      </ScrollView>
      <View style={[styles.row, { padding: Spacing.three }]} accessibilityRole="radiogroup">
        <Chip label={t.marketplace.allModes} selected={mode === ''} onPress={() => setMode('')} />
        {MARKETPLACE_MODES.map((m) => (
          <Chip key={m} label={t.marketplace.modes[m]} selected={mode === m} onPress={() => setMode(m)} />
        ))}
      </View>
      {listings.loading ? <Loading /> : (
        <FlatList
          data={listings.items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingHorizontal: Spacing.three, paddingBottom: Spacing.four, gap: Spacing.two }}
          renderItem={({ item }) => (
            <Card onPress={() => router.push(`/marketplace/listing/${item.id}`)}>
              <View style={[styles.row, { justifyContent: 'space-between' }]}>
                <ThemedText type="smallBold" style={{ flex: 1 }} numberOfLines={1}>{item.title}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">{t.marketplace.modes[item.mode]}</ThemedText>
              </View>
              <ThemedText type="small" numberOfLines={2}>{item.body}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {[t.marketplace.categories[item.category], formatDate(item.createdAt), item.owner?.displayName]
                  .filter(Boolean).join(' · ')}
              </ThemedText>
            </Card>
          )}
          onEndReached={listings.loadMore}
          onEndReachedThreshold={0.5}
          refreshControl={<RefreshControl refreshing={listings.refreshing} onRefresh={() => listings.reload(true)} />}
          ListEmptyComponent={
            <ThemedText themeColor="textSecondary" style={{ padding: Spacing.four, textAlign: 'center' }}>
              {t.marketplace.empty}
            </ThemedText>
          }
        />
      )}
    </View>
  );
}
