import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';

import type { Conversation } from '@gwc/contracts/messaging';

import { messagingApi } from '@/api/endpoints';
import { ThemedText } from '@/components/themed-text';
import { Card, Centered, Loading } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { usePaged } from '@/hooks/use-paged';
import { useTranslations } from '@/i18n';

/**
 * Messages: every conversation about a listing, newest activity first
 * (feature 020, US3). Re-read on focus, so a reply that arrived while the
 * member was elsewhere shows — there is no real-time transport (008).
 */
export default function Inbox() {
  const { t, format, formatDate } = useTranslations();
  const inbox = usePaged<Conversation>((cursor) => messagingApi.inbox(cursor), []);
  const { reload } = inbox;
  useFocusEffect(useCallback(() => { void reload(true); }, [reload]));

  if (inbox.loading && inbox.items.length === 0) return <Loading />;

  return (
    <FlatList
      data={inbox.items}
      keyExtractor={(c) => c.id}
      contentContainerStyle={{ padding: Spacing.three, gap: Spacing.two }}
      refreshControl={<RefreshControl refreshing={inbox.refreshing} onRefresh={() => void reload(true)} />}
      onEndReached={() => void inbox.loadMore()}
      ListEmptyComponent={<Centered><ThemedText themeColor="textSecondary">{t.messages.empty}</ThemedText></Centered>}
      renderItem={({ item }) => (
        <Card onPress={() => router.push(`/marketplace/messages/${item.id}`)}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.two }}>
            <ThemedText type={item.unreadCount > 0 ? 'smallBold' : 'small'} style={{ flex: 1 }} numberOfLines={1}>
              {item.subject.title ?? t.messages.listingGone}
            </ThemedText>
            {item.unreadCount > 0 ? (
              <ThemedText type="smallBold">{format(t.messages.unread, { n: item.unreadCount })}</ThemedText>
            ) : null}
          </View>
          <ThemedText type="small" themeColor="textSecondary">{item.counterpart?.displayName ?? ''}</ThemedText>
          {item.lastMessage ? (
            <ThemedText numberOfLines={2}>{item.lastMessage.excerpt}</ThemedText>
          ) : null}
          <ThemedText type="small" themeColor="textSecondary">{formatDate(item.lastMessageAt, true)}</ThemedText>
        </Card>
      )}
    />
  );
}
