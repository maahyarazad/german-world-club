# Quickstart: validating the loader

Prerequisites: `npm install`; for the web checks `npm run -w client dev` against a local API (a **local** database, never the URL in `server/.env`); for the app `npx expo start` on a device or simulator. Use the browser's network throttling ("Slow 3G") or the devtools "Block request" to hold requests open.

1. **Component**: `npm run -w client test -- tests/components` (spinner, page loader, button loading) and the hook tests: all pass. (Contract guarantees 1–4.)
2. **Page loader (web)**: throttle to Slow 3G and open `/konsole/mitglied/profil`, `/konsole/admin/rollen`, `/konsole/admin` (as a superadmin), `/konsole/mitglied/nachrichten`: a large navy loader is centred until the content arrives; no blank page; with fast network no flash. (US1, SC-001, SC-003)
3. **Failure**: block the page's data request: the loader is replaced by the page's existing failure callout, not left spinning. (US1.2, FR-010)
4. **Button (web)**: on sign-in, press "Sign in" on Slow 3G: the loader appears inside the button, its size does not change, a second press sends nothing (watch the network tab: one request). Repeat on password reset, registration steps, Edit profile → Save, Settings → Terminate, Roles → Save. (US2, SC-002, SC-004)
5. **No request, no loader**: "Back", "Cancel", opening a dialog never show the loader. (US2.4)
6. **Reduced motion**: enable "reduce motion" in the OS; reload: nothing rotates. (US3, SC-005)
7. **Screen reader**: VoiceOver/NVDA announces "Loading" on the page loader and button; (US3.1)
8. **App**: repeat 2–7 on a device for the member screens (threads, marketplace, events, profile, devices), the sign-in screens, and the profiling flow; in the dark scheme the loader is the light tint and visible. (SC-006)
9. **Source scan**: `npm run -w client test -- tests/loading-states.test.tsx` fails if a console component that calls the API renders nothing while loading and is not allow-listed. (R5)
10. `npm test` (client), `tsc --noEmit` in client and the app, `npm run -w client test:i18n`.
