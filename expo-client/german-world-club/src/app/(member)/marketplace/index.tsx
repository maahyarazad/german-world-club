import { router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { FlashList } from '@shopify/flash-list';
import { RefreshControl, ScrollView, View, StyleSheet } from 'react-native';

import { MARKETPLACE_CATEGORIES, MARKETPLACE_MODES } from '@gwc/contracts/marketplace';
import type { Listing, MarketplaceCategory, MarketplaceMode } from '@gwc/contracts/marketplace';
import { SEARCH_MIN_LENGTH } from '@gwc/contracts/search';

import { ApiError } from '@/api/client';
import { authApi, marketplaceApi, messagingApi } from '@/api/endpoints';
import { HeaderMenu, type HeaderMenuItem } from '@/components/header-menu';
import { SearchField } from '@/components/search-field';
import { ThemedText } from '@/components/themed-text';
import { Card, Chip, Loading, styles as uiStyles } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { usePaged } from '@/hooks/use-paged';
import { useTranslations } from '@/i18n';
import { useThemedStyles, type AppTheme } from '@/hooks/use-themed-styles';

/**
 * The marketplace tab (008 US6, delivered by feature 017): the same listings,
 * filters and order the web shows, because both faces call one API. Filters
 * are the contract's enums; which listings match is the server's answer.
 */
export default function Marketplace() {
  const themed = useThemedStyles(makeStyles);
  const { t, formatDate } = useTranslations();
  const [category, setCategory] = useState<MarketplaceCategory | ''>('');
  const [mode, setMode] = useState<MarketplaceMode | ''>('');

  // The text search (feature 042): the box, and what is actually sent once the person pauses and has
  // typed enough. `usePaged` restarts from the top when it changes and ignores a superseded answer.
  const [text, setText] = useState('');
  const typed = text.trim();
  const q = useDebouncedValue(typed.length >= SEARCH_MIN_LENGTH ? typed : '');

  const fetchPage = useCallback(
    (cursor: string | null) => marketplaceApi.list({ category: category || undefined, mode: mode || undefined, cursor, q: q || undefined }),
    [category, mode, q],
  );
  const listings = usePaged<Listing>(fetchPage, [category, mode, q]);

  // Whether to SHOW "New listing" — display only (Principle I). Every member
  // may post since feature 021; the server refuses anyone else whatever this
  // says. Re-read on every focus, like every session-derived display.
  const [canPost, setCanPost] = useState(false);
  useFocusEffect(useCallback(() => {
    authApi.me().then(
      (me) => setCanPost(me.kind === 'member'),
      (e) => console.error('Marketplace.loadMe', e instanceof ApiError ? e.problem : e),
    );
  }, []));

  // Feature 020: whether any conversation has something new — the dot on
  // Messages. Re-read on focus; there is no real-time transport (008).
  const [unread, setUnread] = useState(false);
  useFocusEffect(useCallback(() => {
    messagingApi.inbox(null).then(
      (page) => setUnread(page.items.some((c) => c.unreadCount > 0)),
      (e) => console.error('Marketplace.loadUnread', e instanceof ApiError ? e.problem : e),
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

  // What the header's three dots open. Display only (Principle I): the server refuses
  // anyone else whatever this shows.
  const menuItems: HeaderMenuItem[] = [
    { key: 'messages', label: t.messages.open, href: '/marketplace/messages', dot: unread },
    ...(canPost
      ? ([
          { key: 'mine', label: t.marketplace.myListings, href: '/marketplace/mine' },
          { key: 'new', label: t.marketplace.newListing, href: '/marketplace/new' },
        ] satisfies HeaderMenuItem[])
      : []),
  ];

  return (
    <View style={themed.flex1Clear}>
      {/* The three dots in the header (feature 039): Messages always (feature 020 — the five
          bottom-bar slots are full), My listings and New listing only for a member who may
          post. They are rows of a small menu now, not three text buttons. */}
      <Stack.Screen options={{ headerRight: () => <HeaderMenu items={menuItems} /> }} />
      {/* Outside the loading swap below on purpose: that swap unmounts the list on every reload, and a box
          inside it would unmount with it, losing focus and closing the keyboard on every keystroke. */}
      <View style={styles.searchBox}>
        <SearchField value={text} onChangeText={setText} label={t.marketplace.search.label}
          placeholder={t.marketplace.search.placeholder} clearLabel={t.marketplace.search.clear} />
      </View>
      {/* Horizontal: five category chips do not fit a phone's width. */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.flexGrow0}
        contentContainerStyle={[uiStyles.row, styles.scrollViewContentContainerPaddingHorizontalThree2]}
        accessibilityRole="radiogroup">
        <Chip label={t.marketplace.allCategories} selected={category === ''} onPress={() => setCategory('')} />
        {MARKETPLACE_CATEGORIES.map((c) => (
          <Chip key={c} label={t.marketplace.categories[c]} selected={category === c} onPress={() => setCategory(c)} />
        ))}
      </ScrollView>
      <View style={[uiStyles.row, styles.paddingThree]} accessibilityRole="radiogroup">
        <Chip label={t.marketplace.allModes} selected={mode === ''} onPress={() => setMode('')} />
        {MARKETPLACE_MODES.map((m) => (
          <Chip key={m} label={t.marketplace.modes[m]} selected={mode === m} onPress={() => setMode(m)} />
        ))}
      </View>
      {listings.loading ? <Loading /> : (
        <FlashList
          data={listings.items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.flashListContentContainerPaddingHorizontalThree2}
          // FlashList's content container takes padding only, so the old `gap` is a separator.
          ItemSeparatorComponent={() => <View style={styles.heightTwo} />}
          renderItem={({ item }) => (
            <Card onPress={() => router.push(`/marketplace/listing/${item.id}`)}>
              <View style={[uiStyles.row, styles.justifySpacebetween]}>
                <ThemedText type="smallBold" style={styles.flex1} numberOfLines={1}>{item.title}</ThemedText>
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
          // A listing must take the first tap while the keyboard is up, and dragging the list closes it.
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          refreshControl={<RefreshControl refreshing={listings.refreshing} onRefresh={() => listings.reload(true)} />}
          ListEmptyComponent={
            <ThemedText themeColor="textSecondary" style={styles.paddingFourTextCenter}>
              {q ? t.marketplace.search.noResults : t.marketplace.empty}
            </ThemedText>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flexGrow0: { flexGrow: 0 },
  searchBox: { paddingHorizontal: Spacing.three, paddingTop: Spacing.three },
  scrollViewContentContainerPaddingHorizontalThree2: { paddingHorizontal: Spacing.three, paddingTop: Spacing.three },
  paddingThree: { padding: Spacing.three },
  flashListContentContainerPaddingHorizontalThree2: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.four },
  heightTwo: { height: Spacing.two },
  justifySpacebetween: { justifyContent: 'space-between' },
  flex1: { flex: 1 },
  paddingFourTextCenter: { padding: Spacing.four, textAlign: 'center' },
});

const makeStyles = (theme: AppTheme) =>
  StyleSheet.create({
    flex1Clear: { flex: 1, backgroundColor: 'transparent' },
  });
