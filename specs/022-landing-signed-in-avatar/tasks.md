---
description: "Tasks for feature 022: signed-in visitors see their avatar on the landing page"
---

# Tasks: Signed-in visitors see their avatar on the landing page

**Input**: `specs/022-landing-signed-in-avatar/` (spec, plan, research R1–R6, contracts/landing.md,
quickstart)
**Branch**: `022-landing-signed-in-avatar`, from `main` after PR #18 was merged.

**Tests**: included. CLAUDE.md requires behaviour tests with counter-assertions. Server suites
run against `gwc_test` only.

## Format: `[ID] [P?] [Story] Description`

- US1: a member sees their avatar (P1)
- US2: staff, merchant and partner see initials (P2)
- US3: nobody else ever sees a signed-in page (P1)

---

## Phase 1: Setup

- [ ] T001 Confirm the branch is `022-landing-signed-in-avatar`. Run
  `DATABASE_URL=postgres://postgres:postgres@localhost:5432/gwc_test npm run -w server test -- seo authz auth`
  and record the baseline, so the 10-auth refactor (T004) can be shown not to change any
  outcome.

---

## Phase 2: Foundational

**Purpose**: one definition of "signed in", shared by the console and the landing page
(research R1). Blocks every story.

- [ ] T002 [P] Add the markers to `client/index.html` and `client/en.html`:
  - `<!--gwc:account-->` and `<!--/gwc:account-->` around the masthead sign-in `<a class="btn btn-primary" href="/konsole/anmelden">`;
  - `<!--gwc:signin-->` and `<!--/gwc:signin-->` around the `<div class="login-actions">…</div>`
    in the sign-in section.
  - Add CSS to each shell's `<style>`:
    - `.account`: a 40 px circle, `overflow:hidden`, `display:inline-flex`, centred, `border:1px`
      using the existing navy, and a `:focus-visible` outline matching
      `.masthead .btn:focus-visible`;
    - `.account img`: `width:100%; height:100%; object-fit:cover`;
    - `.initials`: 14 px, semibold, the navy background and light text used by `.btn-primary`.
  - Add an HTML comment above each marker explaining that the server swaps the content for
    signed-in visitors (feature 022).
  - Change nothing else in the shells.
- [ ] T003 [P] Create `server/tests/seo/landing-viewer.test.ts` with the markers check: read
  `client/index.html` and `client/en.html`, and assert each contains both marker pairs, each
  exactly once.
- [ ] T004 In `server/src/plugins/10-auth.ts`, refactor so the gates can be evaluated without
  throwing:
  - extract the session check (denylist plus `loadSession` revoked) and the member and
    organisation gate predicates into functions returning a refusal or `null`;
  - `authenticate` throws the same problems, in the same order, as before;
  - staff: `peekViewer` follows whatever `authenticate`/11-rbac checks for staff (look for an
    `admin_users` status check, and reuse it if one exists).
  - Re-run the T001 suites: identical results.
- [ ] T005 In the same file, decorate `app.peekViewer(request): Promise<{ id: string; kind: 'member' | 'admin' | 'merchant' | 'partner' } | null>`:
  - `null` immediately when there's no `gwc_at` cookie, so anonymous visitors cost nothing;
  - otherwise `app.verifyAccessToken(request, undefined)` for any audience, then the T004
    session check, then the gates for that audience as a member console route would apply
    them (not `onboarding`/`profiling`);
  - any throw or refusal → `null`;
  - it never sets `request.principal` or `request.permissions` and never calls `auditDenial`.
  - Add a doc comment on why (research R1). Declare the decorator's type wherever `GwcApp`'s
    decorators are typed.

**Checkpoint**: the T001 suites are unchanged, and the T003 marker test passes.

---

## Phase 3: User Story 1 - A member sees their avatar (Priority: P1) 🎯 MVP

**Goal**: FR-001, FR-002, FR-005–FR-007 for members.

**Independent test**: with a member's access cookie, `/` shows their avatar linking to
`/konsole` and the "Zur Konsole" button, and no `/konsole/anmelden`.

### Tests for User Story 1

- [ ] T006 [P] [US1] In `server/tests/seo/landing-viewer.test.ts`, mint the cookie the way
  existing cookie tests do (`signIn` helper from `tests/helpers/auth.ts`, as in
  `tests/marketplace/parity.test.ts`). Cover:
  - **member with an avatar**: insert an asset with variants and a `member_avatars` row the way
    `tests/profile` or `tests/media` helpers do, then `GET /` with the cookie. The body contains
    `class="account"`, `href="/konsole"`, an `<img src=` pointing at a derivative URL (not the
    original key), and `aria-label="Zur Konsole – {name}"`. It doesn't contain
    `href="/konsole/anmelden"` or `/konsole/passwort`. The sign-in section has
    `<a class="btn btn-primary" href="/konsole">Zur Konsole</a>`.
  - **member without an avatar**: `<span class="initials" aria-hidden="true">AG</span>` for
    "Arian Geissler".
  - **`/en`**: "Go to the console – {name}" and "Go to the console".
  - **escaping**: display name `<b>x</b>` → `&lt;b&gt;x&lt;/b&gt;`, and no `<b>` in the body.
  - **no script**: no `<script` in any response.
  - **counter-assertion**: `GET /` without the cookie still has `href="/konsole/anmelden"` and
    no `class="account"`.

### Implementation for User Story 1

- [ ] T007 [P] [US1] Create `server/src/modules/public/application/viewer.ts` with
  `loadViewer(app, viewer, { signal })` (research R2):
  - **member**: `SELECT display_name FROM members WHERE id = $1`, plus
    `SELECT asset_id FROM member_avatars WHERE member_id = $1`, then `loadMediaItems`. Pick the
    smallest image variant with `width >= 64`, else the smallest.
  - **admin**: `SELECT display_name FROM admin_users WHERE id = $1`. **merchant and partner**:
    `SELECT display_name FROM organisation_users WHERE id = $1`.
  - Return `{ name, initials, avatar: { url, width, height } | null }`. `initials` is the first
    letters of up to two words of `name`, upper-cased, or `'?'`.
  - Columns are named.
- [ ] T008 [US1] In `server/src/modules/public/application/landing.ts`:
  - add `LANDING_ACCOUNT_LABELS = { de: { toConsole: 'Zur Konsole' }, en: { toConsole: 'Go to the console' } }`;
  - extend `renderLanding({ shell, record, origin, cspNonce, viewer = null, language = 'de' })`.
    With a viewer and a shell, replace the content between `<!--gwc:account-->` and
    `<!--/gwc:account-->`, and between `<!--gwc:signin-->` and `<!--/gwc:signin-->`, with the
    contract's markup (`contracts/landing.md`), using `escape` from `../templates/layout.ts` for
    every value;
  - without a viewer, return exactly what it returns today;
  - keep `withCspNonces` applied last.
- [ ] T009 [US1] In `server/src/modules/public/controller.ts` `landingHandler`:
  - `const principal = await app.peekViewer(request)`;
  - if non-null, `viewer = await loadViewer(app, principal, { signal: request.deadlineSignal })`,
    wrapped so a failure means `viewer = null`;
  - pass `viewer` and the language (`'de'` for `landing`, `'en'` for `landingEn`; extend
    `landingHandler(shell, record, language)`) to `renderLanding`;
  - headers: with a viewer, `cache-control: private, no-store` and
    `vary: ${VARY}, Cookie`; without one, unchanged.

**Checkpoint**: T006 passes. The member sees their avatar on `/` and `/en`.

---

## Phase 4: User Story 3 - Nobody else ever sees a signed-in page (Priority: P1)

**Goal**: FR-003, FR-004, SC-002–SC-004.

### Tests for User Story 3

- [ ] T010 [P] [US3] In `server/tests/seo/landing-viewer.test.ts`:
  - **headers**: signed in → `cache-control` is exactly `private, no-store` and `vary` includes
    `Cookie`. Anonymous → `cache-control` equals `PUBLIC_CACHE` (import it) and `vary` has no
    `Cookie`;
  - **unchanged bytes**: the anonymous body equals `renderLanding` called with no viewer (or a
    snapshot of the shell with nonces normalised) — SC-003;
  - **anonymous with 200**, never an error, for: a signed-out session (sign in, then call the
    sign-out route, then `GET /` with the old cookie); a revoked session (set
    `sessions.revoked_at`); a garbage cookie (`gwc_at=nonsense`); an expired token (sign one
    with a past `exp` using the app's JWT signer, or fake timers if that's how the auth tests do
    it); a member with status `locked`; an applicant whose application is `pending`;
  - **counter-assertion**: the same member, admissible, gets `class="account"`.

### Implementation for User Story 3

- [ ] T011 [US3] Fix whatever T010 shows in `peekViewer` (T005) or the controller (T009). Don't
  loosen T010.

---

## Phase 5: User Story 2 - Staff, merchant and partner (Priority: P2)

**Goal**: US2.

- [ ] T012 [P] [US2] In `server/tests/seo/landing-viewer.test.ts`, sign in staff
  (`createAdmin` and the staff sign-in helper), a merchant user and a partner user (the
  organisation helpers used by `tests/organisations`). Each gets `class="initials"` with their
  initials and `href="/konsole"`. Counter-assertion: a merchant user whose organisation is
  `suspended` gets the anonymous page.
- [ ] T013 [US2] Make T012 pass in `viewer.ts` (T007) and `peekViewer` (T005) if needed.

---

## Phase 6: Polish

- [ ] T014 Add a paragraph to `CLAUDE.md` after the "Two languages, two mechanisms" paragraph:
  - the landing pages render a signed-in variant on the server (feature 022): `peekViewer` and
    the markers in the shells;
  - signed-in responses are `private, no-store` with `Vary: Cookie`; anonymous responses are
    untouched;
  - there's still no JavaScript;
  - the refresh-cookie limit;
  - never add `Vary: Cookie` to the anonymous response.
- [ ] T015 Run the gates:
  - the full `npm run -w server test` on `gwc_test` (the 7 known failures on `main` excepted);
  - `npm run -w server verify:seo` if a dev server and database are available;
  - `npm run -w client test`, since the shells are part of the client build;
  - `npm run -w client build`, then check `client/dist/index.html` and `dist/en.html` still
    contain the markers (the HTML minifier must not strip comments; if it does, switch the
    markers to `data-gwc-slot` attributes on wrapper elements and update T003 and T008).
- [ ] T016 Walk through `specs/022-landing-signed-in-avatar/quickstart.md` steps 1–7 in a
  browser, and record the result there.

---

## Dependencies & execution order

- T001 → T002 ∥ T003 → T004 → T005 → stories.
- **US1** (T006–T009): T007 ∥ T006, then T008 → T009.
- **US3** (T010–T011) needs T009.
- **US2** (T012–T013) needs T009.
- **Polish** comes last. T015's build check can move T002's marker form, so run it before
  pushing.

## Parallel examples

```text
T002 ∥ T003
T006 ∥ T007
T010 ∥ T012  (same test file — write them in sequence if one person does both)
```

## Implementation strategy

1. **MVP = US1 together with US3.** A signed-in page that could be cached for strangers must not
   ship, so US3's headers and refusals are part of the first release.
2. Then US2 (other roles), then Polish.

Commit per phase on `022-landing-signed-in-avatar`. Don't push or open a PR unless asked.
