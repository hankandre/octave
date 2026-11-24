// The first-focus smoke test (T3-01 item 4): install the release APK on the emulator ANDROID_SERIAL names, start it
// through the leanback launcher category, send no key until the first tile reports focus, then send exactly one Right
// and require the second tile to take focus. judgeFirstFocus() is the oracle; the transcript and a screenshot of the
// first screen go to release-evidence/tv/. The development server watch (T3-19 item 2) runs around the app start and
// fails the run on any connection from the app to the development server port; see scripts/tv-dev-server-watch.mjs.
// Run: ANDROID_SERIAL=<emulator> node scripts/tv-first-focus.mjs [apk]   (pnpm tv:smoke)
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ANDROID_APPLICATION_ID } from "../packages/core/src/domain/app-identity.ts";
import { openDeviceAdb } from "./tv-adb.mjs";
import { androidSdk, platformTool } from "./tv-android-sdk.mjs";
import { RELEASE_APK } from "./tv-apk-check.mjs";
import { installRefusal, readInstallFacts } from "./tv-install-guard.mjs";
import { judgeDevServerWatch, startDevServerWatch } from "./tv-dev-server-watch.mjs";
import { hideHostPaths, shownPath } from "./tv-host-paths.mjs";

const EVIDENCE = fileURLToPath(new URL("../release-evidence/tv/", import.meta.url));
const LEANBACK = "android.intent.category.LEANBACK_LAUNCHER";
const FIRST_FOCUS_MS = 30_000;
const AFTER_PRESS_MS = 5_000;
const SETTLE_MS = 1_500;

// A logcat line in any column format: `... <pid> <tid> <priority> <tag>: <message>`.
const LOGCAT = /\d+\s+\d+\s+[VDIWEFA]\s+([^:]*?)\s*:\s?(.*)$/;

function parse(line) {
  if (line.startsWith("OCTAVE_RESOLVE ")) return { kind: "resolve", value: line.slice("OCTAVE_RESOLVE ".length).trim() };
  const match = LOGCAT.exec(line);
  if (match === null) return { kind: "other" };
  const [, tag, message] = match;
  const focus = /^OCTAVE_FOCUS (tile-\d+)$/.exec(message.trim());
  if (tag === "ReactNativeJS" && focus !== null) return { kind: "focus", tile: focus[1] };
  if (tag === "OCTAVE_PRESS" && message.trim() === "1 RIGHT") return { kind: "press" };
  return { kind: "other" };
}

// Returns `ERROR tv focus: <reason>` lines; empty only when tile-0 held focus before the one press and tile-1 is the
// first focus after it.
export function judgeFirstFocus(lines) {
  const events = lines.map(parse);
  const errors = [];
  const fail = (reason) => errors.push(`ERROR tv focus: ${reason}`);

  const resolve = events.find((event) => event.kind === "resolve");
  if (resolve === undefined) fail("no OCTAVE_RESOLVE line; the launch was not resolved through the leanback category");
  else if (!resolve.value.startsWith(`${ANDROID_APPLICATION_ID}/`)) {
    fail(`the leanback launcher category resolves to "${resolve.value}", not an activity of ${ANDROID_APPLICATION_ID}`);
  }

  const presses = events.flatMap((event, index) => (event.kind === "press" ? [index] : []));
  const focuses = events.flatMap((event, index) => (event.kind === "focus" ? [{ index, tile: event.tile }] : []));
  if (presses.length === 0) {
    fail("no press marker; the smoke test sends exactly one press");
    if (focuses.length === 0) fail("no focus line arrived");
    return errors;
  }
  if (presses.length > 1) {
    fail(`${presses.length} presses; the oracle allows exactly one press`);
    return errors;
  }
  const [press] = presses;
  const before = focuses.filter((focus) => focus.index < press);
  const after = focuses.filter((focus) => focus.index > press);
  if (focuses.length === 0) {
    fail("no focus line arrived, before or after the press");
    return errors;
  }
  if (before.length === 0) {
    fail(`the first focus (${after[0].tile}) came only after the press: a priming press; tile-0 must hold focus before the press`);
    return errors;
  }
  const held = before[before.length - 1].tile;
  if (held !== "tile-0") fail(`${held} held focus before the press, not tile-0`);
  if (after.length === 0) fail("no focus line after the press; Right must move focus to tile-1");
  else if (after[0].tile !== "tile-1") fail(`the first focus after the press is ${after[0].tile}, not tile-1`);
  return errors;
}

function fail(message) {
  console.error(`ERROR tv focus: ${message}`);
  process.exit(1);
}

// A failure after the development server watch has started: thrown, so the watch is stopped before the script exits.
class SmokeFailure extends Error {}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The smoke run on one device, from install to the judges. Returns the error lines (empty on a pass). The development
 * server watch starts before the install and is stopped before this returns or throws (T3-19 item 2).
 */
export async function runSmoke({ serial, adbPath, apk, port = 8081, evidence = EVIDENCE, onWatch = () => undefined }) {
  // Everything adb returns has the serial replaced by `[device]` (T3-30), so nothing below can print or write it.
  const runner = await openDeviceAdb({ adbPath, serial });
  const adb = (...rest) => runner.run(rest);
  const shell = (...rest) => adb("shell", ...rest);

  const watch = await startDevServerWatch({ adb: adbPath, serial, port });
  onWatch(watch);
  try {
    const refusal = installRefusal(await readInstallFacts((args) => adb(...args), apk));
    if (refusal !== null) throw new SmokeFailure(refusal);
    const install = adb("install", "-r", apk);
    if (install.status !== 0) throw new SmokeFailure(`ERROR tv focus: adb install failed: ${(install.stdout + install.stderr).trim().split("\n").pop()}`);
    shell("am", "force-stop", ANDROID_APPLICATION_ID);
    shell("logcat", "-c");

    const resolved = shell("cmd", "package", "resolve-activity", "--brief", "-a", "android.intent.action.MAIN", "-c", LEANBACK, ANDROID_APPLICATION_ID);
    const component = resolved.stdout.trim().split("\n").pop()?.trim() ?? "";
    const resolveLine = `OCTAVE_RESOLVE ${component}`;
    // The controls run before the app starts, so no control can land late and be counted as the app's.
    const controlFailures = await watch.runControls();
    // Start the resolved component, as a launcher does: an implicit start would also need CATEGORY_DEFAULT, which a
    // launcher's intent filter does not carry (am start answers START_INTENT_NOT_RESOLVED).
    if (component.startsWith(`${ANDROID_APPLICATION_ID}/`)) {
      shell("am", "start", "-a", "android.intent.action.MAIN", "-c", LEANBACK, "-n", component);
    }

    const logcat = () => shell("logcat", "-d", "-v", "threadtime", "ReactNativeJS:I", "OCTAVE_PRESS:I", "*:S").stdout.split("\n").filter(Boolean);
    // Send no key until the first tile reports focus, or the wait runs out (the judge then names the failure).
    for (const deadline = Date.now() + FIRST_FOCUS_MS; Date.now() < deadline; await sleep(250)) {
      if (logcat().some((line) => parse(line).kind === "focus")) break;
    }
    mkdirSync(evidence, { recursive: true });
    // Let the launch transition finish so the screenshot shows the first screen alone.
    await sleep(SETTLE_MS);
    const screen = runner.bytes(["exec-out", "screencap", "-p"]);
    if (screen.status === 0) writeFileSync(join(evidence, "first-screen.png"), screen.stdout);

    shell("log", "-t", "OCTAVE_PRESS", "1 RIGHT");
    shell("input", "keyevent", "22");
    for (const deadline = Date.now() + AFTER_PRESS_MS; Date.now() < deadline; await sleep(250)) {
      const events = logcat().map(parse);
      const press = events.findIndex((event) => event.kind === "press");
      if (press !== -1 && events.slice(press + 1).some((event) => event.kind === "focus")) break;
    }
    const transcript = [resolveLine, ...logcat()];
    writeFileSync(join(evidence, "first-focus.txt"), `${transcript.join("\n")}\n`);
    // Read the watch only after the event loop has turned since the last spawnSync, so no app connection is still queued.
    await sleep(SETTLE_MS);
    const watched = watch.result();
    const watchErrors = judgeDevServerWatch(watched, controlFailures);
    writeFileSync(
      join(evidence, "dev-server-watch.txt"),
      `${[`port ${port}: ${watched.controlsSeen} of ${watched.controlsExpected} control connections seen, ${watched.appConnections} app connections, ${watch.strays()} connections before the controls (not counted)`, ...controlFailures, ...watchErrors].join("\n")}\n`,
    );
    const focusErrors = judgeFirstFocus(transcript);
    if (focusErrors.length > 0) console.error(transcript.join("\n"));
    return [...watchErrors, ...focusErrors];
  } catch (error) {
    if (error instanceof SmokeFailure) return [error.message];
    throw error;
  } finally {
    await watch.stop();
  }
}

/**
 * What the CLI does once it has the serial, the adb path and the APK: checks the device, runs the smoke test with a
 * signal handler that stops the watch, prints the result. Returns the exit code; only the signal handler exits the
 * process itself. `port` and `evidence` are arguments, not environment overrides, so a run cannot be pointed at the
 * wrong port and pass.
 */
export async function smokeCli({ serial, adbPath, apk, port = 8081, evidence = EVIDENCE }) {
  let runner;
  try {
    runner = await openDeviceAdb({ adbPath, serial });
  } catch (error) {
    console.error(`ERROR tv focus: ${hideHostPaths(error.message)}`);
    return 1;
  }
  const state = runner.run(["get-state"]);
  if (state.stdout.trim() !== "device") {
    console.error("ERROR tv focus: no device; ANDROID_SERIAL names no attached, booted device");
    return 1;
  }

  // A signal stops the watch (the reverse and the port) before the script exits.
  let watch = null;
  const onSignal = async (signal) => {
    if (watch) await watch.stop();
    process.exit(signal === "SIGINT" ? 130 : 143);
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  let errors;
  try {
    errors = await runSmoke({ serial, adbPath, apk, port, evidence, onWatch: (started) => (watch = started) });
  } catch (error) {
    errors = [`ERROR tv smoke: ${hideHostPaths(error.message)}`];
  }
  process.off("SIGINT", onSignal);
  process.off("SIGTERM", onSignal);
  if (errors.length > 0) {
    for (const error of errors) console.error(error);
    return 1;
  }
  console.log("tv focus: tile-0 took focus with no key, and one Right moved it to tile-1");
  console.log("tv smoke: the release app opened no connection to the development server port while it started");
  return 0;
}

async function main(args) {
  // The serial chooses the device; it is never printed or written.
  const serial = process.env.ANDROID_SERIAL;
  if (!serial) fail("set ANDROID_SERIAL to the emulator's serial; this script never picks a device itself");
  let adbPath;
  try {
    adbPath = platformTool(androidSdk(), "adb");
  } catch (error) {
    fail(error.message);
  }
  const apk = args[0] ?? RELEASE_APK;
  if (!existsSync(apk)) fail(`no APK at ${shownPath(apk)}; run pnpm tv:build first`);
  process.exitCode = await smokeCli({ serial, adbPath, apk });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
