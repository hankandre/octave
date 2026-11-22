// @vitest-environment node
// T3-20 item 5 (docs/specs/T3-20.md, "Documents"): docs/security.md section 3 states the resolved-address rule and
// names its tests in the same pull request.
//
// - Section 3 is found by its heading, `## 3.`, up to the next `## ` heading, never by line number, so rows or bullets
//   another task moves do not matter.
// - The rule is one top-level bullet that starts `- **Resolved addresses (T3-20).**`, after the "Cleartext on Android"
//   bullet. A bullet runs from its line up to the next line that starts with `- ` or `#` (sub-bullets are indented).
// - The bullet names the three Kotlin test classes with their directory, scripts/tv-resolved-address.test.ts, the
//   probe's resolved-address check under pnpm tv:e2e (by its own name, not as part of the script's file name), the
//   test-only seam (withResolver), and the refusal's code.
// - Every repository file the bullet names in backticks exists.
// - The section no longer says "plain HTTP depends on the literal host, never a DNS answer": a DNS answer can now
//   refuse a connection. Wording beyond these names is the implementer's and the review's.
// The pull request's call-out cannot be a test; the Ship step writes it and the guardian review checks it.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const lines = readFileSync(join(repo, "docs", "security.md"), "utf8").split("\n");

function sectionThree(): string[] {
  const start = lines.findIndex((line) => /^## 3\.\s/.test(line));
  expect(start, "docs/security.md has a section 3").toBeGreaterThan(-1);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  return end === -1 ? rest : rest.slice(0, end);
}

// The top-level bullet that starts with `prefix`, up to the next line that starts with `- ` or `#`.
function bullet(section: string[], prefix: string): { index: number; text: string } {
  const index = section.findIndex((line) => line.startsWith(prefix));
  expect(index, `section 3 has a top-level bullet starting ${prefix}`).toBeGreaterThan(-1);
  const rest = section.slice(index + 1);
  const end = rest.findIndex((line) => line.startsWith("- ") || line.startsWith("#"));
  return { index, text: [section[index], ...(end === -1 ? rest : rest.slice(0, end))].join("\n") };
}

const RULE = "- **Resolved addresses (T3-20).**";
const TEST_DIR = "modules/session/android/src/test/java/dev/octave/session/http";
const NAMES = [
  "ResolvedAddressTest",
  "ResolvedAddressAnswerTest",
  "ResolvedAddressScopeTest",
  TEST_DIR,
  "scripts/tv-resolved-address.test.ts",
  "pnpm tv:e2e",
  "withResolver",
  "resolved-public",
];
const OLD_SENTENCE = "plain HTTP depends on the literal host, never a DNS answer";
const FILE = /^[\w.@/-]+\.(?:kt|java|ts|tsx|mjs|js|json|md|yml|yaml|gradle|txt)$/;

describe("docs/security.md section 3 after T3-20", () => {
  it("T3-20 item 5: section 3 has the Resolved addresses bullet after the Cleartext on Android bullet", () => {
    const section = sectionThree();
    const cleartext = bullet(section, "- **Cleartext on Android.**");
    const rule = bullet(section, RULE);
    expect(rule.index, "the Resolved addresses bullet comes after the Cleartext on Android bullet").toBeGreaterThan(cleartext.index);
  });

  it("T3-20 item 5: the bullet names each of the rule's tests, the device check, the seam and the refusal's code", () => {
    const { text } = bullet(sectionThree(), RULE);
    for (const name of NAMES) expect(text.includes(name), `the Resolved addresses bullet names ${name}`).toBe(true);
    // The probe's check by its own name, not only as part of the script's file name.
    expect(/(?<!tv-)resolved-address(?![.\w])/.test(text), "the Resolved addresses bullet names the probe's resolved-address check").toBe(true);
  });

  it("T3-20 item 5: every file the bullet names exists", () => {
    const { text } = bullet(sectionThree(), RULE);
    const named = [...text.matchAll(/`([^`]+)`/g)].map((match) => match[1]).filter((token) => FILE.test(token) && token.includes("/"));
    for (const token of named) {
      if (token.startsWith("release-evidence/") || token.startsWith("apps/tv/android/")) continue;
      expect(existsSync(join(repo, token)), `${token}, named in the Resolved addresses bullet`).toBe(true);
    }
    for (const name of ["ResolvedAddressTest", "ResolvedAddressAnswerTest", "ResolvedAddressScopeTest"]) {
      expect(existsSync(join(repo, TEST_DIR, `${name}.kt`)), `${TEST_DIR}/${name}.kt exists`).toBe(true);
    }
  });

  it("T3-20 item 5: section 3 no longer says plain HTTP depends on the literal host alone", () => {
    const text = sectionThree().join("\n");
    expect(text.includes(OLD_SENTENCE), `section 3 still says "${OLD_SENTENCE}"`).toBe(false);
  });
});
