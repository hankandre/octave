// What a lane can take next, read from origin/main, for the lane runner in task.js.
// Usage: node .claude/workflows/lane-state.mjs --repo <main checkout> --lane <lane> [--base origin/main] [--no-fetch]
// Prints one JSON line {ok, lane, serial, tasks, inFlight, problems} on stdout and ERROR lines on stderr; exits 0 when ok, 1 otherwise.
//   tasks:    the lane's todo, non-human tasks in file order, each {id, model, depends_on, waitingOn}; waitingOn lists the dependencies not passing.
//   inFlight: the lane's todo and in_progress tasks that have a worktree on task/<ID> or a remote origin/task/<ID>, each {id, where}.
// It reads tasks/prd.json through git show, never the working tree, and fetches origin unless --no-fetch (a locked fetch is retried).
// A gate script runs under node and may import; only task.js cannot.
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { LANES, SERIAL_LANES } from "../../scripts/task.mjs";

const LOCKED = /index\.lock|shallow\.lock|Unable to create/;
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function makeGit(repo) {
  return (args) => {
    const out = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
    return { ok: out.status === 0, text: String(out.stdout || ""), stderr: String(out.stderr || out.error || "").trim() };
  };
}

function fetchOrigin(git) {
  let last;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    last = git(["fetch", "-q", "origin"]);
    if (last.ok || !LOCKED.test(last.stderr)) return last;
    if (attempt < 2) sleep(1000);
  }
  return last;
}

export function laneState({ repo, lane, base = "origin/main", fetch = true }) {
  const result = { ok: false, lane, serial: SERIAL_LANES.includes(lane), tasks: [], inFlight: [], problems: [] };
  const fail = (message) => {
    result.problems.push(`ERROR lane: ${message}`);
    return result;
  };
  if (!LANES.includes(lane)) return fail(`unknown lane ${JSON.stringify(lane)}; the lanes are ${LANES.join(", ")}`);
  const dir = resolve(repo || ".");
  const git = makeGit(dir);
  if (!git(["rev-parse", "--git-dir"]).ok) return fail(`${dir} is not a git checkout`);
  if (fetch) {
    const fetched = fetchOrigin(git);
    if (!fetched.ok) return fail(`git fetch origin failed: ${fetched.stderr}`);
  }
  const shown = git(["show", `${base}:tasks/prd.json`]);
  if (!shown.ok) return fail(`cannot read tasks/prd.json at ${base}: ${shown.stderr}`);
  let prd;
  try {
    prd = JSON.parse(shown.text);
  } catch (error) {
    return fail(`tasks/prd.json at ${base} is not JSON`);
  }
  const all = prd.phases.flatMap((phase) => phase.tasks);
  const passing = new Set(all.filter((task) => task.passes === true).map((task) => task.id));
  const mine = all.filter((task) => task.lane === lane);
  result.tasks = mine
    .filter((task) => task.status === "todo" && task.human !== true)
    .map((task) => ({ id: task.id, model: task.model, depends_on: task.depends_on || [], waitingOn: (task.depends_on || []).filter((dep) => !passing.has(dep)) }));

  const where = new Map();
  let path = "";
  for (const line of git(["worktree", "list", "--porcelain"]).text.split("\n")) {
    if (line.startsWith("worktree ")) path = line.slice("worktree ".length);
    const branch = line.match(/^branch refs\/heads\/task\/(T\d+-\d{2})$/);
    if (branch && !where.has(branch[1])) where.set(branch[1], path);
  }
  for (const line of git(["for-each-ref", "--format=%(refname:short)", "refs/remotes/origin/task/"]).text.split("\n")) {
    const remote = line.trim().match(/^origin\/task\/(T\d+-\d{2})$/);
    if (remote && !where.has(remote[1])) where.set(remote[1], `origin/task/${remote[1]}`);
  }
  result.inFlight = mine.filter((task) => (task.status === "todo" || task.status === "in_progress") && where.has(task.id)).map((task) => ({ id: task.id, where: where.get(task.id) }));
  result.ok = true;
  return result;
}

function main(argv) {
  let values;
  try {
    ({ values } = parseArgs({ args: argv, strict: true, options: { repo: { type: "string" }, lane: { type: "string" }, base: { type: "string" }, "no-fetch": { type: "boolean" } } }));
  } catch (error) {
    console.error(`ERROR lane: ${error.message}`);
    process.exit(1);
  }
  if (values.lane === undefined) {
    console.error("ERROR lane: --lane is required");
    process.exit(1);
  }
  const result = laneState({ repo: values.repo, lane: values.lane, base: values.base, fetch: !values["no-fetch"] });
  console.log(JSON.stringify(result));
  for (const problem of result.problems) console.error(problem);
  process.exit(result.ok ? 0 : 1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
