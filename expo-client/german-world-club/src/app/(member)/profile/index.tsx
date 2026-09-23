import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';

import type { MemberProfile } from '@gwc/contracts/profile';

import { profileApi } from '@/api/endpoints';
import { countryName } from '@/components/country-picker';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, Centered, Chip, FormScreen, Loading, Message, styles } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTranslations, type Locale } from '@/i18n';
import { useSession } from '@/session/session';

/** Your own profile, with the contact details only you see. */
export default function Profile() {
  const { t, locale, setLocale, format, formatDate, problemMessage } = useTranslations();
  const { signOut } = useSession();
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [error, setError] = useState<unknown>(null);

  // On focus, so returning from the edit modal shows the saved values.
  useFocusEffect(useCallback(() => {
    profileApi.me().then((p) => { setProfile(p); setError(null); }, setError);
  }, []));

  if (error && !profile) {
    return (
      <Centered>
        <Message text={problemMessage(error)} />
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
    <FormScreen title={profile.displayName ?? ''} subtitle={format(t.profile.memberSince, { date: formatDate(profile.memberSince) })}>
      <View style={styles.row}>
        <ThemedText type="smallBold">{profile.followers}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">{t.profile.followers}</ThemedText>
        <ThemedText type="smallBold">{profile.following}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">{t.profile.following}</ThemedText>
      </View>
      {profile.bio ? <ThemedText>{profile.bio}</ThemedText> : null}
      <Card>
        {row(t.profile.email, profile.email)}
        {row(t.profile.mobile, profile.mobile)}
        {/* A calendar date: formatted without a time zone so it cannot slip a day. */}
        {row(t.profile.birthday, profile.birthday ? formatDate(`${profile.birthday}T12:00:00Z`) : null)}
        {row(t.profile.city, profile.city)}
        {row(t.profile.country, countryName(profile.countryOfResidence, locale))}
      </Card>
      <Button label={t.profile.edit} onPress={() => router.push('/profile/edit')} variant="secondary" />

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
