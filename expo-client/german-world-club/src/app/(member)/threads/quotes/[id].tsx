import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback } from 'react';
import { FlatList, View } from 'react-native';

import type { ThreadPost } from '@gwc/contracts/threads';

import { threadsApi } from '@/api/endpoints';
import { PostCard } from '@/components/post-card';
import { ThemedText } from '@/components/themed-text';
import { Loading } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { usePaged } from '@/hooks/use-paged';
import { useTheme } from '@/hooks/use-theme';
import { useTranslations } from '@/i18n';

/** The visible quotes of a post (010 US2). */
export default function Quotes() {
  const theme = useTheme();
  const { t } = useTranslations();
  const { id } = useLocalSearchParams<{ id: string }>();
  const fetchPage = useCallback((cursor: string | null) => threadsApi.quotes(id, cursor), [id]);
  const list = usePaged<ThreadPost>(fetchPage, [id]);
  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <Stack.Screen options={{ title: t.threads.quotes }} />
      {list.loading ? <Loading /> : (
        <FlatList
          data={list.items}
          keyExtractor={(p) => p.id}
          onEndReached={list.loadMore}
          renderItem={({ item }) => (
            <PostCard post={item} onChange={(post) => list.setItems((all) => all.map((p) => (p.id === post.id ? post : p)))} />
          )}
          ListEmptyComponent={<ThemedText themeColor="textSecondary" style={{ padding: Spacing.four }}>{t.common.empty}</ThemedText>}
        />
      )}
    </View>
  );
}
