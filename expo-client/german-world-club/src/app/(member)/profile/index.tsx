import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';

import type { MemberProfile } from '@gwc/contracts/profile';
import type { ProfileTab, ThreadPost } from '@gwc/contracts/threads';

import { profileApi, threadsApi } from '@/api/endpoints';
import { countryName } from '@/components/country-picker';
import { PostCard } from '@/components/post-card';
import { ProfileHeader, TabChips } from '@/components/profile-header';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, Centered, Chip, FormScreen, Loading, styles } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTranslations, type Locale } from '@/i18n';
import { useSession } from '@/session/session';
import { ApiError } from '@/api/client';

/**
 * Your own profile: the header others see (010), the contact details only you
 * see, and your posts in the four tabs.
 */
export default function Profile() {
  const { t, locale, setLocale, format, formatDate } = useTranslations();
  const { signOut } = useSession();
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  // Not the problem itself (that goes to the console): whether to offer the
  // way out, since a profile that will not load leaves nothing else to do.
  const [loadFailed, setLoadFailed] = useState(false);
  const [tab, setTab] = useState<ProfileTab>('threads');
  const [posts, setPosts] = useState<ThreadPost[]>([]);
  const profileId = profile?.id;

  useFocusEffect(useCallback(() => {
    if (!profileId) return;
    threadsApi.memberPosts(profileId, null, tab).then((p) => setPosts(p.items)).catch((e) => {
      console.error('Profile.loadPosts', e instanceof ApiError ? e.problem : e);
      setPosts([]);
    });
  }, [profileId, tab]));

  // On focus, so returning from the edit modal shows the saved values.
  useFocusEffect(useCallback(() => {
    profileApi.me().then((p) => { setProfile(p); setLoadFailed(false); }, (e) => {
      console.error('Profile.load', e instanceof ApiError ? e.problem : e);
      setLoadFailed(true);
    });
  }, []));

  if (loadFailed && !profile) {
    return (
      <Centered>
        <Button label={t.common.signOut} onPress={signOut} variant="secondary" />
      </Centered>
    );
  }
  if (!profile) return <Loading />;

  const row = (label: string, value: string | null | undefined) => (value ? (
    <View style={{ gap: 2 }}>
      <ThemedText type="small" themeColor="textSecondary">{label}</ThemedText>
      <ThemedText>{value}</ThemedText>
    </View>
  ) : null);

  return (
    <FormScreen>
      <ProfileHeader profile={profile}>
        <ThemedText type="small" themeColor="textSecondary">
          {format(t.profile.memberSince, { date: formatDate(profile.memberSince) })}
        </ThemedText>
      </ProfileHeader>
      <Card>
        {row(t.profile.email, profile.email)}
        {row(t.profile.mobile, profile.mobile)}
        {/* A calendar date: formatted without a time zone so it cannot slip a day. */}
        {row(t.profile.birthday, profile.birthday ? formatDate(`${profile.birthday}T12:00:00Z`) : null)}
        {row(t.profile.city, profile.city)}
        {row(t.profile.country, countryName(profile.countryOfResidence, locale))}
      </Card>
      <Button label={t.profile.edit} onPress={() => router.push('/profile/edit')} variant="secondary" />
      <Button label={t.profile.privacy} onPress={() => router.push('/profile/privacy')} variant="secondary" />
      <Button label={t.notifications.settingsLink} onPress={() => router.push('/profile/notifications')} variant="secondary" />

      <TabChips tab={tab} onChange={setTab} />
      <View>
        {posts.length === 0
          ? <ThemedText themeColor="textSecondary">{t.common.empty}</ThemedText>
          : posts.map((post) => (
            <PostCard key={post.id} post={post}
              onChange={(next) => setPosts((all) => all.map((p) => (p.id === next.id ? next : p)))}
              onRemoved={(id) => setPosts((all) => all.filter((p) => p.id !== id))} />
          ))}
      </View>

      <View style={{ gap: Spacing.two }}>
        <ThemedText type="smallBold">{t.common.language}</ThemedText>
        <View style={styles.chips} accessibilityRole="radiogroup">
          {(['de', 'en'] as Locale[]).map((l) => (
            <Chip key={l} label={l === 'de' ? 'Deutsch' : 'English'} selected={locale === l} onPress={() => setLocale(l)} />
          ))}
        </View>
      </View>

      <Button label={t.common.signOut} onPress={signOut} variant="danger" />
    </FormScreen>
  );
}
