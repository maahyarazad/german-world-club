import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, View } from 'react-native';

import { MAX_GUESTS, MOBILE_PAYMENT_METHODS, type EventDetail, type MobilePaymentMethod } from '@gwc/contracts/events';

import { eventsApi } from '@/api/endpoints';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, Centered, Chip, FormScreen, Loading, Message, Stepper, styles } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useTranslations } from '@/i18n';

/**
 * One event: what, when, where, the price that applies now, and registration
 * (§4's mobile "attend / attend with guests / cancel" flow).
 *
 * The app shows the current per-person price but never computes the total a
 * member will be charged — that is the server's answer to the registration,
 * computed at that moment (§12.3, §12.15). A client-side total would be a
 * second pricing engine that could disagree with the real one.
 */
export default function EventScreen() {
  const theme = useTheme();
  const { t, format, formatDate, formatMoney, problemMessage } = useTranslations();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [guests, setGuests] = useState(0);
  const [kidsFree, setKidsFree] = useState(0);
  const [kidsCharged, setKidsCharged] = useState(0);
  const [payment, setPayment] = useState<MobilePaymentMethod>('door');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setEvent(await eventsApi.detail(id));
    } catch (e) {
      setLoadError(e);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  if (loadError && !event) return <Centered><Message text={problemMessage(loadError)} /></Centered>;
  if (!event) return <Loading />;

  const open = event.phase === 'early' || event.phase === 'standard' || event.phase === 'late';
  const kidsMax = event.maxKids ?? 20;
  const money = (cents: number | null) => (cents === null || cents === 0 ? t.events.free : formatMoney(cents, event.currency));

  const register = async () => {
    setBusy(true);
    setError(null);
    try {
      await eventsApi.register(event.id, { guestCount: guests, kidsFree, kidsCharged, paymentMethod: payment });
      await load();
    } catch (e) {
      setError(problemMessage(e));
      // Seats or phase may have moved while the screen was open.
      await load();
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => Alert.alert(t.events.cancelConfirm, undefined, [
    { text: t.common.cancel, style: 'cancel' },
    {
      text: t.events.cancelRegistration,
      style: 'destructive',
      onPress: async () => {
        setError(null);
        try {
          await eventsApi.cancel(event.id);
          await load();
        } catch (e) {
          setError(problemMessage(e));
        }
      },
    },
  ]);

  const mine = event.myRegistration;

  return (
    <FormScreen title={event.title}>
      <Stack.Screen options={{ title: '' }} />
      <View style={{ gap: Spacing.one }}>
        <ThemedText type="smallBold">{t.events.when}</ThemedText>
        <ThemedText>{formatDate(event.startsAt, true)}{event.endsAt ? ` – ${formatDate(event.endsAt, true)}` : ''}</ThemedText>
      </View>
      {event.venue || event.city ? (
        <View style={{ gap: Spacing.one }}>
          <ThemedText type="smallBold">{t.events.where}</ThemedText>
          <ThemedText>{[event.venue, event.city].filter(Boolean).join(', ')}</ThemedText>
        </View>
      ) : null}
      {event.description ? <ThemedText>{event.description}</ThemedText> : null}

      <Card>
        <ThemedText type="smallBold">{t.events.phase[event.phase]}</ThemedText>
        {open ? (
          <>
            <ThemedText>{format(t.events.pricePerPerson, { price: money(event.currentPriceCents) })}</ThemedText>
            <ThemedText type="small" style={{ color: event.seatsLeft === 0 ? theme.danger : theme.textSecondary }}>
              {event.seatsLeft === 0 ? t.events.soldOut : format(t.events.seatsLeft, { count: event.seatsLeft })}
            </ThemedText>
          </>
        ) : null}
      </Card>

      <Message text={error} />

      {mine ? (
        <Card>
          <ThemedText type="smallBold">{t.events.yourRegistration}</ThemedText>
          <ThemedText>{t.events.guests}: {mine.guestCount} · {t.events.kidsFree}: {mine.kidsFree} · {t.events.kidsCharged}: {mine.kidsCharged}</ThemedText>
          <ThemedText>{t.events.amount}: {money(mine.amountCents)} · {mine.paid ? t.events.paid : t.events.unpaid}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {t.events.payment}: {t.events.paymentMethods[mine.paymentMethod as MobilePaymentMethod] ?? mine.paymentMethod}
          </ThemedText>
          {mine.paid ? null : <Button label={t.events.cancelRegistration} variant="danger" onPress={cancel} />}
        </Card>
      ) : open && event.seatsLeft > 0 ? (
        <View style={{ gap: Spacing.three }}>
          <Stepper label={t.events.guests} value={guests} onChange={setGuests} max={MAX_GUESTS} />
          <Stepper label={t.events.kidsFree} value={kidsFree} onChange={setKidsFree} max={Math.max(0, kidsMax - kidsCharged)} />
          <Stepper label={t.events.kidsCharged} value={kidsCharged} onChange={setKidsCharged} max={Math.max(0, kidsMax - kidsFree)} />
          <View style={{ gap: Spacing.two }}>
            <ThemedText type="smallBold">{t.events.payment}</ThemedText>
            <View style={styles.chips} accessibilityRole="radiogroup">
              {MOBILE_PAYMENT_METHODS.map((m) => (
                <Chip key={m} label={t.events.paymentMethods[m]} selected={payment === m} onPress={() => setPayment(m)} />
              ))}
            </View>
          </View>
          <ThemedText type="small" themeColor="textSecondary">{t.events.priceNote}</ThemedText>
          <Button label={t.events.register} onPress={register} loading={busy} />
        </View>
      ) : null}
    </FormScreen>
  );
}
