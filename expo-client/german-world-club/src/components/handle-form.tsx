import { useEffect, useState } from 'react';

import { HANDLE_PATTERN, RESERVED_HANDLES, normaliseHandle } from '@gwc/contracts/profile';
import type { MemberProfile } from '@gwc/contracts/profile';

import { profileApi } from '@/api/endpoints';
import { ThemedText } from '@/components/themed-text';
import { Button, FormScreen, TextField } from '@/components/ui';
import { useTranslations } from '@/i18n';
import { ApiError } from '@/api/client';

/**
 * Choosing or changing the @handle (010 US1/US3). The pattern and reserved
 * list give an inline hint only; availability and the save are the server's
 * answers — two members can race for one handle, and the database decides.
 */
export function HandleForm({ current, onSaved }: { current: string | null; onSaved: (profile: MemberProfile) => void }) {
  const { t } = useTranslations();
  const [value, setValue] = useState(current ?? '');
  const [available, setAvailable] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  const handle = normaliseHandle(value);
  const wellFormed = HANDLE_PATTERN.test(handle) && !(RESERVED_HANDLES as readonly string[]).includes(handle);

  useEffect(() => {
    setAvailable(null);
    if (!wellFormed || handle === current) return;
    const timer = setTimeout(() => {
      profileApi.handleAvailable(handle).then((r) => setAvailable(r.available)).catch((e) => {
        console.error('HandleForm.checkAvailability', e instanceof ApiError ? e.problem : e);
        setAvailable(null);
      });
    }, 350);
    return () => clearTimeout(timer);
  }, [handle, wellFormed, current]);

  const save = async () => {
    setBusy(true);
    try {
      onSaved(await profileApi.setHandle(handle));
    } catch (e) {
      console.error('HandleForm.save', e instanceof ApiError ? e.problem : e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormScreen title={t.profile.handleTitle} subtitle={t.profile.handleIntro}>
      <TextField label={t.profile.handle} value={value} onChangeText={setValue} autoCapitalize="none" autoCorrect={false} autoFocus />
      <ThemedText type="small" themeColor="textSecondary">
        {!wellFormed ? t.profile.handleHint : available === false ? t.profile.handleTaken : available ? t.profile.handleAvailable : ' '}
      </ThemedText>
      <Button label={t.profile.handleSave} onPress={save} loading={busy} disabled={!wellFormed || available === false} />
    </FormScreen>
  );
}
