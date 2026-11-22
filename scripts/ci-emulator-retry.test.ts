// @vitest-environment node
// T1-17 item 1 (docs/specs/T1-17.md, "The retry"): an emulator step is run once more only when the emulator never
// reached the step's test script. A pnpm shim creates the start marker; a decision step reads it. The modules and the
// shim are imported or run inside each test, so a missing file fails only that test.
//
// The CLI test never touches a real process: the child runs with a PATH of the shim directory, a directory of fake
// `pkill` and `adb` programs, and Node's directory only, and GITHUB_ACTIONS=true is set only for the cases that
// expect the cleanup (spec check note 4: the cleanup is done only on a GitHub runner).
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const RETRY = join(repo, "scripts", "ci-emulator-retry.mjs");
const SHIM = join(repo, "scripts", "ci-script-started.sh");

type RetryModule = {
  retryDecision: (input: { outcome: string | undefined; scriptStarted: boolean | undefined; shimFirst: boolean }) => { retry: boolean; reason: string };
  shimIsFirst: (input: { pathValue: string | undefined; shimDir: string }) => boolean;
};

async function load(): Promise<RetryModule> {
  return (await import(pathToFileURL(RETRY).href)) as RetryModule;
}

const made: string[] = [];
function temp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  made.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

function program(path: string, body: string): void {
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
}

describe("T1-17 item 1: retryDecision", () => {
  it("T1-17 item 1: retries exactly one combination: failure, marker absent, shim first", async () => {
    const { retryDecision } = await load();
    const outcomes = ["success", "failure", "cancelled", "skipped", "", undefined, "weird text"];
    const retried: string[] = [];
    for (const outcome of outcomes) {
      for (const scriptStarted of [true, false, undefined]) {
        for (const shimFirst of [true, false]) {
          const result = retryDecision({ outcome, scriptStarted, shimFirst });
          expect(typeof result.reason).toBe("string");
          expect(result.reason.length).toBeGreaterThan(0);
          if (result.retry) retried.push(`${String(outcome)}/${String(scriptStarted)}/${String(shimFirst)}`);
        }
      }
    }
    expect(retried).toEqual(["failure/false/true"]);
  });

  it("T1-17 item 1: never retries a started script, whatever the outcome", async () => {
    const { retryDecision } = await load();
    for (const outcome of ["success", "failure", "cancelled", "skipped"]) {
      expect(retryDecision({ outcome, scriptStarted: true, shimFirst: true }).retry).toBe(false);
    }
  });

  it("T1-17 item 1: does not retry when it cannot tell (marker state unknown or shim not first)", async () => {
    const { retryDecision } = await load();
    expect(retryDecision({ outcome: "failure", scriptStarted: undefined, shimFirst: true }).retry).toBe(false);
    expect(retryDecision({ outcome: "failure", scriptStarted: false, shimFirst: false }).retry).toBe(false);
  });
});

describe("T1-17 item 1: shimIsFirst", () => {
  function pathDirs() {
    const root = temp("ci-shimfirst-");
    const shimDir = join(root, "shim");
    const realDir = join(root, "real");
    const emptyDir = join(root, "empty");
    for (const dir of [shimDir, realDir, emptyDir]) mkdirSync(dir);
    program(join(shimDir, "pnpm"), "exit 0");
    program(join(realDir, "pnpm"), "exit 0");
    return { shimDir, realDir, emptyDir };
  }

  it("T1-17 item 1: true when the shim directory is the first one that holds a pnpm", async () => {
    const { shimIsFirst } = await load();
    const { shimDir, realDir, emptyDir } = pathDirs();
    expect(shimIsFirst({ pathValue: [shimDir, realDir].join(":"), shimDir })).toBe(true);
    expect(shimIsFirst({ pathValue: [emptyDir, shimDir, realDir].join(":"), shimDir })).toBe(true);
  });

  it("T1-17 item 1: false when the real pnpm's directory comes first", async () => {
    const { shimIsFirst } = await load();
    const { shimDir, realDir } = pathDirs();
    expect(shimIsFirst({ pathValue: [realDir, shimDir].join(":"), shimDir })).toBe(false);
  });

  it("T1-17 item 1: false when no directory of the path holds a pnpm, or the path is empty", async () => {
    const { shimIsFirst } = await load();
    const { shimDir, emptyDir } = pathDirs();
    expect(shimIsFirst({ pathValue: emptyDir, shimDir: join(emptyDir, "nowhere") })).toBe(false);
    expect(shimIsFirst({ pathValue: "", shimDir })).toBe(false);
    expect(shimIsFirst({ pathValue: undefined, shimDir })).toBe(false);
  });
});

describe("T1-17 item 1: the pnpm shim", () => {
  function setup() {
    const root = temp("ci-shim-");
    const started = join(root, "started");
    mkdirSync(started);
    const log = join(root, "log.txt");
    const marker = join(started, "smoke");
    const fake = join(root, "real-pnpm");
    // Records whether the marker existed when it started, then its arguments, and exits with the code named by FAKE_EXIT.
    program(fake, `if [ -e "${marker}" ]; then echo "marker=present" >> "${log}"; else echo "marker=absent" >> "${log}"; fi\necho "args=$*" >> "${log}"\nexit "\${FAKE_EXIT:-0}"`);
    return { root, started, log, marker, fake };
  }

  function shim(env: Record<string, string>, args: string[]) {
    return spawnSync("sh", [SHIM, ...args], { cwd: repo, env: { PATH: "/usr/bin:/bin", ...env }, encoding: "utf8", timeout: 30_000 });
  }

  const logLines = (log: string) => (existsSync(log) ? readFileSync(log, "utf8").trimEnd().split("\n") : []);

  it("T1-17 item 1: the marker exists before the real pnpm starts, and the arguments pass through", () => {
    const { log, marker, fake } = setup();
    const out = shim({ OCTAVE_CI_SCRIPT_STARTED: marker, OCTAVE_CI_REAL_PNPM: fake }, ["tv:smoke", "--flag", "two words"]);
    expect(out.status).toBe(0);
    expect(existsSync(marker)).toBe(true);
    expect(logLines(log)).toEqual(["marker=present", "args=tv:smoke --flag two words"]);
  });

  it("T1-17 item 1: the real pnpm's exit code passes through", () => {
    const { marker, fake } = setup();
    expect(shim({ OCTAVE_CI_SCRIPT_STARTED: marker, OCTAVE_CI_REAL_PNPM: fake, FAKE_EXIT: "7" }, ["tv:wire"]).status).toBe(7);
  });

  it("T1-17 item 1: succeeds when the marker already exists (tv:wire starts pnpm again with the variable inherited)", () => {
    const { log, marker, fake } = setup();
    writeFileSync(marker, "");
    const out = shim({ OCTAVE_CI_SCRIPT_STARTED: marker, OCTAVE_CI_REAL_PNPM: fake }, ["tv:e2e"]);
    expect(out.status).toBe(0);
    expect(existsSync(marker)).toBe(true);
    expect(logLines(log)).toEqual(["marker=present", "args=tv:e2e"]);
  });

  it("T1-17 item 1: a marker that cannot be created gives a non-zero exit and the real pnpm never runs", () => {
    const { root, log, fake } = setup();
    const out = shim({ OCTAVE_CI_SCRIPT_STARTED: join(root, "no-such-dir", "smoke"), OCTAVE_CI_REAL_PNPM: fake }, ["tv:smoke"]);
    expect(out.status).not.toBe(0);
    expect(out.stderr).toMatch(/ERROR ci:/);
    expect(existsSync(log)).toBe(false);
  });

  it("T1-17 item 1: with no marker variable it only passes through and creates no file", () => {
    const { started, log, fake } = setup();
    const out = shim({ OCTAVE_CI_REAL_PNPM: fake }, ["install", "--frozen-lockfile"]);
    expect(out.status).toBe(0);
    expect(readdirSync(started)).toEqual([]);
    expect(logLines(log)).toEqual(["marker=absent", "args=install --frozen-lockfile"]);
  });

  it("T1-17 item 1: without OCTAVE_CI_REAL_PNPM it fails with an ERROR ci: line", () => {
    const { marker } = setup();
    const out = shim({ OCTAVE_CI_SCRIPT_STARTED: marker }, ["tv:smoke"]);
    expect(out.status).not.toBe(0);
    expect(out.stderr).toMatch(/ERROR ci:/);
  });

  it("T1-17 item 1: when OCTAVE_CI_REAL_PNPM is not an executable file it fails with an ERROR ci: line", () => {
    const { root, marker } = setup();
    const out = shim({ OCTAVE_CI_SCRIPT_STARTED: marker, OCTAVE_CI_REAL_PNPM: join(root, "missing-pnpm") }, ["tv:smoke"]);
    expect(out.status).not.toBe(0);
    expect(out.stderr).toMatch(/ERROR ci:/);
  });
});

describe("T1-17 item 1: the decision CLI", () => {
  function setup() {
    const root = temp("ci-retry-cli-");
    const runnerTemp = join(root, "runner-temp");
    const shimDir = join(runnerTemp, "octave-ci", "bin");
    const startedDir = join(runnerTemp, "octave-ci", "started");
    const realDir = join(root, "real-bin");
    const fakeDir = join(root, "fake-bin");
    for (const dir of [shimDir, startedDir, realDir, fakeDir]) mkdirSync(dir, { recursive: true });
    program(join(shimDir, "pnpm"), "exit 0");
    program(join(realDir, "pnpm"), "exit 0");
    const calls = join(root, "calls.txt");
    program(join(fakeDir, "pkill"), `echo "pkill $*" >> "${calls}"\nexit 1`);
    program(join(fakeDir, "adb"), `echo "adb $*" >> "${calls}"\nexit 1`);
    const output = join(root, "github-output.txt");
    writeFileSync(output, "");
    return { root, runnerTemp, shimDir, startedDir, realDir, fakeDir, calls, output, marker: join(startedDir, "smoke") };
  }

  type Setup = ReturnType<typeof setup>;

  function cli(s: Setup, over: Record<string, string | undefined> = {}) {
    const env: Record<string, string | undefined> = {
      PATH: [s.shimDir, s.fakeDir, dirname(process.execPath)].join(":"),
      RUNNER_TEMP: s.runnerTemp,
      GITHUB_OUTPUT: s.output,
      OCTAVE_CI_STEP_OUTCOME: "failure",
      OCTAVE_CI_SCRIPT_STARTED: s.marker,
      ...over,
    };
    for (const key of Object.keys(env)) if (env[key] === undefined) delete env[key];
    return spawnSync(process.execPath, [RETRY], { cwd: repo, env: env as NodeJS.ProcessEnv, encoding: "utf8", timeout: 30_000 });
  }

  const outputText = (s: Setup) => readFileSync(s.output, "utf8");
  const callsText = (s: Setup) => (existsSync(s.calls) ? readFileSync(s.calls, "utf8") : "");

  it("T1-17 item 1: a failure with no marker and the shim first writes retry=true, exits 0 and says why", () => {
    const s = setup();
    const out = cli(s);
    expect(out.status).toBe(0);
    expect(outputText(s)).toBe("retry=true\n");
    expect(out.stdout).toMatch(/ci: the emulator never ran the script; running the step once more/);
  });

  it("T1-17 item 1: on a runner it stops the leftover emulator through PATH with pkill and adb", () => {
    const s = setup();
    const out = cli(s, { GITHUB_ACTIONS: "true" });
    expect(out.status).toBe(0);
    expect(outputText(s)).toBe("retry=true\n");
    const calls = callsText(s).trimEnd().split("\n");
    expect(calls).toContain("pkill -KILL -f qemu-system");
    expect(calls).toContain("adb kill-server");
  });

  it("T1-17 item 1: off a runner it kills nothing (another agent's emulator may be running)", () => {
    const s = setup();
    for (const value of [undefined, "", "false", "1"]) {
      const out = cli(s, { GITHUB_ACTIONS: value });
      expect(out.status).toBe(0);
      expect(outputText(s)).toContain("retry=true");
      expect(callsText(s)).toBe("");
    }
  });

  it("T1-17 item 1: a marker that exists gives exit 1, an ERROR ci: line, no output line and no cleanup", () => {
    const s = setup();
    writeFileSync(s.marker, "");
    const out = cli(s, { GITHUB_ACTIONS: "true" });
    expect(out.status).toBe(1);
    expect(out.stdout + out.stderr).toMatch(/ERROR ci:/);
    expect(outputText(s)).toBe("");
    expect(callsText(s)).toBe("");
  });

  it("T1-17 item 1: any outcome other than failure gives exit 1 and no output line", () => {
    const s = setup();
    for (const outcome of ["success", "cancelled", "skipped", "", "weird"]) {
      const out = cli(s, { OCTAVE_CI_STEP_OUTCOME: outcome, GITHUB_ACTIONS: "true" });
      expect(out.status, `outcome ${outcome}`).toBe(1);
      expect(outputText(s)).toBe("");
    }
    expect(callsText(s)).toBe("");
  });

  it("T1-17 item 1: a missing started directory, a missing marker variable or a missing outcome is cannot tell: exit 1", () => {
    const s = setup();
    rmSync(s.startedDir, { recursive: true });
    expect(cli(s).status).toBe(1);
    mkdirSync(s.startedDir);
    expect(cli(s, { OCTAVE_CI_SCRIPT_STARTED: undefined }).status).toBe(1);
    expect(cli(s, { OCTAVE_CI_STEP_OUTCOME: undefined }).status).toBe(1);
    expect(outputText(s)).toBe("");
    expect(callsText(s)).toBe("");
  });

  it("T1-17 item 1: a shim that is not first on PATH is cannot tell: exit 1", () => {
    const s = setup();
    const out = cli(s, { PATH: [s.realDir, s.shimDir, s.fakeDir, dirname(process.execPath)].join(":"), GITHUB_ACTIONS: "true" });
    expect(out.status).toBe(1);
    expect(out.stdout + out.stderr).toMatch(/ERROR ci:/);
    expect(outputText(s)).toBe("");
    expect(callsText(s)).toBe("");
  });
});
