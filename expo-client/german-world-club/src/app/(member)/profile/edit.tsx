import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { GENDERS, type Gender } from '@gwc/contracts/onboarding';
import { PROFILE_BIO_MAX } from '@gwc/contracts/profile';

import { profileApi } from '@/api/endpoints';
import { ThemedText } from '@/components/themed-text';
import { Button, Chip, FormScreen, Loading, Message, TextField, styles } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTranslations } from '@/i18n';

/**
 * What a member may change themselves: bio, city, gender. The name is not
 * here on purpose — §3.2 routes a name change through staff — and neither are
 * the verified email and mobile.
 */
export default function EditProfile() {
  const { t, problemMessage } = useTranslations();
  const [loaded, setLoaded] = useState(false);
  const [bio, setBio] = useState('');
  const [city, setCity] = useState('');
  const [gender, setGender] = useState<Gender | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    profileApi.me().then((p) => {
      setBio(p.bio ?? '');
      setCity(p.city ?? '');
      setGender(p.gender);
      setLoaded(true);
    }, (e) => setError(problemMessage(e)));
  }, [problemMessage]);

  if (!loaded && !error) return <Loading />;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      // Empty means cleared: the server stores null, not an empty string.
      await profileApi.update({
        bio: bio.trim() || null,
        city: city.trim() || null,
        ...(gender ? { gender } : {}),
      });
      router.back();
    } catch (e) {
      setError(problemMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormScreen>
      <TextField label={t.profile.bio} value={bio} onChangeText={setBio} multiline maxLength={PROFILE_BIO_MAX}
        style={{ minHeight: 110, textAlignVertical: 'top' }} hint={`${bio.length}/${PROFILE_BIO_MAX}`} />
      <TextField label={t.profile.city} value={city} onChangeText={setCity} maxLength={120} autoComplete="postal-address-locality" />
      <View style={{ gap: Spacing.two }}>
        <ThemedText type="smallBold">{t.register.gender}</ThemedText>
        <View style={styles.chips} accessibilityRole="radiogroup">
          {GENDERS.map((g) => (
            <Chip key={g} label={t.register.genders[g]} selected={gender === g} onPress={() => setGender(g)} />
          ))}
        </View>
      </View>
      <Message text={error} />
      <Button label={t.common.save} onPress={save} loading={busy} />
    </FormScreen>
  );
}
