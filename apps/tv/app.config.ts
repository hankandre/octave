// The TV app's Expo config. The application ID and name come from the core, the one place that defines them.
import "tsx/cjs";
import type { ExpoConfig } from "expo/config";
import { ANDROID_APPLICATION_ID, APP_NAME } from "../../packages/core/src/domain/app-identity";

const config: ExpoConfig = {
  name: APP_NAME,
  slug: "octave-tv",
  version: "0.1.0",
  orientation: "landscape",
  android: {
    package: ANDROID_APPLICATION_ID,
    // Backup is off (T3-22); apps/tv/plugins/with-trimmed-manifest.js adds the data extraction rules.
    allowBackup: false,
  },
  plugins: [
    ["@react-native-tvos/config-tv", { isTV: true }],
    ["expo-build-properties", { android: { buildArchs: ["arm64-v8a", "x86_64"] } }],
    "./plugins/with-app-jvm-tests.js",
    "./plugins/with-trimmed-manifest.js",
    "./plugins/with-device-probe.js",
  ],
};

export default config;
