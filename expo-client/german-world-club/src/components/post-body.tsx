import { router } from 'expo-router';

import { MENTION_PATTERN } from '@gwc/contracts/threads';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';

/**
 * A post's text with its mentions linked (US5). The server resolved who was
 * mentioned; the app only matches the `@…` spans against that list, and a
 * span with no entry stays plain text.
 */
export function PostBody({ body, mentions }: { body: string; mentions: readonly { memberId: string; handle: string }[] }) {
  const theme = useTheme();
  if (!body) return null;
  const byHandle = new Map(mentions.map((m) => [m.handle.toLowerCase(), m.memberId]));
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const match of body.matchAll(new RegExp(MENTION_PATTERN.source, 'g'))) {
    const handle = match[1]!.replace(/\.+$/, '');
    const memberId = byHandle.get(handle.toLowerCase());
    if (!memberId) continue;
    const start = match.index!;
    parts.push(body.slice(last, start));
    parts.push(
      <ThemedText key={start} style={{ color: theme.tint }} accessibilityRole="link"
        onPress={() => router.push({ pathname: '/threads/member/[id]', params: { id: memberId } })}>
        @{handle}
      </ThemedText>,
    );
    last = start + 1 + handle.length;
  }
  parts.push(body.slice(last));
  return <ThemedText>{parts}</ThemedText>;
}
