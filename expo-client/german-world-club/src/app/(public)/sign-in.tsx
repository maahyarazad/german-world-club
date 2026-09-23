import { router } from 'expo-router';
import { useState } from 'react';

import { Button, FormScreen, Message, TextField } from '@/components/ui';
import { useTranslations } from '@/i18n';
import { useSession } from '@/session/session';

export default function SignIn() {
  const { t, problemMessage } = useTranslations();
  const { signIn } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await signIn(email.trim().toLowerCase(), password);
      // `authenticated` needs nothing here: the session moves the app on.
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
      }
    } catch (e) {
      setError(problemMessage(e));
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
      <Message text={error} />
      <Message text={notice} tone="info" />
      <Button label={t.signIn.submit} onPress={submit} loading={busy} disabled={!email || password.length < 8} />
    </FormScreen>
  );
}
