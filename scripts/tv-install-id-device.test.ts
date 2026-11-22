// @vitest-environment node
// T4-09, the implementer's tests of the install-id stage's device words (docs/specs/T4-09.md, "Test plan"), written
// after milestone 1 recorded them: the emulator guard, the skip-or-fail decision (the Product Owner ruling's condition
// 4), the bmgr parsers, and runInstallIdStage against a recording fake adb runner: the skip path touches nothing, CI
// fails a skip, an emulator runs whatever the environment, and the finally puts the backup state back.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  INSTALL_ID_NOT_RUN_ERROR,
  INSTALL_ID_NOT_RUN_LINE,
  INSTALL_ID_SKIP_LINE,
  backupEnabled,
  backupOutcome,
  formerTransport,
  isEmulator,
  restoreToken,
  runInstallIdStage,
  stageDecision,
  stageRequired,
  transportSelected,
} from "./tv-install-id.mjs";

const APP = "dev.octave.tv";
const SERIAL = "192.0.2.44:5555";
const LOCAL = "com.android.localtransport/.LocalTransport";
const PLAY = "com.google.android.gms/.backup.BackupTransportService";

// The words milestone 1 recorded on the android-tv API 36 emulator.
const RECORDED = {
  enabled: "Backup Manager currently disabled\n",
  selected: `Selected transport ${LOCAL} (formerly ${PLAY})\n`,
  refused: `Running incremental backup for 1 requested packages.\nPackage ${APP} with result: Backup is not allowed\nBackup finished with result: Success\n`,
  sets: "  1 : Local disk image\n",
  unknown: `Unknown transport '${PLAY}' specified; no changes made.\n`,
};

describe("T4-09 isEmulator: true only on the recorded emulator value", () => {
  it("is true when ro.boot.qemu or ro.kernel.qemu is exactly 1, whitespace trimmed", () => {
    expect(isEmulator({ "ro.boot.qemu": "1\n", "ro.kernel.qemu": "1\n" })).toBe(true);
    expect(isEmulator({ "ro.boot.qemu": "1" })).toBe(true);
    expect(isEmulator({ "ro.boot.qemu": "", "ro.kernel.qemu": " 1\r\n" })).toBe(true);
  });

  it.each([
    ["both empty (a real TV)", { "ro.boot.qemu": "\n", "ro.kernel.qemu": "\n" }],
    ["both absent", {}],
    ["0", { "ro.boot.qemu": "0", "ro.kernel.qemu": "0" }],
    ["another word", { "ro.boot.qemu": "yes", "ro.kernel.qemu": "true" }],
    ["a value that merely contains 1", { "ro.boot.qemu": "11", "ro.kernel.qemu": "1x" }],
    ["a failed read", { "ro.boot.qemu": undefined, "ro.kernel.qemu": undefined }],
    ["a number, not the read text", { "ro.boot.qemu": 1 }],
    ["another property holding 1", { "ro.build.characteristics": "1" }],
    ["null", null],
    ["undefined", undefined],
  ])("is false for %s", (_name, properties) => {
    expect(isEmulator(properties as Record<string, unknown>)).toBe(false);
  });
});

describe("T4-09 stageDecision: run on an emulator, else fail when required, else skip", () => {
  it.each([
    [true, true, "run"],
    [true, false, "run"],
    [false, true, "fail"],
    [false, false, "skip"],
  ])("emulator=%s mustRun=%s is %s", (emulator, mustRun, expected) => {
    expect(stageDecision({ emulator, mustRun })).toBe(expected);
  });

  it("stageRequired reads GITHUB_ACTIONS=true and OCTAVE_INSTALL_ID_STAGE=required only", () => {
    expect(stageRequired({ GITHUB_ACTIONS: "true" })).toBe(true);
    expect(stageRequired({ OCTAVE_INSTALL_ID_STAGE: "required" })).toBe(true);
    expect(stageRequired({})).toBe(false);
    expect(stageRequired({ GITHUB_ACTIONS: "false", OCTAVE_INSTALL_ID_STAGE: "yes" })).toBe(false);
  });
});

describe("T4-09 the bmgr parsers", () => {
  it("backupOutcome: the documented success line, the recorded refusal, another package, empty", () => {
    expect(backupOutcome(`Package ${APP} with result: Success\nBackup finished with result: Success\n`, APP)).toBe("success");
    expect(backupOutcome(RECORDED.refused, APP)).toBe("refused");
    expect(backupOutcome(`Package ${APP}.other with result: Success\nBackup finished with result: Success\n`, APP)).toBe("none");
    expect(backupOutcome(`Package com.example with result: Backup is not allowed\n`, APP)).toBe("none");
    expect(backupOutcome("Backup finished with result: Success\n", APP)).toBe("none");
    expect(backupOutcome("", APP)).toBe("none");
  });

  it("transportSelected: the recorded selection, an error line, another transport", () => {
    expect(transportSelected(RECORDED.selected)).toBe("selected");
    expect(transportSelected(`Selected transport ${LOCAL}\n`)).toBe("selected");
    expect(transportSelected(RECORDED.unknown)).toBe("missing");
    expect(transportSelected(`Selected transport ${PLAY}\n`)).toBe("missing");
    expect(transportSelected("")).toBe("missing");
  });

  it("formerTransport, backupEnabled and restoreToken read the recorded words", () => {
    expect(formerTransport(RECORDED.selected)).toBe(PLAY);
    expect(formerTransport(`Selected transport ${LOCAL}\n`)).toBeUndefined();
    expect(backupEnabled(RECORDED.enabled)).toBe(false);
    expect(backupEnabled("Backup Manager currently enabled\n")).toBe(true);
    expect(backupEnabled("something else")).toBeUndefined();
    expect(restoreToken(RECORDED.sets)).toBe("1");
    expect(restoreToken("")).toBeUndefined();
  });
});

// A fake emulator or TV: answers each adb call from its state and records it.
type Answer = { status: number; stdout: string; stderr: string };
function fakeDevice({ emulator, finishLaunches = true }: { emulator: boolean; finishLaunches?: boolean }) {
  const calls: string[][] = [];
  let id = 0;
  let nextId = 1;
  let enabled = false;
  let transport = PLAY;
  let launched = false;
  const mark = () => `a${id.toString(16).padStart(15, "0")}`;
  const answer = (stdout: string, status = 0): Answer => ({ status, stdout, stderr: "" });
  const run = (args: string[]): Answer => {
    calls.push(args);
    const [first, ...rest] = args;
    if (first !== "shell") return answer("", 1);
    const command = rest.join(" ");
    if (command.startsWith("getprop ")) return answer(emulator && (rest[1] === "ro.boot.qemu" || rest[1] === "ro.kernel.qemu") ? "1\n" : "\n");
    if (command === "bmgr enabled") return answer(`Backup Manager currently ${enabled ? "enabled" : "disabled"}\n`);
    if (command.startsWith("bmgr enable ")) {
      enabled = rest[2] === "true";
      return answer(`Backup Manager now ${enabled ? "enabled" : "disabled"}\n`);
    }
    if (command.startsWith("bmgr transport ")) {
      if (rest[2] !== LOCAL) return answer(`Unknown transport '${rest[2]}' specified; no changes made.\n`);
      const before = transport;
      transport = LOCAL;
      return answer(`Selected transport ${LOCAL} (formerly ${before})\n`);
    }
    if (command.startsWith("bmgr backupnow ")) return answer(RECORDED.refused);
    if (command === "bmgr list sets") return answer(RECORDED.sets);
    if (command.startsWith("bmgr restore ")) return answer("Scheduling restore: Local disk image\nrestoreStarting: 0 packages\nrestoreFinished: -1000\ndone\n");
    if (command.startsWith("pm clear ")) {
      id = 0;
      return answer("Success\n");
    }
    if (command.startsWith("cmd package resolve-activity")) return answer(`priority=0 preferredOrder=0\n${APP}/.MainActivity\n`);
    if (command.startsWith("am start")) {
      if (id === 0) id = nextId++;
      launched = true;
      return answer("Starting: Intent\n");
    }
    if (command.startsWith("am force-stop")) return answer("");
    if (command === "logcat -c") {
      launched = false;
      return answer("");
    }
    if (command.startsWith("logcat -d")) {
      if (!launched) return answer("");
      const lines = ["OCTAVE_INSTALL start", `OCTAVE_INSTALL id shape=ok stable=yes mark=${mark()}`, ...(finishLaunches ? ["OCTAVE_INSTALL done"] : [])];
      return answer(lines.map((line) => `11-22 10:00:01.000  4321  4377 I ReactNativeJS: ${line}`).join("\n"));
    }
    return answer("", 1);
  };
  const open = ({ serial }: { adbPath: string; serial: string }) => {
    expect(serial).toBe(SERIAL);
    return { run, runAsync: run, redact: (text: string) => text };
  };
  return { open, calls, state: () => ({ enabled, transport }) };
}

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function stage(device: ReturnType<typeof fakeDevice>, env: Record<string, string>, launchMs = 60_000) {
  const evidenceDir = mkdtempSync(join(tmpdir(), "octave-install-id-"));
  dirs.push(evidenceDir);
  const printed: string[] = [];
  const result = await runInstallIdStage({
    adbPath: "/fake/adb",
    serial: SERIAL,
    evidenceDir,
    env,
    open: device.open,
    sleep: async () => undefined,
    print: (line: string) => printed.push(line),
    launchMs,
  });
  const evidence = readFileSync(join(evidenceDir, "e2e-install-id.txt"), "utf8");
  return { result, printed, evidence };
}

const touches = /\b(pm|bmgr|am|logcat|cmd|install)\b/;

describe("T4-09 runInstallIdStage on a device that is not an emulator", () => {
  it("skips with no error, reads the two properties by name only, and writes the one skip line", async () => {
    const device = fakeDevice({ emulator: false });
    const { result, printed, evidence } = await stage(device, {});
    expect(result).toEqual({ outcome: "skipped", errors: [] });
    expect(device.calls).toEqual([
      ["shell", "getprop", "ro.boot.qemu"],
      ["shell", "getprop", "ro.kernel.qemu"],
    ]);
    for (const call of device.calls) expect(call.join(" ")).not.toMatch(touches);
    expect(evidence).toBe(`${INSTALL_ID_SKIP_LINE}\n`);
    expect(printed).toEqual(["tv e2e: install-id stage skipped, the device is not an emulator"]);
  });

  it.each([[{ GITHUB_ACTIONS: "true" }], [{ OCTAVE_INSTALL_ID_STAGE: "required" }]])("fails a skip when the run requires the stage (%j)", async (env) => {
    const device = fakeDevice({ emulator: false });
    const { result, evidence } = await stage(device, env);
    expect(result).toEqual({ outcome: "failed", errors: [INSTALL_ID_NOT_RUN_ERROR] });
    expect(device.calls).toEqual([
      ["shell", "getprop", "ro.boot.qemu"],
      ["shell", "getprop", "ro.kernel.qemu"],
    ]);
    expect(evidence).toBe(`${INSTALL_ID_NOT_RUN_LINE}\n`);
    expect(evidence).not.toContain(INSTALL_ID_SKIP_LINE);
    expect(evidence).not.toMatch(/relaunch=/);
  });
});

describe("T4-09 runInstallIdStage on an emulator", () => {
  it.each([[{}], [{ GITHUB_ACTIONS: "true" }]])("runs whatever the environment (%j) and records the ran-stage line", async (env) => {
    const device = fakeDevice({ emulator: true });
    const { result, printed, evidence } = await stage(device, env);
    expect(result).toEqual({ outcome: "ran", errors: [] });
    const commands = device.calls.map((call) => call.join(" "));
    expect(commands.filter((command) => command === `shell pm clear ${APP}`)).toHaveLength(3);
    expect(commands).toContain(`shell bmgr transport ${LOCAL}`);
    expect(commands).toContain(`shell bmgr backupnow ${APP}`);
    expect(commands).toContain(`shell bmgr restore 1 ${APP}`);
    expect(evidence.trim().split("\n")).toEqual([
      "fresh shape=ok stable=yes",
      "relaunch shape=ok stable=yes",
      "afterClear shape=ok stable=yes",
      "afterRestore shape=ok stable=yes",
      "relaunch=same clear=new restore=new transport=selected backup=refused",
    ]);
    expect(printed).toContain("tv e2e: install-id relaunch=same clear=new restore=new transport=selected backup=refused");
    // The finally tried the earlier transport, which the image does not have, and put the enabled state back.
    expect(commands).toContain(`shell bmgr transport ${PLAY}`);
    expect(printed.some((line) => /earlier backup transport/.test(line))).toBe(true);
    expect(device.state().enabled).toBe(false);
    expect(commands[commands.length - 1]).toBe(`shell am force-stop ${APP}`);
  });

  it("puts the backup state back and fails when a launch never finishes", async () => {
    const device = fakeDevice({ emulator: true, finishLaunches: false });
    const { result, evidence } = await stage(device, {}, 0);
    expect(result.outcome).toBe("failed");
    expect(result.errors.length).toBeGreaterThan(0);
    for (const error of result.errors) expect(error).toMatch(/^ERROR tv install id: /);
    expect(device.state().enabled).toBe(false);
    const commands = device.calls.map((call) => call.join(" "));
    expect(commands.lastIndexOf("shell bmgr enable false")).toBeGreaterThan(commands.lastIndexOf("shell bmgr enable true"));
    expect(evidence).toMatch(/relaunch=\S+ clear=\S+ restore=\S+ transport=selected backup=refused/);
  });

  it("changes nothing when bmgr enabled answers in an unknown form", async () => {
    const device = fakeDevice({ emulator: true });
    const run = device.open({ adbPath: "", serial: SERIAL }).run;
    const open = () => ({ run: (args: string[]) => (args.join(" ") === "shell bmgr enabled" ? { status: 0, stdout: "odd\n", stderr: "" } : run(args)) });
    const evidenceDir = mkdtempSync(join(tmpdir(), "octave-install-id-"));
    dirs.push(evidenceDir);
    const result = await runInstallIdStage({ adbPath: "", serial: SERIAL, evidenceDir, env: {}, open, sleep: async () => undefined, print: () => undefined });
    expect(result.outcome).toBe("failed");
    expect(device.calls.map((call) => call.join(" ")).filter((command) => touches.test(command) && !command.startsWith("shell getprop"))).toEqual([]);
  });
});

describe("T4-09 no printed or written line holds the serial", () => {
  it.each([
    ["a real TV", false, {}],
    ["a real TV in CI", false, { GITHUB_ACTIONS: "true" }],
    ["an emulator", true, {}],
  ])("%s", async (_name, emulator, env) => {
    const { printed, evidence, result } = await stage(fakeDevice({ emulator }), env as Record<string, string>);
    for (const text of [evidence, ...printed, ...result.errors]) {
      expect(text).not.toContain(SERIAL);
      expect(text).not.toContain("192.0.2.44");
    }
  });
});
