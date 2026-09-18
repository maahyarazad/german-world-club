# Push Notification Blueprint — GEC

Reference implementation for push notifications across the **React Native app** (token
producer + receiver) and the **Node/Express admin server** (token store + dispatcher).

The server half of this blueprint is the code that already runs in this repo
(`service/pushService.js`, `controllers/notificationController.js`,
`routes/notification/notification.js`). The mobile half is the matching client contract —
copy it into the React Native project.

---

## 1. Architecture

```
┌──────────────────────┐        1. register + get token
│  React Native app    │ ──────────────────────────────────┐
│  (Expo or bare RN)   │                                   │
└──────────┬───────────┘                                   ▼
           │                                    ┌────────────────────────┐
           │ 2. POST /notification/save-push-token │  Expo push service  │
           │    { user_id, token, provider,     │  or Firebase (FCM)    │
           │      platform }                    └───────────┬────────────┘
           ▼                                                │
┌──────────────────────┐                                    │ 4. deliver
│  Node admin server   │  3. POST /notification/send-notification
│  app_user_contact    │ ───────────────────────────────────┘
│  push_notification_* │
└──────────▲───────────┘
           │ admin composes + fires
┌──────────┴───────────┐
│  Admin web-client    │
└──────────────────────┘
```

**Two providers, one pipeline.** Each device row carries a `push_provider` of `expo` or
`fcm`. `sendToManyByProvider()` splits the recipient list by that column and fans out to
both transports, then merges the counts. Expo-built clients send an `ExponentPushToken[…]`;
bare RN / `@react-native-firebase` clients send a raw FCM token. Never send an Expo token
to FCM or vice versa — it will hard-fail per token.

---

## 2. Data model

### `app_user_contact` (device/token columns)

| Column | Type | Notes |
|---|---|---|
| `user_id` | FK | one row per user |
| `fcmToken` | VARCHAR | the push token — Expo token *or* FCM token, see `push_provider` |
| `push_provider` | VARCHAR | `'expo'` \| `'fcm'` (defaults to `'fcm'`) |
| `platform` | VARCHAR | `'ios'` \| `'android'`, nullable |
| `notification` | TINYINT(1) | user's opt-in flag; `get-userpushtoken` filters on `= 1` |

> **Known limitation:** this is one token *per user*, not per device. A user logging in on a
> second device overwrites the first device's token. If multi-device delivery is needed,
> split this into a `user_push_tokens` table keyed on `(user_id, token)` and change
> `storeFcmToken` to `INSERT … ON DUPLICATE KEY UPDATE`.

### `push_notification_logs` — one row per send attempt

`id` CHAR(36) PK · `sent_at` · `app_id` · `title` VARCHAR(65) · `body` VARCHAR(240) ·
`destination_type` · `destination_id` · `destination_label` · `is_test` TINYINT ·
`total_success` / `total_failure` · `expo_success` / `expo_failure` / `expo_response_id` /
`expo_status` · `fcm_success` / `fcm_failure`.
Index: `idx_pnl_is_test_sent_at (is_test, sent_at)`.

Two hard-won rules encoded in the DDL (see
`db/make/20260824-0-alter-push_notification_logs-details.sql`):

1. The free-text columns are **explicitly `utf8mb4`** — the table's own collation is
   utf8mb3, and titles/bodies routinely contain emoji. Under `STRICT_TRANS_TABLES` a 4-byte
   character aborts the INSERT *after the push has already gone out*. The DB connection must
   also be `charset: "utf8mb4"` (set in `service/database/database.js`).
2. `id` is generated in Node with `crypto.randomUUID()` and inserted explicitly.
   `LAST_INSERT_ID()` doesn't work on a CHAR(36)/`UUID()` column, and `sent_at` only has
   1-second granularity — "read back the newest row" attaches recipients to the wrong parent
   under concurrent sends.

### `push_notification_recipients` — per-token outcome

`log_id` FK → logs · `user_id` · `fcm_token` · `push_provider` · `platform` · `status` ·
`error_message`.

---

## 3. Server side

### 3.1 Config

```
FIREBASE_PROJECT_ID=gec-rewards-26313
```

The Firebase Admin service-account JSON lives at the repo root
(`gec-rewards-26313-firebase-adminsdk-fbsvc-*.json`) and is git-ignored. **Never commit it.**
In production prefer `GOOGLE_APPLICATION_CREDENTIALS` pointing at a file outside the repo, or
inject the JSON via a secret manager.

Expo needs no server credentials for basic sends. If the project enables Expo's *enhanced
security*, add an `Authorization: Bearer <EXPO_ACCESS_TOKEN>` header to the
`exp.host` request.

### 3.2 `service/pushService.js` — the dispatcher

Lazy, idempotent Firebase init:

```js
const admin = require("firebase-admin");
const serviceAccount = require("../gec-rewards-26313-firebase-adminsdk-fbsvc-….json");

let initialized = false;

function initPush() {
  if (initialized) return;
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: process.env.FIREBASE_PROJECT_ID || "gec-rewards-26313",
  });
  initialized = true;
}
```

**Every value in `data` must be a string.** FCM rejects non-string data values outright;
Expo is lenient but the client then has to handle both shapes. Normalize once:

```js
function normalizeData(data = {}) {
  return Object.fromEntries(
    Object.entries(data).map(([k, v]) => [k, String(v ?? "")])
  );
}
```

**Expo transport** — POST to `https://exp.host/--/api/v2/push/send`, **max 100 messages per
request**:

```js
async function sendExpoToMany({ tokens, title, body, data = {} }) {
  const cleanTokens = [...new Set((tokens || []).filter(Boolean))];
  if (!cleanTokens.length) {
    return { provider: "expo", successCount: 0, failureCount: 0, responses: [] };
  }

  const messages = cleanTokens.map((token) => ({
    to: token,
    sound: "default",
    title,
    body,
    data: normalizeData(data),
  }));

  const chunks = [];
  for (let i = 0; i < messages.length; i += 100) chunks.push(messages.slice(i, i + 100));

  let successCount = 0, failureCount = 0;
  const responses = [];

  for (const chunk of chunks) {
    const response = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Accept-encoding": "gzip, deflate",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(chunk),
    });
    const result = await response.json();
    const tickets = Array.isArray(result?.data) ? result.data : [];
    for (const ticket of tickets) {
      if (ticket?.status === "ok") successCount += 1;
      else failureCount += 1;
    }
    responses.push(...tickets);
  }

  return { provider: "expo", successCount, failureCount, responses };
}
```

**FCM transport** — `sendEachForMulticast`, **max 500 tokens per call**:

```js
async function sendFcmToMany({ tokens, title, body, data = {} }) {
  initPush();
  const cleanTokens = [...new Set((tokens || []).filter(Boolean))];
  if (!cleanTokens.length) {
    return { provider: "fcm", successCount: 0, failureCount: 0, responses: [] };
  }

  const chunks = [];
  for (let i = 0; i < cleanTokens.length; i += 500) chunks.push(cleanTokens.slice(i, i + 500));

  let successCount = 0, failureCount = 0;
  const responses = [];

  for (const chunk of chunks) {
    const result = await admin.messaging().sendEachForMulticast({
      tokens: chunk,
      notification: { title, body },
      data: normalizeData(data),
      android: { priority: "high", notification: { sound: "default" } },
      apns: { payload: { aps: { sound: "default" } } },
    });
    successCount += result.successCount;
    failureCount += result.failureCount;
    responses.push(...result.responses);
  }

  return { provider: "fcm", successCount, failureCount, responses };
}
```

**The split** — callers only ever use this:

```js
async function sendToManyByProvider({ recipients, title, body, data = {} }) {
  const expoTokens = [], fcmTokens = [];

  for (const recipient of recipients || []) {
    const token = recipient?.fcmToken;
    if (!token) continue;
    const provider = (recipient?.push_provider || "fcm").toLowerCase();
    (provider === "expo" ? expoTokens : fcmTokens).push(token);
  }

  const expo = await sendExpoToMany({ tokens: expoTokens, title, body, data });
  const fcm  = await sendFcmToMany({ tokens: fcmTokens, title, body, data });

  return {
    successCount: expo.successCount + fcm.successCount,
    failureCount: expo.failureCount + fcm.failureCount,
    expo,
    fcm,
  };
}
```

### 3.3 Routes — `routes/notification/notification.js`

Mounted at `/notification` in `routes/index.js`; full base path `/v1/api/notification`.

| Method | Path | Handler | Purpose |
|---|---|---|---|
| POST | `/save-push-token` | `storeFcmToken` | **mobile app calls this** |
| POST | `/send-notification` | `sendNotification` | broadcast to all opted-in users |
| POST | `/test` | `sendTestNotification` | send only to `app_test_recipients` |
| GET | `/sent-notifications` | `getSentNotifications` | history (`?is_test=0\|1&limit=`) |
| POST | `/get-userpushtoken` | `getUserListWithPushToken` | |
| POST | `/search-user`, `/add-test-recipient`, DELETE `/remove-test-recipient/:user_id` | | test-recipient admin |

> **Note:** this router has **no auth middleware** today. `/send-notification` broadcasts to
> every user with a token. Put the admin JWT guard in front of it before this is reachable
> from anything but the admin panel.

### 3.4 Token registration — `storeFcmToken`

```js
exports.storeFcmToken = async (req, res) => {
  const { user_id, token, provider, platform } = req.body;

  if (!user_id || !token) {
    return res.send({ success: false, message: "user_id and token are required" });
  }

  const result = await query(
    `UPDATE app_user_contact
        SET fcmToken = ?, push_provider = ?, platform = ?
      WHERE user_id = ?`,
    [token, (provider || "fcm").toLowerCase(), platform || null, user_id]
  );

  if (!result.affectedRows) {
    return res.send({ success: false, message: "Could not store the push token." });
  }
  return res.send({ success: true, message: "Push token stored successfully" });
};
```

### 3.5 Sending — `sendNotification`

The shape that matters:

```js
const recipients = await query(`
  SELECT user_id, fcmToken, push_provider, platform
    FROM app_user_contact
   WHERE fcmToken IS NOT NULL AND fcmToken != ''`);

const result = await sendToManyByProvider({
  recipients,
  title,
  body,
  data: { path: path ?? "", id: id ?? "" },   // deep-link payload, see §5
});

// The push is ALREADY DELIVERED here. A logging failure must never be reported
// as a send failure — that invites the admin to re-send and notify everyone twice.
try {
  const logId = await insertPushLog({ result, app_id, title, body, path, id, link_label, isTest: false });
  // … insert push_notification_recipients rows …
} catch (logErr) {
  console.error("Push notification delivered but logging failed:", logErr);
}

return res.send({ success: true, message: "Notifications processed", result });
```

**Request body contract**

```jsonc
{
  "title": "string, required, ≤65 chars",
  "body":  "string, required, ≤240 chars",
  "app_id": 1,
  "path": "'event' | 'partner' | ''",   // deep-link destination type
  "id":   "number | string",            // deep-link destination id
  "link_label": "string"                // display name captured AT SEND TIME,
                                        // so the log survives a rename/delete
}
```

`/test` takes the same body plus `user_list: [{ user_id }]`.

---

## 4. React Native — Expo (the primary path)

### 4.1 Install

```bash
npx expo install expo-notifications expo-device expo-constants
```

`app.json` / `app.config.js`:

```jsonc
{
  "expo": {
    "plugins": [
      ["expo-notifications", {
        "icon": "./assets/notification-icon.png",
        "color": "#ffffff"
      }]
    ],
    "ios": { "bundleIdentifier": "…", "infoPlist": { "UIBackgroundModes": ["remote-notification"] } },
    "android": { "package": "…", "googleServicesFile": "./google-services.json" },
    "extra": { "eas": { "projectId": "YOUR-EAS-PROJECT-ID" } }
  }
}
```

> `projectId` is **required** for `getExpoPushTokenAsync()` in SDK 48+. Without it the call
> throws at runtime in a production build while working fine in Expo Go.

### 4.2 Foreground presentation handler (module scope, once)

```ts
// src/services/push/handler.ts
import * as Notifications from "expo-notifications";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});
```

Import it once at the top of `App.tsx` — before any component renders.

### 4.3 Register and obtain the token

```ts
// src/services/push/registerForPush.ts
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { Platform } from "react-native";

export type PushRegistration = {
  token: string;
  provider: "expo";
  platform: "ios" | "android";
};

export async function registerForPushNotificationsAsync(): Promise<PushRegistration | null> {
  // Push does not work on simulators/emulators — bail early rather than throwing.
  if (!Device.isDevice) return null;

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "Default",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      sound: "default",
      lightColor: "#FF231F7C",
    });
  }

  const { status: existing } = await Notifications.getPermissionsAsync();
  let status = existing;
  if (existing !== "granted") {
    ({ status } = await Notifications.requestPermissionsAsync());
  }
  // The user said no. Respect it — do not re-prompt on every launch.
  if (status !== "granted") return null;

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId;

  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });

  return {
    token,                                   // "ExponentPushToken[xxxxxxxx]"
    provider: "expo",
    platform: Platform.OS as "ios" | "android",
  };
}
```

### 4.4 Send the token to the server

```ts
// src/services/push/PushService.ts
import { api } from "../api";              // your axios instance, baseURL .../v1/api
import { registerForPushNotificationsAsync } from "./registerForPush";

export async function syncPushToken(user_id: number | string) {
  const registration = await registerForPushNotificationsAsync();
  if (!registration) return;

  await api.post("notification/save-push-token", {
    user_id,
    token: registration.token,
    provider: registration.provider,   // "expo"
    platform: registration.platform,
  });
}
```

**Call `syncPushToken` after login, and on every cold start while logged in.** Push tokens
rotate (app reinstall, OS restore, Expo project change); a token registered once at signup
goes stale and the user silently stops receiving anything.

On logout, clear it so the device stops receiving the previous user's pushes:

```ts
await api.post("notification/save-push-token", {
  user_id, token: "", provider: "expo", platform: Platform.OS,
});
```

> With the current single-token-per-user schema the server rejects an empty token
> (`user_id and token are required`). Either relax that check for a logout clear, or move to
> the `user_push_tokens` table described in §2.

### 4.5 Receive and route

```tsx
// src/services/push/usePushNotifications.ts
import { useEffect, useRef } from "react";
import * as Notifications from "expo-notifications";
import { useNavigation } from "@react-navigation/native";

type PushData = { path?: string; id?: string };

export function usePushNotifications() {
  const navigation = useNavigation<any>();
  const received = useRef<Notifications.Subscription>();
  const responded = useRef<Notifications.Subscription>();

  useEffect(() => {
    // Delivered while the app is in the foreground.
    received.current = Notifications.addNotificationReceivedListener(() => {
      // refresh an in-app badge / inbox here
    });

    // The user tapped the notification.
    responded.current = Notifications.addNotificationResponseReceivedListener((response) => {
      routeFromPush(response.notification.request.content.data as PushData);
    });

    // Cold start: the app was launched BY the tap, so no listener ever fires.
    // This is the case that gets forgotten and reads as "deep links don't work".
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) routeFromPush(response.notification.request.content.data as PushData);
    });

    return () => {
      received.current?.remove();
      responded.current?.remove();
    };
  }, [navigation]);

  function routeFromPush(data: PushData) {
    // Server always sends strings (normalizeData). Never assume a number.
    const { path, id } = data ?? {};
    if (!path || !id) return;

    switch (path) {
      case "event":   navigation.navigate("EventDetail",   { id }); break;
      case "partner": navigation.navigate("PartnerDetail", { id }); break;
      default: break;
    }
  }
}
```

---

## 5. The deep-link payload contract

The admin panel's `LinkSelector` produces `path` + `id`; the server passes them through as
`data`, and the app routes on them. This is the whole contract:

| `data.path` | `data.id` | App destination |
|---|---|---|
| `"event"` | event id | Event detail screen |
| `"partner"` | partner id | Partner detail screen |
| `""` | `""` | No navigation — open the app's default screen |

**Both sides must agree on strings.** The server stringifies everything via
`normalizeData()`; the app must not do `typeof id === "number"` checks.

To add a destination type: add the option to the admin `LinkSelector`, add the `case` to
`routeFromPush`, and extend `destination_type` (VARCHAR(20), no enum constraint — no
migration needed).

---

## 6. React Native — bare RN / `@react-native-firebase` (the `provider: "fcm"` path)

Use this when the app is not on Expo. Everything server-side is unchanged; only the token
source and provider label differ.

```bash
npm i @react-native-firebase/app @react-native-firebase/messaging
cd ios && pod install
```

Place `google-services.json` (Android) and `GoogleService-Info.plist` (iOS) per the
React Native Firebase setup docs, and enable Push Notifications + Background Modes →
Remote notifications in Xcode capabilities.

```ts
import messaging from "@react-native-firebase/messaging";
import { Platform, PermissionsAndroid } from "react-native";

export async function registerForPushNotificationsAsync() {
  if (Platform.OS === "android" && Platform.Version >= 33) {
    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS
    );
    if (granted !== PermissionsAndroid.RESULTS.GRANTED) return null;
  } else {
    const status = await messaging().requestPermission();
    const ok =
      status === messaging.AuthorizationStatus.AUTHORIZED ||
      status === messaging.AuthorizationStatus.PROVISIONAL;
    if (!ok) return null;
  }

  const token = await messaging().getToken();
  return { token, provider: "fcm" as const, platform: Platform.OS as "ios" | "android" };
}
```

Handlers:

```ts
// index.js — MUST be outside any component, before AppRegistry.registerComponent
messaging().setBackgroundMessageHandler(async () => {});

// in a component
useEffect(() => {
  const unsubForeground = messaging().onMessage(async () => { /* refresh inbox */ });
  const unsubOpened = messaging().onNotificationOpenedApp((msg) => routeFromPush(msg.data));
  messaging().getInitialNotification().then((msg) => { if (msg) routeFromPush(msg.data); });
  // Tokens rotate — re-sync whenever FCM issues a new one.
  const unsubRefresh = messaging().onTokenRefresh((token) =>
    api.post("notification/save-push-token", { user_id, token, provider: "fcm", platform: Platform.OS })
  );
  return () => { unsubForeground(); unsubOpened(); unsubRefresh(); };
}, []);
```

---

## 7. End-to-end checklist

**Mobile**
- [ ] `projectId` present in `app.json` `extra.eas` (Expo) / Firebase config files in place (bare)
- [ ] Notification handler registered at module scope, before first render
- [ ] Android notification channel created before requesting the token
- [ ] Permission requested once, refusal respected
- [ ] `syncPushToken` runs after login **and** on every cold start
- [ ] Token cleared on logout
- [ ] All three receive paths wired: foreground, background-tap, **cold-start tap**
- [ ] `data.path` / `data.id` handled as strings
- [ ] Tested on a physical device (push never works on a simulator)

**Server**
- [ ] Service-account JSON present and git-ignored
- [ ] DB connection `charset: "utf8mb4"` (emoji in titles)
- [ ] Log-row id generated with `crypto.randomUUID()`
- [ ] Logging failures caught and never surfaced as send failures
- [ ] Auth middleware in front of `/send-notification` and `/test`
- [ ] Verified with `/test` against `app_test_recipients` before any broadcast

---

## 8. Gotchas that have actually bitten

| Symptom | Cause |
|---|---|
| Works in Expo Go, fails in the production build | Missing `extra.eas.projectId` |
| Every push fails for one cohort of users | Expo token sent through FCM (or vice versa) — check `push_provider` |
| Deep link works from background, not from a cold start | `getLastNotificationResponseAsync()` / `getInitialNotification()` not wired |
| INSERT fails after the push was delivered | Emoji in title/body vs. utf8mb3 column or connection |
| Admin re-sends and everyone gets it twice | A logging error was reported as a send failure |
| Recipients attached to the wrong log row | Relying on `sent_at`/`LAST_INSERT_ID()` instead of an explicit UUID |
| User stops receiving pushes after reinstall | Token rotated and was never re-synced |
| Only one of a user's devices gets the push | Single-token-per-user schema (§2) |
| No `data` reaches the app on iOS | Non-string values in `data` — run everything through `normalizeData()` |

---

## 9. Files in this repo

| Path | Role |
|---|---|
| `service/pushService.js` | Provider split, Expo + FCM transports, chunking |
| `controllers/notificationController.js` | Token storage, send, test-send, logging, history |
| `routes/notification/notification.js` | Route table |
| `db/make/20260824-0-alter-push_notification_logs-details.sql` | Log-table migration |
| `web-client/src/services/Notification/Notification.service.ts` | Admin panel API client |
| `specs/002-push-notification-panel/` | Spec, data model, API contract |
