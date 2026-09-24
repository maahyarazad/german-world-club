import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback } from 'react';
import { FlatList, Pressable, View } from 'react-native';

import type { ThreadAuthor } from '@gwc/contracts/threads';

import { threadsApi } from '@/api/endpoints';
import { Avatar } from '@/components/avatar';
import { ThemedText } from '@/components/themed-text';
import { Loading } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { usePaged } from '@/hooks/use-paged';
import { useTheme } from '@/hooks/use-theme';
import { useTranslations } from '@/i18n';

type Kind = 'followers' | 'following' | 'likes';

/** A list of members: a member's followers or following, or a post's likers (010 US2/US4). */
export default function People() {
  const theme = useTheme();
  const { t, format } = useTranslations();
  const { id, kind = 'followers' } = useLocalSearchParams<{ id: string; kind?: Kind }>();
  const fetchPage = useCallback((cursor: string | null) => (
    kind === 'likes' ? threadsApi.likes(id, cursor)
      : kind === 'following' ? threadsApi.following(id, cursor) : threadsApi.followers(id, cursor)
  ), [id, kind]);
  const list = usePaged<ThreadAuthor>(fetchPage, [id, kind]);
  const title = kind === 'likes' ? t.threads.likes : kind === 'following' ? t.profile.followingTitle : t.profile.followersTitle;

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <Stack.Screen options={{ title }} />
      {list.loading ? <Loading /> : (
        <PeopleList people={list.items} onEnd={list.loadMore} empty={t.common.empty} label={(n) => format(t.profile.avatarAlt, { name: n })} />
      )}
    </View>
  );
}

export function PeopleList({ people, onEnd, empty, label, trailing }: {
  people: ThreadAuthor[]
  onEnd?: () => void
  empty: string
  label: (name: string) => string
  trailing?: (author: ThreadAuthor) => React.ReactNode
}) {
  const theme = useTheme();
  return (
    <FlatList
      data={people}
      keyExtractor={(a) => a.id}
      onEndReached={onEnd}
      ListEmptyComponent={<ThemedText themeColor="textSecondary" style={{ padding: Spacing.four }}>{empty}</ThemedText>}
      renderItem={({ item }) => (
        <Pressable
          onPress={() => router.push({ pathname: '/threads/member/[id]', params: { id: item.id } })}
          style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two, padding: Spacing.three, borderBottomWidth: 0.5, borderColor: theme.border }}>
          <Avatar author={item} label={label(item.displayName ?? '')} />
          <View style={{ flex: 1 }}>
            <ThemedText type="smallBold">{item.displayName ?? '—'}</ThemedText>
            {item.handle ? <ThemedText type="small" themeColor="textSecondary">@{item.handle}</ThemedText> : null}
          </View>
          {trailing?.(item)}
        </Pressable>
      )}
    />
  );
}
