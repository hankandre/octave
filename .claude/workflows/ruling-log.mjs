// Checks that an inline Product Owner ruling reached tasks/product-owner-log.md on the task branch, and reads a task's earlier rulings back.
// Usage: node .claude/workflows/ruling-log.mjs --repo <worktree> --task <ID> --commit <sha>
//        node .claude/workflows/ruling-log.mjs --repo <worktree> --task <ID> --history
// Prints one JSON line on stdout and ERROR lines on stderr; exits 0 when ok, 1 otherwise.
// Check mode: {ok, commit, heading, problems}. History mode: {ok, sections, counts, firstRulings, problems}.
// It only reads the repository; it never writes, stashes or resets.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const TASK_ID = /^T\d+-\d{2}$/;
const LOG = "tasks/product-owner-log.md";

function makeGit(repo) {
  return (args) => {
    const out = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
    return { ok: out.status === 0, text: String(out.stdout || "").trim(), stderr: String(out.stderr || "").trim() };
  };
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const headingOf = (task) => new RegExp(`^## \\d{4}-\\d{2}-\\d{2}, ${escapeRegExp(task)} ruling`);

export function checkRulingLog({ repo, task, commit }) {
  const result = { ok: false, commit: commit || "", heading: "", problems: [] };
  const problem = (message) => result.problems.push(message);
  if (!TASK_ID.test(task || "")) {
    problem(`unknown task id ${JSON.stringify(task)}`);
    return result;
  }
  const dir = resolve(repo || ".");
  if (!existsSync(dir)) {
    problem(`the worktree ${dir} does not exist`);
    return result;
  }
  const git = makeGit(dir);
  const branch = git(["symbolic-ref", "--short", "HEAD"]);
  if (!branch.ok || branch.text !== `task/${task}`) problem(`HEAD is on ${branch.text || "no branch"}, not the task branch task/${task}`);
  const dirty = git(["status", "--porcelain", "--", LOG]);
  if (dirty.text) problem(`${LOG} has uncommitted changes`);
  const sha = /^[0-9a-f]{4,40}$/i.test(commit || "") ? git(["rev-parse", "--verify", "--quiet", `${commit}^{commit}`]) : { ok: false, text: "" };
  if (!sha.ok || !sha.text) {
    problem(`the commit ${JSON.stringify(commit)} does not resolve to a commit`);
    return result;
  }
  result.commit = sha.text;
  if (!git(["merge-base", "--is-ancestor", sha.text, "HEAD"]).ok) problem(`the commit ${sha.text.slice(0, 12)} is not HEAD or an ancestor of HEAD`);
  const files = git(["diff-tree", "--root", "--no-commit-id", "--name-only", "-r", sha.text]).text.split("\n");
  if (!files.includes(LOG)) {
    problem(`the commit ${sha.text.slice(0, 12)} does not change ${LOG}`);
  } else {
    const added = git(["show", "--format=", "--unified=0", sha.text, "--", LOG]).text.split("\n").filter((line) => line.startsWith("+## ")).map((line) => line.slice(1));
    const heading = added.find((line) => headingOf(task).test(line));
    if (heading) result.heading = heading;
    else problem(`the commit adds no section headed "## <date>, ${task} ruling" to ${LOG}`);
  }
  result.ok = result.problems.length === 0;
  return result;
}

// Same normalisation as ruleKey in task.js (a workflow script cannot import this file, so the two are kept equal by hand).
const ruleKey = (rule) => String(rule).trim().toLowerCase().replace(/\s+/g, " ").replace(/[.,;:!?]+$/, "");

// The task's ruling sections in a log: one line "- [<rule key>] <ruling> | reason: ..." per ruling.
export function parseRulingHistory(text, task) {
  const counts = {};
  const firstRulings = {};
  let sections = 0;
  let inSection = false;
  for (const line of String(text || "").split("\n")) {
    if (line.startsWith("## ")) {
      inSection = headingOf(task).test(line);
      if (inSection) sections += 1;
    } else if (inSection) {
      const match = /^- \[([^\]]+)\]\s*(.*)$/.exec(line);
      if (match) {
        const key = ruleKey(match[1]);
        counts[key] = (Object.prototype.hasOwnProperty.call(counts, key) ? counts[key] : 0) + 1;
        if (!Object.prototype.hasOwnProperty.call(firstRulings, key)) firstRulings[key] = match[2].split(" | ")[0];
      }
    }
  }
  return { sections, counts, firstRulings };
}

export function rulingHistory({ repo, task }) {
  const result = { ok: false, sections: 0, counts: {}, firstRulings: {}, problems: [] };
  if (!TASK_ID.test(task || "")) {
    result.problems.push(`unknown task id ${JSON.stringify(task)}`);
    return result;
  }
  const dir = resolve(repo || ".");
  if (!existsSync(dir)) {
    result.problems.push(`the worktree ${dir} does not exist`);
    return result;
  }
  const shown = makeGit(dir)(["show", `HEAD:${LOG}`]);
  Object.assign(result, parseRulingHistory(shown.ok ? shown.text : "", task));
  result.ok = true;
  return result;
}

function main(argv) {
  const { values } = parseArgs({ args: argv, options: { repo: { type: "string" }, task: { type: "string" }, commit: { type: "string" }, history: { type: "boolean" } }, strict: true });
  const result = values.history ? rulingHistory({ repo: values.repo, task: values.task }) : checkRulingLog({ repo: values.repo, task: values.task, commit: values.commit });
  console.log(JSON.stringify(result));
  if (!result.ok) {
    console.error(result.problems.map((message) => `ERROR ruling log: ${message}`).join("\n"));
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
