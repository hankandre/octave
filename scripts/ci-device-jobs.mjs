// Decide whether the device jobs (tripwire, tv, wire) run on this CI event (T1-17).
// Run: node scripts/ci-device-jobs.mjs [--repo <dir>]
// Reads GITHUB_EVENT_NAME and OCTAVE_CI_HEAD_SHA; prints one line and appends `device-jobs=skip|run` to GITHUB_OUTPUT.
// Only a pull request whose merge commit changes paths that are all under docs/ or tasks/ gives skip. Everything else,
// an unreadable diff included, gives run. Exit 0 once the output is written; exit 1 when it cannot be.
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

export const SKIPPABLE_PREFIXES = Object.freeze(["docs/", "tasks/"]);

export function deviceJobsDecision({ eventName, paths }) {
  if (eventName !== "pull_request") return { decision: "run", reason: `the event is ${eventName || "unknown"}, not pull_request` };
  if (!Array.isArray(paths) || paths.length === 0) return { decision: "run", reason: "no changed path is known" };
  for (const path of paths) {
    if (typeof path !== "string" || path === "") return { decision: "run", reason: "a changed path is empty" };
    if (!SKIPPABLE_PREFIXES.some((prefix) => path.startsWith(prefix))) return { decision: "run", reason: `${path} is outside ${SKIPPABLE_PREFIXES.join(" and ")}` };
  }
  return { decision: "skip", reason: `${paths.length} changed path(s), all under ${SKIPPABLE_PREFIXES.join(" or ")}` };
}

// The checkout of a pull request is its merge commit: HEAD^1 is the base and HEAD^2 the pull request's head.
export function changedPaths({ repo, headSha }) {
  const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (!headSha) return { unreadable: "the pull request head sha is not set" };
  try {
    const parents = git("rev-list", "--parents", "-n", "1", "HEAD").trim().split(" ");
    if (parents.length !== 3) return { unreadable: "HEAD is not a merge commit with two parents" };
    if (git("rev-parse", "HEAD^2").trim() !== headSha) return { unreadable: "HEAD^2 is not the pull request head" };
    const paths = git("diff", "--name-only", "--no-renames", "-z", "HEAD^1", "HEAD").split("\0").filter((path) => path !== "");
    return { paths };
  } catch (error) {
    return { unreadable: `git failed: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}` };
  }
}

function main() {
  const { values } = parseArgs({ options: { repo: { type: "string", default: process.cwd() } } });
  const eventName = process.env.GITHUB_EVENT_NAME;
  let result;
  if (eventName !== "pull_request") result = deviceJobsDecision({ eventName, paths: undefined });
  else {
    const changed = changedPaths({ repo: values.repo, headSha: process.env.OCTAVE_CI_HEAD_SHA });
    result = "paths" in changed ? deviceJobsDecision({ eventName, paths: changed.paths }) : { decision: "run", reason: `the diff cannot be read: ${changed.unreadable}` };
  }
  try {
    const file = process.env.GITHUB_OUTPUT;
    if (!file) throw new Error("GITHUB_OUTPUT is not set");
    appendFileSync(file, `device-jobs=${result.decision}\n`);
  } catch (error) {
    console.error(`ERROR ci: cannot write device-jobs to GITHUB_OUTPUT: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
  console.log(`ci device jobs: ${result.decision} (${result.reason})`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
