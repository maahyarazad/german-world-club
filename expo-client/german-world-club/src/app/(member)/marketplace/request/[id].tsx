import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';

import { PROBLEMS } from '@gwc/contracts/errors';
import { MESSAGE_MAX } from '@gwc/contracts/messaging';
import type { Listing } from '@gwc/contracts/marketplace';

import { ApiError } from '@/api/client';
import { marketplaceApi, messagingApi } from '@/api/endpoints';
import { ThemedText } from '@/components/themed-text';
import { Button, FormScreen, Message, TextField } from '@/components/ui';
import { useTranslations } from '@/i18n';

/**
 * Write a request about a listing (feature 020, US1). On success the screen is
 * replaced by the conversation it started — or continued: a second request
 * about the same listing adds to the same conversation.
 *
 * Two refusals are shown because the member cannot proceed without knowing
 * them: the listing no longer takes requests, and "slow down". Everything else
 * is logged, not stored (CLAUDE.md).
 */
export default function SendRequest() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, format } = useTranslations();
  const [listing, setListing] = useState<Listing | null>(null);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<'closed' | 'slowDown' | 'failed' | null>(null);

  useEffect(() => {
    marketplaceApi.listing(id).then(setListing, (e) => console.error('SendRequest.load', e instanceof ApiError ? e.problem : e));
  }, [id]);

  const send = async () => {
    const text = body.trim();
    if (!text) return;
    setBusy(true);
    setNotice(null);
    try {
      const sent = await messagingApi.inquire(id, text);
      router.replace(`/marketplace/messages/${sent.conversationId}`);
    } catch (e) {
      console.error('SendRequest.send', e instanceof ApiError ? e.problem : e);
      const type = e instanceof ApiError ? e.problem?.type : undefined;
      setNotice(type === PROBLEMS.GONE.type ? 'closed' : type === PROBLEMS.RATE_LIMITED.type ? 'slowDown' : 'failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormScreen title={t.requests.title} subtitle={listing ? format(t.requests.about, { title: listing.title }) : undefined}>
      <TextField
        label={t.requests.placeholder}
        value={body}
        onChangeText={setBody}
        multiline
        maxLength={MESSAGE_MAX}
        style={{ minHeight: 140, textAlignVertical: 'top' }}
      />
      <ThemedText type="small" themeColor="textSecondary">
        {format(t.requests.counter, { n: body.length, max: MESSAGE_MAX })}
      </ThemedText>
      <Message text={notice ? t.requests[notice] : null} />
      <Button label={t.requests.submit} onPress={() => void send()} loading={busy} disabled={!body.trim()} />
    </FormScreen>
  );
}
