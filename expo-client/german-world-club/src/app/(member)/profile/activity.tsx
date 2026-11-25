import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { FlashList } from '@shopify/flash-list';
import { Pressable, RefreshControl, View, StyleSheet } from 'react-native';

import type { ActivityItem } from '@gwc/contracts/threads';

import { threadsApi } from '@/api/endpoints';
import { Avatar } from '@/components/avatar';
import { ThemedText } from '@/components/themed-text';
import { Loading } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { usePaged } from '@/hooks/use-paged';
import { publishUnread } from '@/hooks/use-unread';
import { useTranslations } from '@/i18n';
import { ApiError } from '@/api/client';
import { useThemedStyles, type AppTheme } from '@/hooks/use-themed-styles';

/**
 * Activity (010 US5), reached from Profile since the Offers tab took its place:
 * likes, replies, quotes, reposts, mentions and follows
 * concerning you — computed by the server from the facts themselves. Opening
 * it moves the unread boundary to the newest item; the server only ever moves
 * it forward.
 */
export default function Activity() {
  const themed = useThemedStyles(makeStyles);
  const { t, format, formatDate } = useTranslations();
  const fetchPage = useCallback((cursor: string | null) => threadsApi.activity(cursor), []);
  const list = usePaged<ActivityItem>(fetchPage, []);

  useFocusEffect(useCallback(() => {
    void list.reload(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []));

  const newest = list.items[0]?.at;
  useFocusEffect(useCallback(() => {
    if (!newest) return;
    threadsApi.markSeen(newest).then(() => publishUnread(0)).catch((e) => { console.error('Activity.markSeen', e instanceof ApiError ? e.problem : e); });
  }, [newest]));

  if (list.loading) return <Loading />;

  return (
    <FlashList
      style={themed.clear}
      // Rows differ by kind (a follow has no post excerpt), so recycle like with like.
      getItemType={(i) => i.kind}
      data={list.items}
      keyExtractor={(i) => `${i.kind}:${i.post?.id ?? ''}:${i.actor.id}:${i.at}`}
      onEndReached={list.loadMore}
      refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={() => list.reload(true)} />}
      ListEmptyComponent={<ThemedText themeColor="textSecondary" style={styles.paddingFourTextCenter}>{t.activity.empty}</ThemedText>}
      renderItem={({ item }) => {
        const name = item.actor.displayName ?? `@${item.actor.handle ?? ''}`;
        const open = () => (item.post
          ? router.push({ pathname: '/threads/[id]', params: { id: item.post.id } })
          : router.push({ pathname: '/threads/member/[id]', params: { id: item.actor.id } }));
        return (
          <Pressable onPress={open} style={themed.pressableRow5}>
            <Avatar author={item.actor} label={format(t.profile.avatarAlt, { name })} />
            <View style={styles.flex1Gap2}>
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

const styles = StyleSheet.create({
  paddingFourTextCenter: { padding: Spacing.four, textAlign: 'center' },
  flex1Gap2: { flex: 1, gap: 2 },
});

const makeStyles = (theme: AppTheme) =>
  StyleSheet.create({
    clear: { backgroundColor: 'transparent' },
    pressableRow5: { flexDirection: 'row', gap: Spacing.two, padding: Spacing.three, borderBottomWidth: 0.5, borderColor: theme.border },
  });
