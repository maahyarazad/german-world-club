import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { CitySlot } from '@gwc/contracts/profiling';

import { ThemedText } from '@/components/themed-text';
import { Button, Chip, FormScreen, Loading, TextField, styles } from '@/components/ui';
import { CountryPicker, countryName } from '@/components/country-picker';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { profilingApi } from '@/api/endpoints';
import { ApiError } from '@/api/client';
import type { StepCtx } from './types';

type Sub = 'primary-country' | 'primary-city' | 'ask-secondary' | 'secondary-country' | 'secondary-city';

/**
 * The elsewhere branch's nearest-city step: one primary city, then up to two
 * optional secondaries, saved together. Starts from what is already saved, and
 * Back walks the sub-steps before it leaves the step.
 */
export function CitiesStep({ ctx }: { ctx: StepCtx }) {
  const { copy, locale, busy } = ctx;
  const theme = useTheme();
  const saved = ctx.answers.primaryCity;
  const [sub, setSub] = useState<Sub>(saved ? 'ask-secondary' : 'primary-country');
  const [primary, setPrimary] = useState<CitySlot>(saved ?? { country: '', city: '' });
  const [secondary, setSecondary] = useState<CitySlot[]>(ctx.answers.secondaryCities);
  const [draftCountry, setDraftCountry] = useState('');
  const [draftCity, setDraftCity] = useState('');

  // The designated cities (research R4) double as a dropdown once their
  // country is picked — currently the UAE emirates; other countries use free text.
  const [gwcCities, setGwcCities] = useState<CitySlot[] | null>(null);
  useEffect(() => {
    profilingApi.gwcCities()
      .then(setGwcCities)
      .catch((e) => {
        console.error('CitiesStep.gwcCities', e instanceof ApiError ? e.problem : e);
        setGwcCities([]);
      });
  }, []);
  const citiesFor = useCallback((country: string) => (gwcCities ?? []).filter((c) => c.country === country), [gwcCities]);

  const goBack = () => {
    const previous: Partial<Record<Sub, Sub>> = {
      'primary-city': 'primary-country', 'ask-secondary': 'primary-city',
      'secondary-country': 'ask-secondary', 'secondary-city': 'secondary-country',
    };
    const target = previous[sub];
    if (target) setSub(target);
    else ctx.back?.();
  };
  const backButton = (sub !== 'primary-country' || ctx.back) ? (
    <Button label={copy.back} variant="secondary" disabled={busy} onPress={goBack} />
  ) : null;

  // A full-flex picker, not `Centered` (which shrinks children and would
  // collapse the list) — the same wrapper (public)/country.tsx uses.
  const pickerScreen = (title: string, selected: string, onSelect: (country: string) => void) => (
    <SafeAreaView edges={['bottom']} style={{ flex: 1, backgroundColor: theme.background }}>
      <View style={{ flex: 1, padding: Spacing.four, gap: Spacing.three }}>
        <ThemedText type="title" style={{ fontSize: 30, lineHeight: 36 }}>{title}</ThemedText>
        <CountryPicker selected={selected} onSelect={onSelect} />
        {backButton}
      </View>
    </SafeAreaView>
  );

  if (sub === 'primary-country') {
    return pickerScreen(copy.primaryCountryTitle, primary.country, (country) => {
      // A different country invalidates the city picked under the old one.
      setPrimary((c) => ({ country, city: c.country === country ? c.city : '' }));
      setSub('primary-city');
    });
  }

  if (sub === 'primary-city') {
    if (gwcCities === null) return <Loading />;
    const options = citiesFor(primary.country);
    return (
      <FormScreen title={copy.primaryCityTitle} subtitle={countryName(primary.country, locale)}>
        {options.length > 0 ? (
          <View style={styles.chips} accessibilityRole="radiogroup">
            {options.map((c) => (
              <Chip
                key={c.city}
                label={c.city}
                selected={primary.city === c.city}
                onPress={() => { setPrimary((p) => ({ ...p, city: c.city })); setSub('ask-secondary'); }}
              />
            ))}
          </View>
        ) : (
          <>
            <TextField label={copy.cityPlaceholder} value={primary.city} onChangeText={(city) => setPrimary((c) => ({ ...c, city }))} autoFocus />
            <Button label={copy.continue} disabled={!primary.city.trim()} onPress={() => setSub('ask-secondary')} />
          </>
        )}
        {backButton}
      </FormScreen>
    );
  }

  if (sub === 'ask-secondary') {
    return (
      <FormScreen title={copy.addSecondaryTitle}>
        {secondary.map((c, i) => (
          <ThemedText key={i} themeColor="textSecondary">{`${c.city} (${c.country})`}</ThemedText>
        ))}
        {secondary.length > 0 && (
          <Button label={copy.change} variant="secondary" onPress={() => setSecondary([])} />
        )}
        {secondary.length < 2 && (
          <Button label={copy.addSecondaryYes} variant="secondary" onPress={() => { setDraftCountry(''); setDraftCity(''); setSub('secondary-country'); }} />
        )}
        <Button
          label={busy ? copy.submitting : copy.addSecondaryNo}
          loading={busy}
          onPress={() => ctx.save({ primaryCity: primary, secondaryCities: secondary })}
        />
        {backButton}
      </FormScreen>
    );
  }

  if (sub === 'secondary-country') {
    return pickerScreen(copy.secondaryCountryTitle, draftCountry, (country) => {
      setDraftCountry(country);
      setSub('secondary-city');
    });
  }

  const addSecondary = (city: string) => {
    setSecondary((current) => [...current, { country: draftCountry, city }]);
    setSub('ask-secondary');
  };
  if (gwcCities === null) return <Loading />;
  const secondaryOptions = citiesFor(draftCountry);
  return (
    <FormScreen title={copy.secondaryCityTitle} subtitle={countryName(draftCountry, locale)}>
      {secondaryOptions.length > 0 ? (
        <View style={styles.chips} accessibilityRole="radiogroup">
          {secondaryOptions.map((c) => (
            <Chip key={c.city} label={c.city} selected={draftCity === c.city} onPress={() => addSecondary(c.city)} />
          ))}
        </View>
      ) : (
        <>
          <TextField label={copy.cityPlaceholder} value={draftCity} onChangeText={setDraftCity} autoFocus />
          <Button label={copy.continue} disabled={!draftCity.trim()} onPress={() => addSecondary(draftCity)} />
        </>
      )}
      {backButton}
    </FormScreen>
  );
}
