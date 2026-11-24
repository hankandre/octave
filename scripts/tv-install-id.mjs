// T4-09's install-id stage, run last by pnpm tv:e2e (docs/specs/T4-09.md, "The device stage"). On a device that is
// positively an emulator it clears the app's data, relaunches it, backs it up to the local transport and restores it,
// and judges the OCTAVE_INSTALL lines the app writes (apps/tv/src/e2e/install-id-run.ts): a relaunch keeps the
// install id's mark, cleared data gives a new one, and a backup and restore does not bring the old one back. On any
// other device (a real TV, or one that cannot be told apart) the stage is skipped after reading two properties by name:
// no `pm clear`, no `bmgr`, no launch. In CI (GITHUB_ACTIONS) or with OCTAVE_INSTALL_ID_STAGE=required a skip fails.
//
// Every adb call goes through the runner openAdb returns (./tv-adb.mjs), which keeps the serial out of everything it
// returns; this file starts no program itself. No line it writes or prints holds a serial, an id or a DeviceId.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ANDROID_APPLICATION_ID } from "../packages/core/src/domain/app-identity.ts";
import { openAdb } from "./tv-adb.mjs";

const PREFIX = "OCTAVE_INSTALL ";
const LEANBACK = "android.intent.category.LEANBACK_LAUNCHER";
const LOCAL_TRANSPORT = "com.android.localtransport/.LocalTransport";
const LAUNCH_MS = 60_000;
const POLL_MS = 500;
const RESTORE_MS = 120_000;
const EVIDENCE_FILE = "e2e-install-id.txt";

export const INSTALL_ID_SKIP_LINE = "install-id stage: skipped, the device is not an emulator";
export const INSTALL_ID_NOT_RUN_LINE = "install-id stage: not run, the device was not recognised as an emulator and this run requires the stage";
export const INSTALL_ID_NOT_RUN_ERROR = "ERROR tv install id: the device was not recognised as an emulator, and this run requires the stage";
export const INSTALL_ID_SKIP_PRINT = "tv e2e: install-id stage skipped, the device is not an emulator";

// The properties that mark an emulator, each read with its own `getprop <name>`, and the value that marks it. Both read
// `1` on the android-tv API 36 emulator (the spec's milestone 1 record) and are not set on a production device.
export const EMULATOR_PROPERTIES = ["ro.boot.qemu", "ro.kernel.qemu"];
const EMULATOR_VALUE = "1";

// A logcat line in any column format: `... <pid> <tid> <priority> <tag>: <message>` (as scripts/tv-e2e.mjs).
const LOGCAT = /\d+\s+\d+\s+[VDIWEFA]\s+([^:]*?)\s*:\s?(.*)$/;
const ID_LINE = /^OCTAVE_INSTALL id shape=(\S+) stable=(\S+) mark=(\S+)$/;
const MARK = /^[0-9a-f]{16}$/;

// The message of each ReactNativeJS line that starts with `OCTAVE_INSTALL `, in order.
export function extractInstallIdLines(logcatLines) {
  return logcatLines.flatMap((line) => {
    const match = LOGCAT.exec(line);
    if (match === null) return [];
    const [, tag, message] = match;
    const text = message.trim();
    return tag === "ReactNativeJS" && text.startsWith(PREFIX) ? [text] : [];
  });
}

// One launch's lines: the mark when they hold exactly one start, one good id line and one done and no threw; else the
// reasons it does not.
function readLaunch(lines) {
  const problems = [];
  const count = (line) => lines.filter((each) => each === line).length;
  const ids = lines.filter((line) => line.startsWith(`${PREFIX}id `) || line === `${PREFIX}id`);
  if (count(`${PREFIX}start`) !== 1) problems.push(`${count(`${PREFIX}start`)} start lines; expected one`);
  if (count(`${PREFIX}done`) !== 1) problems.push(`${count(`${PREFIX}done`)} done lines; expected one`);
  if (count(`${PREFIX}threw`) > 0) problems.push("the app's install-id run threw");
  if (ids.length !== 1) problems.push(`${ids.length} id lines; expected one`);
  let mark;
  if (ids.length === 1) {
    const match = ID_LINE.exec(ids[0]);
    if (match === null) problems.push("the id line is not in the fixed form");
    else {
      const [, shape, stable, value] = match;
      if (shape !== "ok") problems.push(`shape=${shape}; the stored id is not a version 4 UUID`);
      if (stable !== "yes") problems.push(`stable=${stable}; the two gateways did not send the DeviceId the stored id derives`);
      if (!MARK.test(value)) problems.push("the mark is not 16 hex digits");
      else mark = value;
    }
  }
  return { mark: problems.length === 0 ? mark : undefined, problems };
}

const LAUNCHES = [
  ["fresh", "the first launch after pm clear"],
  ["relaunch", "the relaunch"],
  ["afterClear", "the launch after the second pm clear"],
  ["afterRestore", "the launch after the backup, pm clear and restore"],
];

// Returns `ERROR tv install id: <reason>` lines; empty only when each of the four launches is good, the relaunch keeps
// the fresh mark, the cleared launch has a new one, the restored launch one unlike both earlier ones, the local
// transport was selected, and the backup answered success or refused.
export function judgeInstallId({ fresh, relaunch, afterClear, afterRestore, transport, backup }) {
  const errors = [];
  const fail = (reason) => errors.push(`ERROR tv install id: ${reason}`);
  const launches = { fresh, relaunch, afterClear, afterRestore };
  const marks = {};
  for (const [key, what] of LAUNCHES) {
    const { mark, problems } = readLaunch(Array.isArray(launches[key]) ? launches[key] : []);
    for (const problem of problems) fail(`${what} (${key}): ${problem}`);
    marks[key] = mark;
  }
  if (marks.fresh !== undefined && marks.relaunch !== undefined && marks.relaunch !== marks.fresh) {
    fail("the relaunch's mark differs from the first launch's; the install id did not survive a relaunch");
  }
  if (marks.fresh !== undefined && marks.afterClear !== undefined && marks.afterClear === marks.fresh) {
    fail("the mark after pm clear equals the first launch's; clearing the app's data did not give a new install id");
  }
  if (marks.afterRestore !== undefined) {
    if (marks.fresh !== undefined && marks.afterRestore === marks.fresh) fail("the mark after the restore equals the first launch's; the restore brought an old install id back");
    if (marks.afterClear !== undefined && marks.afterRestore === marks.afterClear) fail("the mark after the restore equals the cleared launch's; the restore brought an old install id back");
  }
  if (transport !== "selected") fail(`transport=${transport || "missing"}; the local backup transport was not selected`);
  if (backup !== "success" && backup !== "refused") fail(`backup=${backup || "none"}; bmgr backupnow gave no result for the app`);
  return errors;
}

export function installIdResultLine({ relaunch, clear, restore, transport, backup }) {
  return `relaunch=${relaunch} clear=${clear} restore=${restore} transport=${transport} backup=${backup}`;
}

// The result line's words from the four launches' lines.
export function resultWords({ fresh, relaunch, afterClear, afterRestore, transport, backup }) {
  const mark = (lines) => readLaunch(lines).mark;
  const [a, b, c, d] = [mark(fresh), mark(relaunch), mark(afterClear), mark(afterRestore)];
  return {
    relaunch: a !== undefined && a === b ? "same" : "differs",
    clear: a !== undefined && c !== undefined && c !== a ? "new" : "same",
    restore: d !== undefined && d !== a && d !== c ? "new" : "same",
    transport: transport === "selected" ? "selected" : "missing",
    backup: backup === "success" || backup === "refused" ? backup : "none",
  };
}

// True only when a named property holds exactly the emulator's value (whitespace trimmed). An empty value, a missing
// property, a failed read (given as anything but a string) and any other value are all false.
export function isEmulator(properties) {
  if (properties === null || typeof properties !== "object") return false;
  return EMULATOR_PROPERTIES.some((name) => typeof properties[name] === "string" && properties[name].trim() === EMULATOR_VALUE);
}

// "run" on an emulator, whatever mustRun is; otherwise "fail" when the run requires the stage, else "skip".
export function stageDecision({ emulator, mustRun }) {
  if (emulator === true) return "run";
  return mustRun === true ? "fail" : "skip";
}

// Whether this run requires the stage: in CI (the runner sets GITHUB_ACTIONS for every step) or when asked.
export function stageRequired(env) {
  return env?.GITHUB_ACTIONS === "true" || env?.OCTAVE_INSTALL_ID_STAGE === "required";
}

const outputLines = (output) => (typeof output === "string" ? output.split(/\r?\n/).map((line) => line.trim()) : []);

// The `bmgr backupnow` answer for the application id alone: its own result line, read whole, so the run's closing
// "Backup finished with result: Success" and a line for another package count for nothing.
export function backupOutcome(output, applicationId) {
  const lines = outputLines(output);
  if (lines.includes(`Package ${applicationId} with result: Success`)) return "success";
  if (lines.includes(`Package ${applicationId} with result: Backup is not allowed`)) return "refused";
  return "none";
}

// "selected" only when `bmgr transport` answers that it selected the local transport.
export function transportSelected(output) {
  return outputLines(output).some((line) => line === `Selected transport ${LOCAL_TRANSPORT}` || line.startsWith(`Selected transport ${LOCAL_TRANSPORT} `))
    ? "selected"
    : "missing";
}

// The transport the selection replaced, from its `(formerly <transport>)`; undefined when it names none.
export function formerTransport(output) {
  const match = /\(formerly ([^\s()]+)\)/.exec(typeof output === "string" ? output : "");
  return match === null ? undefined : match[1];
}

// `bmgr enabled`: true, false, or undefined for an answer in another form.
export function backupEnabled(output) {
  const lines = outputLines(output);
  if (lines.includes("Backup Manager currently enabled")) return true;
  if (lines.includes("Backup Manager currently disabled")) return false;
  return undefined;
}

// The first restore set's token from `bmgr list sets` (`  1 : Local disk image`); undefined when there is none.
export function restoreToken(output) {
  for (const line of outputLines(output)) {
    const match = /^(\S+)\s*:\s*\S/.exec(line);
    if (match !== null) return match[1];
  }
  return undefined;
}

const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs the stage on the device `serial` names. Returns `{ outcome: "ran" | "skipped" | "failed", errors }` and writes
 * release-evidence/tv/e2e-install-id.txt. `open` defaults to `openAdb`, which refuses a serial given as a name; `scripts/tv-e2e.mjs` passes `openDeviceAdb`. `sleep`, `print` and `launchMs` are for tests.
 */
export async function runInstallIdStage({
  adbPath,
  serial,
  evidenceDir,
  env = process.env,
  open = openAdb,
  sleep = realSleep,
  print = (line) => console.log(line),
  launchMs = LAUNCH_MS,
}) {
  const runner = await open({ adbPath, serial });
  const shell = (args, options) => runner.run(["shell", ...args], options);
  const write = (lines) => {
    mkdirSync(evidenceDir, { recursive: true });
    writeFileSync(join(evidenceDir, EVIDENCE_FILE), `${lines.join("\n")}\n`);
  };

  // 1. Decide, from the named properties alone.
  const properties = {};
  for (const name of EMULATOR_PROPERTIES) {
    const read = shell(["getprop", name]);
    properties[name] = read.status === 0 ? read.stdout : undefined;
  }
  const decision = stageDecision({ emulator: isEmulator(properties), mustRun: stageRequired(env) });
  if (decision === "skip") {
    write([INSTALL_ID_SKIP_LINE]);
    print(INSTALL_ID_SKIP_PRINT);
    return { outcome: "skipped", errors: [] };
  }
  if (decision === "fail") {
    write([INSTALL_ID_NOT_RUN_LINE]);
    return { outcome: "failed", errors: [INSTALL_ID_NOT_RUN_ERROR] };
  }

  // 2. Remember the backup state before changing it; an answer in an unknown form changes nothing.
  const enabledBefore = backupEnabled(shell(["bmgr", "enabled"]).stdout);
  if (enabledBefore === undefined) {
    write(["install-id stage: not run, bmgr enabled answered in an unknown form"]);
    return { outcome: "failed", errors: ["ERROR tv install id: bmgr enabled answered in an unknown form; the backup state was not changed"] };
  }

  const launch = async () => {
    shell(["am", "force-stop", ANDROID_APPLICATION_ID]);
    shell(["logcat", "-c"]);
    const resolved = shell(["cmd", "package", "resolve-activity", "--brief", "-a", "android.intent.action.MAIN", "-c", LEANBACK, ANDROID_APPLICATION_ID]);
    const component = resolved.stdout.trim().split("\n").pop()?.trim() ?? "";
    if (!component.startsWith(`${ANDROID_APPLICATION_ID}/`)) return [];
    shell(["am", "start", "-a", "android.intent.action.MAIN", "-c", LEANBACK, "-n", component]);
    const read = () => extractInstallIdLines(shell(["logcat", "-d", "-v", "threadtime", "ReactNativeJS:I", "*:S"]).stdout.split("\n"));
    let lines = [];
    for (const deadline = Date.now() + launchMs; ; await sleep(POLL_MS)) {
      lines = read();
      if (lines.includes(`${PREFIX}done`) || Date.now() >= deadline) break;
    }
    shell(["am", "force-stop", ANDROID_APPLICATION_ID]);
    return lines;
  };

  const seen = { fresh: [], relaunch: [], afterClear: [], afterRestore: [], transport: "missing", backup: "none" };
  const errors = [];
  let former;
  try {
    // 3. A fresh launch, a relaunch, and a launch after cleared data.
    shell(["pm", "clear", ANDROID_APPLICATION_ID]);
    seen.fresh = await launch();
    seen.relaunch = await launch();
    shell(["pm", "clear", ANDROID_APPLICATION_ID]);
    seen.afterClear = await launch();

    // 4. A backup to the local transport, cleared data, a restore, and a launch.
    shell(["bmgr", "enable", "true"]);
    const selection = shell(["bmgr", "transport", LOCAL_TRANSPORT]).stdout;
    seen.transport = transportSelected(selection);
    former = formerTransport(selection);
    seen.backup = backupOutcome(shell(["bmgr", "backupnow", ANDROID_APPLICATION_ID], { timeoutMs: RESTORE_MS }).stdout, ANDROID_APPLICATION_ID);
    shell(["pm", "clear", ANDROID_APPLICATION_ID]);
    const token = restoreToken(shell(["bmgr", "list", "sets"]).stdout);
    if (token === undefined) errors.push("ERROR tv install id: bmgr list sets names no restore set, so nothing was restored");
    else shell(["bmgr", "restore", token, ANDROID_APPLICATION_ID], { timeoutMs: RESTORE_MS });
    seen.afterRestore = await launch();
  } finally {
    // 5. Put the transport and the enabled state back, and stop the app.
    if (former !== undefined && former !== LOCAL_TRANSPORT) {
      const back = shell(["bmgr", "transport", former]);
      if (/Unknown transport/.test(back.stdout + back.stderr)) {
        print("tv e2e: install-id stage could not select the earlier backup transport again; the device has no such transport");
      }
    }
    shell(["bmgr", "enable", String(enabledBefore)]);
    shell(["am", "force-stop", ANDROID_APPLICATION_ID]);
  }

  // 6. Judge and record. No mark, no serial.
  errors.push(...judgeInstallId(seen));
  const line = installIdResultLine(resultWords(seen));
  const summary = (key) => {
    const match = ID_LINE.exec(seen[key].find((each) => each.startsWith(`${PREFIX}id `)) ?? "");
    return `${key} ${match === null ? "no-id-line" : `shape=${match[1]} stable=${match[2]}`}`;
  };
  write([...LAUNCHES.map(([key]) => summary(key)), line]);
  print(`tv e2e: install-id ${line}`);
  return { outcome: errors.length === 0 ? "ran" : "failed", errors };
}
