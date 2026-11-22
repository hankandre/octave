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
    [
      "expo-build-properties",
      {
        android: {
          buildArchs: ["arm64-v8a", "x86_64"],
          // Keep R8 from merging Octave's classes with library classes, so each dex class that holds Octave
          // code holds only Octave's. Without allowoptimization R8 does not merge the class or inline its
          // methods elsewhere; it may still rename it or remove it when unused. Library classes still merge.
          // The dex check fails when this stops holding (rule D7, docs/specs/T3-19.md, decision log 27).
          extraProguardRules: "-keep,allowobfuscation,allowshrinking class dev.octave.** { *; }",
        },
      },
    ],
    "./plugins/with-app-jvm-tests.js",
    "./plugins/with-trimmed-manifest.js",
    "./plugins/with-device-probe.js",
  ],
};

export default config;
