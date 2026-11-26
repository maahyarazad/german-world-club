import { Stack, router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { FlashList } from '@shopify/flash-list';
import { RefreshControl, View, StyleSheet } from 'react-native';

import type { FeedItem, FeedScope } from '@gwc/contracts/threads';

import { threadsApi } from '@/api/endpoints';
import { HeaderIconButton } from '@/components/header-icon-button';
import { PostCard } from '@/components/post-card';
import { ThemedText } from '@/components/themed-text';
import { Chip, Loading, styles as uiStyles } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { usePaged } from '@/hooks/use-paged';
import { useTranslations } from '@/i18n';
import { useThemedStyles } from '@/hooks/use-themed-styles';

/** The feed (§7): people you follow, or everybody. */
export default function Feed() {
  const themed = useThemedStyles(makeStyles);
  const { t } = useTranslations();
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
    <View style={themed.flex1Clear}>
      {/* New post is this screen's only header action, so it is a plain button and not a
          one-row drop-down behind the three dots (Marketplace, with three, keeps the dots). */}
      <Stack.Screen
        options={{
          headerRight: () => (
            <HeaderIconButton name="plus" label={t.threads.compose} onPress={() => router.push('/threads/compose')} />
          ),
        }}
      />
      <View style={[uiStyles.row, styles.paddingThree]} accessibilityRole="radiogroup">
        <Chip label={t.threads.following} selected={scope === 'following'} onPress={() => setScope('following')} />
        <Chip label={t.threads.all} selected={scope === 'all'} onPress={() => setScope('all')} />
      </View>
      {feed.loading ? <Loading /> : (
        <FlashList
          data={feed.items}
          keyExtractor={(item) => `${item.post.id}:${item.repostedBy?.id ?? ''}`}
          renderItem={({ item }) => (
            // key: a recycled cell must not keep the previous post's in-flight flag.
            <PostCard
              key={`${item.post.id}:${item.repostedBy?.id ?? ''}`}
              post={item.post}
              repostedBy={item.repostedBy}
              onChange={(post) => feed.setItems((all) => all.map((i) => (i.post.id === post.id ? { ...i, post } : i)))}
              onRemoved={(id) => feed.setItems((all) => all.filter((i) => i.post.id !== id))}
              onHideAuthor={(authorId) => feed.setItems((all) => all.filter((i) => i.post.author.id !== authorId))}
            />
          )}
          onEndReached={feed.loadMore}
          onEndReachedThreshold={0.5}
          refreshControl={<RefreshControl refreshing={feed.refreshing} onRefresh={() => feed.reload(true)} />}
          ListEmptyComponent={
            <ThemedText themeColor="textSecondary" style={styles.paddingFourTextCenter}>
              {scope === 'following' ? t.threads.emptyFollowing : t.common.empty}
            </ThemedText>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  paddingThree: { padding: Spacing.three },
  paddingFourTextCenter: { padding: Spacing.four, textAlign: 'center' },
});

const makeStyles = () =>
  StyleSheet.create({
    flex1Clear: { flex: 1, backgroundColor: 'transparent' },
  });
