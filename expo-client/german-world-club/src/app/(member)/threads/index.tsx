import { router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';

import type { FeedItem, FeedScope } from '@gwc/contracts/threads';

import { threadsApi } from '@/api/endpoints';
import { PostCard } from '@/components/post-card';
import { ThemedText } from '@/components/themed-text';
import { Chip, Loading, Message, styles } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { usePaged } from '@/hooks/use-paged';
import { useTheme } from '@/hooks/use-theme';
import { useTranslations } from '@/i18n';

/** The feed (§7): people you follow, or everybody. */
export default function Feed() {
  const theme = useTheme();
  const { t, problemMessage } = useTranslations();
  const [scope, setScope] = useState<FeedScope>('following');
  const fetchPage = useCallback((cursor: string | null) => threadsApi.feed(scope, cursor), [scope]);
  const feed = usePaged<FeedItem>(fetchPage, [scope]);

  // Coming back from compose or a thread: show what changed there. Skipped on
  // the first focus, which the initial load already covers.
  const focusedOnce = useRef(false);
  useFocusEffect(useCallback(() => {
    if (focusedOnce.current) void feed.reload(true);
    focusedOnce.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feed.reload]));

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <Stack.Screen options={{
        headerRight: () => (
          <ThemedText accessibilityRole="button" style={{ color: theme.tint, fontWeight: '600' }}
            onPress={() => router.push('/threads/compose')}>
            {t.threads.compose}
          </ThemedText>
        ),
      }} />
      <View style={[styles.row, { padding: Spacing.three }]} accessibilityRole="radiogroup">
        <Chip label={t.threads.following} selected={scope === 'following'} onPress={() => setScope('following')} />
        <Chip label={t.threads.all} selected={scope === 'all'} onPress={() => setScope('all')} />
      </View>
      {feed.loading ? <Loading /> : (
        <FlatList
          data={feed.items}
          keyExtractor={(item) => `${item.post.id}:${item.repostedBy?.id ?? ''}`}
          renderItem={({ item }) => (
            <PostCard
              post={item.post}
              repostedBy={item.repostedBy}
              onChange={(post) => feed.setItems((all) => all.map((i) => (i.post.id === post.id ? { ...i, post } : i)))}
              onRemoved={(id) => feed.setItems((all) => all.filter((i) => i.post.id !== id))}
            />
          )}
          onEndReached={feed.loadMore}
          onEndReachedThreshold={0.5}
          refreshControl={<RefreshControl refreshing={feed.refreshing} onRefresh={() => feed.reload(true)} />}
          ListHeaderComponent={feed.error ? <View style={{ padding: Spacing.three }}><Message text={problemMessage(feed.error)} /></View> : null}
          ListEmptyComponent={
            <ThemedText themeColor="textSecondary" style={{ padding: Spacing.four, textAlign: 'center' }}>
              {scope === 'following' ? t.threads.emptyFollowing : t.common.empty}
            </ThemedText>
          }
        />
      )}
    </View>
  );
}
