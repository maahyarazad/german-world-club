import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import type { OrganisationProfile } from '@gwc/contracts/profile';

import { profileApi } from '@/api/endpoints';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, FormScreen, Loading, Message } from '@/components/ui';
import { useTranslations } from '@/i18n';
import { useSession } from '@/session/session';

export default function OrganisationHome() {
  const { t, problemMessage } = useTranslations();
  const { state, signOut } = useSession();
  const [profile, setProfile] = useState<OrganisationProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const kind = state.status === 'organisation' ? (state.principal.kind as 'merchant' | 'partner') : null;

  useEffect(() => {
    if (kind) profileApi.organisation(kind).then(setProfile, (e) => setError(problemMessage(e)));
  }, [kind, problemMessage]);

  if (!profile && !error) return <Loading />;

  return (
    <FormScreen title={profile?.organisation.name}>
      <Message text={error} />
      {profile ? (
        <Card>
          <View style={{ gap: 2 }}>
            <ThemedText type="small" themeColor="textSecondary">{t.profile.email}</ThemedText>
            <ThemedText>{profile.email}</ThemedText>
          </View>
          <View style={{ gap: 2 }}>
            <ThemedText type="small" themeColor="textSecondary">{t.profile.role}</ThemedText>
            <ThemedText>{profile.displayName ? `${profile.displayName} · ${profile.role}` : profile.role}</ThemedText>
          </View>
        </Card>
      ) : null}
      <Button label={t.profile.publicProfile} onPress={() => router.push('/public-profile')} variant="secondary" />
      <Button label={t.common.signOut} onPress={signOut} variant="danger" />
    </FormScreen>
  );
}
