import { useCallback, useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';

import type { ThreadAuthor } from '@gwc/contracts/threads';

import { threadsApi } from '@/api/endpoints';
import { Avatar } from '@/components/avatar';
import { ScreenLoader } from '@/components/screen-loader';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useTranslations } from '@/i18n';
import { ApiError } from '@/api/client';

/** Who you blocked and muted, with undo (010 US8). */
export default function Privacy() {
  const theme = useTheme();
  const { t, format } = useTranslations();
  const [blocked, setBlocked] = useState<ThreadAuthor[]>([]);
  const [muted, setMuted] = useState<ThreadAuthor[]>([]);
  const [loaded, setLoaded] = useState({ blocks: false, mutes: false });
  const load = useCallback(() => {
    threadsApi.blocks().then((r) => setBlocked(r.items)).catch((e) => { console.error('Privacy.loadBlocks', e instanceof ApiError ? e.problem : e); }).finally(() => setLoaded((l) => ({ ...l, blocks: true })));
    threadsApi.mutes().then((r) => setMuted(r.items)).catch((e) => { console.error('Privacy.loadMutes', e instanceof ApiError ? e.problem : e); }).finally(() => setLoaded((l) => ({ ...l, mutes: true })));
  }, []);
  useEffect(load, [load]);

  const section = (title: string, people: ThreadAuthor[], ready: boolean, undo: string, run: (id: string) => Promise<unknown>) => (
    <View style={{ gap: Spacing.two }}>
      <ThemedText type="smallBold">{title}</ThemedText>
      {!ready ? <ScreenLoader size="md" flex={false} /> : people.length === 0 ? <ThemedText themeColor="textSecondary">{t.profile.none}</ThemedText> : people.map((p) => (
        <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
          <Avatar author={p} label={format(t.profile.avatarAlt, { name: p.displayName ?? '' })} />
          <ThemedText style={{ flex: 1 }}>{p.displayName ?? `@${p.handle ?? ''}`}</ThemedText>
          <ThemedText style={{ color: theme.tint }} accessibilityRole="button" onPress={() => void run(p.id).then(load)}>{undo}</ThemedText>
        </View>
      ))}
    </View>
  );

  return (
    <ScrollView style={{ backgroundColor: theme.background }} contentContainerStyle={{ padding: Spacing.four, gap: Spacing.five }}>
      {section(t.profile.blockedList, blocked, loaded.blocks, t.profile.unblock, (id) => threadsApi.setBlock(id, false))}
      {section(t.profile.mutedList, muted, loaded.mutes, t.profile.unmute, (id) => threadsApi.setMute(id, false))}
    </ScrollView>
  );
}
