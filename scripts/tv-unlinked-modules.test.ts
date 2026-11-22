// @vitest-environment node
// T3-19 item 3: expo-file-system, expo-asset, @expo/log-box and @expo/dom-webview are excluded from Android autolinking
// unless one must stay, which KEPT_EXPO_MODULES lists with its reason and the trial's evidence; LINKED_NETWORK_PATHS
// names only what the APK still holds. Written over the partition, so it holds whichever packages the trials keep.
//
// "Excluded" is read by Expo's override rule (expo-modules-autolinking 58.1.0, build/commands/autolinkingOptions.js,
// parsePackageJsonOptions): `expo.autolinking.android` is spread over `expo.autolinking`, so an `exclude` under
// `android` replaces the top-level one and is never merged with it; a value that is not a list excludes nothing. This
// is the same rule as excludedOnAndroid() in scripts/linked-network-paths.test.ts.
//
// Product Owner condition on the frozen-test change 24a79047 (tasks/product-owner-log.md, 2026-11-22): each excluded
// package's Java package is on the production ABSENT_PACKAGES, so the dex check fails if its classes come back.
//
// The interface these tests hold is written at the top of scripts/fixtures/tv/dex/harness.ts; linkedPackages(root) is
// T3-04's ({ packages: { name, dir }[], errors }).
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { cleanTemps, loadFixtureLists, loadProductionLists, repo, runDex } from "./fixtures/tv/dex/harness";

const TIMEOUT = 60_000;

// The four packages item 3 names, with their Java packages (their android/build.gradle namespace and package lines).
const FOUR: Record<string, string> = {
  "expo-file-system": "expo.modules.filesystem.",
  "expo-asset": "expo.modules.asset.",
  "@expo/log-box": "expo.modules.logbox.",
  "@expo/dom-webview": "expo.modules.webview.",
};

type LinkedEntry = { id: string; package: string };
type CheckNetworkPaths = {
  LINKED_NETWORK_PATHS: LinkedEntry[];
  linkedPackages(root: string): { packages: { name: string; dir: string }[]; errors: string[] };
};

async function loadCheck(): Promise<CheckNetworkPaths> {
  return (await import(pathToFileURL(join(repo, "scripts", "check-network-paths.mjs")).href)) as CheckNetworkPaths;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function excludedOnAndroid(manifest: unknown): Set<string> {
  const expo = isObject(manifest) && isObject(manifest.expo) ? manifest.expo : {};
  const autolinking = isObject(expo.autolinking) ? expo.autolinking : {};
  const merged = { ...autolinking, ...(isObject(autolinking.android) ? autolinking.android : {}) };
  const exclude: unknown[] = Array.isArray(merged.exclude) ? merged.exclude : [];
  return new Set(exclude.filter((name): name is string => typeof name === "string"));
}

const APP_EXCLUDED = excludedOnAndroid(JSON.parse(readFileSync(join(repo, "apps", "tv", "package.json"), "utf8")));
const EXCLUDED_FOUR = Object.keys(FOUR).filter((name) => APP_EXCLUDED.has(name));

const temps: string[] = [];
afterAll(() => {
  cleanTemps();
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

type Kept = { package: string; reason: string; evidence: string };

describe("T3-19 item 3: each of the four is excluded or kept with its reason", () => {
  it("T3-19 item 3: each package is in exactly one of the Android exclusion list and KEPT_EXPO_MODULES, and a kept one has a reason and evidence", async () => {
    const lists = await loadProductionLists();
    const kept = lists.KEPT_EXPO_MODULES as Kept[];
    expect(Array.isArray(kept)).toBe(true);
    for (const row of kept) expect(Object.keys(FOUR), `KEPT_EXPO_MODULES names ${row.package}`).toContain(row.package);
    for (const name of Object.keys(FOUR)) {
      const rows = kept.filter((row) => row.package === name);
      const excluded = APP_EXCLUDED.has(name);
      expect(rows.length + (excluded ? 1 : 0), `${name}: excluded on Android or kept, exactly one`).toBe(1);
      for (const row of rows) {
        expect(typeof row.reason === "string" && row.reason.trim().length > 0, `${name}: reason`).toBe(true);
        expect(typeof row.evidence === "string" && row.evidence.trim().length > 0, `${name}: evidence`).toBe(true);
      }
    }
  });

  it("T3-19 item 3: an excluded package has no LINKED_NETWORK_PATHS row, is not read by linkedPackages, and its Java package is on ABSENT_PACKAGES", async () => {
    const lists = await loadProductionLists();
    const absent = lists.ABSENT_PACKAGES as string[];
    expect(Array.isArray(absent)).toBe(true);
    const { LINKED_NETWORK_PATHS, linkedPackages } = await loadCheck();
    const ids: Record<string, string> = { "expo-file-system": "E2", "expo-asset": "E3", "@expo/log-box": "E4", "@expo/dom-webview": "E5" };
    const read = linkedPackages(repo).packages.map((pkg) => pkg.name);
    for (const name of EXCLUDED_FOUR) {
      expect(LINKED_NETWORK_PATHS.filter((entry) => entry.package === name || entry.id === ids[name]), `${name}: rows`).toEqual([]);
      expect(read, `${name}: linkedPackages`).not.toContain(name);
      expect(absent, `${name}: ${FOUR[name]} on ABSENT_PACKAGES`).toContain(FOUR[name]);
    }
  });
});

// --- linkedPackages on fixture trees ----------------------------------------------------------------------------

function tree(appManifest: Record<string, unknown>, packages: { name: string; dependencies?: string[] }[]): string {
  const root = mkdtempSync(join(tmpdir(), "octave-linked-"));
  temps.push(root);
  mkdirSync(join(root, "apps", "tv"), { recursive: true });
  writeFileSync(join(root, "apps", "tv", "package.json"), JSON.stringify({ name: "@octave/tv", ...appManifest }));
  for (const pkg of packages) {
    const dir = join(root, "node_modules", ...pkg.name.split("/"));
    mkdirSync(join(dir, "android"), { recursive: true });
    const dependencies = Object.fromEntries((pkg.dependencies ?? []).map((name) => [name, "1.0.0"]));
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: pkg.name, version: "1.0.0", dependencies }));
  }
  return root;
}

const PACKAGES = [
  { name: "expo-file-system", dependencies: ["fs-helper"] },
  { name: "expo-asset" },
  { name: "fs-helper" },
  { name: "other-native" },
];
const DEPENDENCIES = { dependencies: { "expo-file-system": "1.0.0", "expo-asset": "1.0.0", "other-native": "1.0.0" } };

async function namesFor(autolinking: Record<string, unknown>): Promise<string[]> {
  const { linkedPackages } = await loadCheck();
  const result = linkedPackages(tree({ ...DEPENDENCIES, expo: { autolinking } }, PACKAGES));
  expect(result.errors).toEqual([]);
  return result.packages.map((pkg) => pkg.name).sort();
}

describe("T3-19 item 3: linkedPackages reads the exclusion list by Expo's override rule", () => {
  it("T3-19 item 3: a top-level exclude skips one of the four and still follows its dependencies", async () => {
    expect(await namesFor({ exclude: ["expo-file-system"] })).toEqual(["expo-asset", "fs-helper", "other-native"]);
  });

  it("T3-19 item 3: an exclude under android replaces the top-level one", async () => {
    expect(await namesFor({ exclude: ["expo-file-system"], android: { exclude: [] } })).toEqual(["expo-asset", "expo-file-system", "fs-helper", "other-native"]);
    expect(await namesFor({ exclude: ["expo-file-system"], android: { exclude: ["expo-asset"] } })).toEqual(["expo-file-system", "fs-helper", "other-native"]);
  });

  it("T3-19 item 3: a name outside the four on the list is still read, and an exclude that is not a list excludes nothing", async () => {
    expect(await namesFor({ exclude: ["other-native"] })).toEqual(["expo-asset", "expo-file-system", "fs-helper", "other-native"]);
    expect(await namesFor({ exclude: "expo-file-system" })).toEqual(["expo-asset", "expo-file-system", "fs-helper", "other-native"]);
  });
});

// --- D5 and the partition -----------------------------------------------------------------------------------------

describe("T3-19 item 3: the dex check and LINKED_NETWORK_PATHS", () => {
  it(
    "T3-19 item 3: D5 fails a dex holding expo.modules.filesystem.FileSystemDownloadKt when its package is absent, and passes it otherwise",
    async () => {
      const { FIXTURE_LISTS } = await loadFixtureLists();
      const control = await runDex({ lists: FIXTURE_LISTS });
      expect(control.code, control.out).toBe(0);
      const run = await runDex({ lists: { ...FIXTURE_LISTS, absentPackages: ["expo.modules.filesystem."] } });
      expect(run.code, run.out).toBe(1);
      expect(run.out).toMatch(/^ERROR tv apk dex: .*expo\.modules\.filesystem\./m);
    },
    TIMEOUT,
  );

  it("T3-19 item 3: every LINKED_NETWORK_PATHS id is an entry point's linkedPath or source-only with a reason, never both, and both lists name only real ids", async () => {
    const lists = await loadProductionLists();
    const rows = lists.APK_NETWORK_ENTRY_POINTS as { id: string; linkedPath: string | null }[];
    const sourceOnly = lists.SOURCE_ONLY_LINKED_PATHS as { id: string; reason: string }[];
    const { LINKED_NETWORK_PATHS } = await loadCheck();
    const ids = new Set(LINKED_NETWORK_PATHS.map((entry) => entry.id));
    const linked = new Set(rows.map((row) => row.linkedPath).filter((id): id is string => id !== null));
    const source = new Set(sourceOnly.map((entry) => entry.id));
    for (const entry of sourceOnly) {
      expect(typeof entry.reason === "string" && entry.reason.trim().length > 0, `${entry.id}: reason`).toBe(true);
      expect(ids.has(entry.id), `source-only ${entry.id} is a LINKED_NETWORK_PATHS id`).toBe(true);
    }
    for (const id of linked) expect(ids.has(id), `linkedPath ${id} is a LINKED_NETWORK_PATHS id`).toBe(true);
    for (const id of ids) {
      expect(Number(linked.has(id)) + Number(source.has(id)), `${id}: an entry point's linkedPath or source-only, exactly one`).toBe(1);
    }
  });
});
