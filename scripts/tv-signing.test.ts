// @vitest-environment node
// T3-21 item 2 (docs/specs/T3-21.md, "Test plan"): a release build for a real TV is signed with the owner's private
// key, found through OCTAVE_SIGNING_PROPERTIES, and never with the template's debug keystore. Without the key the build
// fails before Gradle runs and names what is missing. The Gradle text comes from the config plugin
// apps/tv/plugins/with-release-signing.js; its transform runs here on the recorded template app/build.gradle.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type TvBuildSystem, buildTv } from "./tv-build.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const TEMPLATE = readFileSync(join(repo, "scripts", "fixtures", "tv", "signing", "template-app-build.gradle"), "utf8");
const VARIABLE = "OCTAVE_SIGNING_PROPERTIES";
const PASSWORD = "pw-marker-3f9a1c";
// A directory name that stands for the owner's home: no error line may carry it.
const PATH_MARKER = "owner-home-marker";

type SigningModule = {
  signingProblems(env: Record<string, string | undefined>, options: { repoRoot: string }): string[];
};
type SigningPlugin = {
  addReleaseSigning(contents: string, options: { applicationId: string }): string;
};

const signing = (): Promise<SigningModule> => import("./tv-signing.mjs") as Promise<SigningModule>;
const plugin = (): SigningPlugin => require("../apps/tv/plugins/with-release-signing.js") as SigningPlugin;

let work: string;
// A stand-in for the repository root, so "inside the repository" is tested without touching the real one.
let fakeRepo: string;
// The owner's side: outside the stand-in repository, under a directory carrying the path marker.
let owner: string;

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "octave-signing-"));
  fakeRepo = join(work, "checkout");
  owner = join(work, PATH_MARKER);
  mkdirSync(fakeRepo, { recursive: true });
  mkdirSync(owner, { recursive: true });
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

type Keys = { storeFile?: string; storePassword?: string; keyAlias?: string; keyPassword?: string };

function writeProperties(dir: string, keys: Keys, name = "signing.properties"): string {
  const lines = Object.entries(keys)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${value}`);
  const path = join(dir, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, `${lines.join("\n")}\n`);
  return path;
}

function goodKeys(dir = owner): Keys {
  writeFileSync(join(dir, "octave.jks"), "not a real keystore");
  return { storeFile: "octave.jks", storePassword: PASSWORD, keyAlias: "octave", keyPassword: PASSWORD };
}

async function problems(env: Record<string, string | undefined>, root = fakeRepo): Promise<string[]> {
  return (await signing()).signingProblems(env, { repoRoot: root });
}

function expectNamed(lines: string[], what: RegExp): void {
  expect(lines.length).toBeGreaterThanOrEqual(1);
  expect(lines.join("\n")).toMatch(what);
  for (const line of lines) {
    expect(line).toMatch(/^ERROR tv build: /);
    expect(line, "a line prints no path").not.toContain(PATH_MARKER);
    expect(line, "a line prints no password").not.toContain(PASSWORD);
    expect(line, "a line prints no path").not.toContain(work);
  }
}

describe("signingProblems: what is missing is named, and no path or value is printed", () => {
  it("T3-21 item 2: passes when the variable names a complete properties file outside the repository", async () => {
    const path = writeProperties(owner, goodKeys());
    expect(await problems({ [VARIABLE]: path })).toEqual([]);
  });

  it("T3-21 item 2: names the variable when it is not set or is empty", async () => {
    expectNamed(await problems({}), new RegExp(VARIABLE));
    expectNamed(await problems({ [VARIABLE]: "" }), new RegExp(VARIABLE));
  });

  it("T3-21 item 2: names a properties file that does not exist, without its path", async () => {
    const lines = await problems({ [VARIABLE]: join(owner, "missing.properties") });
    expectNamed(lines, new RegExp(VARIABLE));
    expect(lines.join("\n")).toMatch(/does not exist/);
  });

  it.each(["storeFile", "storePassword", "keyAlias", "keyPassword"] as const)("T3-21 item 2: names the missing key %s", async (key) => {
    const keys = goodKeys();
    delete keys[key];
    const path = writeProperties(owner, keys);
    const lines = await problems({ [VARIABLE]: path });
    expectNamed(lines, new RegExp(key));
    // Only the missing key is named.
    for (const other of ["storeFile", "storePassword", "keyAlias", "keyPassword"].filter((name) => name !== key)) {
      expect(lines.join("\n")).not.toContain(other);
    }
  });

  it("T3-21 item 2: names a store file that does not exist", async () => {
    const path = writeProperties(owner, { ...goodKeys(), storeFile: "gone.jks" });
    const lines = await problems({ [VARIABLE]: path });
    expectNamed(lines, /storeFile/);
    expect(lines.join("\n")).toMatch(/does not exist/);
  });

  it("T3-21 item 2: resolves a relative storeFile against the properties file's directory, not the working directory", async () => {
    const sub = join(owner, "keys");
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(sub, "relative.jks"), "not a real keystore");
    const path = writeProperties(sub, { storeFile: "relative.jks", storePassword: PASSWORD, keyAlias: "octave", keyPassword: PASSWORD });
    expect(await problems({ [VARIABLE]: path })).toEqual([]);
  });

  it("T3-21 item 2: accepts an absolute storeFile", async () => {
    const keys = goodKeys();
    const path = writeProperties(owner, { ...keys, storeFile: join(owner, "octave.jks") });
    expect(await problems({ [VARIABLE]: path })).toEqual([]);
  });

  it("T3-21 item 2: refuses a properties file inside the repository", async () => {
    const inside = join(fakeRepo, "secrets");
    mkdirSync(inside, { recursive: true });
    writeFileSync(join(inside, "octave.jks"), "not a real keystore");
    const path = writeProperties(inside, { storeFile: "octave.jks", storePassword: PASSWORD, keyAlias: "octave", keyPassword: PASSWORD });
    expectNamed(await problems({ [VARIABLE]: path }), /inside the repository/);
  });

  it("T3-21 item 2: refuses a store file inside the repository", async () => {
    writeFileSync(join(fakeRepo, "octave.jks"), "not a real keystore");
    const path = writeProperties(owner, { storeFile: join(fakeRepo, "octave.jks"), storePassword: PASSWORD, keyAlias: "octave", keyPassword: PASSWORD });
    expectNamed(await problems({ [VARIABLE]: path }), /inside the repository/);
  });

  it("T3-21 item 2: --throwaway makes a key a build accepts, prints only the properties path, and never prints the password", async () => {
    const dir = join(work, "throwaway");
    const result = spawnSync(process.execPath, [join(repo, "scripts", "tv-signing.mjs"), "--throwaway", dir], { encoding: "utf8", timeout: 60_000 });
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    const printed = result.stdout.trim();
    expect(printed.split("\n")).toHaveLength(1);
    expect(existsSync(printed), "the printed path is the properties file").toBe(true);
    expect(await problems({ [VARIABLE]: printed })).toEqual([]);
    const text = readFileSync(printed, "utf8");
    const password = /^storePassword=(.+)$/m.exec(text)?.[1] ?? "";
    expect(password.length).toBeGreaterThanOrEqual(16);
    expect(result.stdout + result.stderr).not.toContain(password);
  }, 90_000);
});

describe("buildTv stops before Gradle when the key is missing", () => {
  const LINE = "ERROR tv build: OCTAVE_SIGNING_PROPERTIES is not set";

  function system(gradleCalls: string[][]): TvBuildSystem {
    return {
      prebuildIsCurrent: () => true,
      prebuild: () => 0,
      sourceHash: () => "hash",
      gradle: (tasks: string[]) => {
        gradleCalls.push(tasks);
        return { status: 0 };
      },
      signingProblems: () => [LINE],
      releaseApk: join(work, "android/app/build/outputs/apk/release/app-release.apk"),
      releaseMapping: join(work, "android/app/build/outputs/mapping/release/mapping.txt"),
      bundleDir: join(work, "android/app/build/generated/assets"),
      probeBuildDir: join(work, "modules/session/android/build/outputs/apk/androidTest/debug"),
      e2eApk: join(work, "dist/e2e/octave-tv-e2e.apk"),
      e2eMapping: join(work, "dist/e2e/octave-tv-e2e.mapping.txt"),
      e2eStamp: join(work, "dist/e2e/octave-tv-e2e.hash"),
      probeApk: join(work, "dist/e2e/octave-session-probe.apk"),
    } as unknown as TvBuildSystem;
  }

  it.each([false, true])("T3-21 item 2: returns the line and never calls Gradle (e2e %s)", (e2e) => {
    const calls: string[][] = [];
    expect(buildTv({ e2e }, system(calls))).toEqual([LINE]);
    expect(calls).toEqual([]);
  });
});

// The release build type's text, from `release {` to its closing brace.
function releaseBlock(gradle: string): string {
  const buildTypes = gradle.indexOf("buildTypes");
  expect(buildTypes, "the template has buildTypes").toBeGreaterThanOrEqual(0);
  const open = gradle.indexOf("{", gradle.indexOf("release", buildTypes));
  let depth = 0;
  for (let i = open; i < gradle.length; i += 1) {
    if (gradle[i] === "{") depth += 1;
    if (gradle[i] === "}") depth -= 1;
    if (depth === 0) return gradle.slice(open, i + 1);
  }
  throw new Error("unbalanced release block");
}

function debugBlock(gradle: string): string {
  const buildTypes = gradle.slice(gradle.indexOf("buildTypes"));
  const open = buildTypes.indexOf("{", buildTypes.indexOf("debug {"));
  return buildTypes.slice(open, buildTypes.indexOf("}", open) + 1);
}

describe("the release-signing plugin's transform of the recorded template", () => {
  const options = { applicationId: "com.example.appid" };

  it("T3-21 item 2: the recorded template signs release with the debug keystore (the premise)", () => {
    expect(releaseBlock(TEMPLATE)).toContain("signingConfig signingConfigs.debug");
  });

  it("T3-21 item 2: release is signed by octaveRelease and no longer by the debug config; debug stays as it was", () => {
    const out = plugin().addReleaseSigning(TEMPLATE, options);
    const release = releaseBlock(out);
    expect(release).toContain("signingConfig signingConfigs.octaveRelease");
    expect(release).not.toContain("signingConfigs.debug");
    expect(debugBlock(out)).toBe(debugBlock(TEMPLATE));
    expect(out).toMatch(/signingConfigs\s*\{[\s\S]*octaveRelease\s*\{/);
  });

  it("T3-21 item 2: the guard names the variable, reads the environment, and fails a release packaging task", () => {
    const out = plugin().addReleaseSigning(TEMPLATE, options);
    expect(out).toContain(VARIABLE);
    expect(out).toContain("taskGraph.whenReady");
    expect(out).toMatch(/System\.getenv\(\s*["']OCTAVE_SIGNING_PROPERTIES["']\s*\)/);
    expect(out).toMatch(/packageRelease/);
    expect(out).toMatch(/assembleRelease/);
    expect(out).toMatch(/bundleRelease/);
    expect(out).toMatch(/GradleException/);
  });

  it("T3-21 item 2: what the plugin adds holds no password literal", () => {
    const out = plugin().addReleaseSigning(TEMPLATE, options);
    const before = new Set(TEMPLATE.split("\n"));
    const added = out.split("\n").filter((line) => !before.has(line));
    expect(added.length).toBeGreaterThan(0);
    for (const line of added) {
      expect(line).not.toMatch(/(storePassword|keyPassword)\s*=?\s*['"]/);
    }
    expect(added.join("\n")).not.toMatch(/\bandroid\b['"]/);
  });

  it("T3-21 item 2: applied twice, the result is the same as applied once", () => {
    const once = plugin().addReleaseSigning(TEMPLATE, options);
    expect(plugin().addReleaseSigning(once, options)).toBe(once);
  });

  it("T3-21 item 2: throws on a template with no release signingConfig line", () => {
    const release = releaseBlock(TEMPLATE);
    const without = TEMPLATE.replace(release, release.replace(/^.*signingConfig signingConfigs\.debug.*\n/m, ""));
    expect(without).not.toBe(TEMPLATE);
    const { addReleaseSigning } = plugin();
    expect(() => addReleaseSigning(without, options)).toThrow(/signingConfig/);
  });

  it("T3-21 item 2: throws on a template with two release signingConfig lines", () => {
    const release = releaseBlock(TEMPLATE);
    const twice = TEMPLATE.replace(release, release.replace(/^(.*signingConfig signingConfigs\.debug.*\n)/m, "$1$1"));
    expect(twice).not.toBe(TEMPLATE);
    const { addReleaseSigning } = plugin();
    expect(() => addReleaseSigning(twice, options)).toThrow(/signingConfig/);
  });
});

describe("no key is committed", () => {
  const tracked = (): string[] => execFileSync("git", ["ls-files", "-z"], { cwd: repo, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\0").filter(Boolean);

  it("T3-21 item 2: no tracked file is a keystore or a private key", () => {
    expect(tracked().filter((path) => /\.(jks|keystore|p12|pk8)$/i.test(path))).toEqual([]);
  });

  it("T3-21 item 2: no tracked properties file sets storePassword or keyPassword", () => {
    const offenders = tracked()
      .filter((path) => path.endsWith(".properties") && existsSync(join(repo, path)))
      .filter((path) => /^\s*(storePassword|keyPassword)\s*[=:]/m.test(readFileSync(join(repo, path), "utf8")));
    expect(offenders).toEqual([]);
  });

  it.each(["octave.jks", "release.keystore", "upload.p12", "key.pk8", "signing.properties", "signing-local.properties", "apps/tv/signing.properties"])(
    "T3-21 item 2: git ignores %s",
    (path) => {
      const result = spawnSync("git", ["check-ignore", "-q", path], { cwd: repo });
      expect(result.status, `${path} is not ignored`).toBe(0);
    },
  );
});
