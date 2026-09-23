import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { GENDERS, registerRequestSchema, type Gender } from '@gwc/contracts/onboarding';

import { ThemedText } from '@/components/themed-text';
import { Button, Chip, FormScreen, TextField, styles } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useTranslations } from '@/i18n';
import { useRegistrationDraft } from '@/session/registration-draft';

/**
 * Onboarding step 1 (§6.1): full name, mobile, birthday, gender — plus the
 * email and password the account signs in with later.
 *
 * Validated with the server's own schema from @gwc/contracts, field by field,
 * so this screen cannot accept something the server will refuse or refuse
 * something it would accept. The server validates again regardless.
 */
const fields = registerRequestSchema.shape;

type Errors = Partial<Record<'fullName' | 'email' | 'password' | 'mobile' | 'birthday' | 'gender', string>>;

export default function Register() {
  const { t } = useTranslations();
  const theme = useTheme();
  const { draft, update } = useRegistrationDraft();
  const [fullName, setFullName] = useState(draft.fullName ?? '');
  const [email, setEmail] = useState(draft.email ?? '');
  const [password, setPassword] = useState(draft.password ?? '');
  const [mobile, setMobile] = useState(draft.mobile ?? '');
  const [year, month, day] = (draft.birthday ?? '--').split('-');
  const [dd, setDd] = useState(day ?? '');
  const [mm, setMm] = useState(month ?? '');
  const [yyyy, setYyyy] = useState(year ?? '');
  const [gender, setGender] = useState<Gender | undefined>(draft.gender);
  const [errors, setErrors] = useState<Errors>({});

  const next = () => {
    // People type spaces and dashes in phone numbers; E.164 has neither.
    const normalisedMobile = mobile.replace(/[\s\-()]/g, '');
    const birthday = `${yyyy.padStart(4, '0')}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
    const found: Errors = {};
    if (!fields.fullName.safeParse(fullName).success) found.fullName = t.validation.fullName;
    if (!fields.email.safeParse(email).success) found.email = t.validation.email;
    if (!fields.password.safeParse(password).success) found.password = t.validation.password;
    if (!fields.mobile.safeParse(normalisedMobile).success) found.mobile = t.validation.mobile;
    if (!fields.birthday.safeParse(birthday).success) found.birthday = t.validation.birthday;
    if (!gender) found.gender = t.validation.gender;
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    update({ fullName: fullName.trim(), email: email.trim().toLowerCase(), password, mobile: normalisedMobile, birthday, gender });
    router.push('/country');
  };

  return (
    <FormScreen title={t.register.detailsTitle}>
      <TextField label={t.register.fullName} value={fullName} onChangeText={setFullName}
        autoComplete="name" textContentType="name" error={errors.fullName} />
      <TextField label={t.register.email} value={email} onChangeText={setEmail}
        keyboardType="email-address" autoCapitalize="none" autoComplete="email" textContentType="emailAddress" error={errors.email} />
      <TextField label={t.register.password} value={password} onChangeText={setPassword}
        secureTextEntry autoComplete="new-password" textContentType="newPassword" error={errors.password} />
      <TextField label={t.register.mobile} value={mobile} onChangeText={setMobile}
        keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber"
        placeholder="+49 151 12345678" hint={t.register.mobileHint} error={errors.mobile} />

      <View style={{ gap: Spacing.one }}>
        <ThemedText type="smallBold">{t.register.birthday}</ThemedText>
        <View style={[styles.row, { alignItems: 'flex-start' }]}>
          <View style={{ flex: 1 }}>
            <TextField label={t.register.day} value={dd} onChangeText={(v) => setDd(v.replace(/\D/g, ''))} keyboardType="number-pad" maxLength={2} />
          </View>
          <View style={{ flex: 1 }}>
            <TextField label={t.register.month} value={mm} onChangeText={(v) => setMm(v.replace(/\D/g, ''))} keyboardType="number-pad" maxLength={2} />
          </View>
          <View style={{ flex: 2 }}>
            <TextField label={t.register.year} value={yyyy} onChangeText={(v) => setYyyy(v.replace(/\D/g, ''))} keyboardType="number-pad" maxLength={4} />
          </View>
        </View>
        {errors.birthday ? <ThemedText type="small" style={{ color: theme.danger }}>{errors.birthday}</ThemedText> : null}
      </View>

      <View style={{ gap: Spacing.two }} accessibilityRole="radiogroup">
        <ThemedText type="smallBold">{t.register.gender}</ThemedText>
        <View style={styles.chips}>
          {GENDERS.map((g) => (
            <Chip key={g} label={t.register.genders[g]} selected={gender === g} onPress={() => setGender(g)} />
          ))}
        </View>
        {errors.gender ? <ThemedText type="small" style={{ color: theme.danger }}>{errors.gender}</ThemedText> : null}
      </View>

      <Button label={t.common.continue} onPress={next} />
    </FormScreen>
  );
}
