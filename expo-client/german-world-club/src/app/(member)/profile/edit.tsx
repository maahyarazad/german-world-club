import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';

import { GENDERS, type Gender } from '@gwc/contracts/onboarding';
import { PROFILE_BIO_MAX, PROFILE_LINKS_MAX } from '@gwc/contracts/profile';
import type { MemberProfile, ProfileLink } from '@gwc/contracts/profile';

import { profileApi } from '@/api/endpoints';
import { Avatar } from '@/components/avatar';
import { ThemedText } from '@/components/themed-text';
import { UploadProgress } from '@/components/upload-progress';
import { useMediaUpload } from '@/hooks/use-media-upload';
import { pickMedia } from '@/lib/pick-media';
import { Button, Chip, FormScreen, Loading, Message, TextField, styles as uiStyles } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTranslations } from '@/i18n';
import { ApiError } from '@/api/client';

/**
 * What a member may change themselves: avatar, handle, bio, city, gender and
 * links (010 adds the avatar, handle and links). The name is not here on
 * purpose — §3.2 routes a name change through staff — and neither are the
 * verified email and mobile. Avatar and links save on their own, because each
 * is its own server call with its own refusal.
 */
export default function EditProfile() {
  const { t, format, formatDate } = useTranslations();
  const [loaded, setLoaded] = useState(false);
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [links, setLinks] = useState<ProfileLink[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [bio, setBio] = useState('');
  const [city, setCity] = useState('');
  const [gender, setGender] = useState<Gender | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The picture goes up through the same path as every member upload, so the
  // member sees the club's loader with a percentage (feature 037, FR-020).
  const avatarUpload = useMediaUpload('member');

  useEffect(() => {
    profileApi.me().then((p) => {
      setProfile(p);
      setLinks(p.links);
      setBio(p.bio ?? '');
      setCity(p.city ?? '');
      setGender(p.gender);
      setLoaded(true);
    }, (e) => { console.error('EditProfile.load', e instanceof ApiError ? e.problem : e); });
  }, []);

  if (!loaded && !error) return <Loading />;

  const avatarBusy = avatarUpload.state.phase === 'uploading' || avatarUpload.state.phase === 'processing';

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
      console.error('EditProfile.run', e instanceof ApiError ? e.problem : e);
    } finally {
      setBusy(false);
    }
  };

  const changeAvatar = async () => {
    const { denied, items, unsupported } = await pickMedia({ limit: 1, videos: false });
    if (denied) return setError(t.threads.photoPermission);
    const [item] = items;
    if (!item) {
      // Nothing picked, or the one picked cannot be uploaded: only the second needs saying.
      if (unsupported.length > 0) setError(t.upload.unsupportedFormat);
      return;
    }
    setError(null);
    const asset = await avatarUpload.start(item, format(t.profile.avatarAlt, { name: profile?.displayName ?? '' }));
    // A failure or a cancel returns null and nothing is saved: the current
    // picture stays exactly as it was (FR-021).
    if (!asset) return;
    await run(() => profileApi.setAvatar(asset.id));
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
      console.error('EditProfile.save', e instanceof ApiError ? e.problem : e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormScreen>
      {profile ? (
        <View style={styles.gapTwo}>
          <ThemedText type="smallBold">{t.profile.avatar}</ThemedText>
          <View style={[uiStyles.row, styles.itemsCenter]}>
            <Avatar author={profile} size={64} label={format(t.profile.avatarAlt, { name: profile.displayName ?? '' })} />
            <Button label={t.profile.avatarChange} variant="secondary" onPress={changeAvatar} disabled={busy || avatarBusy} />
          </View>
          <UploadProgress variant="spinner" state={avatarUpload.state} label={t.profile.avatar}
            onCancel={avatarUpload.cancel} onRetry={changeAvatar} />
          {profile.avatar ? (
            <ThemedText type="small" themeColor="textSecondary" accessibilityRole="button"
              onPress={() => !avatarBusy && run(() => profileApi.setAvatar(null))}>{t.profile.avatarRemove}</ThemedText>
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
        style={styles.minHeight110TextAlignVerticalTop} hint={`${bio.length}/${PROFILE_BIO_MAX}`} />
      <TextField label={t.profile.city} value={city} onChangeText={setCity} maxLength={120} autoComplete="postal-address-locality" />
      <View style={styles.gapTwo}>
        <ThemedText type="smallBold">{t.register.gender}</ThemedText>
        <View style={uiStyles.chips} accessibilityRole="radiogroup">
          {GENDERS.map((g) => (
            <Chip key={g} label={t.register.genders[g]} selected={gender === g} onPress={() => setGender(g)} />
          ))}
        </View>
      </View>
      <Button label={t.common.save} onPress={save} loading={busy} />

      <View style={styles.gapTwo}>
        <ThemedText type="smallBold">{t.profile.links}</ThemedText>
        {links.map((link, i) => (
          <View key={i} style={styles.gapOne}>
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
        <Button label={t.profile.saveLinks} onPress={() => run(() => profileApi.setLinks(links))} loading={busy} />
      </View>

      <Message text={error} />
      <Message text={notice} tone="success" />
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  gapTwo: { gap: Spacing.two },
  itemsCenter: { alignItems: 'center' },
  minHeight110TextAlignVerticalTop: { minHeight: 110, textAlignVertical: 'top' },
  gapOne: { gap: Spacing.one },
});
