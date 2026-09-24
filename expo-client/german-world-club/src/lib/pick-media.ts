import * as ImagePicker from 'expo-image-picker';

import { mediaApi } from '@/api/endpoints';

export type Picked = { uri: string; name: string; type: string; kind: 'image' | 'video' };

/**
 * Pick photos (and, when asked, videos) from the library. Returns [] when the
 * member cancels or refuses access — `denied` says which, so the screen can
 * explain rather than silently do nothing.
 */
export async function pickMedia({ limit, videos = true }: { limit: number; videos?: boolean }) {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return { denied: true, items: [] as Picked[] };
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: videos ? ['images', 'videos'] : ['images'],
    allowsMultipleSelection: limit > 1,
    selectionLimit: limit,
    quality: 0.9,
    // Location and device metadata are stripped by the server at ingest
    // (Principle VI) whatever arrives; asking for none is just less to send.
    exif: false,
  });
  if (result.canceled) return { denied: false, items: [] as Picked[] };
  return {
    denied: false,
    items: result.assets.map((a, i): Picked => {
      const kind = a.type === 'video' ? 'video' : 'image';
      const type = a.mimeType ?? (kind === 'video' ? 'video/mp4' : 'image/jpeg');
      return { uri: a.uri, name: a.fileName ?? `upload-${Date.now()}-${i}.${type.split('/')[1] ?? 'jpg'}`, type, kind };
    }),
  };
}

/**
 * Upload one item and wait until the server has derived it. A video comes
 * back `processing`; posting it before it is `ready` would be refused, so this
 * waits, bounded, rather than failing the post.
 */
export async function uploadReady(item: Picked, alt: string, route = '/media') {
  let asset = await mediaApi.upload(item, alt, route);
  for (let waited = 0; asset.state === 'processing' && waited < 120_000; waited += 2_000) {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    asset = await mediaApi.get(asset.id);
  }
  if (asset.state !== 'ready') throw new Error(`asset ${asset.id} is ${asset.state}`);
  return asset.id;
}
