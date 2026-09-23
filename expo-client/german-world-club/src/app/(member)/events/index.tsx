import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';

import type { EventSummary } from '@gwc/contracts/events';

import { eventsApi } from '@/api/endpoints';
import { ThemedText } from '@/components/themed-text';
import { Card, Chip, Loading, Message, styles } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { usePaged } from '@/hooks/use-paged';
import { useTheme } from '@/hooks/use-theme';
import { useTranslations } from '@/i18n';

/** Club events (§4), soonest first; past ones on the other tab. */
export default function Events() {
  const theme = useTheme();
  const { t, problemMessage } = useTranslations();
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
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <View style={[styles.row, { padding: Spacing.three }]} accessibilityRole="radiogroup">
        <Chip label={t.events.upcoming} selected={when === 'upcoming'} onPress={() => setWhen('upcoming')} />
        <Chip label={t.events.past} selected={when === 'past'} onPress={() => setWhen('past')} />
      </View>
      {events.loading ? <Loading /> : (
        <FlatList
          data={events.items}
          keyExtractor={(e) => e.id}
          contentContainerStyle={{ padding: Spacing.three, gap: Spacing.three }}
          renderItem={({ item }) => <EventCard event={item} />}
          onEndReached={events.loadMore}
          refreshControl={<RefreshControl refreshing={events.refreshing} onRefresh={() => events.reload(true)} />}
          ListHeaderComponent={events.error ? <Message text={problemMessage(events.error)} /> : null}
          ListEmptyComponent={<ThemedText themeColor="textSecondary" style={{ textAlign: 'center' }}>{t.common.empty}</ThemedText>}
        />
      )}
    </View>
  );
}

function EventCard({ event }: { event: EventSummary }) {
  const theme = useTheme();
  const { t, format, formatDate, formatMoney } = useTranslations();
  const open = event.phase === 'early' || event.phase === 'standard' || event.phase === 'late';
  const price = event.currentPriceCents === null
    ? null
    : event.currentPriceCents === 0 ? t.events.free : formatMoney(event.currentPriceCents, event.currency);

  return (
    <Card onPress={() => router.push({ pathname: '/events/[id]', params: { id: event.id } })}>
      <ThemedText type="small" style={{ color: theme.tint, fontWeight: '600' }}>{formatDate(event.startsAt, true)}</ThemedText>
      <ThemedText type="subtitle" style={{ fontSize: 20, lineHeight: 26 }}>{event.title}</ThemedText>
      {event.venue || event.city ? (
        <ThemedText themeColor="textSecondary">{[event.venue, event.city].filter(Boolean).join(' · ')}</ThemedText>
      ) : null}
      <View style={[styles.row, { flexWrap: 'wrap' }]}>
        {event.registered ? (
          <ThemedText type="smallBold" style={{ color: theme.success }}>✓ {t.events.registered}</ThemedText>
        ) : null}
        <ThemedText type="small" themeColor="textSecondary">{t.events.phase[event.phase]}</ThemedText>
        {open && price ? <ThemedText type="small">{format(t.events.pricePerPerson, { price })}</ThemedText> : null}
        {open ? (
          <ThemedText type="small" style={{ color: event.seatsLeft === 0 ? theme.danger : theme.textSecondary }}>
            {event.seatsLeft === 0 ? t.events.soldOut : format(t.events.seatsLeft, { count: event.seatsLeft })}
          </ThemedText>
        ) : null}
      </View>
    </Card>
  );
}
