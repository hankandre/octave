// @vitest-environment node
// T3-30 item 2, further cases (docs/specs/T3-30.md, "The check"): an imported function used as a value, and a file that
// does not know adb.
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
type Check = { adbOutputFindings(files: { path: string; source: string }[]): string[] };
const findingsFor = async (path: string, source: string) => {
  const { adbOutputFindings } = (await import(pathToFileURL(join(repo, "scripts", "check-adb-output.mjs")).href)) as Check;
  return adbOutputFindings([{ path, source }]).filter((line) => line.includes(path));
};

describe("T3-30 item 2: a child_process function used as a value", () => {
  it("an alias or a pass-on in a file that knows adb is a finding", async () => {
    const head = 'import { spawnSync } from "node:child_process";\nconst adbPath = process.env.ADB_PATH;\n';
    expect((await findingsFor("scripts/alias-a.mjs", `${head}const run = spawnSync;\nrun(adbPath, []);\n`)).length).toBeGreaterThan(0);
    expect((await findingsFor("scripts/alias-b.mjs", `${head}use(spawnSync);\n`)).length).toBeGreaterThan(0);
  });

  it("a member call of a namespace import in a file that does not know adb is read too", async () => {
    expect((await findingsFor("scripts/alias-c.mjs", 'import * as cp from "node:child_process";\ncp.spawnSync(tool, []);\n')).length).toBeGreaterThan(0);
    expect(await findingsFor("scripts/alias-d.mjs", 'import * as cp from "node:child_process";\ncp.spawnSync("git", []);\nconst m = /x/.exec(y);\n')).toEqual([]);
  });

  it("a renamed import of a program held in a variable is read in a file that does not know adb", async () => {
    expect((await findingsFor("scripts/alias-e.mjs", 'import { spawn as go } from "node:child_process";\ngo(tool, []);\n')).length).toBeGreaterThan(0);
  });
});
