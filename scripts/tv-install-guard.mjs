// The install guard (T3-21 item 4; docs/security.md, Development builds). Before any `adb install`, a script reads three
// facts from the device and the APK, and refuses a debuggable APK, or one signed with the debug certificate, on a device
// that is not positively an emulator. A device that cannot be read counts as not an emulator. The facts are read with
// the one adb runner of the calling script; the serial never reaches a line printed here.
import { androidSdk, newestBuildTool } from "./tv-android-sdk.mjs";
import { judgeCerts, readBadging, readCerts } from "./tv-apk-signing.mjs";
import { EMULATOR_PROPERTIES, isEmulator, stageDecision } from "./tv-install-id.mjs";

// The refusal line, or null when the install may go ahead. On an emulator nothing is refused.
export function installRefusal({ emulator, badging, certs }) {
  if (emulator === true) return null;
  if (/^application-debuggable\s*$/m.test(badging ?? "")) {
    return "ERROR tv install: the APK is debuggable, and a debuggable build is never installed on a device that is not an emulator (docs/security.md, Development builds)";
  }
  const problems = judgeCerts(certs ?? "");
  if (problems.length > 0) {
    return `ERROR tv install: the APK is refused on a device that is not an emulator: ${problems[0].replace(/^ERROR tv signing: /, "")}`;
  }
  return null;
}

// "run" on an emulator; otherwise "fail" when the run requires the stage, else "skip" (the debuggable probe's stages).
export function probeStageDecision({ emulator, mustRun }) {
  return stageDecision({ emulator, mustRun });
}

// The device and APK facts. `run(args)` runs one adb command (sync or async) and returns { status, stdout }. The APK is
// read only when the device is not an emulator; when either tool fails the certificates stay empty, which installRefusal
// refuses (no signer).
export async function readInstallFacts(run, apk, { env = process.env } = {}) {
  const properties = {};
  for (const name of EMULATOR_PROPERTIES) {
    const read = await run(["shell", "getprop", name]);
    properties[name] = read.status === 0 ? read.stdout : undefined;
  }
  const emulator = isEmulator(properties);
  if (emulator) return { emulator, badging: "", certs: "" };
  let badging = "";
  let certs = "";
  try {
    const sdk = androidSdk(env);
    badging = readBadging(newestBuildTool(sdk, "aapt2"), apk);
    certs = readCerts(newestBuildTool(sdk, "apksigner"), apk);
  } catch {
    certs = "";
  }
  return { emulator, badging, certs };
}
