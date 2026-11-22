// pnpm tv:wire (T3-05; docs/specs/T3-05.md, "The wire runner"): runs the tagged wire tests of
// apps/tv/src/e2e/wire/wire-tests.json in the e2e app on the emulator ANDROID_SERIAL names, against the local mock and
// the three pinned fixture servers, records every request the app makes through one recorder per (test, target) pair,
// and judges the record, the app's OCTAVE_WIRE lines and the run's whole logcat dump.
//
// It sets the emulator's global http_proxy to a listener of its own for the whole run (no request naming a wire target
// may reach it), clears it at its start and in a finally, and so runs only on the implementer's own emulator, never on
// a shared device. The serial is never printed. Importing this module runs nothing.
// Run: ANDROID_SERIAL=<your own emulator> node scripts/tv-wire.mjs [--task <id>] [--list]   (pnpm tv:wire)
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ANDROID_APPLICATION_ID } from "../packages/core/src/domain/app-identity.ts";
import { androidSdk, platformTool } from "./tv-android-sdk.mjs";
import { E2E_APK, buildTv, e2eApkIsCurrent } from "./tv-build.mjs";
import { judgeCapture, judgeLogcat, judgeRecords, judgeWire } from "./tv-wire-judge.mjs";
import { startMock } from "./tv-wire-mock.mjs";
import { proxyRequestsNamingTargets, serverAnswers, startProxyListener, startRecorder } from "./tv-wire-proxy.mjs";

const repo = fileURLToPath(new URL("..", import.meta.url));
const LIST = join(repo, "apps", "tv", "src", "e2e", "wire", "wire-tests.json");
const CREDENTIALS = join(repo, "tests", "integration", ".credentials");
const EVIDENCE = join(repo, "release-evidence", "wire");
const LEANBACK = "android.intent.category.LEANBACK_LAUNCHER";
const RUN_MS = 240_000;
const REAL_TARGETS = ["jellyfin-10-11", "jellyfin-12", "jellyscale"];

// What transport-probe-then-signed-in sends: the gateway's connect, login, userViews and logout.
export const PROBE_THEN_SIGNED_IN = ["GET /System/Info/Public", "POST /Users/AuthenticateByName", "GET /UserViews", "POST /Sessions/Logout"];

export function readWireList() {
  return JSON.parse(readFileSync(LIST, "utf8"));
}

// The list's entries for a task, or every entry without one.
export function selectTests({ task } = {}, list = readWireList()) {
  return list.tests.filter((entry) => task === undefined || entry.task === task);
}

// The task ids that have a wire test (T10-01 builds its check on this).
export function tasksWithWireTests(list = readWireList()) {
  return new Set(list.tests.map((entry) => entry.task));
}

// Every (test, target) pair in list order, with its device port.
export function pairsOf(list = readWireList()) {
  const pairs = [];
  for (const entry of list.tests) {
    for (const target of entry.targets) pairs.push({ test: entry.id, target, task: entry.task, devicePort: list.basePort + pairs.length });
  }
  return pairs;
}

function readCredentials() {
  if (!existsSync(CREDENTIALS)) return {};
  return Object.fromEntries(
    readFileSync(CREDENTIALS, "utf8")
      .split("\n")
      .filter((line) => line.includes("="))
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
  );
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fail(message) {
  console.error(`ERROR tv wire: ${message}`);
  process.exit(1);
}

function pnpm(script) {
  const run = spawnSync("pnpm", [script], { cwd: repo, stdio: ["ignore", "inherit", "inherit"] });
  if (run.status !== 0) fail(`pnpm ${script} failed`);
}

// Starts the fixture servers when a selected real target does not answer; both steps are safe to repeat.
async function ensureFixtures(targets) {
  const urls = { "jellyfin-10-11": "http://127.0.0.1:18096", "jellyfin-12": "http://127.0.0.1:18097", jellyscale: "http://127.0.0.1:18098" };
  const healthy = (await Promise.all(targets.map((target) => serverAnswers(urls[target])))).every(Boolean);
  if (!healthy) pnpm("fixture:up");
  const credentials = readCredentials();
  if (!healthy || targets.some((target) => credentials[`${target}_password`] === undefined)) pnpm("fixture:setup");
}

function parseArgs(args) {
  const options = { task: undefined, list: false };
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--list") options.list = true;
    else if (args[index] === "--task" && args[index + 1] !== undefined) options.task = args[++index];
    else fail(`unknown argument ${args[index]}; use [--task <id>] [--list]`);
  }
  return options;
}

const LOGCAT = /\d+\s+\d+\s+[VDIWEFA]\s+([^:]*?)\s*:\s?(.*)$/;

function wireLines(dump) {
  return dump.flatMap((line) => {
    const match = LOGCAT.exec(line);
    if (match === null || match[1] !== "ReactNativeJS") return [];
    const text = match[2].trim();
    return text.startsWith("OCTAVE_WIRE ") ? [text] : [];
  });
}

// The device's adb connection. Every `adb reverse` lives on it, so when the connection drops (adbd restarts or the
// host's transport reconnects) every reverse is gone and the app's calls to its pair ports fail as network errors:
// CI run 45002313854 failed so (timeout=network, cancelled=network, the private-LAN pair unreachable, no request reaching
// any recorder after the stall), and `adb reconnect device` mid-run reproduces those words locally. What dropped the
// connection on CI is unverified; its log shows the device "offline" and "not found" seconds before the run. So the
// runner starts only once adbd has run for ADBD_STEADY_S (a mitigation, not a proven fix), and treats a run whose adbd
// changed or whose reverses are gone at its end as void: it runs once more, never more.
export const ADBD_STEADY_S = 60;
const ADBD_WAIT_MS = 180_000;

// `ps -A -o PID,ELAPSED,NAME` output -> { pid, elapsed } for adbd (elapsed in seconds), or null. ELAPSED is
// [[dd-]hh:]mm:ss.
export function adbdOf(psOutput) {
  for (const line of psOutput.split("\n")) {
    const fields = line.trim().split(/\s+/);
    if (fields.length !== 3 || fields[2] !== "adbd" || !/^[0-9]+$/.test(fields[0])) continue;
    const match = /^(?:(?:([0-9]+)-)?([0-9]+):)?([0-9]+):([0-9]+)$/.exec(fields[1]);
    if (match === null) continue;
    const [days, hours, minutes, seconds] = match.slice(1).map((part) => Number(part ?? 0));
    return { pid: Number(fields[0]), elapsed: ((days * 24 + hours) * 60 + minutes) * 60 + seconds };
  }
  return null;
}

// `adb reverse --list` output and the device ports the runner reversed -> the ports no longer listed.
export function missingReverses(listOutput, devicePorts) {
  const listed = new Set();
  for (const line of listOutput.split("\n")) {
    const match = /^\S+\s+tcp:([0-9]+)\s/.exec(line.trim() + " ");
    if (match !== null) listed.add(Number(match[1]));
  }
  return devicePorts.filter((port) => !listed.has(port));
}

// The run-void errors from adbd before and after the run and the reverses missing at its end; empty when steady.
export function adbRestartErrors({ before, after, missing, reversed }) {
  const errors = [];
  if (before === null || after === null || before.pid !== after.pid || after.elapsed < before.elapsed) {
    errors.push("ERROR tv wire: the device's adb daemon restarted during the run, which drops every adb reverse; the run is void");
  }
  if (missing.length > 0) {
    errors.push(`ERROR tv wire: ${missing.length} of ${reversed} adb reverse(s) were gone at the end of the run (the adb connection dropped); the run is void`);
  }
  return errors;
}

// `dumpsys activity activities` output -> the package of the top resumed activity, or "unknown".
export function resumedPackage(dumpsys) {
  const match = /topResumedActivity=ActivityRecord\{\S+ \S+ ([A-Za-z0-9_.]+)\//.exec(dumpsys);
  return match === null ? "unknown" : match[1];
}

async function main(args) {
  const options = parseArgs(args);
  const list = readWireList();
  const selectedIds = new Set(selectTests({ task: options.task }, list).map((entry) => entry.id));
  const all = pairsOf(list);
  const selected = all.filter((pair) => selectedIds.has(pair.test));
  if (options.list) {
    for (const pair of selected) console.log(`${pair.test} ${pair.target} ${pair.task}`);
    return;
  }
  if (selected.length === 0) fail(`no wire test is tagged ${options.task}`);

  // The serial chooses the device; it is never printed or written.
  const serial = process.env.ANDROID_SERIAL;
  if (!serial) fail("set ANDROID_SERIAL to your own emulator's serial; this script never picks a device itself");
  let adbPath;
  try {
    adbPath = platformTool(androidSdk(), "adb");
  } catch (error) {
    fail(error.message);
  }
  const adb = (...rest) => spawnSync(adbPath, ["-s", serial, ...rest], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  const shell = (...rest) => adb("shell", ...rest);
  if (adb("get-state").stdout.trim() !== "device") fail("no device; ANDROID_SERIAL names no attached, booted device");
  // A run that was killed may have left the proxy set.
  shell("settings", "put", "global", "http_proxy", ":0");

  const realTargets = [...new Set(selected.map((pair) => pair.target).filter((target) => REAL_TARGETS.includes(target)))];
  if (realTargets.length > 0) await ensureFixtures(realTargets);
  const credentials = readCredentials();

  if (!e2eApkIsCurrent()) {
    console.log("tv wire: the e2e APK is missing or older than its sources; running pnpm tv:e2e:build");
    const errors = buildTv({ e2e: true });
    if (errors.length > 0) {
      for (const error of errors) console.error(error);
      process.exit(1);
    }
  }
  const install = adb("install", "-r", E2E_APK);
  if (install.status !== 0) fail("adb install of the e2e APK failed");

  const adbd = () => adbdOf(shell("ps", "-A", "-o", "PID,ELAPSED,NAME").stdout ?? "");
  const secrets = new Set([list.canary, list.password]);
  for (const target of REAL_TARGETS) if (credentials[`${target}_password`]) secrets.add(credentials[`${target}_password`]);

  // One whole run with its own mock, recorders, proxy listener and reverses.
  const attempt = async () => {
    let before = adbd();
    for (const deadline = Date.now() + ADBD_WAIT_MS; (before === null || before.elapsed < ADBD_STEADY_S) && Date.now() < deadline; before = adbd()) {
      await sleep(2_000);
    }
    if (before === null || before.elapsed < ADBD_STEADY_S) fail(`the device's adb daemon did not stay up for ${ADBD_STEADY_S} s within ${ADBD_WAIT_MS / 1000} s`);
    const mock = await startMock({ canary: list.canary, user: list.user, password: list.password, canaryDevicePort: list.canaryPort });
    const proxy = await startProxyListener();
    const recorders = new Map();
    const reversed = [];
    const reverse = (devicePort, hostPort) => {
      const done = adb("reverse", `tcp:${devicePort}`, `tcp:${hostPort}`);
      if (done.status !== 0) throw new Error(`adb reverse failed for device port ${devicePort}`);
      reversed.push(devicePort);
    };
    let dump = [];
    let after = null;
    let missing = [];
    let foreground = "unknown";
    try {
      for (const pair of selected) {
        let upstream;
        let swap;
        if (pair.target === "mock") {
          const port = pair.test === "transport-redirect" ? mock.ports.redirector : pair.test === "transport-private-lan-and-proxy" ? mock.ports.privateLan : mock.ports.main;
          upstream = { port };
        } else {
          const url = credentials[`${pair.target}_url`];
          if (!url) throw new Error(`no fixture credentials for ${pair.target}; run pnpm fixture:setup`);
          upstream = { port: Number(new URL(url).port) };
          swap = {
            from: { user: list.user, password: list.password },
            to: { user: credentials[`${pair.target}_username`], password: credentials[`${pair.target}_password`] },
          };
        }
        const recorder = await startRecorder({ upstream, secrets, swap });
        recorders.set(`${pair.test} ${pair.target}`, recorder);
        reverse(pair.devicePort, recorder.port);
      }
      reverse(list.canaryPort, mock.ports.canaryOrigin);
      reverse(list.proxyPort, proxy.port);
      shell("settings", "put", "global", "http_proxy", `127.0.0.1:${list.proxyPort}`);

      shell("am", "force-stop", ANDROID_APPLICATION_ID);
      shell("logcat", "-c");
      const resolved = shell("cmd", "package", "resolve-activity", "--brief", "-a", "android.intent.action.MAIN", "-c", LEANBACK, ANDROID_APPLICATION_ID);
      const component = resolved.stdout.trim().split("\n").pop()?.trim() ?? "";
      if (!component.startsWith(`${ANDROID_APPLICATION_ID}/`)) throw new Error("the leanback launcher category resolves to no activity of the app");
      shell("am", "start", "-a", "android.intent.action.MAIN", "-c", LEANBACK, "-n", component);
      const read = () => shell("logcat", "-d", "-v", "threadtime").stdout.split("\n");
      for (const deadline = Date.now() + RUN_MS; Date.now() < deadline; await sleep(1_000)) {
        if (wireLines(read()).includes("OCTAVE_WIRE done")) break;
      }
      // Let the app's last calls (a dropped stall runs on to its deadline) reach the recorders.
      await sleep(2_000);
      dump = read();
      after = adbd();
      missing = missingReverses(adb("reverse", "--list").stdout ?? "", reversed);
      foreground = resumedPackage(shell("dumpsys", "activity", "activities").stdout ?? "");
    } catch (error) {
      console.error(`ERROR tv wire: ${error.message}`);
      process.exitCode = 1;
    } finally {
      shell("settings", "put", "global", "http_proxy", ":0");
      shell("am", "force-stop", ANDROID_APPLICATION_ID);
      for (const port of reversed) adb("reverse", "--remove", `tcp:${port}`);
      await Promise.all([...recorders.values()].map((recorder) => recorder.close()));
      await proxy.close();
      await mock.close();
    }
    if (process.exitCode === 1) process.exit(1);
    const voids = adbRestartErrors({ before, after, missing, reversed: reversed.length });
    const device = [
      `adbd up ${before.elapsed} s before the reverses; ${after === null ? "adbd not found after the run" : after.pid === before.pid ? `same adbd after the run (up ${after.elapsed} s)` : "adbd restarted during the run"}`,
      `${reversed.length - missing.length} of ${reversed.length} adb reverse(s) present at the end of the run`,
      `resumed package at the end of the run: ${foreground}`,
    ];
    return { dump, mock, proxy, recorders, voids, device };
  };

  // A run whose adb connection dropped (its reverses gone) is void, not a transport result: it runs once more, and the
  // first attempt stays in device.txt and the output. Any other failure, and a second void run, fails as it is.
  // The void attempt's logcat and global-proxy traffic are still judged with the second's.
  const deviceLines = [];
  let run = await attempt();
  let earlier = { dump: [], seen: [], ports: [] };
  if (run.voids.length > 0) {
    for (const error of run.voids) console.error(error);
    console.error("tv wire: the adb connection dropped during the run; running it once more");
    deviceLines.push("attempt 1 (void):", ...run.device, "attempt 2:");
    earlier = { dump: run.dump, seen: run.proxy.seen, ports: [run.mock.ports.privateLan] };
    run = await attempt();
  }
  deviceLines.push(...run.device);
  const { dump, mock, proxy, recorders } = run;
  const seen = [...earlier.seen, ...proxy.seen];

  const lines = wireLines(dump);
  const counts = mock.counts();
  const pairs = selected.map((pair) => {
    const records = recorders.get(`${pair.test} ${pair.target}`).records;
    const counted = { test: pair.test, target: pair.target, task: pair.task, requests: records.length };
    if (pair.target === "mock") counted.canaryOrigin = counts.canaryOrigin;
    if (pair.test === "transport-redirect") counted.redirector = counts.redirector;
    if (pair.test === "transport-private-lan-and-proxy") counted.privateLan = counts.privateLan;
    return counted;
  });

  const known = [...secrets];
  const runErrors = [...run.voids, ...judgeLogcat([...earlier.dump, ...dump], known)];
  const devicePorts = [...all.map((pair) => pair.devicePort), list.canaryPort, list.closedPort, mock.ports.privateLan, ...earlier.ports];
  const named = proxyRequestsNamingTargets(seen, devicePorts);
  if (named.length > 0) runErrors.push(`ERROR tv wire: ${named.length} request(s) naming a wire target went to the global proxy`);
  if (!lines.includes("OCTAVE_WIRE done")) runErrors.push("ERROR tv wire: no OCTAVE_WIRE done line; the app's wire run did not finish");

  rmSync(EVIDENCE, { recursive: true, force: true });
  mkdirSync(EVIDENCE, { recursive: true });
  const summary = [];
  for (const [index, pair] of pairs.entries()) {
    const { devicePort } = selected[index];
    const records = recorders.get(`${pair.test} ${pair.target}`).records;
    const host = `127.0.0.1:${devicePort}`;
    const errors = [...judgeWire({ pairs: [pair], lines })];
    if (pair.test === "transport-probe-then-signed-in") errors.push(...judgeCapture(records, { expected: PROBE_THEN_SIGNED_IN, host, secrets: known }));
    // The redirect and canary tests ask for a 3xx on purpose; the app must refuse it (their own judges), not avoid it.
    else errors.push(...judgeRecords(records, { host, secrets: known, redirects: ["transport-redirect", "transport-canary"].includes(pair.test) }));
    writeFileSync(join(EVIDENCE, `${pair.test}-${pair.target}.jsonl`), records.map((record) => JSON.stringify(record)).join("\n") + "\n");
    const pass = errors.length === 0 && runErrors.length === 0;
    summary.push(`${pair.test} ${pair.target} ${pair.task} ${pass ? "pass" : "fail"}`);
    for (const error of errors) console.error(error);
  }
  for (const error of runErrors) console.error(error);
  writeFileSync(join(EVIDENCE, "summary.txt"), `${summary.join("\n")}\n`);
  writeFileSync(join(EVIDENCE, "app-lines.txt"), `${lines.join("\n")}\n`);
  writeFileSync(join(EVIDENCE, "device.txt"), `${deviceLines.join("\n")}\n`);
  const proxied = seen.map((entry) => `${entry.method} ${entry.host || "(no Host)"}`);
  writeFileSync(
    join(EVIDENCE, "global-proxy.txt"),
    [`${seen.length} request(s) reached the global proxy listener; ${named.length} named a wire target`, ...proxied].join("\n") + "\n",
  );
  console.log(summary.join("\n"));
  if (summary.some((line) => line.endsWith(" fail"))) process.exit(1);
  console.log(`tv wire: ${summary.length} pair(s) passed; logcat clean; global proxy saw ${seen.length} request(s), none naming a wire target`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
