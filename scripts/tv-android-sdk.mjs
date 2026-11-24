// Finds the Android SDK and its tools for the tv scripts: ANDROID_HOME, then ANDROID_SDK_ROOT. Each function returns
// a path or throws an Error whose message is the reason, which the caller prints after its own `ERROR tv <area>:`.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { shownPath } from "./tv-host-paths.mjs";

export function androidSdk(env = process.env) {
  for (const name of ["ANDROID_HOME", "ANDROID_SDK_ROOT"]) {
    const dir = env[name];
    if (dir) {
      if (!existsSync(dir)) throw new Error(`${name} is ${shownPath(dir)}, which does not exist`);
      return dir;
    }
  }
  throw new Error("set ANDROID_HOME (or ANDROID_SDK_ROOT) to the Android SDK");
}

const byVersion = (a, b) => {
  const pa = a.split(/[.-]/).map(Number);
  const pb = b.split(/[.-]/).map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return Number.isNaN(d) ? 0 : d;
  }
  return 0;
};

// The newest build-tools version that holds the tool, for example aapt2.
export function newestBuildTool(sdk, tool) {
  const root = join(sdk, "build-tools");
  const versions = existsSync(root) ? readdirSync(root).sort(byVersion).reverse() : [];
  for (const version of versions) {
    const path = join(root, version, tool);
    if (existsSync(path)) return path;
  }
  throw new Error(`no ${tool} under ${shownPath(root)}; install build-tools with sdkmanager`);
}

export function platformTool(sdk, tool) {
  const path = join(sdk, "platform-tools", tool);
  if (!existsSync(path)) throw new Error(`no ${tool} under ${shownPath(join(sdk, "platform-tools"))}; install platform-tools with sdkmanager`);
  return path;
}
