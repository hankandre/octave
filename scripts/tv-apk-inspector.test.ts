// @vitest-environment node
// T3-16 item 5 (docs/specs/T3-16.md, "The inspector check"): release_build_has_no_inspector. scripts/tv-apk-inspector.mjs
// fails when a release APK holds Expo's network inspector wiring, judged from the APK's class descriptors, its dex
// markers and its R8 mapping, and `pnpm tv:apk:check` runs it on the release APK the tv job builds.
//
// The rules (the spec's N1 to N4):
// - N1. A dex carries an R8 marker with "compilation-mode":"release" and a pg-map-id, and no dex carries a marker with
//   "compilation-mode":"debug".
// - N2. The mapping exists and its `# pg_map_id:` equals the dex marker's pg-map-id.
// - N3. No class descriptor is in an inspector package.
// - N4. No line of the mapping names a class or member of an inspector package, as a class line or an inline frame.
//
// Fixtures (scripts/fixtures/tv/inspector/, each with a `header` naming the commit and the commands that made it):
// debug-build.json, a cut of a real debug build (D8 debug markers on 19 of 21 dex files, the 25 descriptors under
// Lexpo/modules/kotlin/devtools/ and a sample of others, no mapping); release-build.json, a cut of a real release build
// (its R8 marker, a sample of descriptors, the first 200 lines of its mapping). The planted cases are built here from
// the release cut.
//
// Shapes this file freezes:
// - INSPECTOR_PACKAGES is a list of dotted Java package names and holds expo.modules.kotlin.devtools. The other entries
//   are not frozen (the dev-launcher, dev-menu and network-addons names are for the implementer to confirm).
// - judgeInspector({ descriptors, markers, mapping }) takes descriptors as dex class descriptors (`Lpkg/Name;`),
//   markers as the marker strings read from the dex files (`~~R8{...}`, `~~D8{...}`; a dex with none adds nothing), and
//   mapping as the mapping file's text or null when there is none. It returns error lines, empty when the APK passes;
//   each starts with `ERROR` and names its rule (`N1`, `N2`, `N3` or `N4`).
// - The CLI is `node scripts/tv-apk-inspector.mjs [apk] [mapping]` and exits non-zero with an ERROR line on failure.
//
// Not frozen: error wording beyond the prefix, the rule id and the class named by N3; how the script reads an APK.
//
// The script is loaded at run time from a path built here, so `pnpm typecheck` does not depend on it existing.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(repo, "scripts", "tv-apk-inspector.mjs");
const FIXTURES = join(repo, "scripts", "fixtures", "tv", "inspector");

type Facts = { descriptors: string[]; markers: string[]; mapping: string | null };
type InspectorModule = {
  INSPECTOR_PACKAGES: string[];
  judgeInspector: (facts: Facts) => string[];
};
type Cut = { header: string[]; descriptors: string[]; markers: { dex: string; marker: string | null }[]; mapping: string | null };

async function loadCheck(): Promise<InspectorModule> {
  expect(existsSync(SCRIPT), "scripts/tv-apk-inspector.mjs exists").toBe(true);
  return (await import(pathToFileURL(SCRIPT).href)) as InspectorModule;
}

function cut(name: string): Cut {
  return JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as Cut;
}

function factsOf(build: Cut): Facts {
  return {
    descriptors: [...build.descriptors],
    markers: build.markers.map((entry) => entry.marker).filter((marker): marker is string => marker !== null),
    mapping: build.mapping,
  };
}

const debug = cut("debug-build.json");
const release = cut("release-build.json");
const INSPECTOR_DESCRIPTOR = "Lexpo/modules/kotlin/devtools/";
const PLANTED_CLASS = "expo.modules.kotlin.devtools.ExpoNetworkInspectOkHttpAppInterceptor";

const rulesOf = (errors: string[]) => new Set(errors.map((line) => /\bN[1-4]\b/.exec(line)?.[0]));

function expectOnly(errors: string[], rule: string, what: string) {
  expect(errors.length, `${what} fails`).toBeGreaterThan(0);
  for (const line of errors) expect(line.startsWith("ERROR"), `${what}: ${line}`).toBe(true);
  expect([...rulesOf(errors)], `${what}: the rules named (${errors.join(" | ")})`).toEqual([rule]);
}

// Inserts `line` after the first class line of the release mapping cut.
function withLineInFirstClass(mapping: string, line: string): string {
  const lines = mapping.split("\n");
  const first = lines.findIndex((text) => /^\S.* -> \S+:$/.test(text));
  expect(first, "the release mapping cut has a class line").toBeGreaterThan(-1);
  return [...lines.slice(0, first + 1), line, ...lines.slice(first + 1)].join("\n");
}

describe("release_build_has_no_inspector", () => {
  it("T3-16 item 5: the recorded cuts are what the spec's facts say", () => {
    expect(debug.descriptors.filter((d) => d.startsWith(INSPECTOR_DESCRIPTOR))).toHaveLength(25);
    expect(debug.markers).toHaveLength(21);
    expect(debug.mapping).toBeNull();
    expect(release.descriptors.some((d) => d.startsWith(INSPECTOR_DESCRIPTOR))).toBe(false);
    expect(release.markers.map((entry) => entry.marker)).toEqual([expect.stringMatching(/^~~R8\{.*"compilation-mode":"release".*"pg-map-id":"[0-9a-f]+"/)]);
    expect(release.mapping).toMatch(/^# pg_map_id: [0-9a-f]+$/m);
    for (const build of [debug, release]) expect(build.header.join(" ")).toMatch(/bb6b2364/);
  });

  it("T3-16 item 5: INSPECTOR_PACKAGES holds Expo's inspector package", async () => {
    const { INSPECTOR_PACKAGES } = await loadCheck();
    expect(Array.isArray(INSPECTOR_PACKAGES)).toBe(true);
    expect(INSPECTOR_PACKAGES).toContain("expo.modules.kotlin.devtools");
    for (const name of INSPECTOR_PACKAGES) expect(name).toMatch(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/);
  });

  it("T3-16 item 5: the release build passes", async () => {
    const { judgeInspector } = await loadCheck();
    expect(judgeInspector(factsOf(release))).toEqual([]);
  });

  it("T3-16 item 5: the debug build fails on N1 and N3, naming an inspector class", async () => {
    const { judgeInspector } = await loadCheck();
    const errors = judgeInspector(factsOf(debug));
    for (const line of errors) expect(line.startsWith("ERROR"), line).toBe(true);
    const rules = rulesOf(errors);
    expect(rules.has("N1"), `N1 among ${errors.join(" | ")}`).toBe(true);
    expect(rules.has("N3"), `N3 among ${errors.join(" | ")}`).toBe(true);
    const simpleNames = debug.descriptors
      .filter((d) => d.startsWith(INSPECTOR_DESCRIPTOR))
      .map((d) => d.slice(d.lastIndexOf("/") + 1).replace(/;$/, ""));
    const n3 = errors.filter((line) => /\bN3\b/.test(line)).join("\n");
    expect(simpleNames.some((name) => n3.includes(name)), `an N3 line names an inspector class: ${n3}`).toBe(true);
  });

  it("T3-16 item 5: the debug build with no mapping also fails on N2", async () => {
    const { judgeInspector } = await loadCheck();
    expect(rulesOf(judgeInspector(factsOf(debug))).has("N2")).toBe(true);
  });

  it("T3-16 item 5: a debug marker beside the release marker, or no R8 release marker, fails on N1", async () => {
    const { judgeInspector } = await loadCheck();
    const facts = factsOf(release);
    const debugMarker = debug.markers.find((entry) => entry.marker !== null)?.marker as string;
    expectOnly(judgeInspector({ ...facts, markers: [...facts.markers, debugMarker] }), "N1", "a debug marker beside the release marker");
    const debugMode = facts.markers.map((m) => m.replace('"compilation-mode":"release"', '"compilation-mode":"debug"'));
    expect(rulesOf(judgeInspector({ ...facts, markers: debugMode })).has("N1"), "an R8 marker in debug mode").toBe(true);
    const withoutMapId = facts.markers.map((m) => m.replace(/,?"pg-map-id":"[0-9a-f]+"/, ""));
    expect(rulesOf(judgeInspector({ ...facts, markers: withoutMapId })).has("N1"), "an R8 marker without a pg-map-id").toBe(true);
    expect(rulesOf(judgeInspector({ ...facts, markers: [] })).has("N1"), "no marker").toBe(true);
  });

  it("T3-16 item 5: a mapping from another build or no mapping fails on N2", async () => {
    const { judgeInspector } = await loadCheck();
    const facts = factsOf(release);
    const other = (facts.mapping as string).replace(/^# pg_map_id: [0-9a-f]+$/m, `# pg_map_id: ${"0".repeat(64)}`);
    expect(other).not.toBe(facts.mapping);
    expectOnly(judgeInspector({ ...facts, mapping: other }), "N2", "a mapping with another pg_map_id");
    expectOnly(judgeInspector({ ...facts, mapping: null }), "N2", "no mapping");
    const unmarked = (facts.mapping as string).replace(/^# pg_map_id: .*\n/m, "");
    expectOnly(judgeInspector({ ...facts, mapping: unmarked }), "N2", "a mapping without a pg_map_id");
  });

  it("T3-16 item 5: an inspector class descriptor in a release build fails on N3", async () => {
    const { judgeInspector } = await loadCheck();
    const facts = factsOf(release);
    expectOnly(
      judgeInspector({ ...facts, descriptors: [...facts.descriptors, "Lexpo/modules/kotlin/devtools/ExpoRequestCdpInterceptor;"] }),
      "N3",
      "a kept inspector class",
    );
    expectOnly(
      judgeInspector({ ...facts, descriptors: [...facts.descriptors, "Lexpo/modules/kotlin/devtools/cdp/Event;"] }),
      "N3",
      "a kept class of a subpackage",
    );
  });

  it("T3-16 item 5: a mapping that names an inspector class, as a class line or only as an inline frame, fails on N4", async () => {
    const { judgeInspector } = await loadCheck();
    const facts = factsOf(release);
    const mapping = facts.mapping as string;
    expectOnly(judgeInspector({ ...facts, mapping: `${mapping.replace(/\n$/, "")}\n${PLANTED_CLASS} -> a1b:\n` }), "N4", "a renamed inspector class");
    const inline = withLineInFirstClass(mapping, `    1:4:okhttp3.Response ${PLANTED_CLASS}.intercept(okhttp3.Interceptor$Chain):42:45 -> a`);
    expectOnly(judgeInspector({ ...facts, mapping: inline }), "N4", "an inspector method inlined into another class");
  });

  it("T3-16 item 5: a package that only begins with an inspector package's name passes", async () => {
    const { judgeInspector } = await loadCheck();
    const facts = factsOf(release);
    const mapping = `${(facts.mapping as string).replace(/\n$/, "")}\nexpo.modules.kotlin.devtoolsx.Other -> b1c:\n`;
    expect(judgeInspector({ ...facts, mapping, descriptors: [...facts.descriptors, "Lexpo/modules/kotlin/devtoolsx/Other;"] })).toEqual([]);
  });

  it("T3-16 item 5: the command fails on an APK that does not exist", () => {
    const dir = mkdtempSync(join(tmpdir(), "octave-t3-16-inspector-"));
    try {
      const mapping = join(dir, "mapping.txt");
      writeFileSync(mapping, release.mapping as string);
      expect(existsSync(SCRIPT), "scripts/tv-apk-inspector.mjs exists").toBe(true);
      const child = spawnSync(process.execPath, [SCRIPT, join(dir, "missing.apk"), mapping], { cwd: repo, encoding: "utf8" });
      expect(child.status, child.stderr).not.toBe(0);
      expect(`${child.stdout}${child.stderr}`).toMatch(/ERROR/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("pnpm tv:apk:check runs the inspector check", () => {
  it("T3-16 item 5: package.json's tv:apk:check runs the inspector script after the badging and manifest scripts", () => {
    const pkg = JSON.parse(readFileSync(join(repo, "package.json"), "utf8")) as { scripts: Record<string, string> };
    const command = pkg.scripts["tv:apk:check"] ?? "";
    const badging = command.indexOf("node scripts/tv-apk-check.mjs");
    const manifest = command.indexOf("node scripts/tv-apk-manifest.mjs");
    const inspector = command.indexOf("node scripts/tv-apk-inspector.mjs");
    expect(badging, "tv:apk:check runs node scripts/tv-apk-check.mjs").toBeGreaterThan(-1);
    expect(manifest, "tv:apk:check runs node scripts/tv-apk-manifest.mjs").toBeGreaterThan(-1);
    expect(inspector, "tv:apk:check runs node scripts/tv-apk-inspector.mjs after the badging script").toBeGreaterThan(badging);
    expect(inspector, "tv:apk:check runs node scripts/tv-apk-inspector.mjs after the manifest script").toBeGreaterThan(manifest);
  });

  it("T3-16 item 5: CI's tv job runs pnpm tv:apk:check after pnpm tv:build", () => {
    const lines = readFileSync(join(repo, ".github", "workflows", "ci.yml"), "utf8").split("\n");
    const start = lines.findIndex((line) => line === "  tv:");
    expect(start, "ci.yml has a job named tv").toBeGreaterThan(-1);
    const rest = lines.slice(start + 1);
    const end = rest.findIndex((line) => /^ {2}\S/.test(line));
    const runs = (end === -1 ? rest : rest.slice(0, end))
      .map((line) => /^\s+(?:- )?run:\s*(.+?)\s*$/.exec(line)?.[1])
      .filter((run): run is string => run !== undefined);
    expect(runs).toContain("pnpm tv:build");
    expect(runs.indexOf("pnpm tv:apk:check")).toBeGreaterThan(runs.indexOf("pnpm tv:build"));
  });
});
