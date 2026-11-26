import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { FlashList } from '@shopify/flash-list';
import { Pressable, RefreshControl, View, StyleSheet } from 'react-native';

import { PROFILE_TABS } from '@gwc/contracts/threads';
import type { ActivityItem, ProfileTab, ThreadPost } from '@gwc/contracts/threads';

import { threadsApi } from '@/api/endpoints';
import { Avatar } from '@/components/avatar';
import { PostCard } from '@/components/post-card';
import { ThemedText } from '@/components/themed-text';
import { Chip, Loading, styles as uiStyles } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { usePaged } from '@/hooks/use-paged';
import { publishUnread } from '@/hooks/use-unread';
import { useTranslations } from '@/i18n';
import { useSession } from '@/session/session';
import { ApiError } from '@/api/client';
import { useThemedStyles, type AppTheme } from '@/hooks/use-themed-styles';

/**
 * Everything to do with your Threads, on one screen (010 US5, and feature 039):
 * what happened to you, and what you have posted.
 *
 * Five choices at the top. **Interactions** is the feed this screen has always
 * been — likes, replies, quotes, reposts, mentions and follows concerning you,
 * computed by the server from the facts themselves — and it is what opens first,
 * so nothing about how Activity opened has changed. The other four are your own
 * posts in the tabs Profile used to show: Threads, Replies, Media and Reposts.
 * They moved here so Profile is who you are and your settings, and this is what
 * you have done and what has happened to you. Another member's profile
 * (`threads/member/[id]`) keeps its own four tabs.
 *
 * Reached from Profile since the Offers tab took its place.
 */
type ActivityView = 'interactions' | ProfileTab;
const VIEWS: readonly ActivityView[] = ['interactions', ...PROFILE_TABS];

export default function Activity() {
  const themed = useThemedStyles(makeStyles);
  const { t } = useTranslations();
  const [view, setView] = useState<ActivityView>('interactions');

  return (
    <View style={themed.flex1Clear}>
      <View style={[uiStyles.chips, styles.chipsRow]} accessibilityRole="tablist">
        {VIEWS.map((value) => (
          <Chip
            key={value}
            label={value === 'interactions' ? t.activity.tabInteractions : t.profile.tabs[value]}
            selected={view === value}
            onPress={() => setView(value)}
          />
        ))}
      </View>
      {/* A bounded box for the list below, which sizes itself to its parent. The key gives
          each post tab a fresh list, so one tab's posts never show under another's name. */}
      <View style={themed.flex1Clear}>
        {view === 'interactions' ? <Interactions /> : <OwnPosts key={view} tab={view} />}
      </View>
    </View>
  );
}

/**
 * Likes, replies, quotes, reposts, mentions and follows concerning you. Opening
 * it moves the unread boundary to the newest item; the server only ever moves it
 * forward.
 */
function Interactions() {
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

/**
 * Your own posts in one of the four tabs (FR-008 of feature 010), moved here from
 * Profile. The same endpoint and the same cards; what is new is that the list
 * pages (Profile showed only the first page), refreshes on pull and reloads when
 * you come back to the screen, so a post you just made, or deleted, is right.
 */
function OwnPosts({ tab }: { tab: ProfileTab }) {
  const themed = useThemedStyles(makeStyles);
  const { t } = useTranslations();
  const { state } = useSession();
  // The session already knows who you are, so no request is needed to find out.
  const me = state.status === 'member' ? state.principal.id : null;
  const fetchPage = useCallback(
    (cursor: string | null) => (me ? threadsApi.memberPosts(me, cursor, tab) : Promise.resolve({ items: [], nextCursor: null })),
    [me, tab],
  );
  const posts = usePaged<ThreadPost>(fetchPage, [me, tab]);

  // Coming back from a post, from composing one, or from deleting one: show what changed.
  // Skipped on the first focus, which the initial load already covers.
  const focusedOnce = useRef(false);
  useFocusEffect(useCallback(() => {
    if (focusedOnce.current) void posts.reload(true);
    focusedOnce.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posts.reload]));

  // Never an empty list that reads as "no posts" while the answer is still on its way.
  if (!me || posts.loading) return <Loading />;

  return (
    <FlashList
      style={themed.clear}
      data={posts.items}
      keyExtractor={(post) => post.id}
      onEndReached={posts.loadMore}
      refreshControl={<RefreshControl refreshing={posts.refreshing} onRefresh={() => posts.reload(true)} />}
      ListEmptyComponent={<ThemedText themeColor="textSecondary" style={styles.paddingFourTextCenter}>{t.common.empty}</ThemedText>}
      renderItem={({ item }) => (
        // key: a recycled cell must not keep the previous post's in-flight flag.
        <PostCard
          key={item.id}
          post={item}
          onChange={(next) => posts.setItems((all) => all.map((p) => (p.id === next.id ? next : p)))}
          onRemoved={(id) => posts.setItems((all) => all.filter((p) => p.id !== id))}
        />
      )}
    />
  );
}

const styles = StyleSheet.create({
  chipsRow: { paddingHorizontal: Spacing.four, paddingVertical: Spacing.three },
  paddingFourTextCenter: { padding: Spacing.four, textAlign: 'center' },
  flex1Gap2: { flex: 1, gap: 2 },
});

const makeStyles = (theme: AppTheme) =>
  StyleSheet.create({
    flex1Clear: { flex: 1, backgroundColor: 'transparent' },
    clear: { backgroundColor: 'transparent' },
    pressableRow5: { flexDirection: 'row', gap: Spacing.two, padding: Spacing.three, borderBottomWidth: 0.5, borderColor: theme.border },
  });
