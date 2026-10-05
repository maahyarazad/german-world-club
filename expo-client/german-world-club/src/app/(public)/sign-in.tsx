import { router } from 'expo-router';
import { useState } from 'react';

import { Button, FormScreen, Message, TextField } from '@/components/ui';
import { useTranslations } from '@/i18n';
import { useSession } from '@/session/session';
import { ApiError } from '@/api/client';
import { PROBLEMS } from '@gwc/contracts/errors';

export default function SignIn() {
  const { t } = useTranslations();
  const { signIn } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // A refusal the person can act on (wrong password, no connection…), shown
  // in place of the outcome notices above; both are cleared on the next attempt.
  const [failure, setFailure] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setNotice(null);
    setFailure(null);
    try {
      const result = await signIn(email.trim().toLowerCase(), password);
      // `authenticated` needs nothing here: the session moves the app on.
      console.log(result);
      switch (result.outcome) {
        case 'otp_required':
          router.push({
            pathname: '/sign-in-code',
            params: { challengeId: result.challengeId!, sentTo: result.sentTo ?? '' },
          });
          break;
        case 'approval_pending':
          setNotice(t.signIn.approvalPending);
          break;
        case 'profile_incomplete':
          setNotice(t.signIn.profileIncomplete);
          break;
        case 'password_reset_required':
          setNotice(t.signIn.passwordResetRequired);
          break;
        case 'staff_account':
          setNotice(t.signIn.staffAccount);
          break;
      }
    } catch (e) {
      console.error('SignIn.submit', e instanceof ApiError ? e.problem : e);
      // The screen branches on the problem `type`, never on `detail`. Anything
      // that is not an ApiError never reached the server (fetch itself threw).
      if (!(e instanceof ApiError)) setFailure(t.signIn.networkError);
      else if (e.type === PROBLEMS.INVALID_CREDENTIALS.type || e.status === 401) setFailure(t.signIn.invalidCredentials);
      else if (e.type === PROBLEMS.ACCOUNT_LOCKED.type) setFailure(t.signIn.accountLocked);
      else if (e.type === PROBLEMS.RATE_LIMITED.type) setFailure(t.signIn.tooManyAttempts);
      else setFailure(t.signIn.genericError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormScreen>
      <TextField
        label={t.signIn.email}
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
        textContentType="username"
      />
      <TextField
        label={t.signIn.password}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="current-password"
        textContentType="password"
        onSubmitEditing={submit}
      />
      <Message text={failure} />
      <Message text={notice} tone="info" />
      <Button label={t.signIn.submit} onPress={submit} loading={busy} disabled={!email || password.length < 8} />
    </FormScreen>
  );
}
