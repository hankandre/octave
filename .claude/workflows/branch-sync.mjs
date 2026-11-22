// Brings a resumed task branch up to date with origin/main by rebasing it, never by merging.
// Usage: node .claude/workflows/branch-sync.mjs --repo <worktree> --task <ID> [--base origin/main] [--no-fetch]
// Prints one JSON line on stdout and ERROR lines on stderr; exits 0 when ok, 1 otherwise.
// It never stashes and never uses reset --hard. A conflict is undone with rebase --abort; a rebase that moves a frozen
// file or the freeze commit's place is undone with reset --keep to the old tip (the tree is clean at that point).
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const TASK_ID = /^T\d+-\d{2}$/;

function makeGit(repo) {
  return (args, allowFail = false) => {
    const out = spawnSync("git", ["-C", repo, "-c", "rebase.autoStash=false", ...args], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    if (out.status !== 0 && !allowFail) throw new Error(`git ${args.join(" ")} failed: ${String(out.stderr || out.error || "").trim()}`);
    return { ok: out.status === 0, text: String(out.stdout || "").trim(), stderr: String(out.stderr || "").trim() };
  };
}

// The freeze commit as check-flow defines it: the oldest non-merge commit that adds the task's manifest.
function findFreeze(git, base, task) {
  const manifest = `docs/specs/${task}.tests.json`;
  const shas = git(["rev-list", "--reverse", "--no-merges", `${base}..HEAD`]).text.split("\n").filter(Boolean);
  const added = git(["log", "--reverse", "--no-merges", "--diff-filter=A", "--format=%H", `${base}..HEAD`, "--", manifest]).text.split("\n").filter(Boolean);
  if (!added.length) return { sha: null, index: -1, subject: null, shas, manifest };
  return { sha: added[0], index: shas.indexOf(added[0]), subject: git(["log", "-1", "--format=%s", added[0]]).text, shas, manifest };
}

// The frozen paths' blob ids at HEAD: the manifest and the files it lists (as the freeze commit wrote it).
function frozenBlobs(git, freeze) {
  let files = [];
  try {
    files = JSON.parse(git(["show", `${freeze.sha}:${freeze.manifest}`]).text).files || [];
  } catch (error) {
    files = [];
  }
  const blobs = {};
  for (const path of [freeze.manifest].concat(files)) blobs[path] = git(["rev-parse", "--verify", "--quiet", `HEAD:${path}`], true).text || null;
  return blobs;
}

export function branchSync({ repo, task, base = "origin/main", fetch = true }) {
  const result = { ok: false, task, base, rebased: false, before: null, after: null, merges: [], freeze: null, freezeFirst: null, first: null, missingWorktree: false, problems: [] };
  const fail = (message) => {
    result.problems.push(`ERROR branch: ${message}`);
    return result;
  };
  if (!TASK_ID.test(task || "")) return fail(`unknown task id ${JSON.stringify(task)}`);
  const dir = resolve(repo || ".");
  if (!existsSync(dir)) {
    result.missingWorktree = true;
    return fail(`the worktree ${dir} does not exist`);
  }
  const git = makeGit(dir);
  try {
    if (!git(["rev-parse", "--git-dir"], true).ok) return fail(`${dir} is not a git worktree`);
    if (!git(["symbolic-ref", "-q", "HEAD"], true).ok) return fail("HEAD is detached; check out the task branch first");
    if (fetch) {
      const fetched = git(["fetch", "-q", "origin", "main"], true);
      if (!fetched.ok) return fail(`git fetch origin main failed: ${fetched.stderr}`);
    }
    if (!git(["rev-parse", "--verify", "--quiet", `${base}^{commit}`], true).ok) return fail(`base ${base} does not resolve`);
    result.before = git(["rev-parse", "HEAD"]).text;
    result.after = result.before;

    // (c) a merge on the branch is never rebased: report each one and change nothing.
    for (const sha of git(["rev-list", "--merges", `${base}..HEAD`]).text.split("\n").filter(Boolean)) {
      const subject = git(["log", "-1", "--format=%s", sha]).text;
      result.merges.push({ sha, subject });
      result.problems.push(`ERROR branch: merge commit ${sha.slice(0, 12)} "${subject}" is on this branch; never merge ${base} into a task branch, rebase it. Rebuild the branch without the merge, then rerun`);
    }
    if (result.merges.length) return result;

    // (d) the freeze commit and its place.
    const freeze = findFreeze(git, base, task);
    result.freeze = freeze.sha;
    result.first = freeze.shas[0] || null;
    result.freezeFirst = freeze.sha ? freeze.index === 0 : null;

    // (e) up to date: nothing to do, and uncommitted work is left alone.
    if (git(["merge-base", "--is-ancestor", base, "HEAD"], true).ok) {
      result.ok = true;
      return result;
    }

    // (f) a rebase is due: refuse uncommitted changes to tracked files, never stash.
    const dirty = git(["status", "--porcelain", "--untracked-files=no"]).text.split("\n").filter(Boolean);
    if (dirty.length) return fail(`${base} moved but the worktree has uncommitted changes to tracked files (${dirty.map((line) => line.slice(3)).join(", ")}); commit or discard them, then rerun`);
    const blobsBefore = freeze.sha ? frozenBlobs(git, freeze) : {};

    // (g) rebase, undoing it on a conflict.
    const rebase = git(["rebase", base], true);
    if (!rebase.ok) {
      const conflicts = git(["diff", "--name-only", "--diff-filter=U"], true).text.split("\n").filter(Boolean);
      git(["rebase", "--abort"], true);
      return fail(`rebasing onto ${base} conflicts in ${conflicts.join(", ") || "an unknown file"}; the branch is unchanged. Resolve it by hand, or return the task to the owner`);
    }

    // (h) the order and the frozen blobs must survive the rebase; otherwise restore the old tip.
    const after = findFreeze(git, base, task);
    const moved = [];
    if (freeze.sha) {
      const blobsAfter = frozenBlobs(git, after.sha ? after : freeze);
      for (const path of Object.keys(blobsBefore)) if (blobsAfter[path] !== blobsBefore[path]) moved.push(path);
      if (!after.sha || after.index !== freeze.index || after.subject !== freeze.subject) {
        result.problems.push(`ERROR branch: the freeze commit "${freeze.subject}" is no longer at position ${freeze.index + 1} after the rebase`);
      }
    }
    if (moved.length) result.problems.push(`ERROR branch: the rebase changed frozen files (${moved.join(", ")}); main changed the same lines as the freeze commit`);
    if (result.problems.length) {
      const restore = git(["reset", "--keep", result.before], true);
      result.problems.push(restore.ok ? `ERROR branch: the branch is back at ${result.before.slice(0, 12)}; resolve the overlap by hand` : `ERROR branch: restoring ${result.before.slice(0, 12)} failed: ${restore.stderr}`);
      return result;
    }
    result.rebased = true;
    result.after = git(["rev-parse", "HEAD"]).text;
    result.first = after.shas[0] || null;
    result.freezeFirst = after.sha ? after.index === 0 : null;
    result.ok = true;
    return result;
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

function main(argv) {
  const { values } = parseArgs({
    args: argv,
    options: { repo: { type: "string" }, task: { type: "string" }, base: { type: "string" }, "no-fetch": { type: "boolean" } },
    strict: true,
  });
  const result = branchSync({ repo: values.repo, task: values.task, base: values.base ?? "origin/main", fetch: !values["no-fetch"] });
  console.log(JSON.stringify(result));
  if (!result.ok) {
    console.error(result.problems.join("\n"));
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
