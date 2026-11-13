# Research: Signed-in visitors see their avatar on the landing page

## R1. Rendered by the server, on the same session rules as the console

**Decision**: the landing handlers (`server/src/modules/public/controller.ts`, `landingHandler`)
ask a new decorator `app.peekViewer(request)` who is looking, and render accordingly.
`peekViewer`:
- lives in `server/src/plugins/10-auth.ts`, next to `authenticate`, so it shares one definition
  of "signed in": a verified access token of `typ: 'access'` for any audience, not on the
  session denylist, with an unrevoked session row, and the same status, onboarding and
  organisation gates the console applies;
- **never throws, never audits, and never sets `request.principal`**. A public route must not
  start behaving like an authenticated one, and a bad cookie on the landing page is not a denial
  worth recording. Any failure returns `null`, which renders the anonymous page;
- runs on `audience: 'public'` routes, whose posture doesn't change.

To share the gates without copying them, `applyMemberGates` and `applyOrganisationGates` are
refactored to a form that returns a refusal instead of throwing, or that takes the principal
explicitly. `authenticate` keeps throwing exactly as today, and the authz suites must stay green
unchanged.

**Rationale**: the user chose server rendering. The page stays free of JavaScript (CLAUDE.md:
the landing pages run none). A second, weaker definition of "signed in" would show an ended or
locked member as signed in.

**Limit (accepted)**: the refresh cookie is scoped to `/auth/refresh`, so `/` sees only the
roughly 10-minute access cookie. After it expires the page shows "Anmelden" until the console is
used again.

## R2. What is shown: `landing/viewer.ts`

**Decision**: `server/src/modules/public/application/viewer.ts`,
`loadViewer(app, principal) → { name, initials, avatar: { url, width, height } | null }`.
- **Member**: `display_name` from `members`, and the avatar through the existing `member_avatars`
  plus `loadMediaItems`. Use the smallest variant at least 64 px wide, falling back to the
  smallest. Its URL is the same derivative URL the console uses, never the original (CLAUDE.md:
  the original upload is never served).
- **Staff**: `admin_users.display_name`. **Merchant and partner**: `organisation_users.display_name`.
  No picture.
- **Initials**: the first letters of the first two words, upper-cased, or "?" when there's no
  name.
- Columns are named, never `SELECT *`.

## R3. Where the markup changes: markers in the shells

**Decision**: the landing documents are `client/index.html` and `client/en.html`, read once at
boot. Wrap the two sign-in blocks in HTML comment markers:
- `<!--gwc:account-->…<!--/gwc:account-->` around the masthead button;
- `<!--gwc:signin-->…<!--/gwc:signin-->` around `.login-actions`.

`renderLanding` replaces the content between the markers only when there is a viewer. For an
anonymous visitor nothing is replaced, so the bytes are unchanged (SC-003).

Signed in, the replacements are:
- **masthead**: `<a class="account" href="/konsole" aria-label="Zur Konsole – {name}">`
  containing either `<img src="{url}" alt="" width="40" height="40">` (decorative, because the
  link names the person) or `<span class="initials" aria-hidden="true">{initials}</span>`;
- **sign-in section**: `<a class="btn btn-primary" href="/konsole">Zur Konsole</a>`.

Every interpolated value is HTML-escaped by the existing escape helper.

Labels come from a two-entry table in `landing.ts` keyed by the page's language (`de` for `/`,
`en` for `/en`). The language is in the URL, so this doesn't break the rule that the server
emits no localised text: that rule is about API bodies varying with `Accept-Language`.

CSS for `.account`, `.account img` and `.initials` goes in each shell's `<style>` (already
nonce'd). It's a 40 px circle with a focus ring matching `.masthead .btn:focus-visible`.

A test fails if either shell loses a marker, so a later edit to the HTML can't silently turn the
feature off.

## R4. Caching

**Decision**: signed in → `cache-control: private, no-store` and `vary: Cookie` (as well as the
existing `vary`). Anonymous → unchanged, `PUBLIC_CACHE` and the existing `vary`.

**Rationale**:
- A shared cache never stores a page with a person's name in it.
- Anonymous responses keep their hit rate. Adding `Vary: Cookie` to them would make nearly
  every visitor a cache miss, because analytics and consent cookies differ per visitor.
- A cache serving the anonymous page to a signed-in visitor is the harmless direction.

## R5. SEO and posture

No change. Crawlers have no cookie and get the identical anonymous page, so the canonical URL,
hreflang and `landing-pair.test.ts` are untouched. The route stays `audience: 'public'` in the
authz matrix.

## R6. Tests

`server/tests/seo/landing-viewer.test.ts`:
- anonymous `/` has the same body and headers as before (a counter-assertion for every case);
- a member with an avatar gets the `img` with a derivative URL and `href="/konsole"`, no
  `/konsole/anmelden`, and `private, no-store`;
- a member without an avatar gets initials;
- `/en` uses English labels;
- staff, merchant and partner get initials;
- a revoked session, an expired or garbage cookie, a locked member, or an applicant gets the
  anonymous page with 200;
- a name like `<script>alert(1)</script>` comes out escaped;
- no response contains a `<script>`;
- both shells contain both markers.
