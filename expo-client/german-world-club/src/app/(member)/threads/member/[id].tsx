import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, View } from 'react-native';

import type { PublicMemberProfile } from '@gwc/contracts/profile';
import type { ProfileTab, ThreadPost } from '@gwc/contracts/threads';

import { profileApi, threadsApi } from '@/api/endpoints';
import { PostCard } from '@/components/post-card';
import { ProfileHeader, TabChips } from '@/components/profile-header';
import { ThemedText } from '@/components/themed-text';
import { Button, Centered, Loading, Message, styles } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { usePaged } from '@/hooks/use-paged';
import { useTheme } from '@/hooks/use-theme';
import { useTranslations } from '@/i18n';

/**
 * Another member as members see them — no contact details (§7) — with their
 * posts in four tabs, and follow, mute and block (010 US4/US8).
 *
 * Somebody who blocked you is the server's 404, the same as nobody. Somebody
 * YOU blocked still opens, so you can unblock them, but shows no posts.
 */
export default function MemberProfile() {
  const theme = useTheme();
  const { t, problemMessage } = useTranslations();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [profile, setProfile] = useState<PublicMemberProfile | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<ProfileTab>('threads');
  const blocked = profile?.isBlocked ?? false;
  const fetchPage = useCallback(
    (cursor: string | null) => (blocked ? Promise.resolve({ items: [], nextCursor: null }) : threadsApi.memberPosts(id, cursor, tab)),
    [id, tab, blocked],
  );
  const posts = usePaged<ThreadPost>(fetchPage, [id, tab, blocked]);

  const load = useCallback(() => profileApi.member(id).then(setProfile, setError), [id]);
  useEffect(() => { void load(); }, [load]);

  if (error) return <Centered><Message text={problemMessage(error)} /></Centered>;
  if (!profile) return <Loading />;

  const act = async (run: () => Promise<unknown>) => {
    setBusy(true);
    try { await run(); await load(); } catch (e) { Alert.alert(problemMessage(e)); } finally { setBusy(false); }
  };

  const block = () => {
    if (profile.isBlocked) return void act(() => threadsApi.setBlock(profile.id, false));
    Alert.alert(t.threads.blockConfirm, undefined, [
      { text: t.common.cancel, style: 'cancel' },
      { text: t.profile.block, style: 'destructive', onPress: () => void act(() => threadsApi.setBlock(profile.id, true)) },
    ]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <Stack.Screen options={{ title: profile.handle ? `@${profile.handle}` : profile.displayName ?? '' }} />
      <FlatList
        data={posts.items}
        keyExtractor={(p) => p.id}
        onEndReached={posts.loadMore}
        ListHeaderComponent={
          <View>
            <ProfileHeader profile={profile}>
              {profile.isSelf ? null : (
                <View style={{ gap: Spacing.two }}>
                  {profile.isBlocked ? null : (
                    <Button
                      label={profile.isFollowing ? t.profile.unfollow : t.profile.follow}
                      variant={profile.isFollowing ? 'secondary' : 'primary'}
                      loading={busy}
                      onPress={() => act(() => threadsApi.setFollow(profile.id, !profile.isFollowing))}
                    />
                  )}
                  <View style={styles.row}>
                    <ThemedText style={{ color: theme.tint }} onPress={() => act(() => threadsApi.setMute(profile.id, !profile.isMuted))}>
                      {profile.isMuted ? t.profile.unmute : t.profile.mute}
                    </ThemedText>
                    <ThemedText style={{ color: theme.danger }} onPress={block}>
                      {profile.isBlocked ? t.profile.unblock : t.profile.block}
                    </ThemedText>
                  </View>
                </View>
              )}
            </ProfileHeader>
            {profile.isBlocked
              ? <ThemedText themeColor="textSecondary" style={{ paddingHorizontal: Spacing.four }}>{t.profile.blocked}</ThemedText>
              : <TabChips tab={tab} onChange={setTab} />}
          </View>
        }
        renderItem={({ item }) => (
          <PostCard post={item} onChange={(post) => posts.setItems((all) => all.map((p) => (p.id === post.id ? post : p)))} />
        )}
        ListEmptyComponent={posts.loading || profile.isBlocked ? null : (
          <ThemedText themeColor="textSecondary" style={{ padding: Spacing.four }}>{t.common.empty}</ThemedText>
        )}
      />
    </View>
  );
}
