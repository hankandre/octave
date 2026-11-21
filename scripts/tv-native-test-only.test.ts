// @vitest-environment node
// T3-03, "The red and green runs": scripts/tv-native-test-only.mjs takes exactly one Gradle test filter and judges the
// reports of a filtered run, failing on zero executed tests or any failure, without T3-01's "test sources and no
// report" rule.
import { describe, expect, it } from "vitest";
import { filterFrom, judgeFiltered } from "./tv-native-test-only.mjs";

const suite = (name: string, tests: number, failures = 0, skipped = 0) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="${name}" tests="${tests}" skipped="${skipped}" failures="${failures}" errors="0" time="0.1">\n</testsuite>\n`;

describe("filterFrom", () => {
  it("takes exactly one filter", () => {
    expect(filterFrom(["dev.octave.session.http.OriginPinTest"])).toEqual({ filter: "dev.octave.session.http.OriginPinTest" });
    expect(filterFrom(["dev.octave.session.http.*"])).toEqual({ filter: "dev.octave.session.http.*" });
    expect(filterFrom([]).error).toMatch(/^ERROR tv native: give exactly one test filter/);
    expect(filterFrom(["a.B", "c.D"]).error).toMatch(/^ERROR tv native: give exactly one test filter/);
  });

  it("refuses text that is not a class or method filter, so nothing reaches Gradle as an option", () => {
    for (const bad of ["", "-Pother=1", "a b", "a;rm", "--tests"]) {
      expect(filterFrom([bad]).error).toMatch(/^ERROR tv native: .* is not a class or method filter/);
    }
  });
});

describe("judgeFiltered", () => {
  const app = { project: ":app", xml: [] as string[] };

  it("passes when the filtered class ran and passed, though other projects wrote no report", () => {
    const result = judgeFiltered([app, { project: "modules/session", xml: [suite("dev.octave.session.http.OriginPinTest", 5)] }]);
    expect(result.errors).toEqual([]);
    expect(result.line).toBe("tv native: 5 tests, 0 failed, 2 projects");
  });

  it("fails when the filter matched nothing", () => {
    const result = judgeFiltered([app, { project: "modules/session", xml: [] }]);
    expect(result.errors).toEqual(["ERROR tv native: zero tests ran"]);
  });

  it("fails when every matched test was skipped", () => {
    const result = judgeFiltered([{ project: "modules/session", xml: [suite("dev.octave.session.http.NoProxyTest", 3, 0, 3)] }]);
    expect(result.errors).toEqual(["ERROR tv native: zero tests ran"]);
  });

  it("fails on a failure", () => {
    const result = judgeFiltered([{ project: "modules/session", xml: [suite("dev.octave.session.http.RedirectTest", 11, 1)] }]);
    expect(result.errors).toEqual(["ERROR tv native: modules/session dev.octave.session.http.RedirectTest: 1 failed"]);
  });
});
