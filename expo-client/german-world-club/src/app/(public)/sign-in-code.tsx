import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { authApi } from '@/api/endpoints';
import { Button, CodeField, FormScreen, Message } from '@/components/ui';
import { useTranslations } from '@/i18n';
import { useSession } from '@/session/session';
import { ApiError } from '@/api/client';

/**
 * The SMS second factor (§6.2). Also how an applicant resumes onboarding on
 * the phone they applied from: the server answers their sign-in with a code
 * too, and the session then routes them back to the step they were on.
 */
export default function SignInCode() {
  const { t, format } = useTranslations();
  const { adopt, deviceId } = useSession();
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
      const pair = await authApi.verifyOtp({ challengeId, code, deviceId: deviceId! });
      await adopt({ accessToken: pair.accessToken!, refreshToken: pair.refreshToken!, principal: pair.principal! });
    } catch (e) {
      console.error('SignInCode.submit', e instanceof ApiError ? e.problem : e);
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
      console.error('SignInCode.resend', e instanceof ApiError ? e.problem : e);
    }
  };

  return (
    <FormScreen subtitle={`${t.signIn.otpHint} ${sentTo ? format(t.common.codeSentTo, { target: sentTo }) : ''}`}>
      <CodeField label={t.signIn.otpTitle} length={4} value={code} onChangeText={setCode} />
      <Message text={notice} tone="info" />
      <Button label={t.common.continue} onPress={submit} loading={busy} disabled={code.length !== 4} />
      <Button label={t.common.resendCode} onPress={resend} variant="secondary" />
    </FormScreen>
  );
}
