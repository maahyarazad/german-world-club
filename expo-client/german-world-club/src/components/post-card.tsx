import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import type { ThreadAuthor, ThreadPost } from '@gwc/contracts/threads';

import { threadsApi } from '@/api/endpoints';
import { Avatar } from '@/components/avatar';
import { MediaCarousel } from '@/components/media-carousel';
import { PostBody } from '@/components/post-body';
import { QuoteEmbed } from '@/components/quote-embed';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useTranslations } from '@/i18n';
import { ApiError } from '@/api/client';

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
  post, repostedBy, onChange, onRemoved, onHideAuthor, onOpen = true,
}: {
  post: ThreadPost
  repostedBy?: ThreadAuthor | null
  onChange: (post: ThreadPost) => void
  onRemoved?: (id: string) => void
  /** After a mute or block (010 US8): the list drops this author's posts. */
  onHideAuthor?: (authorId: string) => void
  /** False on the thread view's own subject, which is already open. */
  onOpen?: boolean
}) {
  const theme = useTheme();
  const { t, format, formatDate } = useTranslations();
  const [pending, setPending] = useState(false);

  const act = async (run: () => Promise<ThreadPost>) => {
    if (pending) return;
    setPending(true);
    try {
      onChange(await run());
    } catch (e) {
      console.error('PostCard.act', e instanceof ApiError ? e.problem : e);
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
              console.error('PostCard.remove', e instanceof ApiError ? e.problem : e);
            }
          },
        },
      ]);
      return;
    }
    const name = post.author.displayName ?? `@${post.author.handle ?? ''}`;
    const relate = async (kind: 'mute' | 'block') => {
      try {
        await (kind === 'mute' ? threadsApi.setMute(post.author.id, true) : threadsApi.setBlock(post.author.id, true));
        onHideAuthor?.(post.author.id);
      } catch (e) {
        console.error('PostCard.relate', e instanceof ApiError ? e.problem : e);
      }
    };
    Alert.alert(t.threads.reportTitle, undefined, [
      { text: format(t.threads.mute, { name }), onPress: () => void relate('mute') },
      {
        text: format(t.threads.block, { name }),
        style: 'destructive' as const,
        onPress: () => Alert.alert(t.threads.blockConfirm, undefined, [
          { text: t.common.cancel, style: 'cancel' },
          { text: format(t.threads.block, { name }), style: 'destructive', onPress: () => void relate('block') },
        ]),
      },
      ...(Object.keys(REPORT_REASONS) as (keyof typeof REPORT_REASONS)[]).map((key) => ({
        text: t.threads.reportReasons[key],
        onPress: async () => {
          try {
            await threadsApi.report(post.id, REPORT_REASONS[key]);
            Alert.alert(t.threads.reported);
          } catch (e) {
            console.error('PostCard.report', e instanceof ApiError ? e.problem : e);
          }
        },
      })),
      { text: t.common.cancel, style: 'cancel' as const },
    ]);
  };

  const openAuthor = () => router.push({ pathname: '/threads/member/[id]', params: { id: post.author.id } });
  const authorName = post.author.displayName ?? (post.author.handle ? `@${post.author.handle}` : '—');
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
        <Pressable onPress={openAuthor} accessibilityRole="link" style={styles.author}>
          <Avatar author={post.author} size={32} label={format(t.profile.avatarAlt, { name: authorName })} />
          <View style={{ flexShrink: 1 }}>
            <ThemedText type="smallBold" numberOfLines={1}>
              {authorName}{post.author.isInfluencer ? `  · ${t.threads.influencer}` : ''}
            </ThemedText>
            {post.author.handle ? <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>@{post.author.handle}</ThemedText> : null}
          </View>
        </Pressable>
        <ThemedText type="small" themeColor="textSecondary">{formatDate(post.createdAt, true)}</ThemedText>
      </View>
      <PostBody body={post.body} mentions={post.mentions} />
      <MediaCarousel media={post.media} />
      {post.quoted ? <QuoteEmbed quoted={post.quoted} /> : null}
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
        <Action
          label={`❝ ${post.quoteCount || ''}`}
          accessibilityLabel={t.threads.quote}
          onPress={() => router.push({ pathname: '/threads/compose', params: { quoteOfId: post.id } })}
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
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.two },
  author: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, flexShrink: 1 },
  actions: { flexDirection: 'row', gap: Spacing.five, paddingTop: Spacing.one },
});
