/**
 * Referral links (feature 018, research R9): https://<host>/r/<code> opens the
 * app through iOS universal links and Android App Links, for /r/* only — the
 * rest of the domain keeps opening in the browser. The server answers the
 * matching /.well-known files.
 *
 * Both entries are NATIVE configuration: changing them needs a new EAS build,
 * an over-the-air update cannot deliver them. Until a build with them ships, a
 * tapped link opens the landing page, which works on its own.
 *
 * EXPO_PUBLIC_LINK_HOST must equal the host of the server's CANONICAL_ORIGIN.
 * Unset is fine for development; a production build without it would ship an
 * app that cannot open referral links, so that is refused here.
 */
const linkHost = process.env.EXPO_PUBLIC_LINK_HOST;
if (!linkHost && process.env.EAS_BUILD_PROFILE === "production") {
  throw new Error(
    "EXPO_PUBLIC_LINK_HOST must be set for a production build (the host of the server's CANONICAL_ORIGIN, e.g. german-world-club.com)",
  );
}

export default {
  expo: {
    name: "German World Club",
    slug: "german-world-club",
    version: "1.0.0",
    orientation: "portrait",
    icon: "./assets/icon.png",
    scheme: "germanworldclub",
    userInterfaceStyle: "automatic",
    ios: {
      icon: "./assets/icon.png",
      bundleIdentifier: "com.buenapublica.germanworldclub",
      infoPlist: {
        CFBundleDisplayName: "German World Club",
        ITSAppUsesNonExemptEncryption: false,
      },
      appleTeamId: "YQFY6269ZL",
      ...(linkHost ? { associatedDomains: [`applinks:${linkHost}`] } : {}),
    },
    android: {
      googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? "./google-services.json",
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon.png",
        backgroundColor: "#000000",
      },
      predictiveBackGestureEnabled: false,
      package: "com.buenapublica.germanworldclub",
      ...(linkHost
        ? {
            intentFilters: [
              {
                action: "VIEW",
                autoVerify: true,
                data: [{ scheme: "https", host: linkHost, pathPrefix: "/r/" }],
                category: ["BROWSABLE", "DEFAULT"],
              },
            ],
          }
        : {}),
    },
    web: {
      output: "static",
      favicon: "./assets/favicon.png",
    },
    plugins: [
      "expo-router",
      [
        "expo-splash-screen",
        {
          image: "./assets/splash-icon.png",
          resizeMode: "contain",
          backgroundColor: "#000000",
          imageWidth: 200,
        },
      ],
      "expo-secure-store",
      [
        "expo-image-picker",
        {
          photosPermission:
            "German World Club uses your photo library so you can attach photos and videos to your posts and choose a profile picture.",
          cameraPermission: false,
          microphonePermission: false,
        },
      ],
      "expo-video",
      [
        "expo-notifications",
        {
          icon: "./assets/notification-icon.png",
          color: "#000000",
          defaultChannel: "default",
        },
      ],
    ],
    experiments: {
      typedRoutes: true,
      reactCompiler: true,
    },
    extra: {
      router: {},
      eas: {
        projectId: "c2fa644f-85a8-47fe-9294-1c45d2eef904",
      },
    },
    owner: "buenapublica",
    runtimeVersion: {
      policy: "appVersion",
    },
    updates: {
      url: "https://u.expo.dev/c2fa644f-85a8-47fe-9294-1c45d2eef904",
    },
  },
};