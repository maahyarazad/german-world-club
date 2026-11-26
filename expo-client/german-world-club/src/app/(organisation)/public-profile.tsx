import { router } from 'expo-router';
import { useEffect, useState } from 'react';

import type { OrganisationProfile } from '@gwc/contracts/profile';

import { ApiError } from '@/api/client';
import { profileApi } from '@/api/endpoints';
import { OrganisationCard } from '@/components/organisation-card';
import { ThemedText } from '@/components/themed-text';
import { Button, FormScreen, Loading, Message, TextField } from '@/components/ui';
import { useTranslations } from '@/i18n';
import { useMediaUpload } from '@/hooks/use-media-upload';
import { UploadProgress } from '@/components/upload-progress';
import { checkPicked } from '@/lib/media-limits';
import { pickMedia } from '@/lib/pick-media';
import { useSession } from '@/session/session';
import { StyleSheet } from 'react-native';

/**
 * The organisation's public profile (010 US3, FR-014): what members see.
 *
 * `canEdit` (owner or manager) decides whether the form is shown; the server
 * decides whether an edit is allowed, and answers a `staff`-role edit with
 * 404 — shown here as "not permitted", not as a missing page.
 */
export default function OrganisationPublicProfile() {
  const { t, format } = useTranslations();
  const { state } = useSession();
  const kind = state.status === 'organisation' ? (state.principal.kind as 'merchant' | 'partner') : null;
  const [profile, setProfile] = useState<OrganisationProfile | null>(null);
  const [form, setForm] = useState({ displayName: '', about: '', website: '', city: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Feature 035: the logo shows progress while it goes up and while the server works.
  const logoUpload = useMediaUpload(kind ?? 'partner');

  const adopt = (p: OrganisationProfile) => {
    setProfile(p);
    setForm({
      displayName: p.publicProfile?.displayName ?? '',
      about: p.publicProfile?.about ?? '',
      website: p.publicProfile?.website ?? '',
      city: p.publicProfile?.city ?? '',
    });
  };

  useEffect(() => {
    if (kind) profileApi.organisation(kind).then(adopt, (e) => { console.error('OrganisationPublicProfile.load', e instanceof ApiError ? e.problem : e); });
  }, [kind]);

  if (!kind) { router.replace('/'); return null; }
  if (!profile && !error) return <Loading />;

  const run = async (fn: () => Promise<OrganisationProfile>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      adopt(await fn());
      setNotice(t.profile.saved);
    } catch (e) {
      console.error('OrganisationPublicProfile.run', e instanceof ApiError ? e.problem : e);
    } finally {
      setBusy(false);
    }
  };

  const uploadLogo = async () => {
    // A merchant's photos must stay under 1 MB, so the picker is asked for a lower quality.
    const { denied, items, unsupported } = await pickMedia({ limit: 1, videos: false, quality: kind === 'merchant' ? 0.6 : 0.9 });
    if (denied) return setError(t.threads.photoPermission);
    const [item] = items;
    if (!item) {
      if (unsupported.length > 0) setError(t.upload.unsupportedFormat);
      return;
    }
    if (kind === 'merchant' && checkPicked(item) !== 'ok') return setError(t.merchant.limits.imageTooLarge);
    setError(null);
    const name = profile?.publicProfile?.displayName ?? profile?.organisation.name ?? '';
    // The saved logo is touched only once the new one is ready: a failed or
    // cancelled upload leaves the previous one exactly as it was.
    const asset = await logoUpload.start(item, format(t.profile.avatarAlt, { name }));
    if (asset) await run(() => profileApi.updateOrganisation(kind, { logoAssetId: asset.id }));
  };

  return (
    <FormScreen title={t.profile.publicProfile} subtitle={t.profile.publicIntro}>
      {profile?.publicProfile ? <OrganisationCard org={profile.publicProfile} /> : (
        <ThemedText themeColor="textSecondary">{t.profile.noPublicProfile}</ThemedText>
      )}
      {profile?.canEdit ? (
        <>
          <TextField label={t.profile.displayName} value={form.displayName} maxLength={120}
            onChangeText={(displayName) => setForm({ ...form, displayName })} />
          <TextField label={t.profile.about} value={form.about} maxLength={1000} multiline
            style={styles.minHeight100TextAlignVerticalTop} onChangeText={(about) => setForm({ ...form, about })} />
          <TextField label={t.profile.website} value={form.website} autoCapitalize="none" keyboardType="url"
            onChangeText={(website) => setForm({ ...form, website })} />
          <TextField label={t.profile.city} value={form.city} onChangeText={(city) => setForm({ ...form, city })} />
          <Button label={t.profile.save} loading={busy} disabled={!form.displayName.trim()} onPress={() => run(() => profileApi.updateOrganisation(kind, {
            displayName: form.displayName.trim(),
            about: form.about.trim() || null,
            website: form.website.trim() || null,
            city: form.city.trim() || null,
          }))} />
          <Button label={t.profile.logo} variant="secondary" onPress={uploadLogo}
            disabled={busy || logoUpload.state.phase === 'uploading' || logoUpload.state.phase === 'processing'} />
          <UploadProgress state={logoUpload.state} label={t.profile.logo} onCancel={logoUpload.cancel} />
        </>
      ) : profile ? <ThemedText themeColor="textSecondary">{t.profile.readOnly}</ThemedText> : null}
      <Message text={error} />
      <Message text={notice} tone="success" />
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  minHeight100TextAlignVerticalTop: { minHeight: 100, textAlignVertical: 'top' },
});
