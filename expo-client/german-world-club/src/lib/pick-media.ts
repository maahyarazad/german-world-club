import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';

import { isAcceptedMediaType, sniffImageType } from '@gwc/contracts/media';

export type Picked = {
  uri: string; name: string; type: string; kind: 'image' | 'video'
  /** Bytes, when the library reports them (feature 035: checked against a merchant's limits before sending). */
  size?: number
  width?: number
  height?: number
};

/** What a file is called when the library reported no type: by its extension. */
const TYPE_BY_EXTENSION: Readonly<Record<string, string>> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', avif: 'image/avif',
  heic: 'image/heic', heif: 'image/heif', tif: 'image/tiff', tiff: 'image/tiff', gif: 'image/gif', bmp: 'image/bmp',
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
};

/** The extension a file of an accepted type is given when its own does not match. */
const EXTENSION_BY_TYPE: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
};

const extensionOf = (name: string | null | undefined) =>
  (/\.([A-Za-z0-9]+)(?:[?#].*)?$/.exec(name ?? '')?.[1] ?? '').toLowerCase();

type PickerAsset = { uri: string; type?: string | null; mimeType?: string | null; fileName?: string | null };

/**
 * The type a picked file has, as far as the phone can tell.
 *
 * The library's own `mimeType` first; failing that the extension; failing both a
 * guess by kind, which is what this code always did and leaves the final word to
 * the server, which decides from the file's bytes. It is a judgement made
 * BEFORE uploading so that a file the club will refuse is named to the member
 * at once and never sent.
 */
export function typeOfPicked(asset: PickerAsset): string {
  const reported = asset.mimeType?.toLowerCase();
  if (reported && reported !== 'application/octet-stream') return reported;
  const byExtension = TYPE_BY_EXTENSION[extensionOf(asset.fileName) || extensionOf(asset.uri)];
  return byExtension ?? (asset.type === 'video' ? 'video/mp4' : 'image/jpeg');
}

/** A name whose extension agrees with the type, so a log line about "a .HEIC that is a JPEG" cannot happen. */
function nameFor(type: string, fileName: string | null | undefined, index: number): string {
  const wanted = EXTENSION_BY_TYPE[type];
  if (!fileName) return `upload-${Date.now()}-${index}.${wanted ?? 'bin'}`;
  if (!wanted || TYPE_BY_EXTENSION[extensionOf(fileName)] === type) return fileName;
  return `${fileName.replace(/\.[A-Za-z0-9]+$/, '')}.${wanted}`;
}

/** The first bytes of a file, or null when they cannot be read. A slice, never the whole file. */
async function headOf(uri: string, length = 32): Promise<Uint8Array | null> {
  try {
    const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64, position: 0, length });
    return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  } catch (e) {
    console.error('pickMedia.headOf', e);
    return null;
  }
}

/**
 * A file labelled HEIC or HEIF is checked against its own bytes before it is
 * refused.
 *
 * The picker names what it hands over from the representation it was asked for,
 * and the label can be wrong in the way that matters most: a photo the system has
 * ALREADY converted to JPEG can still carry a `.heic` name. Refusing it on the
 * label would block a perfectly good photo, so the signature decides — the same
 * rule the server follows (Principle VI), applied before upload so the member
 * hears about a real HEIC at once. Only the doubtful labels are checked; reading
 * 32 bytes of a file is cheap, and a file whose bytes cannot be read keeps its
 * label, which is the cautious answer.
 */
async function settleType(picked: Picked): Promise<Picked> {
  if (picked.type !== 'image/heic' && picked.type !== 'image/heif') return picked;
  const head = await headOf(picked.uri);
  const real = head ? sniffImageType(head) : null;
  if (!real || real === 'image/heic' || real === 'image/heif') return picked;
  return { ...picked, type: real, name: nameFor(real, picked.name, 0) };
}

/**
 * Pick photos (and, when asked, videos) from the library. Returns [] when the
 * member cancels or refuses access — `denied` says which, so the screen can
 * explain rather than silently do nothing.
 *
 * `items` holds only what the club accepts (the list in `@gwc/contracts/media`,
 * the one the server validates against); anything else comes back in
 * `unsupported`, so a screen can name it instead of dropping it silently.
 */
export async function pickMedia({ limit, videos = true, aspect, quality = 0.9 }: {
  limit: number
  videos?: boolean
  /** Crop to this ratio in the picker's own editor, e.g. [16, 9] for a store cover (single image only). */
  aspect?: [number, number]
  /** Lower for merchants, whose photos must stay under 1 MB. */
  quality?: number
}) {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return { denied: true, items: [] as Picked[], unsupported: [] as Picked[] };
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: videos ? ['images', 'videos'] : ['images'],
    allowsMultipleSelection: limit > 1 && !aspect,
    selectionLimit: limit,
    ...(aspect ? { allowsEditing: true, aspect } : {}),
    quality,
    // iPhones save photos as HEIC, which the server cannot decode (its image
    // library has no HEVC decoder). On iOS the picker's native default is
    // `current`, "do not transcode", and for a HEIC it then returns the raw bytes
    // whatever `quality` says — so every iPhone photo arrived as a .heic and was
    // refused. `compatible` makes the system convert it to JPEG on the phone,
    // with Apple's own licensed codec, before the app ever sees it. The same
    // setting turns an HEVC video into H.264. The type docs say the default is
    // `automatic`; the native module's is `current` (specs/037, research R12).
    // iOS only: other platforms ignore it.
    preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
    // Location and device metadata are stripped by the server at ingest
    // (Principle VI) whatever arrives; asking for none is just less to send.
    exif: false,
  });
  if (result.canceled) return { denied: false, items: [] as Picked[], unsupported: [] as Picked[] };

  const picked = await Promise.all(result.assets.map((a, i) => {
    const kind = a.type === 'video' ? 'video' : 'image';
    const type = typeOfPicked(a);
    return settleType({
      uri: a.uri, name: nameFor(type, a.fileName, i), type, kind,
      size: a.fileSize, width: a.width, height: a.height,
    });
  }));
  return {
    denied: false,
    items: picked.filter((p) => isAcceptedMediaType(p.type)),
    // Still HEIC after asking for the compatible form (an Android phone that
    // stored one, a file picked from storage), or some other kind we do not take.
    unsupported: picked.filter((p) => !isAcceptedMediaType(p.type)),
  };
}
