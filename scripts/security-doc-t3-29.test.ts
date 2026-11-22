// @vitest-environment node
// T3-29 item 6 (docs/specs/T3-29.md, Test plan and "Citations"): docs/security.md states D1, D0, D8 and K4 by type as
// built; docs/specs/T3-19.md and plan 008 cite no commit that is off main, and name the replacement commits; the dex
// judge is split along its rules to at most 400 lines a file.
//
// The line cap covers the judge and the files split out of it, not every scripts/tv-apk-dex*.mjs: the lists grow by a
// row at a time and are left to the AGENTS.md rule (spec check issue 1). The PR call-out and the
// `git merge-base --is-ancestor` check of each citation are checked at review, not here.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path: string) => readFileSync(join(repo, path), "utf8");
const plain = (text: string) => text.replace(/`/g, "").replace(/\s+/g, " ").trim();

// The commits docs/specs/T3-19.md and plan 008 cited that are not on main, and the commit on main each stands for
// (docs/specs/T3-29.md, "Citations").
const STALE = ["24a79047", "7ce98d84", "c3a858f0", "76d2b7c2", "fddfcb63", "77f67909", "314a33d4", "0bf8d980", "52e832f1", "9d1059c5", "76efbe03"];
const REPLACEMENTS = ["2f936e2d", "44f255a3", "4b6d0266", "f963fc79", "8b8f78a5", "8fecee1b", "f5f9bb32", "be42eaa0", "ad549b9b", "f7c9b1eb"];
const CITING = ["docs/specs/T3-19.md", "docs/plans/active/008-t3-19-review-followups.md"];

describe("T3-29 docs/security.md states the dex check's rules as built", () => {
  const doc = () => plain(read("docs/security.md"));

  it.each(["D8", "pg-map-id", "truncated or damaged", "SocketFactory.createSocket"])("T3-29 item 6: docs/security.md holds %s", (phrase) => {
    expect(doc()).toContain(phrase);
  });

  it("T3-29 item 6: a sentence of docs/security.md names DirectSocketFactory and a listening socket", () => {
    const sentences = doc().split(/(?<=[.;])\s+(?=[A-Z*(])/);
    expect(sentences.some((s) => s.includes("DirectSocketFactory") && /\blistening\b/.test(s))).toBe(true);
  });

  it("T3-29 item 6: docs/security.md names NetworkPathRules.kt near MediaExtractor", () => {
    const text = doc();
    const near = [...text.matchAll(/NetworkPathRules\.kt/g)].some((m) => {
      const at = m.index ?? 0;
      return text.slice(Math.max(0, at - 400), at + 400).includes("MediaExtractor");
    });
    expect(near).toBe(true);
  });
});

describe("T3-29 citations name commits on main", () => {
  it.each(CITING)("T3-29 item 6: %s cites none of the off-main commits", (path) => {
    const text = read(path);
    expect(STALE.filter((hash) => text.includes(hash))).toEqual([]);
  });

  it("T3-29 item 6: the two files name each replacement commit", () => {
    const text = CITING.map(read).join("\n");
    expect(REPLACEMENTS.filter((hash) => !text.includes(hash))).toEqual([]);
  });

  it("T3-29 item 6: docs/specs/T3-19.md names 2f936e2d where it names the Frozen-Test-Change commit", () => {
    const lines = read("docs/specs/T3-19.md")
      .split("\n")
      .filter((line) => line.includes("Frozen-Test-Change"));
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.some((line) => line.includes("2f936e2d"))).toBe(true);
  });
});

describe("T3-29 the dex judge is split along its rules", () => {
  const SPLIT = ["scripts/tv-apk-dex-judge.mjs", "scripts/tv-apk-dex-d4.mjs", "scripts/tv-apk-dex-declarations.mjs", "scripts/tv-apk-dex-closing.mjs"];

  it.each(SPLIT)("T3-29 item 6: %s exists and has at most 400 lines", (path) => {
    expect(existsSync(join(repo, path)), `${path} exists`).toBe(true);
    const lines = read(path).replace(/\n$/, "").split("\n").length;
    expect(lines).toBeLessThanOrEqual(400);
  });

  it("T3-29 item 6: scripts/tv-apk-dex-operand.mjs, when it exists, has at most 400 lines", () => {
    const path = "scripts/tv-apk-dex-operand.mjs";
    if (!existsSync(join(repo, path))) return;
    expect(read(path).replace(/\n$/, "").split("\n").length).toBeLessThanOrEqual(400);
  });
});
