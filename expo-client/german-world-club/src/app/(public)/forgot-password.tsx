import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { PROBLEMS } from '@gwc/contracts/errors';
import { checkMobile } from '@gwc/contracts/mobile';
import { registerRequestSchema } from '@gwc/contracts/onboarding';

import { ApiError } from '@/api/client';
import { authApi } from '@/api/endpoints';
import { AuthScreen } from '@/components/auth-screen';
import { MobileField } from '@/components/mobile-field';
import { ThemedText } from '@/components/themed-text';
import { Button, Chip, Message, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTranslations } from '@/i18n';
import { mobileErrorText } from '@/lib/mobile-text';
import { useSession } from '@/session/session';
import { deviceId as loadDeviceId } from '@/session/storage';

/**
 * Forgot password, step 1 of 2 (feature 043): say who you are, and a six-digit code is
 * texted to the mobile number on record. By email or by number; the person picks.
 *
 * What this screen must NOT do is turn the server's answer into a statement about
 * accounts. The server answers every identifier the same, including one that matches
 * nobody, so this screen goes to the code screen after ANY accepted request and its
 * wording never confirms a match ("if an account matches…", never "we sent a code to
 * ••• 4567" and never "no account found"). A merchant, partner or staff account has no
 * number on file here and is told, in the hint, to use the website; the screen cannot
 * tell it apart from anyone else, by design.
 *
 * Checked before it is sent, with the same rules the server uses: an email that is not an
 * email, or a number `checkMobile` rejects, shows the field's own message and sends nothing.
 */
const emailField = registerRequestSchema.shape.email;

type Mode = 'email' | 'mobile';

export default function ForgotPassword() {
  const { t } = useTranslations();
  const { deviceId } = useSession();
  const [mode, setMode] = useState<Mode>('email');
  // Both are kept while the person flips between the two, so nothing they typed is lost.
  const [email, setEmail] = useState('');
  const [mobile, setMobile] = useState('');
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  // What changes what the person can do: they are being refused for sending too much, or
  // the request never reached the server. Every other refusal is only logged (CLAUDE.md).
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async () => {
    setNotice(null);
    // Validate first. Nothing is sent for a value the server would refuse.
    let identifier: { email: string } | { mobile: string };
    if (mode === 'email') {
      const typed = email.trim().toLowerCase();
      if (!emailField.safeParse(typed).success) {
        setFieldError(t.passwordReset.emailInvalid);
        return;
      }
      identifier = { email: typed };
    } else {
      // People type spaces and dashes in phone numbers; E.164 has neither.
      const check = checkMobile('', mobile.replace(/[\s\-()]/g, ''));
      if (!check.ok) {
        setFieldError(mobileErrorText(t.validation, check.reason));
        return;
      }
      identifier = { mobile: check.e164 };
    }
    setFieldError(undefined);

    setBusy(true);
    try {
      const accepted = await authApi.requestPasswordResetCode({ ...identifier, deviceId: deviceId ?? (await loadDeviceId()) });
      // The same for every identifier. The identifier goes along so the code screen can ask
      // again; it is held in memory by the navigator and never logged.
      router.push({ pathname: '/reset-password', params: { challengeId: accepted.challengeId, ...identifier } });
    } catch (e) {
      console.error('ForgotPassword.submit', e instanceof ApiError ? e.problem : e);
      if (!(e instanceof ApiError)) setNotice(t.passwordReset.offline);
      else if (e.type === PROBLEMS.RATE_LIMITED.type) setNotice(t.passwordReset.tooManyRequests);
    } finally {
      setBusy(false);
    }
  };

  const chooseMode = (next: Mode) => {
    setMode(next);
    setFieldError(undefined);
  };

  return (
    <AuthScreen
      actions={
        <Button
          label={t.passwordReset.submitRequest}
          onPress={submit}
          loading={busy}
          disabled={mode === 'email' ? email.trim() === '' : mobile === ''}
        />
      }>
      <View accessibilityRole="radiogroup" style={styles.chips}>
        <Chip label={t.passwordReset.byEmail} selected={mode === 'email'} onPress={() => chooseMode('email')} />
        <Chip label={t.passwordReset.byMobile} selected={mode === 'mobile'} onPress={() => chooseMode('mobile')} />
      </View>
      {mode === 'email' ? (
        <TextField
          label={t.signIn.email}
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          textContentType="username"
          error={fieldError}
          onSubmitEditing={submit}
        />
      ) : (
        <MobileField value={mobile} onChange={setMobile} error={fieldError} onSubmitEditing={submit} />
      )}
      <ThemedText type="small" themeColor="textSecondary">{t.passwordReset.requestHint}</ThemedText>
      <Message text={notice} />
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', gap: Spacing.two },
});
