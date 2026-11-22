// @vitest-environment node
// T8-22 item 8 (docs/specs/T8-22.md, "Documents"): docs/security.md states the master-URL host rule and the launch
// refusals as built, and names the tests, in the same pull request.
//
// - The master-URL row is the table row of section 2 that starts "A `TranscodingUrl` is never used as given". It
//   names R1 and R2, the refusal detail `host`, and the two T2-06 tests hls-url-non-ascii.test.ts and
//   url-conformance.test.ts; its status is still Tested.
// - The launch-refusals row is the one table row that names launch-request-hardening.test.ts. It names a fragment, a
//   bracketed credential parameter name, `Token=`, `MediaBrowser`, R1 and R2, the two URL shapes, the parsed href, a
//   start position that is not finite and the stop of a refused converted session; it names the three T8-22 tests,
//   every named file exists, and its status begins Tested.
// - Rows are found by what only they name, never by line number. Wording beyond these names is the implementer's.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const lines = readFileSync(join(repo, "docs/security.md"), "utf8").split("\n");
const rows = lines.filter((line) => line.startsWith("|") && !/^\|\s*-/.test(line));

function one(found: string[], what: string): string {
  expect(found.length, `docs/security.md has exactly one ${what}`).toBe(1);
  return found[0];
}

const masterRow = () => one(rows.filter((row) => /^\|\s*A `TranscodingUrl` is never used as given/.test(row)), "master-URL row");
const launchRow = () => one(rows.filter((row) => row.includes("launch-request-hardening.test.ts")), "row naming launch-request-hardening.test.ts");

function lastCell(row: string): string {
  const body = row.trim().replace(/\|\s*$/, "");
  return body.slice(body.lastIndexOf(" | ") + 3).trim();
}

const T8_22_TESTS = [
  "packages/core/src/player/launch-request-hardening.test.ts",
  "packages/core/src/player/coordinator-launch-refusal.test.ts",
  "packages/core/src/jellyfin/subtitle-url-host.test.ts",
];

describe("docs/security.md after T8-22", () => {
  it("T8-22 item 8: the master-URL row states the host rule and names the T2-06 tests", () => {
    const row = masterRow();
    expect(row, "names R1").toMatch(/\bR1\b/);
    expect(row, "names R2").toMatch(/\bR2\b/);
    expect(row, "names the refusal detail host").toMatch(/`host`/);
    for (const name of ["packages/core/src/jellyfin/hls-url-non-ascii.test.ts", "packages/core/src/conformance/url-conformance.test.ts"]) {
      expect(row.includes(name), `the row names ${name}`).toBe(true);
      expect(existsSync(join(repo, name)), `${name} exists`).toBe(true);
    }
    expect(/^[A-Za-z]+/.exec(lastCell(row))?.[0], "the row's status").toBe("Tested");
  });

  it("T8-22 item 8: a launch row lists the new refusals", () => {
    const row = launchRow();
    expect(row, "a fragment").toMatch(/fragment/i);
    expect(row, "a bracketed credential parameter name").toMatch(/bracketed credential/i);
    expect(row, "Token=").toContain("`Token=`");
    expect(row, "MediaBrowser").toContain("`MediaBrowser`");
    expect(row, "R1").toMatch(/\bR1\b/);
    expect(row, "R2").toMatch(/\bR2\b/);
    expect(row, "the original-file shape").toContain("Static=true");
    expect(row, "the master shape").toContain("master.m3u8");
    expect(row, "the parsed href").toMatch(/parsed href/i);
    expect(row, "a start position that is not finite").toMatch(/not finite/i);
    expect(row, "the stop of a refused converted session").toMatch(/stopped/i);
  });

  it("T8-22 item 8: the launch row names the three tests, they exist, and it says Tested", () => {
    const row = launchRow();
    for (const name of T8_22_TESTS) {
      expect(row.includes(name), `the row names ${name}`).toBe(true);
      expect(existsSync(join(repo, name)), `${name} exists`).toBe(true);
    }
    expect(/^[A-Za-z]+/.exec(lastCell(row))?.[0], "the row's status").toBe("Tested");
  });
});
