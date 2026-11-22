// @vitest-environment node
// T4-09 items 2 and 3 (docs/specs/T4-09.md, "The device stage" and "Test plan"): the host side of pnpm tv:e2e's
// install-id stage, scripts/tv-install-id.mjs, and what docs/security.md says about it.
//
// - extractInstallIdLines(logcatLines): the ReactNativeJS messages that start with `OCTAVE_INSTALL `, in order.
// - judgeInstallId({ fresh, relaunch, afterClear, afterRestore, transport, backup }): `ERROR tv install id: <reason>`
//   lines; empty only when each launch holds one start, one id line (shape=ok, stable=yes, a 16-hex mark) and one done
//   and no threw, the relaunch keeps the fresh mark, the cleared launch gets a new mark, the restored launch a mark unlike
//   both earlier ones, the local transport was selected and the backup answered success or refused.
// - INSTALL_ID_SKIP_LINE and installIdResultLine(...): the evidence file's fixed lines.
// - runInstallIdStage(...): called by scripts/tv-e2e.mjs; adb only through openAdb of ./tv-adb.mjs.
//
// No test here reads a device's output, a property name or the environment's effect on a device: those parsers and the
// emulator guard are tested in the implementer's scripts/tv-install-id-device.test.ts, written after milestone 1.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");

type Launch = string[];
type JudgeInput = {
  fresh: Launch;
  relaunch: Launch;
  afterClear: Launch;
  afterRestore: Launch;
  transport: string;
  backup: string;
};
type ResultWords = { relaunch: string; clear: string; restore: string; transport: string; backup: string };
type StageModule = {
  extractInstallIdLines: (logcatLines: string[]) => string[];
  judgeInstallId: (input: JudgeInput) => string[];
  INSTALL_ID_SKIP_LINE: string;
  installIdResultLine: (words: ResultWords) => string;
  runInstallIdStage: unknown;
};

async function loadStage(): Promise<StageModule> {
  return (await import(pathToFileURL(join(repo, "scripts", "tv-install-id.mjs")).href)) as StageModule;
}

const SKIP_LINE = "install-id stage: skipped, the device is not an emulator";
const MARK_A = "0123456789abcdef";
const MARK_B = "fedcba9876543210";
const MARK_C = "a1b2c3d4e5f60718";

const rn = (message: string, time = "10:00:01.000") => `11-22 ${time}  4321  4377 I ReactNativeJS: ${message}`;

function launch(mark: string, change: (lines: string[]) => string[] = (lines) => lines): Launch {
  return change(["OCTAVE_INSTALL start", `OCTAVE_INSTALL id shape=ok stable=yes mark=${mark}`, "OCTAVE_INSTALL done"]);
}

// The lines a launch's logcat yields, read the way the stage reads them.
async function read(lines: Launch): Promise<Launch> {
  const { extractInstallIdLines } = await loadStage();
  return extractInstallIdLines(["--------- beginning of main", ...lines.map((line) => rn(line))]);
}

async function good(overrides: Partial<JudgeInput> = {}): Promise<JudgeInput> {
  return {
    fresh: await read(launch(MARK_A)),
    relaunch: await read(launch(MARK_A)),
    afterClear: await read(launch(MARK_B)),
    afterRestore: await read(launch(MARK_C)),
    transport: "selected",
    backup: "refused",
    ...overrides,
  };
}

function expectFailure(errors: string[], reason?: RegExp): void {
  expect(errors.length).toBeGreaterThanOrEqual(1);
  for (const error of errors) expect(error).toMatch(/^ERROR tv install id: \S/);
  if (reason) expect(errors.join("\n")).toMatch(reason);
}

// Removes `//` and `/* */` comments, keeping string literals, so a comment may name what the code avoids.
function stripComments(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (c === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i += 1;
    } else if (c === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? source.length : end + 2;
    } else if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < source.length && source[j] !== c) j += source[j] === "\\" ? 2 : 1;
      out += source.slice(i, j + 1);
      i = j + 1;
    } else {
      out += c;
      i += 1;
    }
  }
  return out;
}

function readSource(path: string): string {
  expect(existsSync(join(repo, path)), `${path} exists`).toBe(true);
  return stripComments(readFileSync(join(repo, path), "utf8"));
}

// --- item 2: the lines, the judge's relaunch half and the fixed lines -------------------------------------------------

describe("T4-09 item 2: extractInstallIdLines", () => {
  it("T4-09 item 2: keeps the message of each ReactNativeJS line that starts with OCTAVE_INSTALL, in order", async () => {
    const { extractInstallIdLines } = await loadStage();
    const logcat = [
      "--------- beginning of main",
      rn('Running "main" with {"rootTag":11}', "10:00:00.500"),
      rn("OCTAVE_INSTALL start", "10:00:01.100"),
      rn("OCTAVE_E2E start conformance", "10:00:01.150"),
      rn(`OCTAVE_INSTALL id shape=ok stable=yes mark=${MARK_A}`, "10:00:01.200"),
      "11-22 10:00:01.250  6000  6000 I ActivityManager: OCTAVE_INSTALL done",
      rn("not OCTAVE_INSTALL done", "10:00:01.260"),
      rn("OCTAVE_INSTALL done", "10:00:01.300"),
    ];
    expect(extractInstallIdLines(logcat)).toEqual(launch(MARK_A));
  });

  it("T4-09 item 2: reads tag and message, not the columns (logcat -v epoch)", async () => {
    const { extractInstallIdLines } = await loadStage();
    const logcat = launch(MARK_A).map((line, i) => `     1795255201.${String(100 + i)}  4321  4377 I ReactNativeJS: ${line}`);
    expect(extractInstallIdLines(logcat)).toEqual(launch(MARK_A));
  });
});

describe("T4-09 item 2: judgeInstallId, the relaunch", () => {
  it("T4-09 item 2: passes four good launches whose relaunch keeps the fresh mark", async () => {
    const { judgeInstallId } = await loadStage();
    expect(judgeInstallId(await good())).toEqual([]);
  });

  it("T4-09 item 2: fails a relaunch whose mark differs from the fresh launch's", async () => {
    const { judgeInstallId } = await loadStage();
    expectFailure(judgeInstallId(await good({ relaunch: await read(launch(MARK_C)) })), /relaunch/i);
  });

  const broken: Array<[string, (lines: string[]) => string[]]> = [
    ["a missing done", (lines) => lines.filter((line) => line !== "OCTAVE_INSTALL done")],
    ["a missing start", (lines) => lines.filter((line) => line !== "OCTAVE_INSTALL start")],
    ["a missing id line", (lines) => lines.filter((line) => !line.startsWith("OCTAVE_INSTALL id "))],
    ["two id lines", (lines) => [lines[0], lines[1], lines[1], lines[2]]],
    ["two done lines", (lines) => [...lines, "OCTAVE_INSTALL done"]],
    ["stable=no", (lines) => lines.map((line) => line.replace("stable=yes", "stable=no"))],
    ["shape=bad", (lines) => lines.map((line) => line.replace("shape=ok", "shape=bad"))],
    ["a mark that is not 16 hex", (lines) => lines.map((line) => line.replace(/mark=\w+/, "mark=0123"))],
    ["a threw line in place of the id line", (lines) => [lines[0], "OCTAVE_INSTALL threw", lines[2]]],
    ["a threw line beside the id line", (lines) => [lines[0], lines[1], "OCTAVE_INSTALL threw", lines[2]]],
    ["no lines at all", () => []],
  ];

  for (const which of ["fresh", "relaunch", "afterClear", "afterRestore"] as const) {
    it.each(broken)(`T4-09 item 2: fails ${which} with %s`, async (_name, change) => {
      const { judgeInstallId } = await loadStage();
      const marks = { fresh: MARK_A, relaunch: MARK_A, afterClear: MARK_B, afterRestore: MARK_C };
      expectFailure(judgeInstallId(await good({ [which]: await read(launch(marks[which], change)) })));
    });
  }
});

describe("T4-09 item 2: the evidence file's fixed lines", () => {
  it("T4-09 item 2: installIdResultLine gives the fixed form for a passing run", async () => {
    const { installIdResultLine } = await loadStage();
    expect(installIdResultLine({ relaunch: "same", clear: "new", restore: "new", transport: "selected", backup: "refused" })).toBe(
      "relaunch=same clear=new restore=new transport=selected backup=refused",
    );
    expect(installIdResultLine({ relaunch: "same", clear: "new", restore: "new", transport: "selected", backup: "success" })).toBe(
      "relaunch=same clear=new restore=new transport=selected backup=success",
    );
  });

  it("T4-09 item 2: installIdResultLine gives the fixed form for a failing run", async () => {
    const { installIdResultLine } = await loadStage();
    expect(installIdResultLine({ relaunch: "differs", clear: "same", restore: "same", transport: "missing", backup: "none" })).toBe(
      "relaunch=differs clear=same restore=same transport=missing backup=none",
    );
  });

  it("T4-09 item 2: INSTALL_ID_SKIP_LINE is the one fixed skip line, with no mark, and is no result line", async () => {
    const { INSTALL_ID_SKIP_LINE, installIdResultLine } = await loadStage();
    expect(INSTALL_ID_SKIP_LINE).toBe(SKIP_LINE);
    expect(INSTALL_ID_SKIP_LINE).not.toMatch(/[0-9a-f]{16}/i);
    for (const relaunch of ["same", "differs"]) {
      for (const clear of ["new", "same"]) {
        for (const restore of ["new", "same"]) {
          for (const transport of ["selected", "missing"]) {
            for (const backup of ["success", "refused", "none"]) {
              const line = installIdResultLine({ relaunch, clear, restore, transport, backup });
              expect(line).not.toBe(INSTALL_ID_SKIP_LINE);
              expect(line).toMatch(/^relaunch=(same|differs) clear=(new|same) restore=(new|same) transport=(selected|missing) backup=(success|refused|none)$/);
            }
          }
        }
      }
    }
  });
});

describe("T4-09 item 2: pnpm tv:e2e runs the stage, and the stage takes adb only from openAdb", () => {
  it("T4-09 item 2: scripts/tv-install-id.mjs exports runInstallIdStage", async () => {
    const { runInstallIdStage } = await loadStage();
    expect(typeof runInstallIdStage).toBe("function");
  });

  it("T4-09 item 2: scripts/tv-e2e.mjs imports runInstallIdStage and calls it after the resolved-address probe", () => {
    const source = readSource("scripts/tv-e2e.mjs");
    expect(source).toMatch(/\bimport\s*\{[^}]*\brunInstallIdStage\b[^}]*\}\s*from\s*["']\.\/tv-install-id\.mjs["']/);
    const call = source.search(/\brunInstallIdStage\s*\(/);
    const probe = source.search(/\brunResolvedAddressProbe\s*\(/);
    expect(call, "runInstallIdStage is called").toBeGreaterThan(-1);
    expect(probe, "runResolvedAddressProbe is called").toBeGreaterThan(-1);
    expect(call).toBeGreaterThan(probe);
  });

  it("T4-09 item 2: scripts/tv-install-id.mjs imports openAdb from ./tv-adb.mjs and nothing from node:child_process", () => {
    const source = readSource("scripts/tv-install-id.mjs");
    expect(source).toMatch(/\bimport\s*\{[^}]*\bopenAdb\b[^}]*\}\s*from\s*["']\.\/tv-adb\.mjs["']/);
    expect(source).not.toMatch(/child_process/);
  });
});

// --- item 3: cleared data, the backup leg, the no-backup directory and the document -----------------------------------

describe("T4-09 item 3: judgeInstallId, the cleared and restored launches", () => {
  it("T4-09 item 3: fails when the mark after pm clear equals the fresh mark", async () => {
    const { judgeInstallId } = await loadStage();
    expectFailure(judgeInstallId(await good({ afterClear: await read(launch(MARK_A)) })), /clear/i);
  });

  it("T4-09 item 3: fails when the mark after backup, clear and restore equals the fresh mark", async () => {
    const { judgeInstallId } = await loadStage();
    expectFailure(judgeInstallId(await good({ afterRestore: await read(launch(MARK_A)) })), /restore/i);
  });

  it("T4-09 item 3: fails when the mark after backup, clear and restore equals the cleared launch's mark", async () => {
    const { judgeInstallId } = await loadStage();
    expectFailure(judgeInstallId(await good({ afterRestore: await read(launch(MARK_B)) })), /restore/i);
  });

  it.each(["missing", "", "selected-other"])("T4-09 item 3: fails when transport is %j, not selected", async (transport) => {
    const { judgeInstallId } = await loadStage();
    expectFailure(judgeInstallId(await good({ transport })), /transport/i);
  });

  it.each(["none", "", "ok"])("T4-09 item 3: fails when backup is %j", async (backup) => {
    const { judgeInstallId } = await loadStage();
    expectFailure(judgeInstallId(await good({ backup })), /backup/i);
  });

  it.each(["refused", "success"])("T4-09 item 3: passes with backup %s", async (backup) => {
    const { judgeInstallId } = await loadStage();
    expect(judgeInstallId(await good({ backup }))).toEqual([]);
  });
});

const MODULE_MAIN = "modules/install-id/android/src/main";
const MODULE_KT = `${MODULE_MAIN}/java/dev/octave/installid/OctaveInstallIdModule.kt`;
const OTHER_DIRECTORIES =
  /\b(?:filesDir|getFilesDir|cacheDir|getCacheDir|codeCacheDir|getCodeCacheDir|dataDir|getDataDir|externalFilesDir|getExternalFilesDir|externalCacheDir|getExternalCacheDir|externalMediaDirs|getExternalMediaDirs|obbDir|getObbDir|getDir|openFileOutput|openFileInput|getSharedPreferences|getDatabasePath|dataDirectory|Environment)\b/;

function kotlinFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? kotlinFiles(path) : entry.name.endsWith(".kt") ? [path] : [];
  });
}

describe("T4-09 item 3: the install id is stored in the no-backup directory and nowhere else", () => {
  it("T4-09 item 3: the directory pattern names other app directories and not noBackupFilesDir", () => {
    for (const other of ["context.filesDir", "context.cacheDir", "getExternalFilesDir(null)", "context.dataDir", "Environment.getDataDirectory()"]) {
      expect(OTHER_DIRECTORIES.test(other), other).toBe(true);
    }
    for (const allowed of ["context.noBackupFilesDir", "context.getNoBackupFilesDir()"]) expect(OTHER_DIRECTORIES.test(allowed), allowed).toBe(false);
  });

  it("T4-09 item 3: OctaveInstallIdModule.kt builds its InstallIdStore from noBackupFilesDir", () => {
    const source = readSource(MODULE_KT);
    expect(source).toMatch(/\bInstallIdStore\s*\([^)]*?\b(?:noBackupFilesDir|getNoBackupFilesDir)\b/);
  });

  it("T4-09 item 3: no Kotlin source of the module names another app directory", () => {
    expect(existsSync(join(repo, MODULE_MAIN)), `${MODULE_MAIN} exists`).toBe(true);
    const files = kotlinFiles(join(repo, MODULE_MAIN));
    expect(files.length).toBeGreaterThan(0);
    for (const path of files) expect(stripComments(readFileSync(path, "utf8")), path).not.toMatch(OTHER_DIRECTORIES);
  });
});

function sectionSix(): string {
  const lines = readFileSync(join(repo, "docs", "security.md"), "utf8").split("\n");
  const start = lines.findIndex((line) => /^## 6\.\s/.test(line));
  expect(start, "docs/security.md has a section 6").toBeGreaterThan(-1);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^## /.test(line));
  return [lines[start], ...(end === -1 ? rest : rest.slice(0, end))].join("\n");
}

// Sentences of the section, with Markdown emphasis and code marks removed.
function sentences(text: string): string[] {
  return text
    .replace(/[*`_]/g, "")
    .split(/(?<=\.)\s+|\n\s*\n|\n\s*[-|]/)
    .map((sentence) => sentence.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

describe("T4-09 item 3: docs/security.md section 6 states where the install id is and what was not run", () => {
  it("T4-09 item 3: section 6 names the install id's file and the no-backup directory", () => {
    const section = sectionSix();
    expect(section).toContain("octave-install-id");
    expect(section).toMatch(/getNoBackupFilesDir/);
  });

  it("T4-09 item 3: section 6 says no device-to-device transfer is run", () => {
    const section = sectionSix().replace(/[*`_]/g, "").replace(/\s+/g, " ");
    expect(section).toMatch(/no device-to-device transfer is run/i);
  });

  it("T4-09 item 3: section 6 says that, for a transfer, the exclusion rests on Android's documentation", () => {
    const found = sentences(sectionSix()).filter((sentence) => /transfer/i.test(sentence) && /rests on Android['’]s documentation/i.test(sentence));
    expect(found.length, "a sentence about a transfer that says the exclusion rests on Android's documentation").toBeGreaterThanOrEqual(1);
  });
});
