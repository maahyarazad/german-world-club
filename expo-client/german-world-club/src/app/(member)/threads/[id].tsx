import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';

import type { ThreadPost, ThreadView } from '@gwc/contracts/threads';

import { threadsApi } from '@/api/endpoints';
import { PostCard } from '@/components/post-card';
import { ThemedText } from '@/components/themed-text';
import { Centered, Loading, Message } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useTranslations } from '@/i18n';

/** A post in context: what it answers, the post, and its direct replies. */
export default function Thread() {
  const theme = useTheme();
  const { t, problemMessage } = useTranslations();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [view, setView] = useState<ThreadView | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setView(await threadsApi.thread(id));
      setError(null);
    } catch (e) {
      setError(e);
    }
  }, [id]);

  // Reload on focus: returning from compose should show the new reply.
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  if (error && !view) return <Centered><Message text={problemMessage(error)} /></Centered>;
  if (!view) return <Loading />;

  const replace = (post: ThreadPost) => setView((v) => v && ({
    ...v,
    post: v.post.id === post.id ? post : v.post,
    parent: v.parent?.id === post.id ? post : v.parent,
    replies: v.replies.map((r) => (r.id === post.id ? post : r)),
  }));

  return (
    <FlatList
      style={{ backgroundColor: theme.background }}
      data={view.replies}
      keyExtractor={(p) => p.id}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => {
        setRefreshing(true);
        await load();
        setRefreshing(false);
      }} />}
      ListHeaderComponent={
        <View>
          {view.parent ? <PostCard post={view.parent} onChange={replace} /> : null}
          <View style={{ backgroundColor: theme.backgroundElement }}>
            <PostCard post={view.post} onChange={replace} onOpen={false}
              onRemoved={() => router.back()} />
          </View>
          <View style={{ flexDirection: 'row', gap: Spacing.four, paddingHorizontal: Spacing.three, paddingTop: Spacing.two }}>
            {view.post.likeCount > 0 ? (
              <ThemedText type="small" style={{ color: theme.tint }}
                onPress={() => router.push({ pathname: '/threads/people/[id]', params: { id: view.post.id, kind: 'likes' } })}>
                {t.threads.likes} {view.post.likeCount}
              </ThemedText>
            ) : null}
            {view.post.quoteCount > 0 ? (
              <ThemedText type="small" style={{ color: theme.tint }}
                onPress={() => router.push({ pathname: '/threads/quotes/[id]', params: { id: view.post.id } })}>
                {t.threads.quotes} {view.post.quoteCount}
              </ThemedText>
            ) : null}
          </View>
          {view.post.replyToId && !view.parent
            ? <ThemedText type="small" themeColor="textSecondary" style={{ padding: Spacing.three }}>{t.threads.unavailable}</ThemedText>
            : null}
          <ThemedText type="smallBold" style={{ padding: Spacing.three }}>{t.threads.replies}</ThemedText>
        </View>
      }
      renderItem={({ item }) => (
        <PostCard post={item} onChange={replace}
          onRemoved={(removed) => setView((v) => v && ({ ...v, replies: v.replies.filter((r) => r.id !== removed) }))} />
      )}
      ListEmptyComponent={
        <ThemedText themeColor="textSecondary" style={{ paddingHorizontal: Spacing.three }}>{t.common.empty}</ThemedText>
      }
    />
  );
}
