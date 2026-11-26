import { useCallback, useEffect, useRef, useState } from 'react';

import { PROBLEMS } from '@gwc/contracts/errors';
import { isAcceptedMediaType, type Asset } from '@gwc/contracts/media';

import { api, ApiError, uploadWithProgress } from '@/api/client';
import type { UploadProgress } from '@/api/client';
import type { Picked } from '@/lib/pick-media';

/**
 * Sending one picked file and waiting for the server to finish with it (feature
 * 035, research R10): the bytes going up, then "processing" while the server
 * inspects the file and makes the thumbnails, or the note that it failed.
 *
 * An image is ready as the upload returns; a video is accepted at once and
 * transcoded afterwards, so this polls the organisation's own status route
 * until it is `ready` or `failed`. The poll is bounded and stops with the
 * screen. Nothing is saved until the caller links the returned asset, so a
 * failure or a cancel leaves the previous content exactly as it was.
 *
 * Members upload here too (`'member'`, feature 037): their listing photos, avatar
 * and Threads media used to go through plain `fetch`, which reports no progress.
 * Several files in a row pass `slot: [index, total]`, and the percentage then
 * covers the whole batch — file 2 of 4 at half way reads 38 %, not 50 % — with the
 * slot kept in the state so the screen can say "File 2 of 4".
 */
export type Slot = readonly [index: number, total: number];
/**
 * `reason: 'unsupported-format'` is a failure that retrying cannot fix — the file
 * is of a kind the club does not accept — so the screen says so and offers no
 * Retry. Every other failure leaves `reason` off and keeps its Retry.
 */
export type FailureReason = 'unsupported-format';
export type MediaUploadState =
  | { phase: 'idle' }
  | (UploadProgress & { slot?: Slot })
  | { phase: 'failed'; reason?: FailureReason };

const POLL_MS = 1500;
const POLL_LIMIT = 80;

/** Which routes a kind of account uploads to and polls: a member's are the bare `/media`. */
const routeFor = (kind: 'member' | 'merchant' | 'partner') => (kind === 'member' ? '/media' : `/media/${kind}`);

export function useMediaUpload(kind: 'member' | 'merchant' | 'partner') {
  const [state, setState] = useState<MediaUploadState>({ phase: 'idle' });
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  /** Resolves to the ready asset, or null when it failed or was cancelled. */
  const start = useCallback(async (item: Picked, alt: string, { slot }: { slot?: Slot } = {}): Promise<Asset | null> => {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    // A file of a kind the club will not take is refused here, before a byte is
    // sent: the same list the server validates against, so this cannot disagree
    // with it. `pickMedia` already filters, so this is the net under it.
    if (!isAcceptedMediaType(item.type)) {
      setState({ phase: 'failed', reason: 'unsupported-format' });
      return null;
    }
    // The share of the whole batch, not of this file: file 2 of 4 at half way is 38 %.
    const overall = (fraction: number | null) => (fraction === null || !slot ? fraction : (slot[0] + fraction) / slot[1]);
    const withSlot = (progress: UploadProgress): MediaUploadState =>
      progress.phase === 'uploading'
        ? { phase: 'uploading', fraction: overall(progress.fraction), ...(slot ? { slot } : {}) }
        : { phase: 'processing', ...(slot ? { slot } : {}) };
    setState(withSlot({ phase: 'uploading', fraction: 0 }));
    try {
      const form = new FormData();
      // `alt` before `file`: the server reads the fields that precede the file part.
      form.append('alt', alt);
      // React Native's FormData takes a { uri, name, type } descriptor for a file.
      form.append('file', { uri: item.uri, name: item.name, type: item.type } as unknown as Blob);
      let asset = await uploadWithProgress<Asset>(routeFor(kind), form, { onProgress: (p) => setState(withSlot(p)), signal: abort.signal });

      for (let i = 0; asset.state === 'processing' && i < POLL_LIMIT && !abort.signal.aborted; i += 1) {
        setState(withSlot({ phase: 'processing' }));
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        if (abort.signal.aborted) break;
        asset = await api<Asset>(`${routeFor(kind)}/${asset.id}`);
      }
      if (abort.signal.aborted) { setState({ phase: 'idle' }); return null; }
      if (asset.state !== 'ready') { setState({ phase: 'failed' }); return null; }
      setState({ phase: 'idle' });
      return asset;
    } catch (error) {
      if (abort.signal.aborted) { setState({ phase: 'idle' }); return null; }
      console.error('useMediaUpload.start', error instanceof ApiError ? error.problem : error);
      // The server decides from the file's bytes, so it can still refuse a file
      // that looked fine here (a HEIC with a .jpg name). Say that, not "failed".
      const unsupported = error instanceof ApiError && error.type === PROBLEMS.UNSUPPORTED_MEDIA_TYPE.type;
      setState(unsupported ? { phase: 'failed', reason: 'unsupported-format' } : { phase: 'failed' });
      return null;
    }
  }, [kind]);

  const cancel = useCallback(() => controller.current?.abort(), []);
  return { state, start, cancel };
}
