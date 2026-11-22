// The checks the e2e APK gets before pnpm tv:e2e installs it (T3-31): the dex check, the inspector check and the native
// inspector check, each with the rules and the allowed rows of pnpm tv:apk:check (none is passed or replaced here), and the
// R8 mapping of the e2e build, kept beside the APK by pnpm tv:e2e:build. The mapping path is always given explicitly, so
// neither check falls back to its default path.
import { main as dexMain } from "./tv-apk-dex.mjs";
import { main as inspectorMain } from "./tv-apk-inspector.mjs";
import { main as nativeInspectorMain } from "./tv-apk-native-inspector.mjs";

export const E2E_APK_CHECKS = [
  { script: "scripts/tv-apk-dex.mjs", run: ({ apk, mapping }) => dexMain([apk, mapping]) },
  { script: "scripts/tv-apk-inspector.mjs", run: ({ apk, mapping }) => inspectorMain([apk, mapping]) },
  { script: "scripts/tv-apk-native-inspector.mjs", run: ({ apk }) => nativeInspectorMain([apk]) },
];

// Runs every check, in order, on { apk, mapping }. Each check prints its own lines. Returns one `ERROR tv e2e:` line per
// check that failed (an exit code other than 0, or a throw); empty when all passed. `checks` is a parameter for tests.
export async function checkE2eApk({ apk, mapping }, checks = E2E_APK_CHECKS) {
  const errors = [];
  for (const { script, run } of checks) {
    let outcome;
    try {
      const code = await run({ apk, mapping });
      if (code !== 0) outcome = `exit ${code}`;
    } catch (error) {
      outcome = error instanceof Error ? error.message : String(error);
    }
    if (outcome !== undefined) errors.push(`ERROR tv e2e: the e2e APK failed ${script} (${outcome}); it was not installed; fix it and run pnpm tv:e2e:build`);
  }
  return errors;
}
