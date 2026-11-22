// @vitest-environment node
// T3-24 item 6 (docs/specs/T3-24.md, "Documents"): docs/security.md and the rule's comment on both sides state the
// path rule as built, in the same pull request.
//
// - The paragraph is the one that starts "`request` is not a general HTTP bridge" (section 1, the native surface).
// - The claim row is the table row whose first cell is "A request path cannot leave the session's base path"; the
//   interceptor row is the one table row that names BasePathDotSegmentTest. Both are found by what only they name,
//   never by number (spec-check note 3).
// - The paragraph and the claim row each name a `;`, a control character, U+FF0E, every decoding round, and the
//   four-round limit with what is refused beyond it (a path still encoded, or deeper).
// - The claim row names the three item 1 to 3 classes and packages/core/src/adapters/request-path-forms.test.ts; the
//   interceptor row names BasePathFormsTest beside BasePathDotSegmentTest. The claim row still says Tested.
// - The top comment of RequestPath.kt and of request-path.ts (their comment lines) names P6 and P7 and holds the nine
//   dot-like code points, as U+XXXX or \uXXXX; neither file still says "the escapes of the path as written decode to
//   UTF-8", the T3-16 wording that P5 in every round replaces.
// Wording beyond these names is the implementer's and the review's.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path: string) => readFileSync(join(repo, path), "utf8");
const lines = read("docs/security.md").split("\n");

const KOTLIN_RULE = "modules/session/android/src/main/java/dev/octave/session/http/RequestPath.kt";
const CORE_RULE = "packages/core/src/adapters/request-path.ts";
const DOT_LIKE = ["2024", "2025", "2026", "3002", "FE19", "FE30", "FE52", "FF0E", "FF61"];
const OLD_P5 = "the escapes of the path as written decode to UTF-8";

const rows = lines.filter((line) => line.startsWith("|") && !/^\|\s*-/.test(line));

function one(found: string[], what: string): string {
  expect(found.length, `docs/security.md has exactly one ${what}`).toBe(1);
  return found[0];
}

const paragraph = () => one(lines.filter((line) => line.startsWith("`request` is not a general HTTP bridge")), "paragraph starting `request` is not a general HTTP bridge");
const claimRow = () => one(rows.filter((row) => /^\|\s*A request path cannot leave the session's base path\s*\|/.test(row)), "claim row \"A request path cannot leave the session's base path\"");
const interceptorRow = () => one(rows.filter((row) => row.includes("BasePathDotSegmentTest")), "row naming BasePathDotSegmentTest");

function lastCell(row: string): string {
  const body = row.trim().replace(/\|\s*$/, "");
  return body.slice(body.lastIndexOf(" | ") + 3).trim();
}

// The rule as built, as each text must state it.
function statesTheRule(text: string, where: string) {
  expect(text, `${where} names a \`;\``).toMatch(/`;`|semicolon/i);
  expect(text, `${where} names a control character`).toMatch(/control character/i);
  expect(text, `${where} names U+FF0E`).toMatch(/U\+FF0E/i);
  expect(text, `${where} says every decoding round`).toMatch(/\b(?:every|any|each)\s+(?:decoding\s+)?round/i);
  expect(text, `${where} names the four-round limit`).toMatch(/four rounds|four decodings|fourth (?:round|decoding)/i);
  expect(text, `${where} says a path still encoded beyond the limit is refused`).toMatch(/still (?:percent-)?encoded|still holds an? (?:percent-)?escape|deeper/i);
}

// The comment lines of a source file.
function commentOf(path: string): string {
  return read(path)
    .split("\n")
    .filter((line) => line.trim().startsWith("//"))
    .join("\n");
}

describe("docs/security.md and the rule's comments after T3-24", () => {
  it("T3-24 item 6: the request paragraph states the rule as built", () => {
    statesTheRule(paragraph(), "the paragraph starting `request` is not a general HTTP bridge");
  });

  it("T3-24 item 6: the claim row states the rule as built and still says Tested", () => {
    const row = claimRow();
    statesTheRule(row, "the claim row");
    expect(/^[A-Za-z]+/.exec(lastCell(row))?.[0], "the claim row's status").toBe("Tested");
  });

  it("T3-24 item 6: the claim row names the new tests of items 1 to 3", () => {
    const row = claimRow();
    for (const name of ["SemicolonAndControlPathTest", "DotLikeSegmentPathTest", "DecodingRoundsPathTest", "request-path-forms.test.ts"]) {
      expect(row.includes(name), `the claim row names ${name}`).toBe(true);
    }
  });

  it("T3-24 item 6: the interceptor row names BasePathFormsTest", () => {
    expect(interceptorRow().includes("BasePathFormsTest"), "the row naming BasePathDotSegmentTest names BasePathFormsTest").toBe(true);
  });

  it.each([KOTLIN_RULE, CORE_RULE])("T3-24 item 6: the comment of %s states P6, P7 and the nine dot-like code points", (path) => {
    const comment = commentOf(path);
    expect(comment, `${path}: P6`).toMatch(/\bP6\b/);
    expect(comment, `${path}: P7`).toMatch(/\bP7\b/);
    for (const code of DOT_LIKE) expect(comment, `${path}: U+${code}`).toMatch(new RegExp(`U\\+${code}|\\\\u${code}`, "i"));
  });

  it.each([KOTLIN_RULE, CORE_RULE])("T3-24 item 6: %s no longer limits P5 to the path as written", (path) => {
    expect(read(path).includes(OLD_P5)).toBe(false);
  });
});
