import { useCallback, useEffect, useRef, useState } from 'react';

import type { Asset } from '@gwc/contracts/media';

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
 */
export type MediaUploadState = { phase: 'idle' } | UploadProgress | { phase: 'failed' };

const POLL_MS = 1500;
const POLL_LIMIT = 80;

export function useMediaUpload(kind: 'merchant' | 'partner') {
  const [state, setState] = useState<MediaUploadState>({ phase: 'idle' });
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  /** Resolves to the ready asset, or null when it failed or was cancelled. */
  const start = useCallback(async (item: Picked, alt: string): Promise<Asset | null> => {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setState({ phase: 'uploading', fraction: 0 });
    try {
      const form = new FormData();
      // `alt` before `file`: the server reads the fields that precede the file part.
      form.append('alt', alt);
      // React Native's FormData takes a { uri, name, type } descriptor for a file.
      form.append('file', { uri: item.uri, name: item.name, type: item.type } as unknown as Blob);
      let asset = await uploadWithProgress<Asset>(`/media/${kind}`, form, { onProgress: setState, signal: abort.signal });

      for (let i = 0; asset.state === 'processing' && i < POLL_LIMIT && !abort.signal.aborted; i += 1) {
        setState({ phase: 'processing' });
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        if (abort.signal.aborted) break;
        asset = await api<Asset>(`/media/${kind}/${asset.id}`);
      }
      if (abort.signal.aborted) { setState({ phase: 'idle' }); return null; }
      if (asset.state !== 'ready') { setState({ phase: 'failed' }); return null; }
      setState({ phase: 'idle' });
      return asset;
    } catch (error) {
      if (abort.signal.aborted) { setState({ phase: 'idle' }); return null; }
      console.error('useMediaUpload.start', error instanceof ApiError ? error.problem : error);
      setState({ phase: 'failed' });
      return null;
    }
  }, [kind]);

  const cancel = useCallback(() => controller.current?.abort(), []);
  return { state, start, cancel };
}
