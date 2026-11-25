import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback } from 'react';
import { FlashList } from '@shopify/flash-list';
import { View, StyleSheet } from 'react-native';

import type { ThreadPost } from '@gwc/contracts/threads';

import { threadsApi } from '@/api/endpoints';
import { PostCard } from '@/components/post-card';
import { ThemedText } from '@/components/themed-text';
import { Loading } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { usePaged } from '@/hooks/use-paged';
import { useTranslations } from '@/i18n';
import { useThemedStyles, type AppTheme } from '@/hooks/use-themed-styles';

/** The visible quotes of a post (010 US2). */
export default function Quotes() {
  const themed = useThemedStyles(makeStyles);
  const { t } = useTranslations();
  const { id } = useLocalSearchParams<{ id: string }>();
  const fetchPage = useCallback((cursor: string | null) => threadsApi.quotes(id, cursor), [id]);
  const list = usePaged<ThreadPost>(fetchPage, [id]);
  return (
    <View style={themed.flex1Clear}>
      <Stack.Screen options={{ title: t.threads.quotes }} />
      {list.loading ? <Loading /> : (
        <FlashList
          data={list.items}
          keyExtractor={(p) => p.id}
          onEndReached={list.loadMore}
          renderItem={({ item }) => (
            <PostCard key={item.id} post={item} onChange={(post) => list.setItems((all) => all.map((p) => (p.id === post.id ? post : p)))} />
          )}
          ListEmptyComponent={<ThemedText themeColor="textSecondary" style={styles.paddingFour}>{t.common.empty}</ThemedText>}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  paddingFour: { padding: Spacing.four },
});

const makeStyles = (theme: AppTheme) =>
  StyleSheet.create({
    flex1Clear: { flex: 1, backgroundColor: 'transparent' },
  });
