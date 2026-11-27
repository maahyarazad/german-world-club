import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';

import { OTP_RESEND_COOLDOWN_SECONDS, PASSWORD_RESET_CODE_LENGTH } from '@gwc/contracts/auth';
import { PROBLEMS } from '@gwc/contracts/errors';

import { ApiError } from '@/api/client';
import { authApi } from '@/api/endpoints';
import { AuthScreen } from '@/components/auth-screen';
import { AsyncButton, Button, CodeField, Message, TextField } from '@/components/ui';
import { useTranslations } from '@/i18n';
import { useSession } from '@/session/session';
import { deviceId as loadDeviceId } from '@/session/storage';

/**
 * Forgot password, step 2 of 2 (feature 043): the six-digit code from the text message and
 * a new password, sent together.
 *
 * The code and the password travel in ONE request so nobody is left holding a spent code
 * and no new password. Both are checked here first, with nothing sent: a password that is
 * too short or two that differ show their own message, and a code that is not six digits
 * leaves Save disabled. That matters beyond tidiness, because the code allows five wrong
 * tries and a typo in the password must never use one up.
 *
 * ONE MESSAGE FOR A BAD CODE. The server answers a wrong, expired, already used and
 * exhausted code identically on purpose (otherwise the difference would tell a stranger
 * whether an account exists, research R17), so this screen has exactly one thing to say:
 * "not correct or has expired". It must not grow per-case messages, because the server no
 * longer sends it anything to base them on.
 *
 * Success does NOT sign anyone in: every session of the account was just ended, so the person
 * goes back to the sign-in screen with a "password changed" message and signs in with the new one.
 */
export default function ResetPassword() {
  const { t, format } = useTranslations();
  const { deviceId } = useSession();
  // The id of the challenge this screen's code belongs to. It is state because asking for another
  // code replaces it; it is not a secret, only a pointer to a row.
  const params = useLocalSearchParams<{ challengeId: string; email?: string; mobile?: string }>();
  const [challengeId, setChallengeId] = useState(params.challengeId);
  // What the person asked with, so the screen can ask again. Held in memory by the navigator; never logged.
  const identifier = params.email ? { email: params.email } : params.mobile ? { mobile: params.mobile } : null;
  // Seconds until another code may be asked for. It starts running when the screen opens, because
  // the ask that brought the person here just sent one. This wait is the APP's: the server answers
  // every ask the same and limits it to three an hour per number (research R17).
  const [cooldown, setCooldown] = useState<number>(OTP_RESEND_COOLDOWN_SECONDS);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [passwordError, setPasswordError] = useState<string | undefined>();
  const [repeatError, setRepeatError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  // The refusals the person must be told about, because they cannot proceed without knowing why.
  const [message, setMessage] = useState<string | null>(null);

  // One tick a second while the wait runs. The seconds left is state because it changes what the
  // button does and says; the timer is cleaned up when it changes or the screen goes.
  useEffect(() => {
    if (cooldown <= 0) return;
    const tick = setTimeout(() => setCooldown((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => clearTimeout(tick);
  }, [cooldown]);

  /**
   * Ask again. There is no resend-by-challenge for this purpose (the server treats a reset challenge
   * like an unknown id, research R17), so this is simply the first request again, which ends the old
   * code and sends a new one to the number on record, if there is one. The screen cannot tell, and
   * does not try: it shows the same as ever.
   */
  const askAgain = async () => {
    if (!identifier) return;
    setMessage(null);
    try {
      const accepted = await authApi.requestPasswordResetCode({ ...identifier, deviceId: deviceId ?? (await loadDeviceId()) });
      setChallengeId(accepted.challengeId);
      setCode('');
      setCooldown(accepted.cooldownSeconds);
    } catch (e) {
      console.error('ResetPassword.resend', e instanceof ApiError ? e.problem : e);
      if (!(e instanceof ApiError)) setMessage(t.passwordReset.offline);
      else if (e.type === PROBLEMS.RATE_LIMITED.type) setMessage(t.passwordReset.tooManyRequests);
    }
  };

  const submit = async () => {
    setMessage(null);
    // The same bound as the server (8 to 256) and as the web console's reset page. A local check
    // sends nothing, so it spends no guess at the code.
    const tooShort = password.length < 8;
    const mismatch = !tooShort && password !== repeat;
    setPasswordError(tooShort ? t.passwordReset.tooShort : undefined);
    setRepeatError(mismatch ? t.passwordReset.mismatch : undefined);
    if (tooShort || mismatch) return;

    setBusy(true);
    try {
      await authApi.confirmPasswordResetCode({
        challengeId,
        code,
        deviceId: deviceId ?? (await loadDeviceId()),
        password,
      });
      router.replace({ pathname: '/sign-in', params: { notice: 'password-reset' } });
    } catch (e) {
      console.error('ResetPassword.submit', e instanceof ApiError ? e.problem : e);
      if (!(e instanceof ApiError)) {
        // Never reached the server: nothing was spent, so trying again is safe.
        setMessage(t.passwordReset.offline);
      } else if (e.type === PROBLEMS.INVALID_OTP.type) {
        setMessage(t.passwordReset.invalidCode);
        // Keep the passwords, which cost effort to type; only the code is wrong.
        setCode('');
      } else if (e.type === PROBLEMS.RATE_LIMITED.type) {
        setMessage(t.passwordReset.tooManyRequests);
      }
      // Anything else is only logged (CLAUDE.md): the screen stays as it is.
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthScreen
      subtitle={t.passwordReset.codeSubtitle}
      actions={
        <>
          <Button
            label={t.passwordReset.submitConfirm}
            onPress={submit}
            loading={busy}
            disabled={code.length !== PASSWORD_RESET_CODE_LENGTH}
          />
          <AsyncButton
            name="ResetPassword.resend"
            label={cooldown > 0 ? format(t.passwordReset.resendIn, { seconds: cooldown }) : t.passwordReset.resend}
            onAction={askAgain}
            variant="secondary"
            disabled={cooldown > 0 || !identifier}
          />
        </>
      }>
      <CodeField label={t.passwordReset.codeLabel} length={PASSWORD_RESET_CODE_LENGTH} value={code} onChangeText={setCode} />
      <TextField
        label={t.passwordReset.newPassword}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
        hint={t.passwordReset.passwordHint}
        error={passwordError}
      />
      <TextField
        label={t.passwordReset.repeatPassword}
        value={repeat}
        onChangeText={setRepeat}
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
        error={repeatError}
        onSubmitEditing={submit}
      />
      <Message text={message} />
    </AuthScreen>
  );
}
