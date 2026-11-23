// @vitest-environment node
// T3-01 acceptance item 1: apps/tv is an Expo SDK 58 app on react-native-tvos 0.88.x that builds for TV, with the
// application ID cloud.jellyscale.octave (T3-21 item 7). The manifest pins every package the spec's Dependencies table
// adopts and none it rejects; Expo's own config resolution gives the core's application ID, the Kotlin package and the
// TV plugin. The build is item 2's job.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ANDROID_APPLICATION_ID, APP_NAME } from "../packages/core/src/domain/app-identity";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const app = join(repo, "apps", "tv");
const EXPO_TIMEOUT = 60_000;

type Manifest = {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

function manifest(): Manifest {
  const path = join(app, "package.json");
  expect(existsSync(path), "apps/tv/package.json exists").toBe(true);
  return JSON.parse(readFileSync(path, "utf8")) as Manifest;
}

function declared(pkg: Manifest): Record<string, string> {
  return { ...pkg.peerDependencies, ...pkg.optionalDependencies, ...pkg.devDependencies, ...pkg.dependencies };
}

// The "Adopted in apps/tv/package.json" table of docs/specs/T3-01.md, read on 2026-11-21.
const ADOPTED: [string, string | RegExp][] = [
  ["expo", "~58.0.26"],
  ["react-native", "npm:react-native-tvos@0.88.1-0"],
  ["react", "19.3.0"],
  ["expo-build-properties", "~58.0.12"],
  ["@shopify/flash-list", "2.3.3"],
  ["react-native-reanimated", "4.7.1"],
  ["react-native-worklets", "0.13.0"],
  ["@react-navigation/native", "7.5.2"],
  ["@react-navigation/native-stack", "7.21.1"],
  ["react-native-screens", "~4.30.1"],
  ["react-native-safe-area-context", "~5.11.1"],
  ["@react-native-tvos/config-tv", "0.1.7"],
  ["@babel/core", /^[~^]?7\.29\.\d+$/],
  ["@types/react", "~19.3.0"],
];

// The "Rejected" table, the security rules and the core's transport rule.
const REJECTED = ["expo-image", "expo-router", "expo-dev-client", "expo-updates", "react-native-web", "axios", "@jellyfin/sdk"];

type TvPlugin = string | [string, Record<string, unknown>?];

type ExpoConfig = {
  name?: string;
  android?: { package?: string };
  plugins?: TvPlugin[];
};

function expoConfig(): ExpoConfig {
  expect(existsSync(join(app, "package.json")), "apps/tv/package.json exists").toBe(true);
  const child = spawnSync("pnpm", ["exec", "expo", "config", "--json"], {
    cwd: app,
    encoding: "utf8",
    timeout: EXPO_TIMEOUT,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, EXPO_NO_TELEMETRY: "1", EXPO_OFFLINE: "1", CI: "1" },
  });
  expect(child.error, `expo config could not start: ${child.error?.message}`).toBeUndefined();
  expect(child.status, `expo config failed:\n${child.stdout}\n${child.stderr}`).toBe(0);
  const out = child.stdout;
  const start = out.indexOf("{");
  const end = out.lastIndexOf("}");
  expect(start, `expo config printed no JSON:\n${out}`).toBeGreaterThan(-1);
  return JSON.parse(out.slice(start, end + 1)) as ExpoConfig;
}

// Generated trees sit at the app root only; node_modules is skipped at any depth.
const GENERATED = new Set(["android", "ios", ".expo", "dist"]);

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules" || (dir === app && GENERATED.has(entry.name))) return [];
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

describe("apps/tv manifest", () => {
  it("T3-01 item 1: is the workspace package @octave/tv", () => {
    expect(manifest().name).toBe("@octave/tv");
  });

  it("T3-01 item 1: is on Expo SDK 58 and react-native aliased to react-native-tvos 0.88", () => {
    const deps = declared(manifest());
    expect(deps.expo).toMatch(/^~58\.0\.\d+$/);
    expect(deps["react-native"]).toMatch(/^npm:react-native-tvos@0\.88\.\d+-\d+$/);
  });

  it.each(ADOPTED)("T3-01 item 1: pins the adopted %s at the version the spec records", (name, version) => {
    const deps = declared(manifest());
    expect(deps[name], `${name} is declared`).toBeDefined();
    if (typeof version === "string") expect(deps[name]).toBe(version);
    else expect(deps[name]).toMatch(version);
  });

  it.each(REJECTED)("T3-01 item 1: does not declare the rejected %s", (name) => {
    expect(declared(manifest())[name]).toBeUndefined();
  });
});

describe("apps/tv resolved Expo config", () => {
  it(
    "T3-01 item 1: builds with the core's application ID and name, and the TV plugin on",
    () => {
      expect(ANDROID_APPLICATION_ID).toBe("cloud.jellyscale.octave");
      const config = expoConfig();
      // T3-21 item 7: android.package is the Kotlin package, apart from the application ID.
      expect(config.android?.package).toBe("dev.octave.tv");
      expect(config.name).toBe(APP_NAME);
      const tv = (config.plugins ?? []).find((plugin) => (Array.isArray(plugin) ? plugin[0] : plugin) === "@react-native-tvos/config-tv");
      expect(tv, "the @react-native-tvos/config-tv plugin is listed").toBeDefined();
      expect(Array.isArray(tv) ? tv[1]?.isTV : undefined, "the TV plugin has isTV: true").toBe(true);
    },
    EXPO_TIMEOUT + 30_000,
  );

  it("T3-01 item 1: defines the application ID only in the core: no literal in apps/tv or the tv scripts", () => {
    expect(existsSync(join(app, "app.config.ts")) || existsSync(join(app, "app.config.js")), "apps/tv has an app config").toBe(true);
    const appFiles = walk(app);
    const scripts = readdirSync(join(repo, "scripts"))
      .filter((name) => /^(tv-.*|check-tv-platform)\.mjs$/.test(name))
      .map((name) => join(repo, "scripts", name));
    const offenders = [...appFiles, ...scripts]
      .filter((path) => readFileSync(path, "utf8").includes(ANDROID_APPLICATION_ID))
      .map((path) => relative(repo, path));
    expect(offenders).toEqual([]);
  });
});
