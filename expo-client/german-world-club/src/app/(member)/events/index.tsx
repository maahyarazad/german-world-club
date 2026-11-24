import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { FlashList } from '@shopify/flash-list';
import { RefreshControl, View, StyleSheet } from 'react-native';

import type { EventSummary } from '@gwc/contracts/events';

import { eventsApi } from '@/api/endpoints';
import { ThemedText } from '@/components/themed-text';
import { Card, Chip, Loading, styles as uiStyles } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { usePaged } from '@/hooks/use-paged';
import { useTranslations } from '@/i18n';
import { useThemedStyles, type AppTheme } from '@/hooks/use-themed-styles';

/** Club events (§4), soonest first; past ones on the other tab. */
export default function Events() {
  const themed = useThemedStyles(makeStyles);
  const { t } = useTranslations();
  const [when, setWhen] = useState<'upcoming' | 'past'>('upcoming');
  const fetchPage = useCallback((cursor: string | null) => eventsApi.list(when, cursor), [when]);
  const events = usePaged<EventSummary>(fetchPage, [when]);

  // Registering on the detail screen changes seats and the badge here.
  const focusedOnce = useRef(false);
  useFocusEffect(useCallback(() => {
    if (focusedOnce.current) void events.reload(true);
    focusedOnce.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events.reload]));

  return (
    <View style={themed.flex1BgBackground}>
      <View style={[uiStyles.row, styles.paddingThree]} accessibilityRole="radiogroup">
        <Chip label={t.events.upcoming} selected={when === 'upcoming'} onPress={() => setWhen('upcoming')} />
        <Chip label={t.events.past} selected={when === 'past'} onPress={() => setWhen('past')} />
      </View>
      {events.loading ? <Loading /> : (
        <FlashList
          data={events.items}
          keyExtractor={(e) => e.id}
          contentContainerStyle={styles.paddingThree}
          // Padding only in FlashList's content container; the old `gap` is a separator.
          ItemSeparatorComponent={() => <View style={styles.heightThree} />}
          renderItem={({ item }) => <EventCard event={item} />}
          onEndReached={events.loadMore}
          refreshControl={<RefreshControl refreshing={events.refreshing} onRefresh={() => events.reload(true)} />}
          ListEmptyComponent={<ThemedText themeColor="textSecondary" style={styles.textCenter}>{t.common.empty}</ThemedText>}
        />
      )}
    </View>
  );
}

function EventCard({ event }: { event: EventSummary }) {
  const themed = useThemedStyles(makeStyles);
  const { t, format, formatDate, formatMoney } = useTranslations();
  const open = event.phase === 'early' || event.phase === 'standard' || event.phase === 'late';
  const price = event.currentPriceCents === null
    ? null
    : event.currentPriceCents === 0 ? t.events.free : formatMoney(event.currentPriceCents, event.currency);

  return (
    <Card onPress={() => router.push({ pathname: '/events/[id]', params: { id: event.id } })}>
      <ThemedText type="small" style={themed.colorTintWeight600}>{formatDate(event.startsAt, true)}</ThemedText>
      <ThemedText type="subtitle" style={styles.font20Line26}>{event.title}</ThemedText>
      {event.venue || event.city ? (
        <ThemedText themeColor="textSecondary">{[event.venue, event.city].filter(Boolean).join(' · ')}</ThemedText>
      ) : null}
      <View style={[uiStyles.row, styles.flexWrapWrap]}>
        {event.registered ? (
          <ThemedText type="smallBold" style={themed.colorSuccess}>✓ {t.events.registered}</ThemedText>
        ) : null}
        <ThemedText type="small" themeColor="textSecondary">{t.events.phase[event.phase]}</ThemedText>
        {open && price ? <ThemedText type="small">{format(t.events.pricePerPerson, { price })}</ThemedText> : null}
        {open ? (
          <ThemedText type="small" style={event.seatsLeft === 0 ? themed.colorDanger : themed.colorTextSecondary}>
            {event.seatsLeft === 0 ? t.events.soldOut : format(t.events.seatsLeft, { count: event.seatsLeft })}
          </ThemedText>
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  paddingThree: { padding: Spacing.three },
  heightThree: { height: Spacing.three },
  textCenter: { textAlign: 'center' },
  font20Line26: { fontSize: 20, lineHeight: 26 },
  flexWrapWrap: { flexWrap: 'wrap' },
});

const makeStyles = (theme: AppTheme) =>
  StyleSheet.create({
    flex1BgBackground: { flex: 1, backgroundColor: theme.background },
    colorTintWeight600: { color: theme.tint, fontWeight: '600' },
    colorSuccess: { color: theme.success },
    colorDanger: { color: theme.danger },
    colorTextSecondary: { color: theme.textSecondary },
  });
