// @vitest-environment node
// T1-17 item 2 (docs/specs/T1-17.md, "The skip"): a pull request whose changed paths are all under docs/ or tasks/
// skips the tv, wire and tripwire jobs; every other case runs them. The module is imported inside each test, so a
// missing file fails only that test. The git cases build temporary repositories and never touch the network.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(repo, "scripts", "ci-device-jobs.mjs");

type Decision = { decision: "skip" | "run"; reason: string };
type Module = {
  SKIPPABLE_PREFIXES: readonly string[];
  deviceJobsDecision: (input: { eventName: string | undefined; paths: readonly string[] | undefined }) => Decision;
  changedPaths: (input: { repo: string; headSha: string | undefined }) => { paths: string[] } | { unreadable: string };
};

async function load(): Promise<Module> {
  return (await import(pathToFileURL(SCRIPT).href)) as Module;
}

const made: string[] = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

const GIT_ENV: NodeJS.ProcessEnv = {
  PATH: process.env.PATH,
  HOME: tmpdir(),
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.invalid",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.invalid",
  GIT_CONFIG_COUNT: "2",
  GIT_CONFIG_KEY_0: "commit.gpgsign",
  GIT_CONFIG_VALUE_0: "false",
  GIT_CONFIG_KEY_1: "init.defaultBranch",
  GIT_CONFIG_VALUE_1: "main",
};

function git(dir: string, ...args: string[]): string {
  return execFileSync("git", ["-C", dir, ...args], { env: GIT_ENV, encoding: "utf8" }).trim();
}

function put(dir: string, path: string, text: string): void {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), text);
}

// A repository shaped like a pull request's merge commit: main holds `base`, a branch `pr` changes the files, and
// HEAD is a merge of pr into main (HEAD^1 the base, HEAD^2 the pull request head).
function mergeRepo(base: Record<string, string>, change: (dir: string) => void): { dir: string; headSha: string } {
  const dir = mkdtempSync(join(tmpdir(), "ci-device-jobs-"));
  made.push(dir);
  git(dir, "init", "-q");
  for (const [path, text] of Object.entries(base)) put(dir, path, text);
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "base");
  git(dir, "checkout", "-q", "-b", "pr");
  change(dir);
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "pr");
  const headSha = git(dir, "rev-parse", "HEAD");
  git(dir, "checkout", "-q", "main");
  put(dir, "unrelated-on-main.txt", "main moved on\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "main moves");
  git(dir, "merge", "-q", "--no-ff", "-m", "merge", "pr");
  return { dir, headSha };
}

describe("T1-17 item 2: deviceJobsDecision", () => {
  it("T1-17 item 2: SKIPPABLE_PREFIXES is exactly docs/ and tasks/", async () => {
    const { SKIPPABLE_PREFIXES } = await load();
    expect([...SKIPPABLE_PREFIXES]).toEqual(["docs/", "tasks/"]);
    expect(Object.isFrozen(SKIPPABLE_PREFIXES)).toBe(true);
  });

  it("T1-17 item 2: skips a pull request that changes only docs/ paths, only tasks/ paths, or both", async () => {
    const { deviceJobsDecision } = await load();
    const skip = (paths: string[]) => deviceJobsDecision({ eventName: "pull_request", paths });
    expect(skip(["docs/a.md"]).decision).toBe("skip");
    expect(skip(["docs/specs/T1-17.md", "docs/commands.md"]).decision).toBe("skip");
    expect(skip(["tasks/prd.json"]).decision).toBe("skip");
    expect(skip(["tasks/backlog.jsonl", "docs/specs/x.md"]).decision).toBe("skip");
    expect(typeof skip(["docs/a.md"]).reason).toBe("string");
  });

  it("T1-17 item 2: runs when any path is outside the list", async () => {
    const { deviceJobsDecision } = await load();
    const run = (paths: string[]) => deviceJobsDecision({ eventName: "pull_request", paths });
    expect(run(["docs/a.md", "apps/tv/index.js"]).decision).toBe("run");
    expect(run(["tasks/prd.json", ".github/workflows/ci.yml"]).decision).toBe("run");
    expect(run(["package.json"]).decision).toBe("run");
  });

  it("T1-17 item 2: look-alike paths run", async () => {
    const { deviceJobsDecision } = await load();
    for (const path of ["docs", "tasks", "docsx/a", "tasksx/a", "Docs/a", "TASKS/a", "apps/docs/a", "packages/tasks/a", "README.md", "./docs/a", "/docs/a"]) {
      expect(deviceJobsDecision({ eventName: "pull_request", paths: [path] }).decision, path).toBe("run");
    }
  });

  it("T1-17 item 2: an empty or missing list, and an empty path, run", async () => {
    const { deviceJobsDecision } = await load();
    expect(deviceJobsDecision({ eventName: "pull_request", paths: [] }).decision).toBe("run");
    expect(deviceJobsDecision({ eventName: "pull_request", paths: undefined }).decision).toBe("run");
    expect(deviceJobsDecision({ eventName: "pull_request", paths: ["docs/a.md", ""] }).decision).toBe("run");
  });

  it("T1-17 item 2: a push, a merge group, and a missing or other event run even for docs-only paths", async () => {
    const { deviceJobsDecision } = await load();
    for (const eventName of ["push", "merge_group", "workflow_dispatch", "pull_request_target", "", undefined]) {
      expect(deviceJobsDecision({ eventName, paths: ["docs/a.md"] }).decision, String(eventName)).toBe("run");
    }
  });
});

describe("T1-17 item 2: changedPaths", () => {
  it("T1-17 item 2: lists what the merge commit changes against its first parent", async () => {
    const { changedPaths } = await load();
    const { dir, headSha } = mergeRepo({ "apps/keep.txt": "k\n" }, (d) => {
      put(d, "docs/a.md", "a\n");
      put(d, "tasks/prd.json", "{}\n");
    });
    const result = changedPaths({ repo: dir, headSha });
    expect("paths" in result).toBe(true);
    if ("paths" in result) expect([...result.paths].sort()).toEqual(["docs/a.md", "tasks/prd.json"]);
  });

  it("T1-17 item 2: a rename from apps/ into docs/ lists the old path too", async () => {
    const { changedPaths, deviceJobsDecision } = await load();
    const { dir, headSha } = mergeRepo({ "apps/tv/moved.ts": "export const x = 1;\n" }, (d) => {
      git(d, "mv", "apps/tv/moved.ts", "docs/moved.ts");
    });
    const result = changedPaths({ repo: dir, headSha });
    expect("paths" in result).toBe(true);
    if (!("paths" in result)) return;
    expect(result.paths).toContain("apps/tv/moved.ts");
    expect(result.paths).toContain("docs/moved.ts");
    expect(deviceJobsDecision({ eventName: "pull_request", paths: result.paths }).decision).toBe("run");
  });

  it("T1-17 item 2: keeps a file name with spaces and a newline whole", async () => {
    const { changedPaths } = await load();
    const { dir, headSha } = mergeRepo({ "x.txt": "x\n" }, (d) => {
      put(d, "docs/with space.md", "a\n");
      put(d, "docs/line\nbreak.md", "b\n");
    });
    const result = changedPaths({ repo: dir, headSha });
    expect("paths" in result).toBe(true);
    if ("paths" in result) expect(result.paths).toEqual(expect.arrayContaining(["docs/with space.md", "docs/line\nbreak.md"]));
  });

  it("T1-17 item 2: a HEAD that is not a merge commit is unreadable", async () => {
    const { changedPaths } = await load();
    const dir = mkdtempSync(join(tmpdir(), "ci-device-jobs-"));
    made.push(dir);
    git(dir, "init", "-q");
    put(dir, "docs/a.md", "a\n");
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "one");
    put(dir, "docs/b.md", "b\n");
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "two");
    const result = changedPaths({ repo: dir, headSha: git(dir, "rev-parse", "HEAD") });
    expect(result).toEqual({ unreadable: expect.any(String) });
  });

  it("T1-17 item 2: a head sha that is not HEAD^2, an empty sha and a missing sha are unreadable", async () => {
    const { changedPaths } = await load();
    const { dir, headSha } = mergeRepo({ "x.txt": "x\n" }, (d) => put(d, "docs/a.md", "a\n"));
    const first = git(dir, "rev-parse", "HEAD^1");
    expect(changedPaths({ repo: dir, headSha: first })).toEqual({ unreadable: expect.any(String) });
    expect(changedPaths({ repo: dir, headSha: "" })).toEqual({ unreadable: expect.any(String) });
    expect(changedPaths({ repo: dir, headSha: undefined })).toEqual({ unreadable: expect.any(String) });
    expect(changedPaths({ repo: dir, headSha })).toEqual({ paths: expect.any(Array) });
  });

  it("T1-17 item 2: a directory that is not a repository is unreadable", async () => {
    const { changedPaths } = await load();
    const dir = mkdtempSync(join(tmpdir(), "ci-device-jobs-none-"));
    made.push(dir);
    expect(changedPaths({ repo: dir, headSha: "0123456789abcdef0123456789abcdef01234567" })).toEqual({ unreadable: expect.any(String) });
  });
});

describe("T1-17 item 2: the CLI", () => {
  function run(dir: string, env: Record<string, string>, outputFile: string | undefined) {
    const full: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: tmpdir(), ...env };
    if (outputFile !== undefined) full.GITHUB_OUTPUT = outputFile;
    return spawnSync(process.execPath, [SCRIPT, "--repo", dir], { cwd: tmpdir(), env: full, encoding: "utf8", timeout: 60_000 });
  }

  function outputFileIn(dir: string): string {
    const file = join(dir, "..", `gh-output-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    writeFileSync(file, "");
    made.push(file);
    return file;
  }

  it("T1-17 item 2: prints one line and appends device-jobs=skip for a docs-only pull request", () => {
    const { dir, headSha } = mergeRepo({ "apps/x.ts": "x\n" }, (d) => {
      put(d, "docs/a.md", "a\n");
      put(d, "tasks/b.json", "{}\n");
    });
    const file = outputFileIn(dir);
    const out = run(dir, { GITHUB_EVENT_NAME: "pull_request", OCTAVE_CI_HEAD_SHA: headSha }, file);
    expect(out.status).toBe(0);
    const lines = out.stdout.trimEnd().split("\n");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^ci device jobs: skip \(.+\)$/);
    expect(readFileSync(file, "utf8")).toBe("device-jobs=skip\n");
  });

  it("T1-17 item 2: a mixed pull request gives device-jobs=run", () => {
    const { dir, headSha } = mergeRepo({ "apps/x.ts": "x\n" }, (d) => {
      put(d, "docs/a.md", "a\n");
      put(d, "apps/x.ts", "y\n");
    });
    const file = outputFileIn(dir);
    const out = run(dir, { GITHUB_EVENT_NAME: "pull_request", OCTAVE_CI_HEAD_SHA: headSha }, file);
    expect(out.status).toBe(0);
    expect(out.stdout).toMatch(/^ci device jobs: run \(.+\)$/m);
    expect(readFileSync(file, "utf8")).toBe("device-jobs=run\n");
  });

  it("T1-17 item 2: a push and a merge group give run even when only docs changed", () => {
    const { dir, headSha } = mergeRepo({ "apps/x.ts": "x\n" }, (d) => put(d, "docs/a.md", "a\n"));
    for (const event of ["push", "merge_group"]) {
      const file = outputFileIn(dir);
      const out = run(dir, { GITHUB_EVENT_NAME: event, OCTAVE_CI_HEAD_SHA: headSha }, file);
      expect(out.status, event).toBe(0);
      expect(readFileSync(file, "utf8"), event).toBe("device-jobs=run\n");
    }
  });

  it("T1-17 item 2: an unreadable diff gives run and exit 0", () => {
    const { dir } = mergeRepo({ "apps/x.ts": "x\n" }, (d) => put(d, "docs/a.md", "a\n"));
    const file = outputFileIn(dir);
    const out = run(dir, { GITHUB_EVENT_NAME: "pull_request", OCTAVE_CI_HEAD_SHA: "0".repeat(40) }, file);
    expect(out.status).toBe(0);
    expect(out.stdout).toMatch(/^ci device jobs: run \(.+\)$/m);
    expect(readFileSync(file, "utf8")).toBe("device-jobs=run\n");
  });

  it("T1-17 item 2: an output file that cannot be written gives exit 1 and an ERROR ci: line", () => {
    const { dir, headSha } = mergeRepo({ "apps/x.ts": "x\n" }, (d) => put(d, "docs/a.md", "a\n"));
    const missing = join(dir, "no-such-dir", "output");
    const out = run(dir, { GITHUB_EVENT_NAME: "pull_request", OCTAVE_CI_HEAD_SHA: headSha }, missing);
    expect(out.status).toBe(1);
    expect(out.stdout + out.stderr).toMatch(/ERROR ci:/);
    expect(existsSync(missing)).toBe(false);
  });

  it("T1-17 item 2: importing the module runs nothing", () => {
    const out = spawnSync(process.execPath, ["--input-type=module", "-e", `await import(${JSON.stringify(pathToFileURL(SCRIPT).href)}); console.log("imported");`], {
      cwd: tmpdir(),
      env: { PATH: process.env.PATH },
      encoding: "utf8",
      timeout: 30_000,
    });
    expect(out.status).toBe(0);
    expect(out.stdout.trim()).toBe("imported");
  });
});
