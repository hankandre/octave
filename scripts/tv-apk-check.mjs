// Checks the TV release APK's badging (T3-01 item 3): Octave's application ID, arm64-v8a native code, a leanback
// launchable activity, and a touchscreen that is declared not required.
// Run: node scripts/tv-apk-check.mjs [apk]   (pnpm tv:apk:check)
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ANDROID_APPLICATION_ID } from "../packages/core/src/domain/app-identity.ts";
import { androidSdk, newestBuildTool } from "./tv-android-sdk.mjs";

export const RELEASE_APK = fileURLToPath(new URL("../apps/tv/android/app/build/outputs/apk/release/app-release.apk", import.meta.url));

const TOUCHSCREEN = "android.hardware.touchscreen";

// Returns one `ERROR tv apk: ...` line per missing fact; empty when the badging passes.
export function checkBadging(text) {
  const lines = text.split("\n").map((line) => line.trim());
  const errors = [];
  const fail = (problem) => errors.push(`ERROR tv apk: ${problem}`);

  const pkg = lines.find((line) => line.startsWith("package: "));
  const name = pkg ? /name='([^']*)'/.exec(pkg)?.[1] : undefined;
  if (name !== ANDROID_APPLICATION_ID) {
    fail(name === undefined ? `no package line; expected ${ANDROID_APPLICATION_ID}` : `the package is ${name}, not ${ANDROID_APPLICATION_ID}`);
  }

  const nativeCode = lines.find((line) => line.startsWith("native-code: "));
  if (!nativeCode?.includes("'arm64-v8a'")) {
    fail(nativeCode === undefined ? "no native code; expected arm64-v8a" : `the native code lacks arm64-v8a (${nativeCode})`);
  }

  if (!lines.some((line) => line.startsWith("leanback-launchable-activity: "))) {
    fail("no leanback-launchable-activity; the main activity needs the LEANBACK_LAUNCHER category");
  }

  const notRequired = lines.includes(`uses-feature-not-required: name='${TOUCHSCREEN}'`);
  const required = lines.some((line) => line === `uses-feature: name='${TOUCHSCREEN}'` || line.startsWith(`uses-implied-feature: name='${TOUCHSCREEN}'`));
  if (!notRequired || required) fail(`the APK requires ${TOUCHSCREEN}; declare it with android:required="false"`);

  return errors;
}

function main(args) {
  const apk = args[0] ?? RELEASE_APK;
  if (!existsSync(apk)) {
    console.error(`ERROR tv apk: no APK at ${apk}; run pnpm tv:prebuild and pnpm tv:build first`);
    process.exit(1);
  }
  let aapt2;
  try {
    aapt2 = newestBuildTool(androidSdk(), "aapt2");
  } catch (error) {
    console.error(`ERROR tv apk: ${error.message}`);
    process.exit(1);
  }
  const child = spawnSync(aapt2, ["dump", "badging", apk], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (child.status !== 0) {
    console.error(`ERROR tv apk: aapt2 dump badging failed: ${(child.stderr || child.error?.message || "").trim()}`);
    process.exit(1);
  }
  const errors = checkBadging(child.stdout);
  for (const error of errors) console.error(error);
  if (errors.length > 0) process.exit(1);
  console.log(`tv apk: ${apk} passes (arm64-v8a, leanback launcher, touchscreen not required)`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
