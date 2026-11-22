// @vitest-environment node
// T3-30 item 2: the CI emulator retry may start adb (`adb kill-server`, stdio discarded) only while it discards the output.
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
type CheckModule = { adbOutputFindings(files: { path: string; source: string }[]): string[] };

describe("T3-30 item 2: the adb check's one exemption", () => {
  it("skips scripts/ci-emulator-retry.mjs only while it keeps stdio ignored, and no other file", async () => {
    const { adbOutputFindings } = (await import(pathToFileURL(join(repo, "scripts", "check-adb-output.mjs")).href)) as CheckModule;
    const path = "scripts/ci-emulator-retry.mjs";
    const kept = 'import { execFileSync } from "node:child_process";\nfor (const [command, args] of [["adb", ["kill-server"]]]) execFileSync(command, args, { stdio: "ignore" });\n';
    expect(adbOutputFindings([{ path, source: kept }]).filter((line) => line.includes(path))).toEqual([]);
    const shown = kept.replace('stdio: "ignore"', 'stdio: "inherit"');
    expect(adbOutputFindings([{ path, source: shown }]).filter((line) => line.includes(path))).not.toEqual([]);
    expect(adbOutputFindings([{ path: "scripts/other.mjs", source: kept }]).length).toBeGreaterThan(0);
  });
});
