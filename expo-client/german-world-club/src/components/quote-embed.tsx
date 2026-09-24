import { router } from 'expo-router';
import { Pressable, View } from 'react-native';

import type { QuotedPost } from '@gwc/contracts/threads';

import { MediaCarousel } from '@/components/media-carousel';
import { PostBody } from '@/components/post-body';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useTranslations } from '@/i18n';

/**
 * The quoted post inside a quote (US2). `unavailable` is a tombstone: the
 * server sends nothing of a quoted post that is no longer visible, so there is
 * nothing else this could show (SC-005).
 */
export function QuoteEmbed({ quoted }: { quoted: QuotedPost }) {
  const theme = useTheme();
  const { t } = useTranslations();
  const box = { borderWidth: 1, borderColor: theme.border, borderRadius: 12, padding: Spacing.two, gap: Spacing.one };
  if (quoted.unavailable) {
    return <View style={box}><ThemedText type="small" themeColor="textSecondary">{t.threads.unavailable}</ThemedText></View>;
  }
  const { post } = quoted;
  return (
    <Pressable style={box} onPress={() => router.push({ pathname: '/threads/[id]', params: { id: post.id } })}>
      <ThemedText type="smallBold">
        {post.author.displayName ?? '—'}{post.author.handle ? `  @${post.author.handle}` : ''}
      </ThemedText>
      <PostBody body={post.body} mentions={post.mentions} />
      <MediaCarousel media={post.media} inset={Spacing.three * 2 + Spacing.two * 2 + 2} />
    </Pressable>
  );
}
