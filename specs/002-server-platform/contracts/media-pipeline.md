# Contract: Media Ingest and Delivery

**Feature**: `002-server-platform` | **Story**: US3 (P3) | **Governs**: Constitution Principle VI

Principle VI states that nothing leaves the server in a shape or size the server did not choose. This contract is the media half of that: the server keeps the original, derives what it will actually deliver, and records the dimensions of every piece so no page shifts while an image loads.

`BUSINESS_DESCRIPTION.md` §10.9 already required images to be "served in appropriate sizes and formats with explicit dimensions, since unsized images are the most common cause of layout shift." Partner logos, article headers, and event galleries are the dominant weight on exactly the pages whose visibility the club sells.

---

## 1. `POST /media`

**Posture**: member-authenticated or staff-permission-gated, depending on the target surface. **Buckets**: `upload` (30 / hour per account, fail-closed) plus the per-account stored-byte quota (FR-063). **Budget**: `media-upload`, 8 s.

```
Request:  multipart/form-data
          file   — the upload
          alt    — string(1..300), REQUIRED (§10.1 galleries need alt text)
          kind   — "image" | "video"
```

| Status | Body | When |
|---|---|---|
| 201 | `{ id, kind, mime, width, height, alt, state: "ready", variants: [...] }` | Image: validated, stripped, probed, all derivatives written in-budget |
| 202 | `{ id, kind, mime, width, height, alt, state: "processing" }` | Video: original stored and probed; derivatives queued |
| 400 | problem+json `unsupported-media-type` | Content inspection found a type not on the allowlist |
| 400 | problem+json `media-dimensions-exceeded` | Decoded pixel count or dimensions past the configured bound |
| 409 | problem+json `media-quota-exceeded` | Per-account stored-byte quota reached |
| 413 | problem+json `media-too-large` | Upload past the 25 MB cap |
| 503 | problem+json `media-processing-unavailable` | Derivative breaker open — **no asset is recorded `ready`** |

`variants` entries are `{ variant, format, width, height, bytes, url }`.

## 2. `GET /media/:checksum/:variant.:ext`

**Posture**: public for assets attached to public records; member-authenticated otherwise. Served with:

```
Cache-Control: public, max-age=31536000, immutable
Content-Disposition: inline; filename="..."
X-Content-Type-Options: nosniff
```

Immutability is safe because the path is content-addressed: different bytes produce a different `checksum`, so a URL's content can never change (FR-062). `nosniff` plus an explicit `Content-Type` is what stops a polyglot file from being interpreted as something executable in the club's origin.

## 3. `GET /media/:id` · `DELETE /media/:id`

`GET` returns the asset record and its variants, including `state` and `failure_reason`, so a client can poll a `processing` video. `DELETE` is gated by ownership or the module flag, removes the record, and removes stored bytes **only when no other asset shares the checksum**.

---

## 4. Validation, in order

Each step runs before the next, so a malicious file is refused as early and as cheaply as possible.

| # | Check | Refusal |
|---|---|---|
| 1 | Byte cap (25 MB) enforced during streaming, never buffered whole | 413 |
| 2 | **Magic-byte inspection** via `file-type`; the filename and client-declared type are ignored entirely (FR-052) | 400 |
| 3 | Type is on the allowlist — `image/jpeg`, `image/png`, `image/webp`, `image/avif`, `video/mp4`, `video/webm`, `video/quicktime` | 400 |
| 4 | Declared dimensions read from the header and checked against the bound **before** decoding; `sharp`'s `limitInputPixels` enforces it again at decode (FR-053) | 400 |
| 5 | Per-account stored-byte quota (FR-063) | 409 |
| 6 | Metadata stripped — EXIF, XMP, ICC, and in particular GPS (FR-054) | — |

**SVG is refused outright.** An SVG is a document that can carry script and external references; storing one and serving it from the club's origin is a stored-XSS primitive. Partner logos requiring vector fidelity are handled as a deliberate, staff-only exception with sanitisation, specified when that need is real rather than pre-built now.

**Step 4 is the one that is easy to skip and expensive to miss.** A 10 KB PNG can declare 100,000 × 100,000 pixels and decode to tens of gigabytes. Checking the header bound before decode is what makes an upload endpoint safe to expose.

---

## 5. Derivatives

| Variant | Width cap | Formats | Applies to |
|---|---|---|---|
| `thumb` | 160 px | WebP + fallback | image |
| `small` | 400 px | WebP + fallback | image |
| `medium` | 800 px | WebP + fallback | image |
| `large` | 1600 px | WebP + fallback | image |
| `poster` | 1600 px | WebP | video |
| `video` | 1280 px | WebM (VP9 / Opus) | video |

Rules:

- **Aspect ratio preserved; never upscaled** (FR-056). A 300 px source yields `thumb` and `small` only — generating a 1600 px derivative from a 300 px original adds bytes and no information.
- **WebP is the primary delivery format.** The fallback is **PNG when the source has an alpha channel** and **JPEG when it does not**. PNG for photographic content is typically 5–10× larger than either, so using it as the default would defeat the purpose of the pipeline.
- Every derivative records its own `format`, `width`, `height`, `bytes` (FR-061).

### Synchronous versus asynchronous

| Kind | When | Why |
|---|---|---|
| **Image** | **Synchronous**, inside the 8 s `media-upload` budget | A 2 MB photograph through `sharp` is roughly 200–600 ms for the full variant set. It fits, so the upload response already carries every URL |
| **Video** | **Asynchronous**, via a `pg-boss` queue | A WebM transcode takes minutes and is CPU-bound. It cannot fit any request budget in [resilience.md §1](./resilience.md), and holding the request open would violate FR-032 |

This is the one place the stated intent — derivatives produced "on the server while they are getting uploaded" — is only achievable for part of the input. It holds for images, which are the case that matters for §10.9 and for every public page. For video the asset reports `processing` and the client renders the poster, or a placeholder, until `ready`.

**Dimensions are probed synchronously in both cases** (FR-055), because §10.9's layout-shift requirement needs width and height at first render and cannot wait for a transcode.

`pg-boss` is a work queue (event-triggered); `croner` in US5 is a scheduler (time-triggered). Different mechanisms for different jobs, not duplication.

---

## 6. Resilience

Derivative generation is an isolated dependency under [resilience.md §2](./resilience.md):

| | Value |
|---|---|
| Timeout | 6 s image · 300 s video job |
| Threshold | 50% over 10 requests |
| Reset | 30 s |
| Unavailable behaviour | **Fail closed** — 503, no asset recorded `ready` (FR-059, FR-063) |
| Retry safe? | Yes — content-addressed, so a repeat produces identical bytes at an identical key |

`ffmpeg` runs as a **subprocess spawned directly** through `node:child_process`, hard-killed on timeout. `fluent-ffmpeg` is deliberately not used: its latest release (2.1.3) is effectively unmaintained, and a direct spawn gives the explicit kill control the budget rule requires. A subprocess also keeps a CPU-bound transcode off the event loop, so `@fastify/under-pressure` does not shed unrelated traffic while one runs.

---

## 7. Consumption

**`buildPageMeta`** ([seo-delivery.md §1](./seo-delivery.md)) selects the `large` WebP variant for `og:image`, since preview bots expect roughly 1200 × 630, and emits its recorded `width`, `height`, and `alt` — which is what makes FR-018 satisfiable from real data rather than seed rows.

**Public templates** emit a `<picture>` with a `srcset` across the breakpoints and explicit `width`/`height` attributes, so the browser picks the smallest sufficient variant and reserves the box before bytes arrive.

**Mobile and the member portal** request variants by name. Neither is given the original's URL — FR-060 makes the original a storage artefact, not a delivery path.

---

## 8. Test contract

| Suite | Asserts | Criterion |
|---|---|---|
| `validation.test.js` | A `.png`-named JPEG is typed from its bytes; a mismatched extension is refused | SC-021, FR-052 |
| `bomb.test.js` | A small file declaring an extreme pixel count is refused **before** decode | FR-053 |
| `metadata-strip.test.js` | A GPS-bearing photograph yields an original and derivatives with zero location metadata | SC-020, FR-054 |
| `derivatives.test.js` | Every breakpoint exists with recorded dimensions and bytes; a 300 px source yields no upscaled variant | FR-056, FR-061 |
| `formats.test.js` | WebP primary; PNG fallback only for alpha sources, JPEG otherwise | FR-057 |
| `compression.test.js` | A 2 MB photograph yields `medium` ≤ 60 KB and `thumb` ≤ 8 KB | SC-019 |
| `video-async.test.js` | Upload returns 202 `processing`; derivatives and poster appear; a failed job sets `failed` with a reason, never a stuck `processing` | FR-058, FR-059 |
| `no-original-served.test.js` | No public page or API response references an original's URL | SC-018, FR-060 |
| `immutability.test.js` | A variant URL is byte-identical across fetches and carries `immutable` plus `nosniff` | FR-062 |
| `breaker.test.js` | With the generator failing, uploads 503 and **zero** assets are recorded `ready` | FR-063 |
| `quota.test.js` | Per-account stored-byte quota and the `upload` bucket both refuse | FR-063 |
| `dedupe.test.js` | Two identical uploads store one copy; deleting one leaves the other's bytes intact | §4.1 |
