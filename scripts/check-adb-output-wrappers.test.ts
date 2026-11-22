// @vitest-environment node
// T3-30 review follow-up: command strings and wrapper programs in a file that knows adb are findings.
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

describe("T3-30: shell forms that start adb", () => {
  it.each([
    ['import { execSync } from "node:child_process";\nexecSync("adb shell getprop");\n'],
    ['import { exec } from "node:child_process";\nexec("adb devices");\n'],
    ['import { spawnSync } from "node:child_process";\nspawnSync("sh", ["-c", adbPath + " shell ls"]);\n'],
    ['import { spawnSync } from "node:child_process";\nspawnSync("env", [adbPath, "devices"]);\n'],
    ['import * as cp from "node:child_process";\ncp.execSync("adb devices");\n'],
  ])("is a finding: %s", async (body) => {
    const lines = await findings(KNOWS + body);
    expect(lines.length, body).toBeGreaterThan(0);
  });

  it("a file that does not know adb may run a wrapper", async () => {
    expect(await findings('import { spawnSync } from "node:child_process";\nspawnSync("sh", ["-c", "true"]);\n')).toEqual([]);
  });
});
