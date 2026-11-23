// @vitest-environment node
// T3-33 item 6 (docs/specs/T3-33.md, "Documents"): docs/security.md, Development builds, states the rule a development
// build follows and names its tests, and each test it names exists. The PR call-out and the guardian are checked at
// review, not here.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const plain = (text: string) => text.replace(/`/g, "").replace(/\s+/g, " ").trim();

const KOTLIN_DIR = "modules/session/android/src/test/java/dev/octave/session/http/";
const KOTLIN_TESTS = ["DevelopmentBuildRefusalTest", "ReleaseBuildServersTest"];
const SCRIPT_TESTS = ["scripts/dev-allowlist-tracked.test.ts", "scripts/tv-apk-allowlist.test.ts"];

function developmentBuilds(): string {
  const doc = readFileSync(join(repo, "docs/security.md"), "utf8");
  const start = doc.indexOf("### Development builds");
  expect(start, "docs/security.md has a Development builds section").toBeGreaterThan(-1);
  const rest = doc.slice(start + "### Development builds".length);
  const end = rest.search(/^#{1,3} /m);
  return plain(end === -1 ? rest : rest.slice(0, end));
}

describe("T3-33 item 6: docs/security.md, Development builds, states the rule and names its tests", () => {
  it("T3-33 item 6: the section names the allowlist variable, the emulator host and the refused code", () => {
    const section = developmentBuilds();
    for (const words of ["OCTAVE_DEV_SERVERS", "10.0.2.2", "loopback", "refused", "T3-33"]) expect(section, `the section names ${words}`).toContain(words);
  });

  it("T3-33 item 6: the section names each test of the task, and each named test exists", () => {
    const section = developmentBuilds();
    for (const name of KOTLIN_TESTS) {
      expect(section, `the section names ${name}`).toContain(name);
      expect(existsSync(join(repo, `${KOTLIN_DIR}${name}.kt`)), `${KOTLIN_DIR}${name}.kt exists`).toBe(true);
    }
    expect(section, `the section names the directory ${KOTLIN_DIR}`).toContain(KOTLIN_DIR);
    for (const path of SCRIPT_TESTS) {
      expect(section, `the section names ${path}`).toContain(path);
      expect(existsSync(join(repo, path)), `${path} exists`).toBe(true);
    }
  });
});
