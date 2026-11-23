// The TV app's device test (T3-02): install the e2e APK on the emulator ANDROID_SERIAL names, start it through the
// leanback launcher category, read the OCTAVE_E2E lines its root writes (the core's URL and DeviceId conformance
// suites and the host checks, under Hermes) and judge them. judgeConformance() is the oracle; the lines go to
// release-evidence/tv/e2e-conformance.txt. The e2e APK is built first when it is missing or older than its sources.
// Before installing, the e2e APK's network security is judged (T3-15 item 1); after the conformance run, the module's
// cleartext probe runs (T3-15 item 2, scripts/tv-cleartext.mjs), then the probe's resolved-address check (T3-20,
// scripts/tv-resolved-address.mjs), then the install-id stage (T4-09, scripts/tv-install-id.mjs), which runs only on a
// device that is positively an emulator and is skipped, with a recorded line, on any other. The two probe stages (the debuggable probe) run on an emulator only, and are skipped, with a recorded line, on any other device (T3-21). An explicit [apk] needs its probe APK too: the second
// argument, or the one pnpm tv:e2e:build wrote; the probe is never skipped. After the network security judgement and
// before any adb command, the dex, inspector and native inspector checks run on the e2e APK with the R8 mapping of its
// build (the third argument, or the one pnpm tv:e2e:build kept beside the APK; scripts/tv-e2e-apk.mjs, T3-31); one
// failing check stops the run before the install.
// Run: ANDROID_SERIAL=<emulator> node scripts/tv-e2e.mjs [apk [probe-apk [mapping]]]   (pnpm tv:e2e)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ANDROID_APPLICATION_ID } from "../packages/core/src/domain/app-identity.ts";
import { openAdb } from "./tv-adb.mjs";
import { androidSdk, newestBuildTool, platformTool } from "./tv-android-sdk.mjs";
import { checkApkAllowlist } from "./tv-apk-allowlist.mjs";
import { judgeNetworkSecurity, readNetworkSecurity } from "./tv-apk-check.mjs";
import { judgeCerts, readCerts } from "./tv-apk-signing.mjs";
import { E2E_APK, E2E_MAPPING, PROBE_APK, buildTv, e2eApkIsCurrent } from "./tv-build.mjs";
import { checkE2eApk } from "./tv-e2e-apk.mjs";
import { expectedPublicCount, runCleartextProbe } from "./tv-cleartext.mjs";
import { installRefusal, probeStageDecision, readInstallFacts } from "./tv-install-guard.mjs";
import { runInstallIdStage, stageRequired } from "./tv-install-id.mjs";
import { runResolvedAddressProbe } from "./tv-resolved-address.mjs";

const FIXTURES = fileURLToPath(new URL("../packages/core/tests/fixtures/", import.meta.url));
const EVIDENCE = fileURLToPath(new URL("../release-evidence/tv/", import.meta.url));
const LEANBACK = "android.intent.category.LEANBACK_LAUNCHER";
const RUN_MS = 60_000;
const PREFIX = "OCTAVE_E2E ";
const PROBE_SKIP_LINE = "probe stage: skipped, the device is not an emulator";
const PROBE_NOT_RUN_LINE = "probe stage: not run, the device was not recognised as an emulator and this run requires the stage";

// A logcat line in any column format: `... <pid> <tid> <priority> <tag>: <message>` (as scripts/tv-first-focus.mjs).
const LOGCAT = /\d+\s+\d+\s+[VDIWEFA]\s+([^:]*?)\s*:\s?(.*)$/;

// The message of each ReactNativeJS line that starts with `OCTAVE_E2E `, in order.
export function extractE2eLines(logcatLines) {
  return logcatLines.flatMap((line) => {
    const match = LOGCAT.exec(line);
    if (match === null) return [];
    const [, tag, message] = match;
    const text = message.trim();
    return tag === "ReactNativeJS" && text.startsWith(PREFIX) ? [text] : [];
  });
}

// The vector counts a full run must report, read from the shared files.
export function expectedCounts() {
  const read = (name) => JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));
  const hosts = read("host-classes.json");
  const hls = read("hls-master-urls.json");
  return { url: hosts.vectors.length + hls.vectors.length + hls.refusals.length, deviceId: read("device-ids.json").vectors.length };
}

const fields = (text) => Object.fromEntries([...text.matchAll(/(\S+?)=(\S+)/g)].map(([, key, value]) => [key, value]));

// Returns `ERROR tv e2e: <reason>` lines; empty only for exactly one finished run with Expo's URL under Hermes, every
// URL and DeviceId vector passing at the expected counts, good random ids and a working Clock.
export function judgeConformance(lines, expected) {
  const errors = [];
  const fail = (reason) => errors.push(`ERROR tv e2e: ${reason}`);
  const messages = lines.filter((line) => line.startsWith(PREFIX)).map((line) => line.slice(PREFIX.length).trim());
  const withHead = (head) => messages.filter((message) => message === head || message.startsWith(`${head} `));

  const starts = messages.filter((message) => message === "start conformance").length;
  const dones = messages.filter((message) => message === "done").length;
  if (starts === 0) fail("no start line; the run never began");
  if (dones === 0) fail("no done line; the run did not finish");
  if (starts > 1 || dones > 1) fail(`more than one run in the transcript (${starts} start lines, ${dones} done lines)`);

  for (const message of messages) {
    const threw = /^(\S+) threw$/.exec(message);
    if (threw !== null) fail(`the ${threw[1]} section threw`);
  }

  const hosts = withHead("host");
  if (hosts.length === 0) fail("no host line; the URL implementation and the engine are unknown");
  else if (hosts.length > 1) fail(`${hosts.length} host lines; expected one`);
  else {
    const host = fields(hosts[0]);
    if (host.url !== "expo-builtin") fail(`the URL under test is not Expo's built-in URL (url=${host.url ?? "missing"})`);
    if (host.engine !== "hermes") fail(`the run was not under Hermes (engine=${host.engine ?? "missing"})`);
  }

  const counted = (head, total, what) => {
    const failures = withHead(`${head}-fail`);
    if (failures.length > 0) fail(`${failures.length} ${head}-fail line(s)`);
    const summaries = withHead(head).filter((message) => message !== `${head} threw`);
    if (summaries.length === 0) {
      if (!messages.includes(`${head} threw`)) fail(`no ${head} line`);
      return;
    }
    if (summaries.length > 1) fail(`${summaries.length} ${head} lines; expected one`);
    const summary = fields(summaries[0]);
    const reported = Number(summary.total);
    const passed = Number(summary.passed);
    if (!Number.isInteger(reported) || !Number.isInteger(passed)) fail(`the ${head} line has no total or passed count`);
    else {
      if (reported !== total) fail(`${head} total=${reported}, but ${what} hold ${total} vectors`);
      if (passed !== reported) fail(`${head} passed=${passed} of total=${reported}`);
    }
  };
  counted("url", expected.url, "the two shared URL files");
  counted("device-id", expected.deviceId, "device-ids.json");

  const crypto = withHead("crypto").filter((message) => message !== "crypto threw");
  if (crypto.length === 0) {
    if (!messages.includes("crypto threw")) fail("no crypto line; random ids were not checked");
  } else if (crypto.length > 1 || crypto[0] !== "crypto random-id=ok") fail(`crypto: ${crypto.join(" | ")}; random-id must be ok`);

  const clock = withHead("clock").filter((message) => message !== "clock threw");
  if (clock.length === 0) {
    if (!messages.includes("clock threw")) fail("no clock line; the Clock was not checked");
  } else {
    const parts = fields(clock[0]);
    const bad = ["now", "after", "every"].filter((part) => parts[part] !== "ok");
    if (clock.length > 1 || bad.length > 0) fail(`clock: ${bad.map((part) => `${part}=${parts[part] ?? "missing"}`).join(" ") || "more than one line"}; every part must be ok`);
  }
  return errors;
}

function fail(message) {
  console.error(`ERROR tv e2e: ${message}`);
  process.exit(1);
}

// The mapping the dex and inspector checks read: the third argument, or the e2e build's own. Never the release mapping.
export function e2eMappingPath(args) {
  return args[2] ?? E2E_MAPPING;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main(args) {
  // The serial chooses the device; it is never printed or written.
  const serial = process.env.ANDROID_SERIAL;
  if (!serial) fail("set ANDROID_SERIAL to the emulator's serial; this script never picks a device itself");
  let adbPath;
  let aapt2;
  try {
    adbPath = platformTool(androidSdk(), "adb");
    aapt2 = newestBuildTool(androidSdk(), "aapt2");
  } catch (error) {
    fail(error.message);
  }
  // Everything adb returns has the serial replaced by `[device]` (T3-30).
  const runner = openAdb({ adbPath, serial });
  const adb = (...rest) => runner.run(rest);
  const shell = (...rest) => adb("shell", ...rest);

  let apk = args[0];
  const probeApk = args[1] ?? PROBE_APK;
  const mapping = e2eMappingPath(args);
  if (apk === undefined) {
    apk = E2E_APK;
    if (!e2eApkIsCurrent()) {
      console.log("tv e2e: the e2e APK is missing or older than its sources; running pnpm tv:e2e:build");
      const errors = buildTv({ e2e: true });
      if (errors.length > 0) {
        for (const error of errors) console.error(error);
        process.exit(1);
      }
    }
  }
  if (!existsSync(apk)) fail(`no APK at ${apk}; run pnpm tv:e2e:build first`);
  if (!existsSync(probeApk)) fail(`no cleartext probe APK at ${probeApk}; pass it after the APK or run pnpm tv:e2e:build`);
  if (!existsSync(mapping)) fail(`no R8 mapping at ${mapping}; pass it after the probe APK or run pnpm tv:e2e:build`);
  let network;
  try {
    network = judgeNetworkSecurity(readNetworkSecurity(aapt2, apk));
  } catch (error) {
    network = [`ERROR tv apk: ${error.message}`];
  }
  if (network.length > 0) {
    for (const error of network) console.error(error);
    fail("the e2e APK does not carry the network security configuration");
  }
  const apkErrors = await checkE2eApk({ apk, mapping });
  if (apkErrors.length > 0) {
    for (const error of apkErrors) console.error(error);
    process.exit(1);
  }
  // T3-33: the e2e APK holds no development-server allowlist. Outside E2E_APK_CHECKS, after they pass, before any adb.
  let allowlist;
  try {
    allowlist = checkApkAllowlist(apk);
  } catch (error) {
    allowlist = [`ERROR tv allowlist: ${error.message}`];
  }
  if (allowlist.length > 0) {
    for (const error of allowlist) console.error(error);
    fail("the e2e APK holds the development-server allowlist canary");
  }
  // T3-21: the e2e APK is signed, and not with the template's debug certificate. Outside E2E_APK_CHECKS, before any adb.
  let signing;
  try {
    signing = judgeCerts(readCerts(newestBuildTool(androidSdk(), "apksigner"), apk));
  } catch (error) {
    signing = [`ERROR tv signing: ${error.message}`];
  }
  if (signing.length > 0) {
    for (const error of signing) console.error(error);
    fail("the e2e APK is not signed with a private key");
  }
  if (adb("get-state").stdout.trim() !== "device") fail("no device; ANDROID_SERIAL names no attached, booted device");

  const facts = await readInstallFacts((rest) => adb(...rest), apk);
  const refusal = installRefusal(facts);
  if (refusal !== null) {
    console.error(refusal);
    process.exit(1);
  }
  const install = adb("install", "-r", apk);
  if (install.status !== 0) fail(`adb install failed: ${(install.stdout + install.stderr).trim().split("\n").pop()}`);
  shell("am", "force-stop", ANDROID_APPLICATION_ID);
  shell("logcat", "-c");

  const resolved = shell("cmd", "package", "resolve-activity", "--brief", "-a", "android.intent.action.MAIN", "-c", LEANBACK, ANDROID_APPLICATION_ID);
  const component = resolved.stdout.trim().split("\n").pop()?.trim() ?? "";
  if (!component.startsWith(`${ANDROID_APPLICATION_ID}/`)) fail(`the leanback launcher category resolves to "${component}", not an activity of ${ANDROID_APPLICATION_ID}`);
  shell("am", "start", "-a", "android.intent.action.MAIN", "-c", LEANBACK, "-n", component);

  const read = () => extractE2eLines(shell("logcat", "-d", "-v", "threadtime", "ReactNativeJS:I", "*:S").stdout.split("\n"));
  let lines = [];
  for (const deadline = Date.now() + RUN_MS; Date.now() < deadline; await sleep(500)) {
    lines = read();
    if (lines.includes(`${PREFIX}done`)) break;
  }
  lines = read();
  shell("am", "force-stop", ANDROID_APPLICATION_ID);
  mkdirSync(EVIDENCE, { recursive: true });
  writeFileSync(join(EVIDENCE, "e2e-conformance.txt"), `${lines.join("\n")}\n`);

  const expected = expectedCounts();
  const errors = judgeConformance(lines, expected);
  if (errors.length > 0) {
    console.error(lines.join("\n"));
    for (const error of errors) console.error(error);
    process.exit(1);
  }
  console.log(`tv e2e: url ${expected.url}/${expected.url}, device-id ${expected.deviceId}/${expected.deviceId}, host ok`);

  // The two probe stages install a debuggable APK, so they run on an emulator only (T3-21 item 4).
  const probeStages = probeStageDecision({ emulator: facts.emulator, mustRun: stageRequired(process.env) });
  if (probeStages === "fail") {
    mkdirSync(EVIDENCE, { recursive: true });
    for (const name of ["e2e-cleartext.txt", "e2e-resolved-address.txt"]) writeFileSync(join(EVIDENCE, name), `${PROBE_NOT_RUN_LINE}\n`);
    console.error("ERROR tv e2e: the device is not an emulator, and this run requires the cleartext and resolved-address probe stages");
    process.exit(1);
  }
  if (probeStages === "skip") {
    mkdirSync(EVIDENCE, { recursive: true });
    for (const name of ["e2e-cleartext.txt", "e2e-resolved-address.txt"]) writeFileSync(join(EVIDENCE, name), `${PROBE_SKIP_LINE}\n`);
    console.log("tv e2e: cleartext and resolved-address probe stages skipped, the device is not an emulator");
  } else {
    const probe = await runCleartextProbe({ adbPath, serial, apk: probeApk, evidenceDir: EVIDENCE });
    if (probe.errors.length > 0) {
      for (const error of probe.errors) console.error(error);
      process.exit(1);
    }
    const publicTotal = expectedPublicCount();
    console.log(`tv e2e: cleartext private-lan ok, loopback ok, public ${probe.report["public-refused"]}/${publicTotal} refused`);

    const resolvedProbe = await runResolvedAddressProbe({ adbPath, serial, apk: probeApk, evidenceDir: EVIDENCE });
    if (resolvedProbe.errors.length > 0) {
      for (const error of resolvedProbe.errors) console.error(error);
      process.exit(1);
    }
    console.log("tv e2e: resolved-address private ok, mixed ok, public refused");
  }

  // Last: it clears the app's data and switches the backup transport on an emulator; it prints its own outcome.
  const installId = await runInstallIdStage({ adbPath, serial, evidenceDir: EVIDENCE });
  if (installId.errors.length > 0) {
    for (const error of installId.errors) console.error(error);
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
