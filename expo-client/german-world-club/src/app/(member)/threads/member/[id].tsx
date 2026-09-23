import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, View } from 'react-native';

import type { PublicMemberProfile } from '@gwc/contracts/profile';
import type { ThreadPost } from '@gwc/contracts/threads';

import { profileApi, threadsApi } from '@/api/endpoints';
import { countryName } from '@/components/country-picker';
import { PostCard } from '@/components/post-card';
import { ThemedText } from '@/components/themed-text';
import { Button, Centered, Loading, Message, styles } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { usePaged } from '@/hooks/use-paged';
import { useTheme } from '@/hooks/use-theme';
import { useTranslations } from '@/i18n';

/** Another member as members see them — no contact details (§7) — and their posts. */
export default function MemberProfile() {
  const theme = useTheme();
  const { t, locale, problemMessage } = useTranslations();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [profile, setProfile] = useState<PublicMemberProfile | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const fetchPage = useCallback((cursor: string | null) => threadsApi.memberPosts(id, cursor), [id]);
  const posts = usePaged<ThreadPost>(fetchPage, [id]);

  useEffect(() => {
    profileApi.member(id).then(setProfile, setError);
  }, [id]);

  if (error) return <Centered><Message text={problemMessage(error)} /></Centered>;
  if (!profile) return <Loading />;

  const toggleFollow = async () => {
    setBusy(true);
    try {
      const next = await threadsApi.setFollow(profile.id, !profile.isFollowing);
      setProfile({ ...profile, isFollowing: next.following, followers: next.followers });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <Stack.Screen options={{ title: profile.displayName ?? '' }} />
      <FlatList
        data={posts.items}
        keyExtractor={(p) => p.id}
        onEndReached={posts.loadMore}
        ListHeaderComponent={
          <View style={{ padding: Spacing.four, gap: Spacing.two }}>
            <ThemedText type="title" style={{ fontSize: 28, lineHeight: 34 }}>{profile.displayName}</ThemedText>
            {profile.city || profile.countryOfResidence ? (
              <ThemedText themeColor="textSecondary">
                {[profile.city, countryName(profile.countryOfResidence, locale)].filter(Boolean).join(', ')}
              </ThemedText>
            ) : null}
            {profile.bio ? <ThemedText>{profile.bio}</ThemedText> : null}
            <View style={styles.row}>
              <ThemedText type="smallBold">{profile.followers}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">{t.profile.followers}</ThemedText>
              <ThemedText type="smallBold">{profile.following}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">{t.profile.following}</ThemedText>
            </View>
            {profile.isSelf ? null : (
              <Button
                label={profile.isFollowing ? t.profile.unfollow : t.profile.follow}
                variant={profile.isFollowing ? 'secondary' : 'primary'}
                onPress={toggleFollow}
                loading={busy}
              />
            )}
            <ThemedText type="smallBold" style={{ paddingTop: Spacing.three }}>{t.profile.posts}</ThemedText>
          </View>
        }
        renderItem={({ item }) => (
          <PostCard post={item} onChange={(post) => posts.setItems((all) => all.map((p) => (p.id === post.id ? post : p)))} />
        )}
        ListEmptyComponent={posts.loading ? null : (
          <ThemedText themeColor="textSecondary" style={{ paddingHorizontal: Spacing.four }}>{t.common.empty}</ThemedText>
        )}
      />
    </View>
  );
}
