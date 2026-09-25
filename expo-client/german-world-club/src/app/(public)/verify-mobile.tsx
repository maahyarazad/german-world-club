import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { authApi, onboardingApi } from '@/api/endpoints';
import { Button, CodeField, FormScreen, Message } from '@/components/ui';
import { useTranslations } from '@/i18n';
import { useRegistrationDraft } from '@/session/registration-draft';
import { useSession } from '@/session/session';
import { ApiError } from '@/api/client';

/**
 * Onboarding step 3 (§6.1): prove the mobile number.
 *
 * Success issues the applicant's first session. The session then asks the
 * server where they stand and the root guards move them to email
 * verification — this screen never navigates on success itself.
 */
export default function VerifyMobile() {
  const { t, format } = useTranslations();
  const { adopt, deviceId } = useSession();
  const { clear } = useRegistrationDraft();
  const params = useLocalSearchParams<{ challengeId: string; sentTo: string }>();
  const { sentTo } = params;
  // A resend mints a new challenge; the code that arrives next belongs to it.
  const [challengeId, setChallengeId] = useState(params.challengeId);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    try {
      const pair = await onboardingApi.verifyMobile({ challengeId, code, deviceId: deviceId! });
      // The body carries tokens because this request carried a deviceId — the
      // web face gets cookies instead. A missing pair here is a server bug,
      // and adopting a half-session would be worse than failing loudly.
      if (!pair.accessToken || !pair.refreshToken) throw new Error('verify-mobile returned no token pair');
      // The draft held the password; it has done its job.
      clear();
      await adopt({ accessToken: pair.accessToken, refreshToken: pair.refreshToken, principal: pair.principal });
    } catch (e) {
      console.error('VerifyMobile.submit', e instanceof ApiError ? e.problem : e);
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    try {
      const resent = await authApi.resendOtp(challengeId);
      setChallengeId(resent.challengeId);
      setNotice(format(t.common.codeSentTo, { target: sentTo }));
    } catch (e) {
      console.error('VerifyMobile.resend', e instanceof ApiError ? e.problem : e);
    }
  };

  return (
    <FormScreen title={t.register.mobileTitle} subtitle={`${t.register.mobileHint2} ${format(t.common.codeSentTo, { target: sentTo })}`}>
      <CodeField label={t.register.mobileTitle} length={4} value={code} onChangeText={setCode} />
      <Message text={notice} tone="info" />
      <Button label={t.common.continue} onPress={submit} loading={busy} disabled={code.length !== 4} />
      <Button label={t.common.resendCode} onPress={resend} variant="secondary" />
    </FormScreen>
  );
}
