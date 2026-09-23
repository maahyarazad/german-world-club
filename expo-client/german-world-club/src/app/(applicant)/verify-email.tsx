import { useEffect, useRef, useState } from 'react';

import { EMAIL_CODE_LENGTH } from '@gwc/contracts/onboarding';

import { onboardingApi } from '@/api/endpoints';
import { Button, CodeField, FormScreen } from '@/components/ui';
import { useTranslations } from '@/i18n';
import { useSession } from '@/session/session';

/** Onboarding step 4 (§6.1): prove the email address with the code we mail. */
export default function VerifyEmail() {
  const { t, format, problemMessage } = useTranslations();
  const { refreshStatus, signOut } = useSession();
  const [challenge, setChallenge] = useState<{ id: string; sentTo: string } | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sentOnce = useRef(false);

  const send = async () => {
    setError(null);
    try {
      const sent = await onboardingApi.sendEmailCode();
      setChallenge({ id: sent.challengeId, sentTo: sent.sentTo });
    } catch (e) {
      setError(problemMessage(e));
    }
  };

  // Send on arrival, once — not on every re-render. Each send is rate-limited
  // and is a fresh set of guesses, so it should happen when asked for.
  useEffect(() => {
    if (sentOnce.current) return;
    sentOnce.current = true;
    void send();
  }, []);

  const submit = async () => {
    if (!challenge) return;
    setBusy(true);
    setError(null);
    try {
      const status = await onboardingApi.verifyEmail({ challengeId: challenge.id, code });
      await refreshStatus(status);
    } catch (e) {
      setError(problemMessage(e));
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormScreen
      title={t.register.emailTitle}
      subtitle={`${t.register.emailHint}${challenge ? ` ${format(t.common.codeSentTo, { target: challenge.sentTo })}` : ''}`}>
      <CodeField label={t.register.emailTitle} length={EMAIL_CODE_LENGTH} value={code} onChangeText={setCode} error={error} />
      <Button label={t.common.continue} onPress={submit} loading={busy} disabled={!challenge || code.length !== EMAIL_CODE_LENGTH} />
      <Button label={t.common.resendCode} onPress={send} variant="secondary" />
      <Button label={t.common.signOut} onPress={signOut} variant="secondary" />
    </FormScreen>
  );
}
