import * as Clipboard from 'expo-clipboard';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Share, View } from 'react-native';

import { formatReferralCode, REFERRAL_STAGES } from '@gwc/contracts/referrals';
import type { ReferralSummary } from '@gwc/contracts/referrals';

import { ApiError } from '@/api/client';
import { referralsApi } from '@/api/endpoints';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, FormScreen, Loading } from '@/components/ui';
import { usePaged } from '@/hooks/use-paged';
import { useTranslations } from '@/i18n';

/**
 * Refer & earn in the app (feature 018, contracts/ui-contract.md): the body of
 * both the member screen and the organisation screen, told apart only by the
 * mount `prefix` the server serves that principal's own referrals at.
 *
 * XP is a number and the word XP, never with a currency sign (FR-016). A
 * refusal is logged and not shown; what stays in state is only whether loading
 * failed, so the screen can offer a retry instead of spinning forever.
 */
const COPIED_FOR_MS = 2000;
/** The server's page size: a page shorter than this was the last one. */
const PAGE_SIZE = 50;
const mayHaveMore = (count: number) => count > 0 && count % PAGE_SIZE === 0;

export function ReferralsView({ prefix }: { prefix: string }) {
  const { t, locale, format, formatDate } = useTranslations();
  const number = new Intl.NumberFormat(locale === 'de' ? 'de-DE' : 'en-GB');
  const xp = (n: number) => format(t.referrals.xpUnit, { n: number.format(n) });

  const [summary, setSummary] = useState<ReferralSummary | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [copied, setCopied] = useState<'link' | 'code' | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const referrals = usePaged((cursor) => referralsApi.referrals(prefix, cursor), [prefix]);
  const history = usePaged((cursor) => referralsApi.xp(prefix, cursor), [prefix]);

  const load = useCallback(() => {
    setLoadFailed(false);
    referralsApi.summary(prefix).then(setSummary, (e) => {
      console.error('ReferralsView.load', e instanceof ApiError ? e.problem : e);
      setLoadFailed(true);
    });
  }, [prefix]);

  // On focus, not only on mount: a referral that registered while the screen
  // sat in the stack should show when the person comes back to it.
  useFocusEffect(load);

  const copy = async (what: 'link' | 'code', value: string) => {
    await Clipboard.setStringAsync(value);
    setCopied(what);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(null), COPIED_FOR_MS);
  };

  const share = (url: string) => {
    Share.share({ message: format(t.referrals.shareMessage, { url }), url }).catch((e) =>
      console.error('ReferralsView.share', e));
  };

  const replace = () => {
    Alert.alert(t.referrals.replaceTitle, t.referrals.replaceConfirm, [
      { text: t.referrals.cancel, style: 'cancel' },
      {
        text: t.referrals.replaceAction,
        onPress: () => {
          setReplacing(true);
          referralsApi.replace(prefix)
            .then(setSummary, (e) => console.error('ReferralsView.replace', e instanceof ApiError ? e.problem : e))
            .finally(() => setReplacing(false));
        },
      },
    ]);
  };

  if (!summary && !loadFailed) return <Loading />;

  return (
    <FormScreen title={t.referrals.title} subtitle={t.referrals.subtitle}>
      {loadFailed && !summary ? (
        <Card>
          <ThemedText themeColor="textSecondary">{t.referrals.loadFailed}</ThemedText>
          <Button label={t.referrals.retry} onPress={load} variant="secondary" />
        </Card>
      ) : null}

      {summary ? (
        <>
          <Card>
            <ThemedText type="small" themeColor="textSecondary">{t.referrals.yourLink}</ThemedText>
            <ThemedText selectable>{summary.link.url}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">{t.referrals.yourCode}</ThemedText>
            <ThemedText type="subtitle" selectable style={{ letterSpacing: 2 }}>
              {formatReferralCode(summary.link.code)}
            </ThemedText>
            <Button label={t.referrals.share} onPress={() => share(summary.link.url)} />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button
                label={copied === 'link' ? t.referrals.copied : t.referrals.copyLink}
                onPress={() => void copy('link', summary.link.url)}
                variant="secondary"
                style={{ flex: 1 }}
              />
              <Button
                label={copied === 'code' ? t.referrals.copied : t.referrals.copyCode}
                onPress={() => void copy('code', formatReferralCode(summary.link.code))}
                variant="secondary"
                style={{ flex: 1 }}
              />
            </View>
            <Button label={t.referrals.replace} onPress={replace} variant="secondary" loading={replacing} />
          </Card>

          <Card>
            <ThemedText type="small" themeColor="textSecondary">{t.referrals.xpBalance}</ThemedText>
            <ThemedText type="title">{xp(summary.xpBalance)}</ThemedText>
            {REFERRAL_STAGES.map((stage) => (
              <View key={stage} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <ThemedText themeColor="textSecondary">{t.referrals.stages[stage]}</ThemedText>
                <ThemedText>{number.format(summary.counts[stage])}</ThemedText>
              </View>
            ))}
          </Card>
        </>
      ) : null}

      <ThemedText type="subtitle">{t.referrals.yourReferrals}</ThemedText>
      {!referrals.loading && referrals.items.length === 0 ? (
        <ThemedText themeColor="textSecondary">{t.referrals.emptyReferrals}</ThemedText>
      ) : null}
      {referrals.items.map((r) => {
        const at = r.endedAt ?? r.joinedAt ?? r.approvedAt ?? r.registeredAt;
        return (
          <Card key={r.id}>
            <ThemedText>{r.refereeName}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {t.referrals.stages[r.stage]} · {formatDate(at)}
            </ThemedText>
          </Card>
        );
      })}
      {mayHaveMore(referrals.items.length) ? (
        <Button label={t.referrals.loadMore} onPress={() => void referrals.loadMore()} variant="secondary" />
      ) : null}

      <ThemedText type="subtitle">{t.referrals.xpHistory}</ThemedText>
      {!history.loading && history.items.length === 0 ? (
        <ThemedText themeColor="textSecondary">{t.referrals.emptyXp}</ThemedText>
      ) : null}
      {history.items.map((e) => (
        <Card key={e.id}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
            <ThemedText style={{ flex: 1 }}>
              {e.kind === 'award'
                ? format(t.referrals.xpReferral, { name: e.refereeName })
                : format(t.referrals.xpReversed, { reason: e.reason })}
            </ThemedText>
            <ThemedText>{e.amount > 0 ? '+' : '−'}{xp(Math.abs(e.amount))}</ThemedText>
          </View>
          <ThemedText type="small" themeColor="textSecondary">{formatDate(e.createdAt)}</ThemedText>
        </Card>
      ))}
      {mayHaveMore(history.items.length) ? (
        <Button label={t.referrals.loadMore} onPress={() => void history.loadMore()} variant="secondary" />
      ) : null}
    </FormScreen>
  );
}
