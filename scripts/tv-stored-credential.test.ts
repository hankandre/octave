// @vitest-environment node
// T4-05, "The device proof": the stored-credential stage's judge passes only two finished reports with every expected
// answer, and its runner installs the probe after the install guard, runs the save and then the restore as two
// instrumentation runs, uninstalls the probe and writes its evidence file. Through a fake adb; no device.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ANDROID_APPLICATION_ID } from "../packages/core/src/domain/app-identity";
import { parseInstrumentation } from "./tv-cleartext.mjs";
import { RESTORE_REPORT_KEYS, SAVE_REPORT_KEYS, judgeStoredCredential, runStoredCredentialProbe } from "./tv-stored-credential.mjs";
import { writeFakeSmokeAdb } from "./fixtures/tv/fake-smoke-adb";

const SAVE: Record<string, string> = {
  "key-before": "absent",
  saved: "yes",
  "record-dir": "no-backup",
  "key-origin": "generated",
  "key-size": "256",
  "key-auth": "none",
  "key-algorithm": "AES",
  selftest: "ok",
  "files-read": "4",
  unreadable: "0",
  canary: "absent",
  done: "yes",
};

const RESTORE: Record<string, string> = {
  listed: "1",
  "result-canary": "absent",
  selftest: "ok",
  "files-read": "4",
  unreadable: "0",
  canary: "absent",
  "key-deleted": "yes",
  "listed-after-key-deleted": "0",
  "record-after-key-deleted": "gone",
  done: "yes",
};

const output = (report: Record<string, string>, code = -1) =>
  [...Object.entries(report).map(([key, value]) => `INSTRUMENTATION_RESULT: ${key}=${value}`), `INSTRUMENTATION_CODE: ${code}`].join("\r\n");

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("T4-05: the stored-credential judge", () => {
  it("passes two complete, expected reports", () => {
    expect(judgeStoredCredential(parseInstrumentation(output(SAVE)), parseInstrumentation(output(RESTORE)))).toEqual([]);
    expect(Object.keys(SAVE).sort()).toEqual([...SAVE_REPORT_KEYS].sort());
    expect(Object.keys(RESTORE).sort()).toEqual([...RESTORE_REPORT_KEYS].sort());
  });

  it.each([
    ["save", "record-dir", "elsewhere"],
    ["save", "key-origin", "other-2"],
    ["save", "key-auth", "required"],
    ["save", "canary", "found-1"],
    ["save", "selftest", "missed"],
    ["save", "files-read", "0"],
    ["restore", "listed", "0"],
    ["restore", "result-canary", "found"],
    ["restore", "record-after-key-deleted", "kept"],
    ["restore", "listed-after-key-deleted", "1"],
  ])("fails %s %s=%s", (phase, key, value) => {
    const save = phase === "save" ? { ...SAVE, [key]: value } : SAVE;
    const restore = phase === "restore" ? { ...RESTORE, [key]: value } : RESTORE;
    const errors = judgeStoredCredential(save, restore);
    expect(errors.join("\n")).toContain(`stored-credential ${phase}`);
    expect(errors.join("\n")).toContain(key);
  });

  it("fails a run that did not finish, and one with a missing key", () => {
    expect(judgeStoredCredential(parseInstrumentation(output(SAVE, 0)), RESTORE).join("\n")).toMatch(/save: the report has no done/);
    const { canary: _dropped, ...partial } = RESTORE;
    expect(judgeStoredCredential(SAVE, partial).join("\n")).toMatch(/restore: the report has no canary/);
  });
});

describe("T4-05: the stored-credential runner", () => {
  it("guards, installs, runs save then restore, uninstalls and writes its evidence", async () => {
    const fake = writeFakeSmokeAdb({ serial: "emulator-5554", port: 1, appId: ANDROID_APPLICATION_ID, emulator: true, control: "connect", instrument: output({ ...SAVE, ...RESTORE }) });
    const evidenceDir = mkdtempSync(join(tmpdir(), "octave-stored-credential-"));
    dirs.push(fake.dir, evidenceDir);

    const result = await runStoredCredentialProbe({ adbPath: fake.adb, serial: "emulator-5554", apk: join(fake.dir, "p.apk"), evidenceDir });

    const calls = readFileSync(fake.log, "utf8").trim().split("\n").map((line) => (JSON.parse(line) as string[]).join(" "));
    const install = calls.findIndex((call) => / install -r -t /.test(` ${call} `));
    const save = calls.findIndex((call) => call.includes("-e check stored-credential-save"));
    const restore = calls.findIndex((call) => call.includes("-e check stored-credential-restore"));
    const uninstall = calls.findIndex((call) => call.includes("uninstall dev.octave.session.test"));
    expect(install).toBeGreaterThan(-1);
    expect(save).toBeGreaterThan(install);
    expect(restore).toBeGreaterThan(save);
    expect(uninstall).toBeGreaterThan(restore);
    expect(result.errors).toEqual([]);
    const evidence = readFileSync(join(evidenceDir, "e2e-stored-credential.txt"), "utf8");
    expect(evidence).toContain("save record-dir=no-backup");
    expect(evidence).toContain("restore listed=1");
  }, 60_000);
});
