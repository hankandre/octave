// @vitest-environment node
// T8-01 (docs/specs/T8-01.md, "Documents"): docs/security.md states the player module's seam as built, names the
// tests, and keeps no T8-01 row Planned, in the same pull request.
//
// - Rows are the table rows of section 4 found by what only they name, never by line number:
//   the methods row starts "The player module exposes only"; the launch row starts "A launch takes only the typed
//   request union"; the events row starts "Player events map one to one"; the view row starts "A native view hosts
//   the video"; the new session row is the one table row that names `SessionAuthorityTest`.
// - Each row says Tested for the module and names its tests: the methods row `scripts/tv-module-surfaces.test.ts`
//   and `ModuleSurfaceTest`; the launch row `LaunchRequestReaderTest` and `scripts/tv-player-engine.test.ts`; the
//   events row `PlayerEventMapsTest` and `scripts/tv-player-engine.test.ts`; the view row
//   `scripts/tv-player-module.test.ts` and T8-02 for video on it; the session row `session-ended` and
//   `SessionRegistryHoldsTest`. Every named test exists.
// - No table row names T8-01 inside a Planned status.
// - Section 1 names `SessionRegistry.holds`, the one thing the registry answers another module (spec check issue 5).
// Wording beyond these names is the implementer's.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const text = readFileSync(join(repo, "docs/security.md"), "utf8");
const lines = text.split("\n");
const rows = lines.filter((line) => line.startsWith("|") && !/^\|\s*-/.test(line));

// The Kotlin tests a row may name by class, and where each lives.
const KOTLIN_TESTS: Record<string, string> = {
  ModuleSurfaceTest: "modules/player/android/src/test/java/dev/octave/player/ModuleSurfaceTest.kt",
  LaunchRequestReaderTest: "modules/player/android/src/test/java/dev/octave/player/seam/LaunchRequestReaderTest.kt",
  SessionAuthorityTest: "modules/player/android/src/test/java/dev/octave/player/seam/SessionAuthorityTest.kt",
  PlayerEventMapsTest: "modules/player/android/src/test/java/dev/octave/player/seam/PlayerEventMapsTest.kt",
  PlayerSeamTest: "modules/player/android/src/test/java/dev/octave/player/seam/PlayerSeamTest.kt",
  SeamCanaryTest: "modules/player/android/src/test/java/dev/octave/player/seam/SeamCanaryTest.kt",
  SessionRegistryHoldsTest: "modules/session/android/src/test/java/dev/octave/session/http/SessionRegistryHoldsTest.kt",
};

function one(found: string[], what: string): string {
  expect(found.length, `docs/security.md has exactly one ${what}`).toBe(1);
  return found[0];
}

const rowStarting = (start: string) => one(rows.filter((row) => row.replace(/^\|\s*/, "").startsWith(start)), `row starting "${start}"`);

function expectNames(row: string, names: string[]) {
  for (const name of names) {
    expect(row.includes(name), `the row names ${name}`).toBe(true);
    const path = KOTLIN_TESTS[name] ?? name;
    expect(existsSync(join(repo, path)), `${path} exists`).toBe(true);
  }
}

function expectTestedNotPlanned(row: string) {
  expect(row, "the row says Tested").toMatch(/\btested\b/i);
  expect(row, "the row still holds Planned (T8-01)").not.toMatch(/Planned \([^)]*T8-01[^)]*\)/);
}

describe("docs/security.md after T8-01", () => {
  it("T8-01 item 1: the methods row says Tested and names the surface tests", () => {
    const row = rowStarting("The player module exposes only");
    expectTestedNotPlanned(row);
    expectNames(row, ["scripts/tv-module-surfaces.test.ts", "ModuleSurfaceTest"]);
  });

  it("T8-01 item 2: the launch row says Tested and names the reader and adapter tests", () => {
    const row = rowStarting("A launch takes only the typed request union");
    expectTestedNotPlanned(row);
    expectNames(row, ["LaunchRequestReaderTest", "scripts/tv-player-engine.test.ts"]);
  });

  it("T8-01 item 3: a row says a launch naming a session the registry does not hold ends in session-ended", () => {
    const row = one(rows.filter((line) => line.includes("SessionAuthorityTest")), "row naming SessionAuthorityTest");
    expect(row).toContain("`session-ended`");
    expectTestedNotPlanned(row);
    expectNames(row, ["SessionAuthorityTest", "SessionRegistryHoldsTest"]);
  });

  it("T8-01 item 3: section 1 names SessionRegistry.holds as what the registry answers another module", () => {
    const section = text.split(/^## 2\./m)[0].split(/^## 1\./m)[1] ?? "";
    expect(section).toContain("`SessionRegistry.holds`");
  });

  it("T8-01 item 4: the events row says Tested and names the event tests", () => {
    const row = rowStarting("Player events map one to one");
    expectTestedNotPlanned(row);
    expectNames(row, ["PlayerEventMapsTest", "scripts/tv-player-engine.test.ts"]);
  });

  it("T8-01 item 5: the view row says Tested, names its test, and leaves video on it to T8-02", () => {
    const row = rowStarting("A native view hosts the video");
    expectTestedNotPlanned(row);
    expectNames(row, ["scripts/tv-player-module.test.ts"]);
    expect(row).toContain("T8-02");
  });

  it("T8-01 item 1: no table row still holds a Planned status naming T8-01", () => {
    expect(rows.filter((row) => /Planned \([^)]*T8-01[^)]*\)/.test(row))).toEqual([]);
  });
});
