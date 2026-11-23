// @vitest-environment node
// T8-02 (docs/specs/T8-02.md, "Files to touch", Documents; Product Owner ruling of 2026-11-23, point 6):
// docs/security.md states the Media3 engine as built and names the tests, in the same pull request.
//
// - Section 2's one-client row (it starts "One OkHttp client carries every server request") no longer holds a Planned
//   status naming T8-02, names Media3's `OkHttpDataSource`, `Media3OkHttpLinkTest` and the wire test
//   `player-original-file`.
// - Section 4 has one table row naming `OctaveHttp.callFactory` (the engine's network path), which says Tested and
//   names `scripts/tv-player-media3.test.ts`; one row naming `player-redirect` (the media redirect), which says Tested,
//   names `server-error` and `PlaybackErrorsTest`; one row naming `first-frame`, which says Tested and names
//   `EngineCoreTest`; one row naming `DecoderFactsTest`, which says Tested.
// - One line of the document (a paragraph or a row) states the dex and K7 exception by name: it names
//   `dev.octave.player.media3`, `OkHttpDataSource$Factory`, `Call$Factory`, D4 and K7.
// - The document names `androidx.media3.datasource.okhttp.OkHttpDataSource` as an entry point.
// - Section 6 lists `ACCESS_NETWORK_STATE` and `WAKE_LOCK` among the removed permissions.
// - No table row holds a Planned status naming T8-02. Every test a row names exists.
// Wording beyond these names is the implementer's.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const text = readFileSync(join(repo, "docs/security.md"), "utf8");
const lines = text.split("\n");
const isRow = (line: string) => line.startsWith("|") && !/^\|\s*-/.test(line);
const rows = lines.filter(isRow);

const KOTLIN_TESTS: Record<string, string> = {
  Media3OkHttpLinkTest: "apps/tv/native/app/src/test/java/dev/octave/buildcheck/Media3OkHttpLinkTest.kt",
  PlaybackErrorsTest: "modules/player/android/src/test/java/dev/octave/player/engine/PlaybackErrorsTest.kt",
  EngineCoreTest: "modules/player/android/src/test/java/dev/octave/player/engine/EngineCoreTest.kt",
  DecoderFactsTest: "modules/player/android/src/test/java/dev/octave/player/engine/DecoderFactsTest.kt",
};

function section(number: number): string {
  return text.split(new RegExp(`^## ${number + 1}\\.`, "m"))[0].split(new RegExp(`^## ${number}\\.`, "m"))[1] ?? "";
}

function one(found: string[], what: string): string {
  expect(found.length, `docs/security.md has exactly one ${what}`).toBe(1);
  return found[0];
}

const sectionRows = (number: number) => section(number).split("\n").filter(isRow);
const rowNaming = (number: number, name: string) => one(sectionRows(number).filter((row) => row.includes(name)), `section ${number} row naming ${name}`);

function expectNames(row: string, names: string[]) {
  for (const name of names) {
    expect(row.includes(name), `the row names ${name}`).toBe(true);
    const path = KOTLIN_TESTS[name] ?? name;
    if (path.includes("/")) expect(existsSync(join(repo, path)), `${path} exists`).toBe(true);
  }
}

function expectTestedNotPlanned(row: string) {
  expect(row, "the row says Tested").toMatch(/\btested\b/i);
  expect(row, "the row still holds Planned (T8-02)").not.toMatch(/Planned \([^)]*T8-02[^)]*\)/);
}

describe("docs/security.md after T8-02", () => {
  it("T8-02 item 1: the one-client row says media goes through Media3's OkHttp data source and names its tests", () => {
    const row = one(rows.filter((line) => line.replace(/^\|\s*/, "").startsWith("One OkHttp client carries every server request")), "one-client row");
    expect(row).not.toMatch(/Planned \([^)]*T8-02[^)]*\)/);
    expect(row).toContain("OkHttpDataSource");
    expectNames(row, ["Media3OkHttpLinkTest", "player-original-file"]);
  });

  it("T8-02 item 1: a section 4 row states the engine's network path over OctaveHttp.callFactory and names its test", () => {
    const row = rowNaming(4, "OctaveHttp.callFactory");
    expectTestedNotPlanned(row);
    expectNames(row, ["scripts/tv-player-media3.test.ts"]);
  });

  it("T8-02 item 1: the dex and K7 exception is stated by package, class and constructor", () => {
    const stated = lines.filter(
      (line) => line.includes("dev.octave.player.media3") && line.includes("OkHttpDataSource$Factory") && line.includes("Call$Factory") && /\bD4\b/.test(line) && /\bK7\b/.test(line),
    );
    expect(stated.length, "a line names the package, the class, the constructor's argument, D4 and K7").toBeGreaterThan(0);
    expect(text).toContain("androidx.media3.datasource.okhttp.OkHttpDataSource");
  });

  it("T8-02 item 1: section 6 lists Media3's two permissions as removed", () => {
    const manifest = section(6);
    for (const name of ["ACCESS_NETWORK_STATE", "WAKE_LOCK"]) expect(manifest, `section 6 names ${name}`).toContain(name);
  });

  it("T8-02 item 1: no table row still holds a Planned status naming T8-02", () => {
    expect(rows.filter((row) => /Planned \([^)]*T8-02[^)]*\)/.test(row))).toEqual([]);
  });

  it("T8-02 item 2: a section 4 row states first-frame on a presented frame and names EngineCoreTest", () => {
    const row = rowNaming(4, "`first-frame`");
    expectTestedNotPlanned(row);
    expectNames(row, ["EngineCoreTest"]);
  });

  it("T8-02 item 3: a section 4 row states the decoder facts and names DecoderFactsTest", () => {
    const row = rowNaming(4, "DecoderFactsTest");
    expectTestedNotPlanned(row);
    expectNames(row, ["DecoderFactsTest"]);
  });

  it("T8-02 item 5: a section 4 row states the media redirect as server-error and names its tests", () => {
    const row = rowNaming(4, "player-redirect");
    expectTestedNotPlanned(row);
    expect(row).toContain("`server-error`");
    expectNames(row, ["PlaybackErrorsTest"]);
  });
});
