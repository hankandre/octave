// @vitest-environment node
// T3-01 acceptance item 5: pnpm tv:native:test runs the app's and the modules' JVM tests, and pnpm check type-checks
// the app. The pure summarizeResults(reports) judges the JUnit XML reports scripts/tv-native-test.mjs collects.
//
// reports: one entry per Gradle project whose tests count (`:app`, and each project under modules/):
//   { project: string, hasTestSources: boolean, xml: string[] }  // xml: the text of each TEST-*.xml it wrote
// summarizeResults(reports) -> { line: "tv native: N tests, F failed, P projects", errors: string[] }
//   N counts executed tests (tests minus skipped), F counts failures plus errors, P counts the reports.
//   errors holds one `ERROR tv native: ...` line per problem; it is empty only when the run counts as a pass.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");

type Report = { project: string; hasTestSources: boolean; xml: string[] };
type Summary = { line: string; errors: string[] };
type SummarizeResults = (reports: Report[]) => Summary;

async function loadSummarize(): Promise<SummarizeResults> {
  const module = (await import("./tv-native-test.mjs")) as { summarizeResults: SummarizeResults };
  return module.summarizeResults;
}

// The shape Gradle's JUnit XML report writes for one test class.
function suite(name: string, cases: { name: string; failure?: string; error?: string; skipped?: boolean }[]): string {
  const failures = cases.filter((c) => c.failure !== undefined).length;
  const errors = cases.filter((c) => c.error !== undefined).length;
  const skipped = cases.filter((c) => c.skipped).length;
  const body = cases
    .map((c) => {
      const inner =
        c.failure !== undefined
          ? `\n    <failure message="${c.failure}" type="org.opentest4j.AssertionFailedError">${c.failure}</failure>\n  `
          : c.error !== undefined
            ? `\n    <error message="${c.error}" type="java.io.FileNotFoundException">${c.error}</error>\n  `
            : c.skipped
              ? "\n    <skipped/>\n  "
              : "";
      return `  <testcase name="${c.name}" classname="${name}" time="0.004">${inner}</testcase>`;
    })
    .join("\n");
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuite name="${name}" tests="${cases.length}" skipped="${skipped}" failures="${failures}" errors="${errors}" timestamp="2026-11-21T10:00:00.000Z" hostname="runner" time="0.012">`,
    "  <properties/>",
    body,
    "  <system-out><![CDATA[]]></system-out>",
    "  <system-err><![CDATA[]]></system-err>",
    "</testsuite>",
    "",
  ].join("\n");
}

const APP_IDENTITY = suite("dev.octave.buildcheck.AppIdentityTest", [{ name: "applicationIdComesFromTheCore()" }]);
const SHARED_VECTORS = suite("dev.octave.buildcheck.SharedVectorsTest", [
  { name: "hostClassesAreReadable()" },
  { name: "hlsMasterUrlsAreReadable()" },
  { name: "hlsPlaylistsAreReadable()" },
]);
const app = (xml: string[]): Report => ({ project: ":app", hasTestSources: true, xml });

describe("summarizeResults", () => {
  it("T3-01 item 5: passes the sample reports and prints the summary line", async () => {
    const summarize = await loadSummarize();
    const result = summarize([app([APP_IDENTITY, SHARED_VECTORS])]);
    expect(result.errors).toEqual([]);
    expect(result.line).toBe("tv native: 4 tests, 0 failed, 1 projects");
  });

  it("T3-01 item 5: counts a module project beside the app, and a module without test sources needs no report", async () => {
    const summarize = await loadSummarize();
    const module = { project: ":octave-player", hasTestSources: true, xml: [suite("dev.octave.player.PlayerTest", [{ name: "starts()" }])] };
    const empty = { project: ":octave-http", hasTestSources: false, xml: [] };
    const result = summarize([app([APP_IDENTITY, SHARED_VECTORS]), module, empty]);
    expect(result.errors).toEqual([]);
    expect(result.line).toBe("tv native: 5 tests, 0 failed, 3 projects");
  });

  it("T3-01 item 5: fails when no test ran", async () => {
    const summarize = await loadSummarize();
    const result = summarize([app([])]);
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    for (const error of result.errors) expect(error).toMatch(/^ERROR tv native: /);
  });

  it("T3-01 item 5: fails when every test was skipped, so zero executed", async () => {
    const summarize = await loadSummarize();
    const result = summarize([app([suite("dev.octave.buildcheck.AppIdentityTest", [{ name: "applicationIdComesFromTheCore()", skipped: true }])])]);
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    expect(result.errors[0]).toMatch(/^ERROR tv native: /);
    expect(result.line).toMatch(/^tv native: 0 tests, /);
  });

  it("T3-01 item 5: fails when there are no projects at all", async () => {
    const summarize = await loadSummarize();
    expect(summarize([]).errors.length).toBeGreaterThanOrEqual(1);
  });

  it("T3-01 item 5: fails a project with test sources and no report, naming it", async () => {
    const summarize = await loadSummarize();
    const result = summarize([app([APP_IDENTITY, SHARED_VECTORS]), { project: ":octave-player", hasTestSources: true, xml: [] }]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/^ERROR tv native: /);
    expect(result.errors[0]).toContain(":octave-player");
  });

  it("T3-01 item 5: fails on a failed test", async () => {
    const summarize = await loadSummarize();
    const failed = suite("dev.octave.buildcheck.AppIdentityTest", [{ name: "applicationIdComesFromTheCore()", failure: "expected: cloud.jellyscale.octave but was: dev.example" }]);
    const result = summarize([app([failed, SHARED_VECTORS])]);
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    expect(result.errors[0]).toMatch(/^ERROR tv native: /);
    expect(result.line).toBe("tv native: 4 tests, 1 failed, 1 projects");
  });

  it("T3-01 item 5: fails on a test that errored", async () => {
    const summarize = await loadSummarize();
    const errored = suite("dev.octave.buildcheck.SharedVectorsTest", [{ name: "hostClassesAreReadable()", error: "host-classes.json (No such file or directory)" }]);
    const result = summarize([app([APP_IDENTITY, errored])]);
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    expect(result.line).toBe("tv native: 2 tests, 1 failed, 1 projects");
  });
});

describe("the scripts and the tv job", () => {
  const pkg = () => JSON.parse(readFileSync(join(repo, "package.json"), "utf8")) as { scripts: Record<string, string> };

  it("T3-01 item 5: has the root script tv:native:test", () => {
    expect(pkg().scripts["tv:native:test"]).toBeTruthy();
  });

  it("T3-01 item 5: type-checks the app in the root typecheck script, which pnpm check runs", () => {
    const { scripts } = pkg();
    expect(scripts.typecheck).toContain("apps/tv/tsconfig.json");
    expect(scripts.check).toContain("pnpm typecheck");
    expect(existsSync(join(repo, "apps", "tv", "tsconfig.json"))).toBe(true);
  });

  it("T3-01 item 5: runs the JVM tests in the tv job as a single-line step", () => {
    const lines = readFileSync(join(repo, ".github", "workflows", "ci.yml"), "utf8").split("\n");
    const start = lines.findIndex((line) => line === "  tv:");
    expect(start, "ci.yml has a job named tv").toBeGreaterThan(-1);
    const rest = lines.slice(start + 1);
    const end = rest.findIndex((line) => /^ {2}\S/.test(line));
    const job = end === -1 ? rest : rest.slice(0, end);
    expect(job.some((line) => /^\s+(?:- )?run: pnpm tv:native:test\s*$/.test(line))).toBe(true);
  });
});
