// T3-34 items 1 and 5: Tabler's icon font is the only icon source, bundled through expo-font, and it is the weight-300 file.
// docs/specs/T3-34.md, "Acceptance". The Expo config is read the way scripts/tv-app-identity.test.ts reads it.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const tv = join(repo, "apps", "tv");
const PACKAGE = "@tabler/icons-webfont";
const EXPO_TIMEOUT = 60_000;

type Family = { fontFamily: string; path: string; fontDefinitions: { weight: number }[] };
type ExpoConfig = { plugins?: (string | [string, Record<string, any>?])[] };

function expoConfig(): ExpoConfig {
  const child = spawnSync("pnpm", ["exec", "expo", "config", "--json"], {
    cwd: tv,
    encoding: "utf8",
    timeout: EXPO_TIMEOUT,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, EXPO_NO_TELEMETRY: "1", EXPO_OFFLINE: "1", CI: "1" },
  });
  expect(child.error, `expo config could not start: ${child.error?.message}`).toBeUndefined();
  expect(child.status, `expo config failed:\n${child.stdout}\n${child.stderr}`).toBe(0);
  const out = child.stdout;
  return JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1)) as ExpoConfig;
}

function fontFamilies(): Family[] {
  const entry = (expoConfig().plugins ?? []).find((plugin) => Array.isArray(plugin) && plugin[0] === "expo-font");
  expect(entry, "the Expo config has an expo-font plugin entry").toBeDefined();
  const options = (entry as [string, Record<string, any>])[1] ?? {};
  return (options.android?.fonts ?? []) as Family[];
}

function tablerFamily(): Family {
  const family = fontFamilies().find((candidate) => candidate.fontFamily === "TablerIcons");
  expect(family, "the expo-font entry's android.fonts holds the TablerIcons family").toBeDefined();
  return family as Family;
}

const fromTv = createRequire(join(tv, "package.json"));

describe("T3-34 item 1: Tabler's font through expo-font, and nothing else", () => {
  it("T3-34 item 1: apps/tv depends on @tabler/icons-webfont at exactly 3.52.0", () => {
    const manifest = JSON.parse(readFileSync(join(tv, "package.json"), "utf8")) as { dependencies?: Record<string, string> };
    expect(manifest.dependencies?.[PACKAGE]).toBe("3.52.0");
  });

  it("T3-34 item 1: no other dependency or devDependency is an icon, svg or vector package", () => {
    const manifest = JSON.parse(readFileSync(join(tv, "package.json"), "utf8")) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const names = [...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.devDependencies ?? {})];
    expect(names.filter((name) => name !== PACKAGE && /icon|svg|vector/i.test(name))).toEqual([]);
  });

  it("T3-34 item 1: the TablerIcons family's path resolves to an existing file of the package's fonts", () => {
    const family = tablerFamily();
    const own = join(tv, family.path);
    const installed = fromTv.resolve(`${PACKAGE}/dist/fonts/tabler-icons-300.ttf`);
    const resolved = existsSync(own) ? own : fromTv.resolve(family.path);
    expect(existsSync(resolved), `${family.path} exists`).toBe(true);
    if (realpathSync(resolved).includes(`${PACKAGE}/dist/fonts/`)) return;
    // A copy under apps/tv/assets/fonts (the spec's fallback) must be byte-identical to the package's file.
    const digest = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
    expect(digest(resolved)).toBe(digest(installed));
  });

  it("T3-34 item 1: the installed package has no android directory and no expo-module.config.json, so autolinking finds no native module", () => {
    const root = dirname(fromTv.resolve(`${PACKAGE}/package.json`));
    expect(existsSync(join(root, "android"))).toBe(false);
    expect(existsSync(join(root, "expo-module.config.json"))).toBe(false);
  });
});

describe("T3-34 item 5: the owner's stroke weight is the light, weight-300 file", () => {
  it("T3-34 item 5: the TablerIcons family points at tabler-icons-300.ttf and has one definition", () => {
    const family = tablerFamily();
    expect(family.path.endsWith("/tabler-icons-300.ttf")).toBe(true);
    expect(family.fontDefinitions).toHaveLength(1);
  });

  it("T3-34 item 5: no other family's path names tabler-icons", () => {
    const others = fontFamilies().filter((family) => family.fontFamily !== "TablerIcons");
    expect(others.filter((family) => family.path.includes("tabler-icons"))).toEqual([]);
  });
});
