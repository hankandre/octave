// Runs the JVM tests of apps/tv and of every module under modules/ (T3-01 item 5), then judges their JUnit reports.
// It prebuilds first when apps/tv/android is missing or stale (scripts/tv-prebuild.mjs), runs the Gradle task
// octaveNativeTest, and fails on zero executed tests, on a project with test sources and no report, or on a failure.
// Run: node scripts/tv-native-test.mjs   (pnpm tv:native:test)
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { androidSdk } from "./tv-android-sdk.mjs";
import { ANDROID_DIR, APP_DIR, prebuild, prebuildIsCurrent } from "./tv-prebuild.mjs";

const repo = fileURLToPath(new URL("..", import.meta.url));

const attribute = (tag, name) => Number(new RegExp(`\\b${name}="(\\d+)"`).exec(tag)?.[1] ?? 0);

// reports: { project, hasTestSources, xml: the text of each TEST-*.xml }[]
// Returns { line: "tv native: N tests, F failed, P projects", errors: "ERROR tv native: ..." lines }.
export function summarizeResults(reports) {
  const errors = [];
  let executed = 0;
  let failed = 0;
  for (const report of reports) {
    if (report.hasTestSources && report.xml.length === 0) {
      errors.push(`ERROR tv native: ${report.project} has test sources and wrote no JUnit report`);
    }
    for (const xml of report.xml) {
      for (const [tag] of xml.matchAll(/<testsuite\b[^>]*>/g)) {
        const suiteFailed = attribute(tag, "failures") + attribute(tag, "errors");
        executed += attribute(tag, "tests") - attribute(tag, "skipped");
        failed += suiteFailed;
        if (suiteFailed > 0) {
          const name = /\bname="([^"]*)"/.exec(tag)?.[1] ?? "a test suite";
          errors.push(`ERROR tv native: ${report.project} ${name}: ${suiteFailed} failed`);
        }
      }
    }
  }
  if (reports.length === 0) errors.push("ERROR tv native: no Gradle project to test");
  else if (executed === 0) errors.push("ERROR tv native: zero tests ran");
  return { line: `tv native: ${executed} tests, ${failed} failed, ${reports.length} projects`, errors };
}

const sourceFiles = (dir) =>
  existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true }).some((entry) =>
        entry.isDirectory() ? sourceFiles(join(dir, entry.name)) : /\.(kt|java)$/.test(entry.name),
      )
    : false;

// The projects whose tests count: :app, whose sources live under apps/tv/native, and each modules/<name>/android.
function projects() {
  const app = {
    project: ":app",
    testSources: join(APP_DIR, "native", "app", "src", "test"),
    results: [join(ANDROID_DIR, "app", "build", "test-results", "testDebugUnitTest")],
  };
  const modulesDir = join(repo, "modules");
  const modules = existsSync(modulesDir)
    ? readdirSync(modulesDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && existsSync(join(modulesDir, entry.name, "android")))
        .map((entry) => {
          const android = join(modulesDir, entry.name, "android");
          return {
            project: `modules/${entry.name}`,
            testSources: join(android, "src", "test"),
            results: ["testDebugUnitTest", "test"].map((task) => join(android, "build", "test-results", task)),
          };
        })
    : [];
  return [app, ...modules];
}

const reportsIn = (dirs) =>
  dirs.flatMap((dir) =>
    existsSync(dir)
      ? readdirSync(dir)
          .filter((name) => /^TEST-.*\.xml$/.test(name))
          .map((name) => readFileSync(join(dir, name), "utf8"))
      : [],
  );

function fail(message) {
  console.error(`ERROR tv native: ${message}`);
  process.exit(1);
}

function main() {
  try {
    androidSdk();
  } catch (error) {
    fail(error.message);
  }
  if (!prebuildIsCurrent()) {
    console.log("tv native: apps/tv/android is missing or stale; running pnpm tv:prebuild");
    if (prebuild() !== 0) fail("expo prebuild failed");
  }
  const targets = projects();
  // Remove old reports so a stale pass cannot count, and so Gradle does not skip the test tasks as up to date.
  for (const target of targets) for (const dir of target.results) rmSync(dir, { recursive: true, force: true });
  const gradle = spawnSync("./gradlew", ["octaveNativeTest"], { cwd: ANDROID_DIR, stdio: "inherit" });
  const summary = summarizeResults(
    targets.map((target) => ({ project: target.project, hasTestSources: sourceFiles(target.testSources), xml: reportsIn(target.results) })),
  );
  console.log(summary.line);
  for (const error of summary.errors) console.error(error);
  if (gradle.status !== 0 && summary.errors.length === 0) console.error(`ERROR tv native: Gradle exited with ${gradle.status ?? gradle.signal}`);
  if (gradle.status !== 0 || summary.errors.length > 0) process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
