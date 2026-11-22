// @vitest-environment node
// T3-30 review follow-up: a `shell` option or a command line as the program name, in a file that knows adb, is a finding.
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
type Check = { adbOutputFindings(files: { path: string; source: string }[]): string[] };
const findings = async (source: string) => {
  const { adbOutputFindings } = (await import(pathToFileURL(join(repo, "scripts", "check-adb-output.mjs")).href)) as Check;
  return adbOutputFindings([{ path: "scripts/x.mjs", source }]).filter((line) => line.includes("scripts/x.mjs"));
};
const KNOWS = "const adbPath = process.env.ADB_PATH;\n";
const IMPORT = 'import { spawn, spawnSync } from "node:child_process";\n';

describe("T3-30: a shell option that starts adb", () => {
  it.each([
    ['spawnSync("adb devices", { shell: true });\n'],
    ['spawn("adb shell ls", { shell: true });\n'],
    ['spawnSync("git", ["status"], { stdio: "pipe", shell: "/bin/sh" });\n'],
    ["const shell = true;\nspawnSync(`git`, [], { shell });\n"],
    ['spawnSync("git status && adb devices");\n'],
  ])("is a finding: %s", async (body) => {
    const lines = await findings(KNOWS + IMPORT + body);
    expect(lines.length, body).toBeGreaterThan(0);
  });

  it("a literal program with no shell option is not a finding, and neither is a shell option in a file that does not know adb", async () => {
    expect(await findings(`${KNOWS}${IMPORT}spawnSync("git", ["status"], { stdio: "pipe" });\n`)).toEqual([]);
    expect(await findings(`${IMPORT}spawnSync("git status", { shell: true });\n`)).toEqual([]);
  });
});
