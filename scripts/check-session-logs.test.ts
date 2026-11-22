// @vitest-environment node
// T3-16 item 4 (docs/specs/T3-16.md, "The log check"): a source check, `pnpm lint:logs`
// (scripts/check-session-logs.mjs), fails on a log call in the session module's HTTP and session code that takes a
// request, a header or a URL, and on HttpLoggingInterceptor; it runs in `pnpm check` and CI's `checks` job.
//
// The rules: G1, the identifier HttpLoggingInterceptor in a scoped source, or the artifact logging-interceptor in the
// module's Gradle file. G2, a log call with an argument that is not constant text (a source check cannot type an
// argument, so every value is refused, which covers a request, a header and a URL); printStackTrace() always fails.
// Scope: Kotlin and Java under modules/session/android/src/main/, TypeScript under modules/session/src/ and
// apps/tv/src/host/, and modules/session/android/build.gradle.
//
// The samples in scripts/fixtures/session-logs/ are stored as text (`*.kt.txt`, `*.java.txt`, `*.ts.txt`,
// `*.gradle.txt`) because `pnpm typecheck` compiles scripts/**/*.ts; this file hands each to findLogViolations under a
// scoped path. Each fail-* sample holds one kind of violation; the pass.* samples hold a constant log call, an empty
// argument list, log words in comments and strings, and an identifier that only contains a log word (catalogLog).
//
// Shapes this file freezes:
// - findLogViolations(files) takes [{ path, text }] with repository-relative paths and returns a list of messages,
//   empty when the files pass. Each message names the file and the line as `<path>:<line>` and the rule (`G1` or `G2`).
//
// The script is loaded at run time from a path built here, so `pnpm typecheck` does not depend on it existing.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(repo, "scripts", "check-session-logs.mjs");
const SAMPLES = join(repo, "scripts", "fixtures", "session-logs");

type SourceFile = { path: string; text: string };
type LogCheckModule = { findLogViolations: (files: SourceFile[]) => string[] };

async function loadCheck(): Promise<LogCheckModule> {
  expect(existsSync(SCRIPT), "scripts/check-session-logs.mjs exists").toBe(true);
  return (await import(pathToFileURL(SCRIPT).href)) as LogCheckModule;
}

const KOTLIN_PATH = "modules/session/android/src/main/java/dev/octave/session/http/Sample.kt";
const JAVA_PATH = "modules/session/android/src/main/java/dev/octave/session/http/Sample.java";
const TS_PATHS = ["modules/session/src/sample.ts", "apps/tv/src/host/sample.ts"];
const GRADLE_PATH = "modules/session/android/build.gradle";

function scopedPaths(sample: string): string[] {
  if (sample.endsWith(".kt.txt")) return [KOTLIN_PATH];
  if (sample.endsWith(".java.txt")) return [JAVA_PATH];
  if (sample.endsWith(".ts.txt")) return TS_PATHS;
  if (sample.endsWith(".gradle.txt")) return [GRADLE_PATH];
  throw new Error(`no scoped path for ${sample}`);
}

const sample = (name: string) => readFileSync(join(SAMPLES, name), "utf8");

// Each failing sample, the rule it breaks and the line of the violation.
const FAILING: { name: string; rule: "G1" | "G2"; line: number }[] = [
  { name: "fail-log-template.kt.txt", rule: "G2", line: 5 },
  { name: "fail-log-url.kt.txt", rule: "G2", line: 7 },
  { name: "fail-println-headers.kt.txt", rule: "G2", line: 5 },
  { name: "fail-print-stack-trace.kt.txt", rule: "G2", line: 8 },
  { name: "fail-system-err.java.txt", rule: "G2", line: 5 },
  { name: "fail-timber.kt.txt", rule: "G2", line: 7 },
  { name: "fail-console-url.ts.txt", rule: "G2", line: 2 },
  { name: "fail-console-template.ts.txt", rule: "G2", line: 2 },
  { name: "fail-logging-interceptor.kt.txt", rule: "G1", line: 7 },
  { name: "fail-logging-interceptor.gradle.txt", rule: "G1", line: 3 },
];
const PASSING = ["pass.kt.txt", "pass.ts.txt", "pass.gradle.txt"];

describe("pnpm lint:logs", () => {
  it("T3-16 item 4: every failing sample fails on its rule, naming the file and the line", async () => {
    const { findLogViolations } = await loadCheck();
    for (const { name, rule, line } of FAILING) {
      for (const path of scopedPaths(name)) {
        const messages = findLogViolations([{ path, text: sample(name) }]);
        expect(messages.length, `${name} as ${path} fails`).toBeGreaterThan(0);
        for (const message of messages) {
          expect(message, `${name}: names the file`).toContain(path);
          expect(message, `${name}: names its rule`).toMatch(new RegExp(`\\b${rule}\\b`));
        }
        expect(messages.some((message) => message.includes(`${path}:${line}`)), `${name}: names line ${line} (${messages.join(" | ")})`).toBe(true);
      }
    }
  });

  it("T3-16 item 4: the passing samples pass", async () => {
    const { findLogViolations } = await loadCheck();
    for (const name of PASSING) {
      for (const path of scopedPaths(name)) {
        expect(findLogViolations([{ path, text: sample(name) }]), `${name} as ${path}`).toEqual([]);
      }
    }
  });

  it("T3-16 item 4: a failing sample among passing files is still found", async () => {
    const { findLogViolations } = await loadCheck();
    const files = [
      { path: KOTLIN_PATH, text: sample("pass.kt.txt") },
      { path: TS_PATHS[0], text: sample("pass.ts.txt") },
      { path: "modules/session/android/src/main/java/dev/octave/session/http/Other.kt", text: sample("fail-log-url.kt.txt") },
    ];
    const messages = findLogViolations(files);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("modules/session/android/src/main/java/dev/octave/session/http/Other.kt:7");
  });

  it("T3-16 item 4: the real tree passes", () => {
    expect(existsSync(SCRIPT), "scripts/check-session-logs.mjs exists").toBe(true);
    const child = spawnSync(process.execPath, [SCRIPT], { cwd: repo, encoding: "utf8" });
    expect(child.status, `${child.stdout}${child.stderr}`).toBe(0);
  });
});

describe("pnpm check runs pnpm lint:logs", () => {
  const pkg = JSON.parse(readFileSync(join(repo, "package.json"), "utf8")) as { scripts: Record<string, string> };

  it("T3-16 item 4: package.json has the lint:logs script", () => {
    expect(pkg.scripts["lint:logs"]).toBe("node scripts/check-session-logs.mjs");
  });

  it("T3-16 item 4: pnpm check runs pnpm lint:logs right after pnpm lint:network", () => {
    const steps = pkg.scripts.check.split(" && ").map((step) => step.trim());
    expect(steps).toContain("pnpm lint:logs");
    expect(steps.indexOf("pnpm lint:logs")).toBe(steps.indexOf("pnpm lint:network") + 1);
  });

  it("T3-16 item 4: CI's checks job runs pnpm lint:logs right after pnpm lint:network", () => {
    const lines = readFileSync(join(repo, ".github", "workflows", "ci.yml"), "utf8").split("\n");
    const start = lines.findIndex((line) => line === "  checks:");
    expect(start).toBeGreaterThan(-1);
    const end = lines.findIndex((line, i) => i > start && /^ {2}\S/.test(line));
    const runs = lines
      .slice(start + 1, end === -1 ? undefined : end)
      .map((line) => /^\s+(?:- )?run:\s*(.+)$/.exec(line)?.[1].replace(/\s+#.*$/, "").trim())
      .filter((run): run is string => run !== undefined);
    expect(runs).toContain("pnpm lint:logs");
    expect(runs.indexOf("pnpm lint:logs")).toBe(runs.indexOf("pnpm lint:network") + 1);
  });
});
