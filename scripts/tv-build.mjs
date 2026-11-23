// Builds the TV app's release APK (pnpm tv:build) or its e2e APK (pnpm tv:e2e:build, `--e2e`; T3-02). Both are the
// release build type with a Hermes bundle; the e2e bundle also holds apps/tv/src/e2e/, which Metro empties unless
// OCTAVE_E2E=1 (apps/tv/e2e-gate.js). The JavaScript bundle task is rerun every time, because Gradle tracks neither the
// flag nor packages/core, and judgeBundle() proves the flavour of every bundle it packages. The e2e APK is moved to
// apps/tv/dist/e2e/ with a stamp of e2eSourceHash(), so the release APK path never holds a harness build. An e2e build
// also builds the device probe's test APK (octaveDeviceProbeApk, apps/tv/plugins/with-device-probe.js; T3-15) and moves
// it beside the e2e APK, and moves Gradle's R8 mapping there too (E2E_MAPPING; T3-31): pnpm tv:e2e judges the e2e APK
// with that mapping, matched to the dex by pg_map_id, and never reads the release path's.
// Run: node scripts/tv-build.mjs [--e2e]
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { RELEASE_APK } from "./tv-apk-check.mjs";
import { RELEASE_MAPPING } from "./tv-apk-inspector.mjs";
import { ANDROID_DIR, APP_DIR, prebuild, prebuildIsCurrent } from "./tv-prebuild.mjs";

const repo = fileURLToPath(new URL("..", import.meta.url));
export const E2E_APK = join(APP_DIR, "dist", "e2e", "octave-tv-e2e.apk");
export const E2E_MAPPING = join(APP_DIR, "dist", "e2e", "octave-tv-e2e.mapping.txt");
export const E2E_STAMP = join(APP_DIR, "dist", "e2e", "octave-tv-e2e.hash");
export const PROBE_APK = join(APP_DIR, "dist", "e2e", "octave-session-probe.apk");
const PROBE_BUILD_DIR = join(repo, "modules", "session", "android", "build", "outputs", "apk", "androidTest", "debug");
const MARKER = Buffer.from("OCTAVE_E2E", "latin1");
const BUNDLE_DIR = join(ANDROID_DIR, "app", "build", "generated", "assets");

// Returns `ERROR tv build: ...` lines; empty when a release bundle lacks the harness marker and an e2e bundle has it.
export function judgeBundle(bytes, flavour) {
  if (bytes.length === 0) return [`ERROR tv build: the ${flavour} bundle is empty`];
  const hasHarness = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).includes(MARKER);
  if (flavour === "release" && hasHarness) return ["ERROR tv build: the release bundle contains the e2e harness"];
  if (flavour === "e2e" && !hasHarness) return ["ERROR tv build: the e2e bundle lacks the harness (was OCTAVE_E2E seen by Metro?)"];
  return [];
}

const FIXTURES = ["host-classes.json", "hls-master-urls.json", "device-ids.json"].map((name) => `packages/core/tests/fixtures/${name}`);
const GENERATED = ["android/", "ios/", "dist/", ".expo/"].map((dir) => `apps/tv/${dir}`);

// The repository paths an e2e bundle is made from: the app outside its generated trees, the core's sources without
// tests, the native modules outside their build output and JVM tests (the probe APK is built from them), the three
// fixture files and the lockfile.
function isE2eInput(path) {
  if (path === "pnpm-lock.yaml" || FIXTURES.includes(path)) return true;
  const parts = path.split("/");
  if (parts.includes("node_modules")) return false;
  if (path.startsWith("modules/")) return !parts.includes("build") && !path.includes("/src/test/");
  if (path.startsWith("packages/core/src/")) return !path.endsWith(".test.ts");
  return path.startsWith("apps/tv/") && !GENERATED.some((dir) => path.startsWith(dir));
}

// A hash of what the e2e bundle is made from, over the files git tracks or would track (git-ignored files are left
// out, so files a build writes never change it). `root` is the tree's root, the repository by default.
export function e2eSourceHash(root = repo) {
  const listed = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root, maxBuffer: 64 * 1024 * 1024 })
    .toString("utf8")
    .split("\0");
  const paths = [...new Set(listed)].filter((path) => path !== "" && isE2eInput(path) && existsSync(join(root, path))).sort();
  const hash = createHash("sha256");
  for (const path of paths) {
    hash.update(path);
    hash.update("\0");
    hash.update(readFileSync(join(root, path)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

export function e2eApkIsCurrent() {
  return existsSync(E2E_APK) && existsSync(PROBE_APK) && existsSync(E2E_MAPPING) && existsSync(E2E_STAMP) && readFileSync(E2E_STAMP, "utf8").trim() === e2eSourceHash();
}

function findBundle(bundleDir) {
  const preferred = join(bundleDir, "react", "release", "index.android.bundle");
  if (existsSync(preferred)) return preferred;
  const found = [];
  const walk = (dir) => {
    for (const entry of existsSync(dir) ? readdirSync(dir, { withFileTypes: true }) : []) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name === "index.android.bundle") found.push(path);
    }
  };
  walk(bundleDir);
  if (found.length !== 1) throw new Error(`expected one index.android.bundle under ${relative(repo, bundleDir)}, found ${found.length}`);
  return found[0];
}

// What buildTv reads, runs and writes outside its options. Tests pass their own (scripts/tv-build-cleanup.test.ts).
const SYSTEM = {
  prebuildIsCurrent,
  prebuild,
  sourceHash: () => e2eSourceHash(),
  gradle: (tasks, env) => spawnSync("./gradlew", tasks, { cwd: ANDROID_DIR, stdio: "inherit", env }),
  releaseApk: RELEASE_APK,
  releaseMapping: RELEASE_MAPPING,
  bundleDir: BUNDLE_DIR,
  probeBuildDir: PROBE_BUILD_DIR,
  e2eApk: E2E_APK,
  e2eMapping: E2E_MAPPING,
  e2eStamp: E2E_STAMP,
  probeApk: PROBE_APK,
};

// Builds one flavour. Returns the error lines; empty on success. A failed e2e build removes the release APK path,
// because Gradle may have written the e2e bundle there before the failure (the probe task failing after
// :app:assembleRelease, an unexpected probe output, or no bundle found).
export function buildTv({ e2e }, system = SYSTEM) {
  const errors = build(e2e, system);
  if (e2e && errors.length > 0) rmSync(system.releaseApk, { force: true });
  return errors;
}

function build(e2e, system) {
  const flavour = e2e ? "e2e" : "release";
  const { releaseApk, probeBuildDir } = system;
  if (!system.prebuildIsCurrent()) {
    console.log("tv build: apps/tv/android is missing or stale; running pnpm tv:prebuild");
    if (system.prebuild() !== 0) return ["ERROR tv build: expo prebuild failed"];
  }
  // Hash the sources before the build, so the stamp names what the bundle was made from.
  const sourceHash = e2e ? system.sourceHash() : undefined;
  const env = { ...process.env };
  delete env.OCTAVE_E2E;
  if (e2e) env.OCTAVE_E2E = "1";
  // T3-33: the development-server allowlist is replaced by a canary for every build, whatever the machine holds, so
  // scripts/tv-apk-allowlist.mjs can show the APK holds no list.
  env.OCTAVE_DEV_SERVERS = "octave-allowlist-canary.invalid";
  rmSync(releaseApk, { force: true });
  if (e2e) rmSync(probeBuildDir, { recursive: true, force: true });
  const tasks = [":app:createBundleReleaseJsAndAssets", "--rerun", ":app:assembleRelease", ...(e2e ? ["octaveDeviceProbeApk"] : [])];
  const gradle = system.gradle(tasks, env);
  if (gradle.status !== 0) return [`ERROR tv build: Gradle exited with ${gradle.status ?? gradle.signal}`];

  let bundle;
  try {
    bundle = findBundle(system.bundleDir);
  } catch (error) {
    return [`ERROR tv build: ${error.message}`];
  }
  const errors = judgeBundle(readFileSync(bundle), flavour);
  if (errors.length > 0) {
    rmSync(releaseApk, { force: true });
    return errors;
  }
  if (!existsSync(releaseApk)) return [`ERROR tv build: Gradle wrote no APK at ${relative(repo, releaseApk)}`];
  if (!e2e) {
    console.log(`tv build: release APK at ${relative(repo, releaseApk)}`);
    return [];
  }
  const probes = existsSync(probeBuildDir) ? readdirSync(probeBuildDir).filter((name) => name.endsWith(".apk")) : [];
  if (probes.length !== 1) return [`ERROR tv build: expected one probe APK under ${relative(repo, probeBuildDir)}, found ${probes.length}`];
  if (!existsSync(system.releaseMapping)) return [`ERROR tv build: Gradle wrote no R8 mapping at ${relative(repo, system.releaseMapping)}`];
  mkdirSync(dirname(system.e2eApk), { recursive: true });
  mkdirSync(dirname(system.probeApk), { recursive: true });
  rmSync(system.e2eStamp, { force: true });
  rmSync(system.e2eMapping, { force: true });
  renameSync(releaseApk, system.e2eApk);
  renameSync(join(probeBuildDir, probes[0]), system.probeApk);
  renameSync(system.releaseMapping, system.e2eMapping);
  writeFileSync(system.e2eStamp, `${sourceHash}\n`);
  console.log(`tv build: e2e APK at ${relative(repo, system.e2eApk)}, mapping at ${relative(repo, system.e2eMapping)}, probe APK at ${relative(repo, system.probeApk)}`);
  return [];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const errors = buildTv({ e2e: process.argv.slice(2).includes("--e2e") });
  for (const error of errors) console.error(error);
  if (errors.length > 0) process.exit(1);
}
