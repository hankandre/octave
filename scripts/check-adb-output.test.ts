// @vitest-environment node
// T3-30 item 2 (docs/specs/T3-30.md, "The check"): a source check that fails any script that starts adb itself, or in a
// form it cannot read, so a new place that passes adb's output on without the redaction is caught by `pnpm check`.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");

type SourceFile = { path: string; source: string };
type CheckModule = { adbOutputFindings(files: SourceFile[]): string[] };

async function load(): Promise<CheckModule> {
  return (await import(pathToFileURL(join(repo, "scripts", "check-adb-output.mjs")).href)) as CheckModule;
}

// Every JavaScript and TypeScript file of the scripts and the integration tests, but no test file, type declaration or
// fixture: tests and fixtures start fake adbs on purpose.
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "fixtures" || entry.name === "node_modules" ? [] : walk(full);
    if (!/\.(mjs|js|cjs|ts)$/.test(entry.name) || /\.d\.(mts|ts|cts)$/.test(entry.name) || /\.test\.(ts|mjs)$/.test(entry.name)) return [];
    return [full];
  });
}

const realFiles = (): SourceFile[] =>
  [...walk(join(repo, "scripts")), ...walk(join(repo, "tests", "integration"))].map((full) => ({
    path: relative(repo, full).split(sep).join("/"),
    source: readFileSync(full, "utf8"),
  }));

// The findings of one synthetic file, among the findings of the whole set that the synthetic file is part of.
async function findingsFor(path: string, source: string): Promise<string[]> {
  const { adbOutputFindings } = await load();
  return adbOutputFindings([{ path, source }]).filter((line) => line.includes(path));
}

const KNOWS_ADB = 'const adbPath = process.env.ADB_PATH;\n';

describe("T3-30 item 2: the real tree", () => {
  it("T3-30 item 2: no script starts adb itself, and the scan read at least today's number of files", async () => {
    const { adbOutputFindings } = await load();
    const files = realFiles();
    expect(files.length).toBeGreaterThanOrEqual(61);
    expect(files.some((file) => file.path === "scripts/tv-first-focus.mjs")).toBe(true);
    expect(files.some((file) => file.path.startsWith("tests/integration/"))).toBe(true);
    expect(adbOutputFindings(files)).toEqual([]);
  });

  it("T3-30 item 2: scripts/tv-adb.mjs exports openAdb and each caller imports it", () => {
    const adb = readFileSync(join(repo, "scripts", "tv-adb.mjs"), "utf8");
    expect(adb).toMatch(/export\s+(function|const)\s+openAdb\b|export\s*\{[^}]*\bopenAdb\b/);
    for (const name of ["tv-first-focus", "tv-dev-server-watch", "tv-e2e", "tv-cleartext", "tv-resolved-address", "tv-wire"]) {
      const source = readFileSync(join(repo, "scripts", `${name}.mjs`), "utf8");
      expect(source, `${name}.mjs imports ./tv-adb.mjs`).toMatch(/from\s+["']\.\/tv-adb\.mjs["']/);
    }
  });

  it("T3-30 item 2: a caller that does not import openAdb is a finding", async () => {
    const { adbOutputFindings } = await load();
    const findings = adbOutputFindings([
      { path: "scripts/tv-adb.mjs", source: "export function openAdb() {}\n" },
      { path: "scripts/tv-first-focus.mjs", source: "export {};\n" },
    ]);
    expect(findings.some((line) => line.startsWith("ERROR adb output: scripts/tv-first-focus.mjs"))).toBe(true);
  });
});

describe("T3-30 item 2: synthetic sources", () => {
  const finding = async (path: string, source: string) => {
    const lines = await findingsFor(path, source);
    expect(lines.length, source).toBeGreaterThan(0);
    for (const line of lines) expect(line.startsWith(`ERROR adb output: ${path}: `), line).toBe(true);
  };
  const clean = async (path: string, source: string) => expect(await findingsFor(path, source), source).toEqual([]);

  it("T3-30 item 2: spawnSync, execFile and a platformTool path in a file that knows adb are findings", async () => {
    await finding("scripts/new-a.mjs", `import { spawnSync } from "node:child_process";\n${KNOWS_ADB}spawnSync(adbPath, ["-s", serial, "shell"]);\n`);
    await finding("scripts/new-b.mjs", `import { execFile } from "node:child_process";\nconst adb = "x";\nexecFile(adb, ["devices"], () => {});\n`);
    await finding(
      "scripts/new-c.mjs",
      `import { spawn } from "node:child_process";\nimport { platformTool } from "./tv-android-sdk.mjs";\nconst tool = platformTool(sdk, name);\nspawn(tool, []);\n`,
    );
  });

  it("T3-30 item 2: a literal adb program is a finding, bare or as a platform-tools path", async () => {
    await finding("scripts/new-d.mjs", `import { spawn } from "node:child_process";\nspawn("adb", ["devices"]);\n`);
    await finding("scripts/new-e.mjs", `import { spawn } from "node:child_process";\nspawn("/sdk/platform-tools/adb", ["devices"]);\n`);
  });

  it("T3-30 item 2: a new place outside scripts/*.mjs is scanned too (integration tests, .ts, .cjs, .js)", async () => {
    const source = `import { spawnSync } from "node:child_process";\n${KNOWS_ADB}spawnSync(adbPath, []);\n`;
    await finding("tests/integration/new-adb.mjs", source);
    await finding("scripts/new-f.ts", source);
    await finding("scripts/new-g.cjs", source);
    await finding("scripts/new-h.js", source);
  });

  it("T3-30 item 2: a namespace, default, renamed, bare, require or dynamic load of child_process in a file that knows adb is a finding", async () => {
    await finding("scripts/new-i.mjs", `import * as cp from "node:child_process";\n${KNOWS_ADB}cp.spawnSync(adbPath, []);\n`);
    await finding("scripts/new-j.mjs", `import cp from "node:child_process";\n${KNOWS_ADB}cp.spawnSync(adbPath, []);\n`);
    await finding("scripts/new-k.mjs", `import { spawn as run } from "node:child_process";\n${KNOWS_ADB}run(adbPath, []);\n`);
    await finding("scripts/new-l.mjs", `const cp = require("node:child_process");\n${KNOWS_ADB}cp.spawnSync(adbPath, []);\n`);
    await finding("scripts/new-m.mjs", `${KNOWS_ADB}const cp = await import("node:child_process");\ncp.spawnSync(adbPath, []);\n`);
    await finding("scripts/new-n.mjs", `import * as cp from "child_process";\n${KNOWS_ADB}cp.spawnSync(adbPath, []);\n`);
    await finding("scripts/new-o.mjs", `import { spawnSync } from "child_process";\n${KNOWS_ADB}spawnSync(adbPath, []);\n`);
  });

  it("T3-30 item 2: a program held in a variable is a finding in an unpinned file that does not know adb, and passes in a pinned one", async () => {
    await finding("scripts/new-helper.mjs", `import { spawnSync } from "node:child_process";\nspawnSync(tool, ["--version"]);\n`);
    for (const pinned of ["tv-apk-check", "tv-apk-manifest", "tv-apk-inspector", "tv-apk-dex", "check-red"]) {
      await clean(`scripts/${pinned}.mjs`, `import { spawnSync } from "node:child_process";\nspawnSync(aapt2, ["dump"]);\n`);
    }
  });

  it("T3-30 item 2: a literal, process.execPath and a call split over lines pass, in a file that knows adb or not", async () => {
    await clean("scripts/new-p.mjs", `import { spawnSync } from "node:child_process";\nspawnSync("pnpm", ["install"]);\n`);
    await clean("scripts/new-q.mjs", `import { spawnSync } from "node:child_process";\nconst child = spawnSync(\n  process.execPath,\n  ["script.mjs"],\n  { encoding: "utf8" },\n);\n`);
    await clean("scripts/new-r.mjs", `import { spawnSync } from "node:child_process";\n${KNOWS_ADB}spawnSync("pnpm", ["build"]);\nspawnSync(\n  process.execPath,\n  [],\n);\n`);
  });

  it("T3-30 item 2: scripts/tv-adb.mjs itself may start adb", async () => {
    const { adbOutputFindings } = await load();
    const lines = adbOutputFindings([{ path: "scripts/tv-adb.mjs", source: `import { spawnSync, spawn } from "node:child_process";\nexport function openAdb({ adbPath }) { spawnSync(adbPath, []); spawn(adbPath, []); }\n` }]);
    expect(lines.filter((line) => line.includes("scripts/tv-adb.mjs: ") && /spawn|child_process|program/i.test(line))).toEqual([]);
  });

  it("T3-30 item 2: a call that is only in a comment is no finding", async () => {
    await clean("scripts/new-s.mjs", `// spawnSync(adbPath, ["devices"]);\n/* execFile(adb, []) and import * as cp from "node:child_process" */\n${KNOWS_ADB}`);
  });

  it("T3-30 item 2: a word that merely contains the letters adb does not make a file know adb", async () => {
    await clean("scripts/new-t.mjs", `import * as cp from "node:child_process";\nconst readBackup = 1;\ncp.spawnSync("git", []);\n`);
  });
});
