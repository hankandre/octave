// Decide whether a failed emulator step of the tv or wire job runs once more (T1-17).
// Run: node scripts/ci-emulator-retry.mjs
// Reads OCTAVE_CI_STEP_OUTCOME, OCTAVE_CI_SCRIPT_STARTED, RUNNER_TEMP, PATH and GITHUB_OUTPUT.
// A step is retried only when it failed and the pnpm shim (scripts/ci-script-started.sh) never created the start marker,
// which means the emulator never reached the test script. A started script is never retried, whatever its result, and a
// case that cannot be told apart is not retried. Exit 0 with `retry=true` written to GITHUB_OUTPUT to retry; exit 1 otherwise.
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, statSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function retryDecision({ outcome, scriptStarted, shimFirst }) {
  if (outcome !== "failure") return { retry: false, reason: `the step's outcome is ${outcome || "unknown"}, not failure` };
  if (scriptStarted === true) return { retry: false, reason: "the step failed after its script started; a started script is never retried" };
  if (scriptStarted !== false) return { retry: false, reason: "cannot tell whether the script started (no start marker state); not retried" };
  if (shimFirst !== true) return { retry: false, reason: "cannot tell whether the script started (the pnpm shim is not first on PATH); not retried" };
  return { retry: true, reason: "the emulator never ran the script" };
}

const isFile = (path) => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

// True when the first directory of the path that holds a file named pnpm is the shim's directory.
export function shimIsFirst({ pathValue, shimDir }) {
  for (const dir of (pathValue ?? "").split(delimiter)) {
    if (dir === "") continue;
    if (isFile(join(dir, "pnpm"))) return resolve(dir) === resolve(shimDir);
  }
  return false;
}

// Stop what a failed boot left behind. Both calls may fail: nothing may be left to stop. No shell is used: a shell whose
// command line holds "qemu-system" would match pkill -f itself.
function stopLeftoverEmulator() {
  for (const [command, args] of [["pkill", ["-KILL", "-f", "qemu-system"]], ["adb", ["kill-server"]]]) {
    try {
      execFileSync(command, args, { stdio: "ignore", timeout: 60_000 });
    } catch {
      // nothing to stop, or the tool is missing
    }
  }
}

function main() {
  const env = process.env;
  const runnerTemp = env.RUNNER_TEMP;
  const markerPath = env.OCTAVE_CI_SCRIPT_STARTED;
  const startedDir = runnerTemp ? join(runnerTemp, "octave-ci", "started") : undefined;
  const shimDir = runnerTemp ? join(runnerTemp, "octave-ci", "bin") : undefined;
  const known = markerPath && startedDir && existsSync(startedDir);
  const decision = retryDecision({
    outcome: env.OCTAVE_CI_STEP_OUTCOME,
    scriptStarted: known ? existsSync(markerPath) : undefined,
    shimFirst: shimDir ? shimIsFirst({ pathValue: env.PATH, shimDir }) : false,
  });
  if (!decision.retry) {
    console.error(`ERROR ci: ${decision.reason}`);
    process.exit(1);
  }
  try {
    if (!env.GITHUB_OUTPUT) throw new Error("GITHUB_OUTPUT is not set");
    appendFileSync(env.GITHUB_OUTPUT, "retry=true\n");
  } catch (error) {
    console.error(`ERROR ci: cannot write retry to GITHUB_OUTPUT: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
  // Only on a GitHub runner: a developer machine may run other agents' emulators.
  if (env.GITHUB_ACTIONS === "true") stopLeftoverEmulator();
  console.log("ci: the emulator never ran the script; running the step once more");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
