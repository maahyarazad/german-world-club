import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { GENDERS, type Gender } from '@gwc/contracts/onboarding';
import { PROFILE_BIO_MAX, PROFILE_LINKS_MAX } from '@gwc/contracts/profile';
import type { MemberProfile, ProfileLink } from '@gwc/contracts/profile';

import { profileApi } from '@/api/endpoints';
import { Avatar } from '@/components/avatar';
import { ThemedText } from '@/components/themed-text';
import { pickMedia, uploadReady } from '@/lib/pick-media';
import { Button, Chip, FormScreen, Loading, Message, TextField, styles } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTranslations } from '@/i18n';

/**
 * What a member may change themselves: avatar, handle, bio, city, gender and
 * links (010 adds the avatar, handle and links). The name is not here on
 * purpose — §3.2 routes a name change through staff — and neither are the
 * verified email and mobile. Avatar and links save on their own, because each
 * is its own server call with its own refusal.
 */
export default function EditProfile() {
  const { t, format, formatDate, problemMessage } = useTranslations();
  const [loaded, setLoaded] = useState(false);
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [links, setLinks] = useState<ProfileLink[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [bio, setBio] = useState('');
  const [city, setCity] = useState('');
  const [gender, setGender] = useState<Gender | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    profileApi.me().then((p) => {
      setProfile(p);
      setLinks(p.links);
      setBio(p.bio ?? '');
      setCity(p.city ?? '');
      setGender(p.gender);
      setLoaded(true);
    }, (e) => setError(problemMessage(e)));
  }, [problemMessage]);

  if (!loaded && !error) return <Loading />;

  const run = async (fn: () => Promise<MemberProfile>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const next = await fn();
      setProfile(next);
      setLinks(next.links);
      setNotice(t.profile.saved);
    } catch (e) {
      setError(problemMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const changeAvatar = async () => {
    const { denied, items } = await pickMedia({ limit: 1, videos: false });
    if (denied) return setError(t.threads.photoPermission);
    const [item] = items;
    if (!item) return;
    await run(async () => profileApi.setAvatar(
      await uploadReady(item, format(t.profile.avatarAlt, { name: profile?.displayName ?? '' })),
    ));
  };

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
      {profile ? (
        <View style={{ gap: Spacing.two }}>
          <ThemedText type="smallBold">{t.profile.avatar}</ThemedText>
          <View style={[styles.row, { alignItems: 'center' }]}>
            <Avatar author={profile} size={64} label={format(t.profile.avatarAlt, { name: profile.displayName ?? '' })} />
            <Button label={t.profile.avatarChange} variant="secondary" onPress={changeAvatar} disabled={busy} />
          </View>
          {profile.avatar ? (
            <ThemedText type="small" themeColor="textSecondary" accessibilityRole="button"
              onPress={() => run(() => profileApi.setAvatar(null))}>{t.profile.avatarRemove}</ThemedText>
          ) : null}

          <ThemedText type="smallBold">{t.profile.handle}</ThemedText>
          <ThemedText>{profile.handle ? `@${profile.handle}` : t.profile.noHandle}</ThemedText>
          {profile.handleChangeableAt ? (
            <ThemedText type="small" themeColor="textSecondary">
              {format(t.profile.handleNextChange, { date: formatDate(profile.handleChangeableAt) })}
            </ThemedText>
          ) : (
            <Button label={t.profile.handleTitle} variant="secondary" onPress={() => router.push('/profile/handle')} />
          )}
        </View>
      ) : null}

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
      <Button label={t.common.save} onPress={save} loading={busy} />

      <View style={{ gap: Spacing.two }}>
        <ThemedText type="smallBold">{t.profile.links}</ThemedText>
        {links.map((link, i) => (
          <View key={i} style={{ gap: Spacing.one }}>
            <TextField label={t.profile.linkUrl} value={link.url} autoCapitalize="none" keyboardType="url"
              onChangeText={(url) => setLinks(links.map((l, j) => (j === i ? { ...l, url } : l)))} />
            <TextField label={t.profile.linkLabel} value={link.label ?? ''}
              onChangeText={(label) => setLinks(links.map((l, j) => (j === i ? { ...l, label: label || null } : l)))} />
            <ThemedText type="small" themeColor="textSecondary" accessibilityRole="button"
              onPress={() => setLinks(links.filter((_, j) => j !== i))}>{t.profile.removeLink}</ThemedText>
          </View>
        ))}
        {links.length < PROFILE_LINKS_MAX ? (
          <Button label={t.profile.addLink} variant="secondary" onPress={() => setLinks([...links, { url: 'https://', label: null }])} />
        ) : null}
        <Button label={t.profile.saveLinks} onPress={() => run(() => profileApi.setLinks(links))} disabled={busy} />
      </View>

      <Message text={error} />
      <Message text={notice} tone="success" />
    </FormScreen>
  );
}
