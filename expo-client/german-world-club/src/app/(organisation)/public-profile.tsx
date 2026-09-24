import { router } from 'expo-router';
import { useEffect, useState } from 'react';

import type { OrganisationProfile } from '@gwc/contracts/profile';

import { ApiError } from '@/api/client';
import { profileApi } from '@/api/endpoints';
import { OrganisationCard } from '@/components/organisation-card';
import { ThemedText } from '@/components/themed-text';
import { Button, FormScreen, Loading, Message, TextField } from '@/components/ui';
import { useTranslations } from '@/i18n';
import { pickMedia, uploadReady } from '@/lib/pick-media';
import { useSession } from '@/session/session';

/**
 * The organisation's public profile (010 US3, FR-014): what members see.
 *
 * `canEdit` (owner or manager) decides whether the form is shown; the server
 * decides whether an edit is allowed, and answers a `staff`-role edit with
 * 404 — shown here as "not permitted", not as a missing page.
 */
export default function OrganisationPublicProfile() {
  const { t, format, problemMessage } = useTranslations();
  const { state } = useSession();
  const kind = state.status === 'organisation' ? (state.principal.kind as 'merchant' | 'partner') : null;
  const [profile, setProfile] = useState<OrganisationProfile | null>(null);
  const [form, setForm] = useState({ displayName: '', about: '', website: '', city: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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
    if (kind) profileApi.organisation(kind).then(adopt, (e) => setError(problemMessage(e)));
  }, [kind, problemMessage]);

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
      setError(e instanceof ApiError && e.status === 404 ? t.profile.notPermitted : problemMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const uploadLogo = async () => {
    const { denied, items } = await pickMedia({ limit: 1, videos: false });
    if (denied) return setError(t.threads.photoPermission);
    const [item] = items;
    if (!item) return;
    const name = profile?.publicProfile?.displayName ?? profile?.organisation.name ?? '';
    await run(async () => profileApi.updateOrganisation(kind, {
      logoAssetId: await uploadReady(item, format(t.profile.avatarAlt, { name }), `/media/${kind}`),
    }));
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
            style={{ minHeight: 100, textAlignVertical: 'top' }} onChangeText={(about) => setForm({ ...form, about })} />
          <TextField label={t.profile.website} value={form.website} autoCapitalize="none" keyboardType="url"
            onChangeText={(website) => setForm({ ...form, website })} />
          <TextField label={t.profile.city} value={form.city} onChangeText={(city) => setForm({ ...form, city })} />
          <Button label={t.profile.save} loading={busy} disabled={!form.displayName.trim()} onPress={() => run(() => profileApi.updateOrganisation(kind, {
            displayName: form.displayName.trim(),
            about: form.about.trim() || null,
            website: form.website.trim() || null,
            city: form.city.trim() || null,
          }))} />
          <Button label={t.profile.logo} variant="secondary" onPress={uploadLogo} disabled={busy} />
        </>
      ) : profile ? <ThemedText themeColor="textSecondary">{t.profile.readOnly}</ThemedText> : null}
      <Message text={error} />
      <Message text={notice} tone="success" />
    </FormScreen>
  );
}
