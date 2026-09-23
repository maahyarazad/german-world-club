import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import type { ThreadAuthor, ThreadPost } from '@gwc/contracts/threads';

import { threadsApi } from '@/api/endpoints';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useTranslations } from '@/i18n';

/**
 * Report reasons as sent to staff. English and fixed, because they are data
 * for the moderation queue, not interface text; the member sees them through
 * the catalogue.
 */
const REPORT_REASONS = {
  spam: 'Spam',
  harassment: 'Harassment or abuse',
  inappropriate: 'Inappropriate content',
} as const;

/**
 * One post, with its actions. Like and repost update from the server's answer
 * rather than guessing a count: both endpoints return the post as it now is.
 */
export function PostCard({
  post, repostedBy, onChange, onRemoved, onOpen = true,
}: {
  post: ThreadPost
  repostedBy?: ThreadAuthor | null
  onChange: (post: ThreadPost) => void
  onRemoved?: (id: string) => void
  /** False on the thread view's own subject, which is already open. */
  onOpen?: boolean
}) {
  const theme = useTheme();
  const { t, format, formatDate, problemMessage } = useTranslations();
  const [pending, setPending] = useState(false);

  const act = async (run: () => Promise<ThreadPost>) => {
    if (pending) return;
    setPending(true);
    try {
      onChange(await run());
    } catch (e) {
      Alert.alert(problemMessage(e));
    } finally {
      setPending(false);
    }
  };

  const more = () => {
    if (post.isMine) {
      Alert.alert(t.threads.deleteConfirm, undefined, [
        { text: t.common.cancel, style: 'cancel' },
        {
          text: t.threads.delete,
          style: 'destructive',
          onPress: async () => {
            try {
              await threadsApi.remove(post.id);
              onRemoved?.(post.id);
            } catch (e) {
              Alert.alert(problemMessage(e));
            }
          },
        },
      ]);
      return;
    }
    Alert.alert(t.threads.reportTitle, undefined, [
      ...(Object.keys(REPORT_REASONS) as (keyof typeof REPORT_REASONS)[]).map((key) => ({
        text: t.threads.reportReasons[key],
        onPress: async () => {
          try {
            await threadsApi.report(post.id, REPORT_REASONS[key]);
            Alert.alert(t.threads.reported);
          } catch (e) {
            Alert.alert(problemMessage(e));
          }
        },
      })),
      { text: t.common.cancel, style: 'cancel' as const },
    ]);
  };

  const openAuthor = () => router.push({ pathname: '/threads/member/[id]', params: { id: post.author.id } });
  const openThread = () => router.push({ pathname: '/threads/[id]', params: { id: post.id } });

  return (
    <Pressable
      disabled={!onOpen}
      onPress={openThread}
      style={[styles.card, { borderColor: theme.border }]}>
      {repostedBy ? (
        <ThemedText type="small" themeColor="textSecondary">
          ↻ {format(t.threads.repostedBy, { name: repostedBy.displayName ?? '—' })}
        </ThemedText>
      ) : null}
      <View style={styles.header}>
        <ThemedText type="smallBold" onPress={openAuthor} accessibilityRole="link">
          {post.author.displayName ?? '—'}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">{formatDate(post.createdAt, true)}</ThemedText>
      </View>
      <ThemedText>{post.body}</ThemedText>
      <View style={styles.actions}>
        <Action
          label={`${t.threads.reply} ${post.replyCount || ''}`}
          onPress={() => router.push({ pathname: '/threads/compose', params: { replyToId: post.id, replyToName: post.author.displayName ?? '' } })}
        />
        <Action
          label={`${post.likedByMe ? '♥' : '♡'} ${post.likeCount || ''}`}
          active={post.likedByMe}
          onPress={() => act(() => threadsApi.setLike(post.id, !post.likedByMe))}
        />
        <Action
          label={`↻ ${post.repostCount || ''}`}
          active={post.repostedByMe}
          onPress={() => act(() => threadsApi.setRepost(post.id, !post.repostedByMe))}
        />
        <Action label="•••" onPress={more} accessibilityLabel={post.isMine ? t.threads.delete : t.threads.report} />
      </View>
    </Pressable>
  );
}

function Action({ label, onPress, active = false, accessibilityLabel }: {
  label: string; onPress: () => void; active?: boolean; accessibilityLabel?: string
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: active }}
      hitSlop={8}
      onPress={onPress}>
      <ThemedText type="small" style={{ color: active ? theme.tint : theme.textSecondary }}>{label}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    gap: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  actions: { flexDirection: 'row', gap: Spacing.five, paddingTop: Spacing.one },
});
