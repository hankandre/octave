// @vitest-environment node
// T8-02 review finding: the approved spec keeps every section the Ship step and item 10 (gate: met) read, and its
// Dependencies section holds the dated T8 phase re-check. Not frozen.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const spec = readFileSync(join(repo, "docs/specs/T8-02.md"), "utf8");
const headings = spec.match(/^## .+$/gm) ?? [];

const section = (heading: string) => {
  const start = spec.indexOf(`\n## ${heading}\n`);
  if (start < 0) return "";
  const next = spec.indexOf("\n## ", start + 1);
  return spec.slice(start, next < 0 ? undefined : next);
};

describe("T8-02 spec sections", () => {
  it("keeps every section, in order", () => {
    expect(headings).toEqual([
      "## Goal",
      "## Facts this spec rests on",
      "## Acceptance",
      "## Files to touch",
      "## Approach",
      "## Test plan",
      "## Invariants and hard rules touched",
      "## Risks and out of scope",
      "## Validation commands",
      "## Dependencies",
      "## Open questions for the Product Owner",
      "## Spec check",
    ]);
  });

  it("T8-02 item 10: records the dated phase re-check of Media3 and the pins the player path builds on", () => {
    const dependencies = section("Dependencies");
    expect(dependencies).toMatch(/2026-11-23/);
    for (const pin of ["androidx.media3", "okhttp", "expo-modules-core", "junit-bom", "Gradle, AGP, Kotlin"]) {
      expect(dependencies, pin).toContain(pin);
    }
  });

  it("keeps the PR call-out for the loosened dex and K7 checks", () => {
    expect(section("Invariants and hard rules touched")).toMatch(/dex and K7 checks are loosened/);
  });

  it("keeps the decision log from D1 to D17", () => {
    for (let n = 1; n <= 17; n += 1) expect(spec, `D${n}`).toMatch(new RegExp(`^- \\*\\*D${n}\\. `, "m"));
  });
});
