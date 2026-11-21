// The first-focus smoke test (T3-01 item 4): install the release APK on the emulator ANDROID_SERIAL names, start it
// through the leanback launcher category, send no key until the first tile reports focus, then send exactly one Right
// and require the second tile to take focus. judgeFirstFocus() is the oracle; the transcript and a screenshot of the
// first screen go to release-evidence/tv/.
// Run: ANDROID_SERIAL=<emulator> node scripts/tv-first-focus.mjs [apk]   (pnpm tv:smoke)
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ANDROID_APPLICATION_ID } from "../packages/core/src/domain/app-identity.ts";
import { androidSdk, platformTool } from "./tv-android-sdk.mjs";
import { RELEASE_APK } from "./tv-apk-check.mjs";

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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function main(args) {
  // The serial chooses the device; it is never printed or written.
  const serial = process.env.ANDROID_SERIAL;
  if (!serial) fail("set ANDROID_SERIAL to the emulator's serial; this script never picks a device itself");
  let adbPath;
  try {
    adbPath = platformTool(androidSdk(), "adb");
  } catch (error) {
    fail(error.message);
  }
  const adb = (...rest) => spawnSync(adbPath, ["-s", serial, ...rest], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const shell = (...rest) => adb("shell", ...rest);

  const apk = args[0] ?? RELEASE_APK;
  if (!existsSync(apk)) fail(`no APK at ${apk}; run pnpm tv:build first`);
  if (adb("get-state").stdout.trim() !== "device") fail("no device; ANDROID_SERIAL names no attached, booted device");

  const install = adb("install", "-r", apk);
  if (install.status !== 0) fail(`adb install failed: ${(install.stdout + install.stderr).trim().split("\n").pop()}`);
  shell("am", "force-stop", ANDROID_APPLICATION_ID);
  shell("logcat", "-c");

  const resolved = shell("cmd", "package", "resolve-activity", "--brief", "-a", "android.intent.action.MAIN", "-c", LEANBACK, ANDROID_APPLICATION_ID);
  const component = resolved.stdout.trim().split("\n").pop()?.trim() ?? "";
  const resolveLine = `OCTAVE_RESOLVE ${component}`;
  // Start the resolved component, as a launcher does: an implicit start would also need CATEGORY_DEFAULT, which a
  // launcher's intent filter does not carry (am start answers START_INTENT_NOT_RESOLVED).
  if (component.startsWith(`${ANDROID_APPLICATION_ID}/`)) {
    shell("am", "start", "-a", "android.intent.action.MAIN", "-c", LEANBACK, "-n", component);
  }

  const logcat = () => shell("logcat", "-d", "-v", "threadtime", "ReactNativeJS:I", "OCTAVE_PRESS:I", "*:S").stdout.split("\n").filter(Boolean);
  const run = async () => {
    // Send no key until the first tile reports focus, or the wait runs out (the judge then names the failure).
    for (const deadline = Date.now() + FIRST_FOCUS_MS; Date.now() < deadline; await sleep(250)) {
      if (logcat().some((line) => parse(line).kind === "focus")) break;
    }
    mkdirSync(EVIDENCE, { recursive: true });
    // Let the launch transition finish so the screenshot shows the first screen alone.
    await sleep(SETTLE_MS);
    const screen = spawnSync(adbPath, ["-s", serial, "exec-out", "screencap", "-p"], { maxBuffer: 64 * 1024 * 1024 });
    if (screen.status === 0) writeFileSync(join(EVIDENCE, "first-screen.png"), screen.stdout);

    shell("log", "-t", "OCTAVE_PRESS", "1 RIGHT");
    shell("input", "keyevent", "22");
    for (const deadline = Date.now() + AFTER_PRESS_MS; Date.now() < deadline; await sleep(250)) {
      const events = logcat().map(parse);
      const press = events.findIndex((event) => event.kind === "press");
      if (press !== -1 && events.slice(press + 1).some((event) => event.kind === "focus")) break;
    }
    const transcript = [resolveLine, ...logcat()];
    writeFileSync(join(EVIDENCE, "first-focus.txt"), `${transcript.join("\n")}\n`);
    const errors = judgeFirstFocus(transcript);
    if (errors.length > 0) {
      console.error(transcript.join("\n"));
      for (const error of errors) console.error(error);
      process.exit(1);
    }
    console.log("tv focus: tile-0 took focus with no key, and one Right moved it to tile-1");
  };
  return run();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
