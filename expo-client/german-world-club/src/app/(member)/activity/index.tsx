import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';

import type { ActivityItem } from '@gwc/contracts/threads';

import { threadsApi } from '@/api/endpoints';
import { Avatar } from '@/components/avatar';
import { ThemedText } from '@/components/themed-text';
import { Loading, Message } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { usePaged } from '@/hooks/use-paged';
import { publishUnread } from '@/hooks/use-unread';
import { useTheme } from '@/hooks/use-theme';
import { useTranslations } from '@/i18n';

/**
 * Activity (010 US5): likes, replies, quotes, reposts, mentions and follows
 * concerning you — computed by the server from the facts themselves. Opening
 * it moves the unread boundary to the newest item; the server only ever moves
 * it forward.
 */
export default function Activity() {
  const theme = useTheme();
  const { t, format, formatDate, problemMessage } = useTranslations();
  const fetchPage = useCallback((cursor: string | null) => threadsApi.activity(cursor), []);
  const list = usePaged<ActivityItem>(fetchPage, []);

  useFocusEffect(useCallback(() => {
    void list.reload(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []));

  const newest = list.items[0]?.at;
  useFocusEffect(useCallback(() => {
    if (!newest) return;
    threadsApi.markSeen(newest).then(() => publishUnread(0)).catch(() => {});
  }, [newest]));

  if (list.loading) return <Loading />;

  return (
    <FlatList
      style={{ backgroundColor: theme.background }}
      data={list.items}
      keyExtractor={(i) => `${i.kind}:${i.post?.id ?? ''}:${i.actor.id}:${i.at}`}
      onEndReached={list.loadMore}
      refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={() => list.reload(true)} />}
      ListHeaderComponent={list.error ? <View style={{ padding: Spacing.three }}><Message text={problemMessage(list.error)} /></View> : null}
      ListEmptyComponent={<ThemedText themeColor="textSecondary" style={{ padding: Spacing.four, textAlign: 'center' }}>{t.activity.empty}</ThemedText>}
      renderItem={({ item }) => {
        const name = item.actor.displayName ?? `@${item.actor.handle ?? ''}`;
        const open = () => (item.post
          ? router.push({ pathname: '/threads/[id]', params: { id: item.post.id } })
          : router.push({ pathname: '/threads/member/[id]', params: { id: item.actor.id } }));
        return (
          <Pressable onPress={open} style={{ flexDirection: 'row', gap: Spacing.two, padding: Spacing.three, borderBottomWidth: 0.5, borderColor: theme.border }}>
            <Avatar author={item.actor} label={format(t.profile.avatarAlt, { name })} />
            <View style={{ flex: 1, gap: 2 }}>
              <ThemedText>{format(t.activity.kinds[item.kind], { name })}</ThemedText>
              {item.post?.body ? <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>{item.post.body}</ThemedText> : null}
              <ThemedText type="small" themeColor="textSecondary">{formatDate(item.at, true)}</ThemedText>
            </View>
          </Pressable>
        );
      }}
    />
  );
}
