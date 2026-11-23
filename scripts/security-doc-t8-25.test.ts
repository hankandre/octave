// @vitest-environment node
// T8-25 item 4, document half: docs/security.md says the filtered native reason goes only to the FailureLog sink.
// The new row is found by what only it names, `ReportingWarningCode`, never by line number. Wording beyond these
// names is the implementer's.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const lines = readFileSync(join(repo, "docs/security.md"), "utf8").split("\n");
const rows = lines.filter((line) => line.startsWith("|") && !/^\|\s*-/.test(line));

function lastCell(row: string): string {
  const body = row.trim().replace(/\|\s*$/, "");
  return body.slice(body.lastIndexOf(" | ") + 3).trim();
}

describe("docs/security.md after T8-25", () => {
  it("T8-25 item 4: one row says a failure is a code and the reason goes only to FailureLog, and names the tests", () => {
    const found = rows.filter((row) => row.includes("ReportingWarningCode"));
    expect(found.length, "docs/security.md has exactly one row naming ReportingWarningCode").toBe(1);
    const [row] = found;
    for (const name of ["PlaybackFailureCode", "FailureLog", "DESIGN.md"]) expect(row.includes(name), `the row names ${name}`).toBe(true);
    for (const name of [
      "packages/core/src/player/session-failure-log.test.ts",
      "packages/core/src/player/session-failure-leaks.test.ts",
    ]) {
      expect(row.includes(name), `the row names ${name}`).toBe(true);
      expect(existsSync(join(repo, name)), `${name} exists`).toBe(true);
    }
    expect(lastCell(row), "status begins Tested").toMatch(/^Tested/);
  });

  it("T8-25 item 4: no line still says safeReason or errorReason is how a reason reaches the screen", () => {
    const stale = lines.filter((line) => /\b(?:safeReason|errorReason)\b/.test(line) && /reaches the screen|reach the screen/.test(line));
    expect(stale).toEqual([]);
  });
});
