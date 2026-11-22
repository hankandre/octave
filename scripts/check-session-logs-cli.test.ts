// @vitest-environment node
// T3-26 item 5 (docs/specs/T3-26.md, "The log check's CLI"): the CLI of pnpm lint:logs prints its summary line with the
// number of files it read, directly and through a symlinked path, so a main that never runs fails pnpm check. The
// frozen T3-16 CLI tests assert only the exit code and stay unchanged. The count is the script's own readScopedFiles
// length, not a literal.
import { spawnSync } from "node:child_process";
import { mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(repo, "scripts", "check-session-logs.mjs");

async function scopedCount(): Promise<number> {
  const { readScopedFiles } = (await import(pathToFileURL(SCRIPT).href)) as { readScopedFiles: (root: string) => unknown[] };
  return readScopedFiles(repo).length;
}

function summaryOf(path: string) {
  const child = spawnSync(process.execPath, [path], { cwd: repo, encoding: "utf8" });
  return { child, lines: child.stdout.split("\n").filter((line) => line !== "") };
}

describe("T3-26 item 5: the check-session-logs CLI says what it read", () => {
  it("T3-26 item 5: run directly, it prints one summary line with the file count and exits 0", async () => {
    const count = await scopedCount();
    expect(count).toBeGreaterThan(0);
    const { child, lines } = summaryOf(SCRIPT);
    expect(child.status, `${child.stdout}${child.stderr}`).toBe(0);
    expect(lines).toEqual([`logs: ${count} files of the session module and its host read, no log call takes a value`]);
  });

  it("T3-26 item 5: run through a symlink, it still runs main and prints the same summary line", async () => {
    const count = await scopedCount();
    const dir = mkdtempSync(join(tmpdir(), "logs-link-"));
    const link = join(dir, "link.mjs");
    symlinkSync(SCRIPT, link);
    const { child, lines } = summaryOf(link);
    expect(child.status, `${child.stdout}${child.stderr}`).toBe(0);
    expect(lines).toEqual([`logs: ${count} files of the session module and its host read, no log call takes a value`]);
  });
});
