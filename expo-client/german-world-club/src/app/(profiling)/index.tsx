import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  SETTLING_STATUSES, QUALIFICATION_LEVELS, OCCUPATIONS, DESIRED_WORK_TYPES, FUTURE_WORK_PRIORITIES, LANGUAGES,
} from '@gwc/contracts/profiling';
import type { ProfilingStatus, CitySlot } from '@gwc/contracts/profiling';

import { ThemedText } from '@/components/themed-text';
import { Button, Centered, Chip, FormScreen, Loading, Message, TextField, styles } from '@/components/ui';
import { CountryPicker, countryName } from '@/components/country-picker';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useTranslations } from '@/i18n';
import { useSession } from '@/session/session';
import { profilingApi } from '@/api/endpoints';
import { ApiError } from '@/api/client';

/**
 * Onboarding Phase 2 (feature 013), on the app. Mirrors the web console's
 * `Profiling.tsx`: branch and progress come from the server on mount, one
 * question at a time, resumable across sessions.
 */
export default function ProfilingScreen() {
  const { t, locale } = useTranslations();
  const copy = t.profiling;
  const { state, refreshProfiling } = useSession();
  const [snapshot, setSnapshot] = useState<ProfilingStatus | null>(
    state.status === 'profiling' ? state.profiling : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setSnapshot(await profilingApi.status());
    } catch (e) {
      console.error('ProfilingScreen.load', e instanceof ApiError ? e.problem : e);
    }
  }, []);

  useEffect(() => { if (!snapshot) void load(); }, [snapshot, load]);

  const submit = useCallback(async (body: Parameters<typeof profilingApi.submit>[0]) => {
    setError(null);
    setBusy(true);
    try {
      const next = await profilingApi.submit(body);
      setSnapshot(next);
      if (next.completed) await refreshProfiling(next);
    } catch (e) {
      console.error('ProfilingScreen.submit', e instanceof ApiError ? e.problem : e);
      setError(copy.genericError);
    } finally {
      setBusy(false);
    }
  }, [refreshProfiling, copy]);

  if (!snapshot) return <Loading />;

  // A completed elsewhere-branch outcome stays on screen until the member
  // continues — the germany branch has no outcome message, so refreshProfiling
  // above already moved the session on to 'member' by the time this would render.
  if (snapshot.completed && snapshot.branch === 'elsewhere') {
    const outcome = snapshot.outcome === 'gwc_city_match'
      ? { title: copy.matchTitle, body: copy.matchBody }
      : { title: copy.meetingTitle, body: copy.meetingBody };
    return (
      <Centered>
        <ThemedText type="title" style={{ textAlign: 'center' }}>{outcome.title}</ThemedText>
        <ThemedText themeColor="textSecondary" style={{ textAlign: 'center' }}>{outcome.body}</ThemedText>
        <Button label={copy.continueToApp} onPress={() => refreshProfiling(snapshot)} />
      </Centered>
    );
  }

  if (snapshot.completed) return <Loading />; // germany: transitioning to 'member'

  return snapshot.branch === 'germany'
    ? <GermanyQuestions copy={copy} snapshot={snapshot} error={error} busy={busy} onSubmit={submit} />
    : <NearestCityWizard copy={copy} locale={locale} error={error} busy={busy} onSubmit={submit} />;
}

type Copy = ReturnType<typeof useTranslations>['t']['profiling'];

function GermanyQuestions({
  copy, snapshot, error, busy, onSubmit,
}: {
  copy: Copy; snapshot: ProfilingStatus; error: string | null; busy: boolean;
  onSubmit: (body: object) => Promise<void>;
}) {
  const { answers } = snapshot;
  const [languageQuery, setLanguageQuery] = useState('');
  const [languages, setLanguages] = useState<string[]>(answers.languages ?? []);
  const [sectorInput, setSectorInput] = useState('');
  const [offeringInput, setOfferingInput] = useState('');
  const [ideaInput, setIdeaInput] = useState('');
  const [priorities, setPriorities] = useState<string[]>(answers.futureWorkPriorities ?? []);

  const choiceScreen = (
    title: string, options: readonly string[], optionLabels: Record<string, string>, field: string,
  ) => (
    <FormScreen title={title}>
      <View style={styles.chips} accessibilityRole="radiogroup">
        {options.map((value) => (
          <Chip key={value} label={optionLabels[value]!} selected={false} onPress={() => onSubmit({ [field]: value })} />
        ))}
      </View>
      <Message text={error} />
    </FormScreen>
  );

  if (answers.settlingStatus === null) {
    return choiceScreen(copy.settlingTitle, SETTLING_STATUSES, copy.settlingOptions, 'settlingStatus');
  }

  if (answers.languages === null) {
    const needle = languageQuery.trim().toLowerCase();
    const options = LANGUAGES.filter((l) => !needle || l.en.toLowerCase().includes(needle));
    return (
      <FormScreen title={copy.languagesTitle} subtitle={copy.languagesSubtitle}>
        <TextField label={copy.languagesSearch} value={languageQuery} onChangeText={setLanguageQuery} autoCorrect={false} />
        <View style={styles.chips} accessibilityRole="radiogroup">
          {options.map((l) => (
            <Chip
              key={l.code}
              label={l.en}
              selected={languages.includes(l.code)}
              onPress={() => setLanguages((current) => (
                current.includes(l.code) ? current.filter((c) => c !== l.code) : [...current, l.code]
              ))}
            />
          ))}
        </View>
        <Message text={error} />
        <Button
          label={busy ? copy.submitting : copy.continue}
          disabled={busy || languages.length === 0}
          onPress={() => onSubmit({ languages })}
        />
      </FormScreen>
    );
  }

  if (answers.qualificationLevel === null) {
    return choiceScreen(copy.qualificationTitle, QUALIFICATION_LEVELS, copy.qualificationOptions, 'qualificationLevel');
  }

  if (answers.occupation === null) {
    return choiceScreen(copy.occupationTitle, OCCUPATIONS, copy.occupationOptions, 'occupation');
  }

  if (answers.desiredWorkType === null) {
    return choiceScreen(copy.desiredWorkTitle, DESIRED_WORK_TYPES, copy.desiredWorkOptions, 'desiredWorkType');
  }

  // Q5 follow-up (FR-009–FR-011): which question(s) come next depends on the
  // Q5 answer itself, not on a fixed position in the sequence.
  const textStep = (title: string, value: string, onChangeText: (v: string) => void, field: string) => (
    <FormScreen title={title}>
      <TextField label={title} value={value} onChangeText={onChangeText} autoFocus />
      <Message text={error} />
      <Button
        label={busy ? copy.submitting : copy.continue}
        disabled={busy || !value.trim()}
        onPress={() => onSubmit({ [field]: value.trim() })}
      />
    </FormScreen>
  );

  if (answers.desiredWorkType === 'employee') {
    if (answers.futureWorkSector === null) {
      return textStep(copy.futureWorkSectorTitle, sectorInput, setSectorInput, 'futureWorkSector');
    }
    if (answers.futureWorkReady === null) {
      return (
        <FormScreen title={copy.futureWorkReadyTitle}>
          <View style={styles.chips} accessibilityRole="radiogroup">
            <Chip label={copy.futureWorkReadyOptions.yes} selected={false} onPress={() => onSubmit({ futureWorkReady: true })} />
            <Chip label={copy.futureWorkReadyOptions.no} selected={false} onPress={() => onSubmit({ futureWorkReady: false })} />
          </View>
          <Message text={error} />
        </FormScreen>
      );
    }
    return null; // complete — parent transitions away
  }

  if (answers.desiredWorkType === 'freelance' || answers.desiredWorkType === 'own_business') {
    if (answers.futureWorkOffering === null) {
      return textStep(copy.futureWorkOfferingTitle, offeringInput, setOfferingInput, 'futureWorkOffering');
    }
    if (answers.futureWorkIdea === null) {
      return textStep(copy.futureWorkIdeaTitle, ideaInput, setIdeaInput, 'futureWorkIdea');
    }
    return null;
  }

  // 'not_sure'
  if (answers.futureWorkPriorities === null) {
    const toggle = (value: string) => setPriorities((current) => (
      current.includes(value) ? current.filter((v) => v !== value) : [...current, value]
    ));
    return (
      <FormScreen title={copy.futureWorkPrioritiesTitle}>
        <View style={styles.chips} accessibilityRole="radiogroup">
          {FUTURE_WORK_PRIORITIES.map((value) => (
            <Chip
              key={value}
              label={copy.futureWorkPrioritiesOptions[value]}
              selected={priorities.includes(value)}
              onPress={() => toggle(value)}
            />
          ))}
        </View>
        <Message text={error} />
        <Button
          label={busy ? copy.submitting : copy.continue}
          disabled={busy || priorities.length === 0}
          onPress={() => onSubmit({ futureWorkPriorities: priorities })}
        />
      </FormScreen>
    );
  }
  return null;
}

type WizardStep =
  | 'primary-country' | 'primary-city'
  | 'ask-secondary' | 'secondary-country' | 'secondary-city';

/** The elsewhere branch: one primary city, then up to two optional secondaries. */
function NearestCityWizard({
  copy, locale, error, busy, onSubmit,
}: {
  copy: Copy; locale: 'en' | 'de'; error: string | null; busy: boolean;
  onSubmit: (body: { primaryCity: CitySlot; secondaryCities: CitySlot[] }) => Promise<void>;
}) {
  const theme = useTheme();
  const [step, setStep] = useState<WizardStep>('primary-country');
  const [primary, setPrimary] = useState<CitySlot>({ country: '', city: '' });
  const [secondary, setSecondary] = useState<CitySlot[]>([]);
  const [draftCountry, setDraftCountry] = useState('');
  const [draftCity, setDraftCity] = useState('');

  // The designated cities (research R4) double as a dropdown once their
  // country is picked — currently just the UAE emirates, so every other
  // country still falls through to free text below.
  const [gwcCities, setGwcCities] = useState<CitySlot[] | null>(null);
  useEffect(() => {
    profilingApi.gwcCities()
      .then(setGwcCities)
      .catch((e) => {
        console.error('NearestCityWizard.gwcCities', e instanceof ApiError ? e.problem : e);
        setGwcCities([]); // falls through to free text everywhere on failure
      });
  }, []);
  const citiesFor = useCallback(
    (country: string) => (gwcCities ?? []).filter((c) => c.country === country),
    [gwcCities],
  );

  // A full-flex picker, not `Centered` (which shrinks children to content
  // size and would collapse the list to zero height) — the same wrapper
  // (public)/country.tsx uses for the same component.
  const pickerScreen = (title: string, selected: string, onSelect: (country: string) => void) => (
    <SafeAreaView edges={['bottom']} style={{ flex: 1, backgroundColor: theme.background }}>
      <View style={{ flex: 1, padding: Spacing.four, gap: Spacing.three }}>
        <ThemedText type="title" style={{ fontSize: 30, lineHeight: 36 }}>{title}</ThemedText>
        <CountryPicker selected={selected} onSelect={onSelect} />
      </View>
    </SafeAreaView>
  );

  if (step === 'primary-country') {
    return pickerScreen(copy.primaryCountryTitle, primary.country, (country) => {
      setPrimary((c) => ({ ...c, country }));
      setStep('primary-city');
    });
  }

  if (step === 'primary-city') {
    if (gwcCities === null) return <Loading />;
    const options = citiesFor(primary.country);
    if (options.length > 0) {
      return (
        <FormScreen title={copy.primaryCityTitle} subtitle={countryName(primary.country, locale)}>
          <View style={styles.chips} accessibilityRole="radiogroup">
            {options.map((c) => (
              <Chip
                key={c.city}
                label={c.city}
                selected={primary.city === c.city}
                onPress={() => { setPrimary((p) => ({ ...p, city: c.city })); setStep('ask-secondary'); }}
              />
            ))}
          </View>
        </FormScreen>
      );
    }
    return (
      <FormScreen title={copy.primaryCityTitle} subtitle={countryName(primary.country, locale)}>
        <TextField label={copy.cityPlaceholder} value={primary.city} onChangeText={(city) => setPrimary((c) => ({ ...c, city }))} autoFocus />
        <Button label={copy.continue} disabled={!primary.city.trim()} onPress={() => setStep('ask-secondary')} />
      </FormScreen>
    );
  }

  if (step === 'ask-secondary') {
    return (
      <Centered>
        <ThemedText type="title" style={{ textAlign: 'center' }}>{copy.addSecondaryTitle}</ThemedText>
        <Message text={error} />
        <View style={{ alignSelf: 'stretch', gap: Spacing.two }}>
          {secondary.length < 2 && (
            <Button label={copy.addSecondaryYes} variant="secondary" onPress={() => { setDraftCountry(''); setDraftCity(''); setStep('secondary-country'); }} />
          )}
          <Button
            label={busy ? copy.submitting : copy.addSecondaryNo}
            loading={busy}
            onPress={() => onSubmit({ primaryCity: primary, secondaryCities: secondary })}
          />
        </View>
      </Centered>
    );
  }

  if (step === 'secondary-country') {
    return pickerScreen(copy.secondaryCountryTitle, draftCountry, (country) => {
      setDraftCountry(country);
      setStep('secondary-city');
    });
  }

  // step === 'secondary-city'
  const addSecondary = (city: string) => {
    setSecondary((current) => [...current, { country: draftCountry, city }]);
    setStep('ask-secondary');
  };

  if (gwcCities === null) return <Loading />;
  const secondaryOptions = citiesFor(draftCountry);
  if (secondaryOptions.length > 0) {
    return (
      <FormScreen title={copy.secondaryCityTitle} subtitle={countryName(draftCountry, locale)}>
        <View style={styles.chips} accessibilityRole="radiogroup">
          {secondaryOptions.map((c) => (
            <Chip key={c.city} label={c.city} selected={draftCity === c.city} onPress={() => addSecondary(c.city)} />
          ))}
        </View>
      </FormScreen>
    );
  }
  return (
    <FormScreen title={copy.secondaryCityTitle} subtitle={countryName(draftCountry, locale)}>
      <TextField label={copy.cityPlaceholder} value={draftCity} onChangeText={setDraftCity} autoFocus />
      <Button label={copy.continue} disabled={!draftCity.trim()} onPress={() => addSecondary(draftCity)} />
    </FormScreen>
  );
}
