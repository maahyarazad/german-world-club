import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { PROBLEMS } from '@gwc/contracts/errors';
import { registerRequestSchema } from '@gwc/contracts/onboarding';

import { authApi, onboardingApi } from '@/api/endpoints';
import { Button, CodeField, FormScreen, Message, TextField } from '@/components/ui';
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
 *
 * A mistyped email or number is corrected here rather than by starting over
 * (step 2 cannot be reached back from this screen): `POST /onboarding/contact`
 * changes the same application and texts a new code. A value another member
 * already has is shown on its field — the one refusal this screen displays,
 * because the applicant must choose another.
 */
const fields = registerRequestSchema.shape;

export default function VerifyMobile() {
  const { t, format } = useTranslations();
  const { adopt, deviceId } = useSession();
  const { draft, update, clear } = useRegistrationDraft();
  const params = useLocalSearchParams<{ challengeId: string; sentTo: string }>();
  const [sentTo, setSentTo] = useState(params.sentTo);
  // A resend or a change mints a new challenge; the code that arrives next belongs to it.
  const [challengeId, setChallengeId] = useState(params.challengeId);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [email, setEmail] = useState(draft.email ?? '');
  const [mobile, setMobile] = useState(draft.mobile ?? '');
  const [errors, setErrors] = useState<{ email?: string; mobile?: string }>({});

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

  const changeContact = async () => {
    const nextEmail = email.trim().toLowerCase();
    const nextMobile = mobile.replace(/[\s\-()]/g, '');
    const found: { email?: string; mobile?: string } = {};
    if (!fields.email.safeParse(nextEmail).success) found.email = t.validation.email;
    if (!fields.mobile.safeParse(nextMobile).success) found.mobile = t.validation.mobile;
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    setNotice(null);
    try {
      const sent = await onboardingApi.changeContact({
        challengeId,
        deviceId: deviceId!,
        ...(nextEmail !== draft.email ? { email: nextEmail } : {}),
        ...(nextMobile !== draft.mobile ? { mobile: nextMobile } : {}),
      });
      // The old code is spent; the next one belongs to the new challenge.
      setChallengeId(sent.challengeId);
      setSentTo(sent.sentTo);
      update({ email: nextEmail, mobile: nextMobile });
      setCode('');
      setEditing(false);
      setNotice(format(t.register.detailsChanged, { target: sent.sentTo }));
    } catch (e) {
      console.error('VerifyMobile.changeContact', e instanceof ApiError ? e.problem : e);
      if (e instanceof ApiError && e.type === PROBLEMS.EMAIL_IN_USE.type) setErrors({ email: t.register.emailInUse });
      if (e instanceof ApiError && e.type === PROBLEMS.MOBILE_IN_USE.type) setErrors({ mobile: t.register.mobileInUse });
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <FormScreen title={t.register.mobileTitle}>
        <TextField label={t.register.email} value={email} onChangeText={setEmail}
          keyboardType="email-address" autoCapitalize="none" autoComplete="email" textContentType="emailAddress" error={errors.email} />
        <TextField label={t.register.mobile} value={mobile} onChangeText={setMobile}
          keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber"
          placeholder="+49 151 12345678" hint={t.register.mobileHint} error={errors.mobile} />
        <Button label={t.register.changeDetailsSave} onPress={changeContact} loading={busy} />
        <Button label={t.register.changeDetailsCancel} onPress={() => { setEditing(false); setErrors({}); }} variant="secondary" />
      </FormScreen>
    );
  }

  return (
    <FormScreen title={t.register.mobileTitle} subtitle={`${t.register.mobileHint2} ${format(t.common.codeSentTo, { target: sentTo })}`}>
      <CodeField label={t.register.mobileTitle} length={4} value={code} onChangeText={setCode} />
      <Message text={notice} tone="info" />
      <Button label={t.common.continue} onPress={submit} loading={busy} disabled={code.length !== 4} />
      <Button label={t.common.resendCode} onPress={resend} variant="secondary" />
      <Button label={t.register.changeDetails} onPress={() => setEditing(true)} variant="secondary" />
    </FormScreen>
  );
}
