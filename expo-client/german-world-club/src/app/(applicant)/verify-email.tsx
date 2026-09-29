import { useEffect, useRef, useState } from 'react';

import { PROBLEMS } from '@gwc/contracts/errors';
import { EMAIL_CODE_LENGTH, registerRequestSchema } from '@gwc/contracts/onboarding';

import { onboardingApi } from '@/api/endpoints';
import { Button, CodeField, FormScreen, Message, TextField } from '@/components/ui';
import { useTranslations } from '@/i18n';
import { useSession } from '@/session/session';
import { ApiError } from '@/api/client';

/**
 * Onboarding step 4 (§6.1): prove the email address with the code we mail.
 *
 * The address can be corrected here while it is unconfirmed (PUT
 * /onboarding/email): the old code stops working and a new one is mailed to
 * the new address. An address another member has is shown on the field.
 *
 * Any other refusal, or a request that never reached the server, is shown in
 * a message above the buttons, worded from the problem `type` by
 * `problemMessage`. It is logged as well.
 */
export default function VerifyEmail() {
  const { t, format, problemMessage } = useTranslations();
  const { refreshStatus, signOut } = useSession();
  const [challenge, setChallenge] = useState<{ id: string; sentTo: string } | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const sentOnce = useRef(false);
  const [editing, setEditing] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);

  const send = async () => {
    setRequestError(null);
    try {
      const sent = await onboardingApi.sendEmailCode();
      setChallenge({ id: sent.challengeId, sentTo: sent.sentTo });
    } catch (e) {
      console.error('VerifyEmail.send', e instanceof ApiError ? e.problem : e);
      setRequestError(problemMessage(e));
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
    setRequestError(null);
    try {
      const status = await onboardingApi.verifyEmail({ challengeId: challenge.id, code });
      await refreshStatus(status);
    } catch (e) {
      console.error('VerifyEmail.submit', e instanceof ApiError ? e.problem : e);
      setRequestError(problemMessage(e));
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  const changeEmail = async () => {
    const email = newEmail.trim().toLowerCase();
    if (!registerRequestSchema.shape.email.safeParse(email).success) {
      setEmailError(t.validation.email);
      return;
    }
    setBusy(true);
    setEmailError(null);
    setRequestError(null);
    try {
      const sent = await onboardingApi.changeEmail(email);
      // The old code stops working; the next one belongs to this challenge.
      setChallenge({ id: sent.challengeId, sentTo: sent.sentTo });
      setCode('');
      setNewEmail('');
      setEditing(false);
    } catch (e) {
      console.error('VerifyEmail.changeEmail', e instanceof ApiError ? e.problem : e);
      if (e instanceof ApiError && e.type === PROBLEMS.EMAIL_IN_USE.type) setEmailError(t.register.emailInUse);
      else setRequestError(problemMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <FormScreen title={t.register.emailTitle}>
        <TextField label={t.register.newEmail} value={newEmail} onChangeText={setNewEmail}
          keyboardType="email-address" autoCapitalize="none" autoComplete="email" textContentType="emailAddress" error={emailError} />
        <Message text={requestError} />
        <Button label={t.register.changeEmailSave} onPress={changeEmail} loading={busy} />
        <Button label={t.register.changeDetailsCancel} onPress={() => { setEditing(false); setEmailError(null); setRequestError(null); }} variant="secondary" />
      </FormScreen>
    );
  }

  return (
    <FormScreen
      title={t.register.emailTitle}
      subtitle={`${t.register.emailHint}${challenge ? ` ${format(t.common.codeSentTo, { target: challenge.sentTo })}` : ''}`}>
      <CodeField label={t.register.emailTitle} length={EMAIL_CODE_LENGTH} value={code} onChangeText={setCode} />
      <Message text={requestError} />
      <Button label={t.common.continue} onPress={submit} loading={busy} disabled={!challenge || code.length !== EMAIL_CODE_LENGTH} />
      <Button label={t.common.resendCode} onPress={send} variant="secondary" />
      <Button label={t.register.changeEmail} onPress={() => { setEditing(true); setRequestError(null); }} variant="secondary" />
      <Button label={t.common.signOut} onPress={signOut} variant="secondary" />
    </FormScreen>
  );
}
