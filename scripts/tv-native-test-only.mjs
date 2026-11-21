// Runs the JVM tests one Gradle test filter selects (T3-03, "The red and green runs"), then judges their JUnit
// reports. It reads report locations from scripts/tv-native-test.mjs, so the two runners cannot disagree on them,
// prebuilds when apps/tv/android is missing or stale, and runs octaveNativeTest with -Poctave.tests=<filter>.
// It fails on a missing or extra argument, on zero executed tests and on any failure. Unlike pnpm tv:native:test it
// does not require a report from every project with test sources, because a filter leaves most of them without one.
// Run: node scripts/tv-native-test-only.mjs <filter>   (for example dev.octave.session.http.OriginPinTest)
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { androidSdk } from "./tv-android-sdk.mjs";
import { projects, reportsIn, summarizeResults } from "./tv-native-test.mjs";
import { ANDROID_DIR, prebuild, prebuildIsCurrent } from "./tv-prebuild.mjs";

const USAGE = "usage: node scripts/tv-native-test-only.mjs <test filter>, for example dev.octave.session.http.OriginPinTest";
const FILTER = /^[A-Za-z_$*][\w$.*]*$/;

// Returns { filter } or { error: "ERROR tv native: ..." }.
export function filterFrom(args) {
  if (args.length !== 1) return { error: `ERROR tv native: give exactly one test filter (${USAGE})` };
  const [filter] = args;
  if (!FILTER.test(filter)) return { error: `ERROR tv native: ${JSON.stringify(filter)} is not a class or method filter (${USAGE})` };
  return { filter };
}

// targets: what projects() returns, each with its report texts. Returns summarizeResults' judgment with no
// "test sources and no report" rule.
export function judgeFiltered(targets) {
  return summarizeResults(targets.map((target) => ({ project: target.project, hasTestSources: false, xml: target.xml })));
}

function fail(message) {
  console.error(message.startsWith("ERROR") ? message : `ERROR tv native: ${message}`);
  process.exit(1);
}

function main() {
  const { filter, error } = filterFrom(process.argv.slice(2));
  if (error) fail(error);
  try {
    androidSdk();
  } catch (sdkError) {
    fail(sdkError.message);
  }
  if (!prebuildIsCurrent()) {
    console.log("tv native: apps/tv/android is missing or stale; running pnpm tv:prebuild");
    if (prebuild() !== 0) fail("expo prebuild failed");
  }
  const targets = projects();
  // Remove old reports so a stale pass cannot count, and so Gradle does not skip the test tasks as up to date.
  for (const target of targets) for (const dir of target.results) rmSync(dir, { recursive: true, force: true });
  const gradle = spawnSync("./gradlew", ["octaveNativeTest", `-Poctave.tests=${filter}`], { cwd: ANDROID_DIR, stdio: "inherit" });
  const summary = judgeFiltered(targets.map((target) => ({ project: target.project, xml: reportsIn(target.results) })));
  console.log(`${summary.line} (filter ${filter})`);
  for (const line of summary.errors) console.error(line);
  if (gradle.status !== 0 && summary.errors.length === 0) console.error(`ERROR tv native: Gradle exited with ${gradle.status ?? gradle.signal}`);
  if (gradle.status !== 0 || summary.errors.length > 0) process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
