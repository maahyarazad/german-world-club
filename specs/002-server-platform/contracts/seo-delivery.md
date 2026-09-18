# Contract: Public Delivery, OG Tags, and SEO

**Feature**: `002-server-platform` | **Source**: `BUSINESS_DESCRIPTION.md` §10 (all subsections), §12.10–§12.14

§10 opens by calling SEO "an application-wide capability, not a marketing add-on", and it is revenue-bearing: partner listings are a paid deliverable whose value *is* visibility (§5, §10.4). This contract is the server-side surface that makes that true and keeps it honest.

---

## 1. `buildPageMeta(record, context)` — the single metadata resolver

One pure function is the only way page metadata is produced (FR-019). Its input is the same content record the page body renders from, so the two cannot drift — which is §10.3's named failure mode: "hand-maintained metadata that duplicates on-page copy drifts and is a recurring defect source."

```
buildPageMeta(record, context) -> PageMeta

context: { surface, origin, locale, now }

PageMeta {
  title            string   <= 60 chars preferred, site name appended exactly once
  description      string   <= 160 chars, truncated at a word boundary
  canonical        string   absolute, on the one canonical origin
  robots           string   'index,follow' | 'noindex,nofollow'
  lang             string   'de' | 'en'
  alternates       [{ hreflang, href }]        reciprocal, includes x-default
  og {
    type           'website' | 'article' | 'event' | 'business.business'
    siteName, title, description, url, locale
    image          { url, width, height, alt }   ← all four REQUIRED
  }
  twitter          { card: 'summary_large_image', title, description, image }
  jsonLd           [ StructuredDataDocument, ... ]
  lastModified     ISO-8601, the record's real updated_at
}
```

Rules the function enforces internally, so no caller can omit them:

| Rule | Requirement |
|---|---|
| Staff override precedence | `seo_metadata.seo_title` / `meta_description` / `share_image_id` / `slug` win over derived values; derived is the fallback, never the reverse (FR-020) |
| Indexability | `robots` is the **stricter** of `record.indexable` and the §10.1 surface posture (FR-025) |
| Absolute URLs | Every URL is absolutized against the single canonical origin; a relative `og:image` breaks every preview bot |
| Image completeness | `width`, `height`, `alt` are required; a missing one is a **test-time failure**, not a silent omission (FR-018) |
| Escaping | Everything interpolated into an attribute is HTML-escaped. A partner business name containing `"` must not break out of `content="…"` |
| Uniqueness | Title and description derive from record-specific fields; the boilerplate-only path is unreachable (§10.3, SC-006) |
| Site-name suffix | Appended once; a record whose title already ends with it is not double-suffixed |

This is the concrete answer to "OG tag handlers": not per-route hand-written tags, but one resolver plus one serializer, with per-route input. Being pure, it is unit-testable with no server and no browser — uniqueness (SC-006) becomes a property test over a record set.

---

## 2. Rendering requirement

**Every public route returns its meaningful content in the initial HTML response** (FR-016, §10.2). Verified by fetching with JavaScript disabled and asserting the content is in the body.

| Surface | Delivery | Indexed |
|---|---|---|
| Landing / coming-soon | Pre-rendered shell (feature 001) served as-is | yes |
| Partner listing, outlet | Server-rendered template | yes |
| Public event page | Server-rendered template | yes |
| Magazine article, news | Server-rendered template | yes |
| Event recap + gallery | Server-rendered template; images carry alt text | yes (text) |
| Committee / about / legal | Server-rendered template | yes |
| Member portal, Threads, messaging, marketplace, checkout, invitation links, admin | Client-rendered bundle | **never** |

§10.2 makes this a genuine constraint rather than a preference: link-preview and most non-Google crawlers execute no JavaScript, so a client-only strategy silently costs the club its share links and the partner visibility it has sold.

**Member-only content is never partially rendered to an unauthenticated visitor** (FR-026, §10.1) — not even a teaser, not for SEO value. Doing so would contradict the invite-only model that defines the club.

---

## 3. Status-code correctness (FR-017)

The current `server.js` answers every unknown non-`/api` path with `index.html` at **HTTP 200**. That is verbatim the defect §10.6 and §12.13 describe. Required behaviour:

| Request | Status | Body |
|---|---|---|
| Known public route, content published | 200 | Rendered page |
| Unknown path | **404** | Rendered, `noindex` error page (HTML) or problem+json (API) |
| Known route, content unpublished | 404, or 410 if deliberately retired | Error page |
| Partner past contract + grace | Per configured policy — default: 200, `noindex`, no sitemap entry (FR-031) | Listing, marked inactive |
| Non-canonical host or scheme | **301** | `Location` on the canonical origin |
| Legacy path in `legacy_redirects` | **301** (or 410) | `Location` on the new path |
| Gated surface, unauthenticated | 401 / 403 + `X-Robots-Tag: noindex` | problem+json |

Mechanics:

- `@fastify/static` registered with **`wildcard: false`** — it serves only files that exist.
- `setNotFoundHandler` returns a real 404. The SPA shell is served only at its own declared routes, **never as a fallback**.
- Canonicalisation runs in an `onRequest` hook, before routing: one host, one scheme, lowercase path, one trailing-slash convention.
- **Regression corpus**: `tests/fixtures/bad-paths.js` holds ≥50 known-bad paths — `/nonsense`, `/wp-login.php`, `/.env`, `/partners/deleted`, `/index.php`, casing and trailing-slash variants — all asserted 404 (SC-004). §10.6 calls this defect "easily-introduced" and asks for it to be "explicitly prevented and regression-tested"; this corpus is that test.

---

## 4. Structured data

JSON-LD, built by the same resolver, from the same record (§10.4):

| Type | Surface | Fields that must track live state |
|---|---|---|
| `Organization` | every public page | — |
| `LocalBusiness` | partner listing, each outlet | emitted only while in contract; address, geo, `openingHours`, discount |
| `Event` | public event page | `eventStatus`, `offers.availability`, `offers.price` — from the real registration window and remaining capacity |
| `Article` | magazine, news | `headline`, `author`, `datePublished`, `dateModified` |
| `BreadcrumbList` | nested content | — |

**Computed per request, never cached** (FR-022, §12.14). §10.4: "publishing an `Event` as available after registration has closed, or a partner as active after their contract lapsed, is both an SEO penalty and a factual misstatement to members."

Tested by validating each document's shape and asserting `availability` against the database's live capacity and window (SC-007).

---

## 5. `GET /sitemap.xml`

Generated from a live query (FR-023, §10.5). Never hand-maintained — the static `client/public/sitemap.xml` is deleted so there is exactly one source.

```
Inclusion predicate:
  published = true
  AND indexable = true
  AND surface posture is indexed        (§10.1)
  AND (record_type <> 'partner' OR contract_start + duration + grace >= now)
```

- `<lastmod>` is the record's real `updated_at`, never the build time.
- `Content-Type: application/xml`; cached 1 hour, invalidated on publish/unpublish.
- A lapsed partner disappears automatically because the query is the source of truth, not a staff action (SC-008).
- Sitemap-index split at 10,000 URLs — recorded as the trigger, not built now.

## `GET /robots.txt`

Generated from `seo/surfaces.js`, the same §10.1 table that drives route postures (FR-024). A new gated surface is therefore disallowed **by construction**, not by remembering to edit a static file.

```
User-agent: *
Disallow: /portal/        Disallow: /threads/      Disallow: /messages/
Disallow: /marketplace/   Disallow: /events/*/register
Disallow: /checkout/      Disallow: /invite/       Disallow: /admin/
Disallow: /auth/          Disallow: /api/
Sitemap: https://<canonical-origin>/sitemap.xml
```

Gated surfaces additionally carry `X-Robots-Tag: noindex, nofollow` on their responses. §10.1 requires **both** access control and a crawl directive, "because URL shapes leak through referrers and shared links" — so the header is not redundant with the 401.

---

## 6. URLs and canonicalisation

| Rule | Requirement | Source |
|---|---|---|
| Slug-based | `/partners/mueller-legal`, never `/partners/4172` | FR-027, §10.6 |
| Stable | Legacy indexed URLs serve or 301 to their equivalent | FR-029, §12.12 |
| One origin | One host, one scheme; all variants 301 | FR-028 |
| One form | Lowercase, one trailing-slash convention; query params that do not change content are stripped from the canonical | §10.6 |

Slug uniqueness is a database constraint — `UNIQUE (record_type, slug)` — because a collision would otherwise surface as a 500 on a paying partner's page.

## 7. Language targeting (§10.7)

German is default; English secondary. Each page emits `<html lang>`, and where a translation group has more than one member, all versions emit **reciprocal** `hreflang` links plus `x-default` pointing at the German version (FR-030). Reciprocity is generated from `translation_group_id` rather than written per page, because a one-directional `hreflang` is ignored and the two translations then compete as duplicates — suppressing both.

Regional relevance (UAE / Germany) comes from `LocalBusiness` address and geo data, not from separate country sites — §10.7 rejects those explicitly.

## 8. Performance (§10.9)

| Surface | `Cache-Control` |
|---|---|
| Public content | `public, max-age=300, stale-while-revalidate=86400` |
| Sitemap / robots | `public, max-age=3600` |
| Static assets (hashed) | `public, max-age=31536000, immutable` |
| **Anything gated** | `private, no-store` |

`no-store` on gated responses is a correctness requirement, not a performance tweak: a member profile cached by a shared proxy and served to a later visitor is a PII breach, and it is exactly what §10.1's gating exists to prevent.

`@fastify/etag` for conditional requests; `@fastify/compress` for text. Images are served with explicit `width`/`height` from the asset record, since §10.9 names unsized images as the most common cause of layout shift.

## 9. Staff-editable SEO fields (§10.8, FR-021)

Exposed under the `seo` module of the five-flag matrix, so editing is a grantable staff privilege rather than a developer task. Editing a record's SEO fields requires the flag on **both** `seo` and the record's own module.

| Field | Effect |
|---|---|
| `slug` | Changes the public URL. Old slug is written to `legacy_redirects` as a 301 automatically — a slug change must not silently discard accumulated equity (§12.12) |
| `seo_title` | Overrides derived title |
| `meta_description` | Overrides derived description |
| `share_image_id` | Overrides derived share image; dimensions and alt come from the asset |
| `indexable` | ANDed with the surface posture; the stricter wins |

Because partner visibility is a paid deliverable, §10.8 requires staff to see and adjust how a partner's page presents in search and in shared links without engineering involvement. The automatic 301 on slug change is the part that is easy to forget and expensive to discover.

## 10. Test contract (§10.10)

§10.10 requires SEO to be "verifiable, not aspirational… checked automatically as part of the delivery pipeline, the same way accessibility and functional behaviour are."

| Suite | Asserts | Criterion |
|---|---|---|
| `build-page-meta.test.js` | Override precedence, escaping, required image dimensions, single site-name suffix, stricter-wins robots | FR-018/020/025 |
| `crawl-posture.test.js` | Every §10.1 surface: status, `X-Robots-Tag`, robots.txt entry | SC-008 |
| `soft-404.test.js` | ≥50 bad paths all 404; the SPA shell is never a fallback | SC-004 |
| `rendering.test.js` | Every public route returns its content with no JS executed | SC-005 |
| `uniqueness.test.js` | Title, description, canonical unique across the generated sitemap | SC-006 |
| `structured-data.test.js` | Each document validates; event availability and partner active status match live state | SC-007 |
| `canonical.test.js` | Non-canonical host/scheme 301s; legacy paths 301 | FR-028/029 |
| `sitemap.test.js` | Lapsed partner absent; `lastmod` is the record's real value | SC-008 |
| `hreflang.test.js` | Alternates reciprocal; `x-default` present | FR-030 |
