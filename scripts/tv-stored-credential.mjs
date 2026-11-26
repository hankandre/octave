// T4-05's device proof (docs/specs/T4-05.md, "The device proof"), run by pnpm tv:e2e after the resolved-address probe,
// on an emulator only: install the module's probe APK, run CleartextProbe with -e check stored-credential-save, then in
// a second instrumentation run (a new process) with -e check stored-credential-restore, and judge both reports with
// judgeStoredCredential(). The check uses the store's own factory over the real Android Keystore and the probe's
// no-backup directory; it sends nothing. Its reports hold fixed words and counts only.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openDeviceAdb } from "./tv-adb.mjs";
import { installRefusal, readInstallFacts } from "./tv-install-guard.mjs";
import { PROBE_COMPONENT, PROBE_PACKAGE, asStatus, lastLine, parseInstrumentation } from "./tv-cleartext.mjs";

export const SAVE_REPORT_KEYS = ["key-before", "saved", "record-dir", "key-origin", "key-size", "key-auth", "key-algorithm", "selftest", "files-read", "unreadable", "canary", "done"];
export const RESTORE_REPORT_KEYS = [
  "listed",
  "result-canary",
  "selftest",
  "files-read",
  "unreadable",
  "canary",
  "key-deleted",
  "listed-after-key-deleted",
  "record-after-key-deleted",
  "done",
];
const PROBE_MS = 90_000;

const SAVE_EXPECTED = {
  "key-before": "absent",
  saved: "yes",
  "record-dir": "no-backup",
  "key-origin": "generated",
  "key-size": "256",
  "key-auth": "none",
  "key-algorithm": "AES",
  selftest: "ok",
  unreadable: "0",
  canary: "absent",
  done: "yes",
};

const RESTORE_EXPECTED = {
  listed: "1",
  "result-canary": "absent",
  selftest: "ok",
  unreadable: "0",
  canary: "absent",
  "key-deleted": "yes",
  "listed-after-key-deleted": "0",
  "record-after-key-deleted": "gone",
  done: "yes",
};

const WHY = {
  "key-before": "the key could not be removed before the save, so its generation is not shown",
  saved: "the record was not stored",
  "record-dir": "the record must live under the no-backup directory",
  "key-origin": "the key must be generated inside the Keystore",
  "key-size": "the key must be 256 bits",
  "key-auth": "the key must need no user authentication",
  "key-algorithm": "the key must be AES",
  selftest: "the file scan did not find a planted canary",
  unreadable: "every file of the data directory must be read",
  canary: "a file of the data directory holds the canary token",
  listed: "the stored account must be listed once by a new process",
  "result-canary": "the restore result holds the canary token",
  "key-deleted": "the key could not be deleted",
  "listed-after-key-deleted": "a record whose key is gone must not be listed",
  "record-after-key-deleted": "a record whose key is gone must be deleted",
  done: "the check did not finish",
};

const isCount = (value) => typeof value === "string" && /^\d+$/.test(value);

// Returns `ERROR tv e2e: stored-credential ...` lines; empty only when both runs finished with every expected answer
// and each read at least one file.
export function judgeStoredCredential(save, restore) {
  const errors = [];
  const check = (phase, report, keys, expected) => {
    for (const key of keys) {
      const value = report[key];
      if (value === undefined) {
        errors.push(`ERROR tv e2e: stored-credential ${phase}: the report has no ${key}`);
        continue;
      }
      if (key === "files-read") {
        if (!isCount(value) || Number(value) < 1) errors.push(`ERROR tv e2e: stored-credential ${phase}: files-read=${value}; the scan must read the data directory`);
        continue;
      }
      if (value !== expected[key]) errors.push(`ERROR tv e2e: stored-credential ${phase}: ${key}=${value}; ${WHY[key]}`);
    }
  };
  check("save", save, SAVE_REPORT_KEYS, SAVE_EXPECTED);
  check("restore", restore, RESTORE_REPORT_KEYS, RESTORE_EXPECTED);
  return errors;
}

// Installs the probe, runs the save and then the restore on the device `serial` names, judges them, and writes
// release-evidence/tv/e2e-stored-credential.txt. Returns { errors, save, restore }. The probe package is removed
// whatever happens, and its data, key and record with it.
export async function runStoredCredentialProbe({ adbPath, serial, apk, evidenceDir }) {
  // Its output holds no serial (T3-30).
  const runner = await openDeviceAdb({ adbPath, serial });
  const adb = (args, timeoutMs = 60_000) => runner.runAsync(args, { timeoutMs });
  const errors = [];
  let save = {};
  let restore = {};
  const instrument = async (check) => {
    const run = await adb(["shell", "am", "instrument", "-w", "-e", "check", check, PROBE_COMPONENT], PROBE_MS);
    if (run.killed) errors.push(`ERROR tv e2e: stored-credential ${check} did not finish within ${PROBE_MS / 1000} s`);
    return parseInstrumentation(run.stdout);
  };
  try {
    const refusal = installRefusal(await readInstallFacts(async (args) => asStatus(await adb(args)), apk));
    if (refusal !== null) errors.push(refusal);
    const install = refusal === null ? await adb(["install", "-r", "-t", apk]) : undefined;
    if (install !== undefined && install.code !== 0) errors.push(`ERROR tv e2e: stored-credential probe install failed: ${lastLine(install)}`);
    if (install?.code === 0) {
      save = await instrument("stored-credential-save");
      restore = await instrument("stored-credential-restore");
    }
  } finally {
    await adb(["uninstall", PROBE_PACKAGE]);
  }

  mkdirSync(evidenceDir, { recursive: true });
  const lines = [
    ...SAVE_REPORT_KEYS.filter((key) => save[key] !== undefined).map((key) => `save ${key}=${save[key]}`),
    ...RESTORE_REPORT_KEYS.filter((key) => restore[key] !== undefined).map((key) => `restore ${key}=${restore[key]}`),
  ];
  writeFileSync(join(evidenceDir, "e2e-stored-credential.txt"), `${lines.join("\n")}\n`);
  errors.push(...judgeStoredCredential(save, restore));
  return { errors, save, restore };
}
