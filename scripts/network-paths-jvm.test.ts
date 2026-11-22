// @vitest-environment node
// T3-04 spec check issue 12: pnpm tv:native:test passes whether or not NetworkPathsBytecodeTest exists, so this holds
// its four tests, the classes the real-source test must read, and the rule ids it shares with pnpm lint:network.
// Not frozen.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { KOTLIN_RULES } from "./check-network-paths.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(repo, "apps", "tv", "native", "app", "src", "test", "java", "dev", "octave", "buildcheck");
const test = readFileSync(join(dir, "NetworkPathsBytecodeTest.kt"), "utf8");
const rules = readFileSync(join(dir, "NetworkPathRules.kt"), "utf8");

describe("T3-04 NetworkPathsBytecodeTest", () => {
  it.each(["compiled_samples_are_caught_by_type", "media3_rules_by_descriptor", "every_rule_has_a_failing_and_a_passing_sample", "octave_classes_reference_no_other_client"])(
    "has the test %s",
    (name) => {
      expect(test).toMatch(new RegExp(`@Test\\s+fun ${name}\\(\\)`));
    },
  );

  it("asserts that it read OctaveHttp and MainApplication", () => {
    expect(test).toContain('"dev/octave/session/http/OctaveHttp" in classes');
    expect(test).toContain('"dev/octave/tv/MainApplication" in classes');
  });

  it("uses the source check's rule ids", () => {
    const ids = /RULE_IDS = listOf\(([^)]*)\)/.exec(rules)?.[1].match(/K\d+/g) ?? [];
    expect(ids).toEqual(KOTLIN_RULES.map((rule) => rule.id));
  });
});
