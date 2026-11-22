// Brings down the fixture servers (Docker Compose project) that one task worktree started, for the task workflow.
// Usage: node .claude/workflows/fixtures-down.mjs --worktree <dir> --compose-file <file>
// The project name is "octave-" and the first 10 hex characters of the SHA-256 of the worktree path, as
// tests/integration/compose-project.mjs computes it. It works after the worktree is deleted (the path string is
// hashed) and takes the compose file from the main checkout. It stops only that name, never another checkout's project.
// Prints one JSON line {ok, worktree, projects, stopped, problems, note?} and exits 0 unless a down fails.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const hashName = (path) => `octave-${createHash("sha256").update(path).digest("hex").slice(0, 10)}`;

// The name for a path: its real path while it exists (what composeProjectName hashes), otherwise the resolved path string.
export function projectNameFor(path) {
  let real;
  try {
    real = realpathSync(path);
  } catch (error) {
    real = resolve(path);
  }
  return hashName(real);
}

const dockerExec = (file, args) => spawnSync(file, args, { encoding: "utf8" });

export function tearDown({ worktree, composeFile, exec = dockerExec, exists = existsSync, realpath = realpathSync }) {
  const resolved = resolve(worktree);
  const names = [hashName(resolved)];
  if (exists(resolved)) {
    try {
      const real = hashName(realpath(resolved));
      if (!names.includes(real)) names.push(real);
    } catch (error) {
      // the worktree vanished between the two calls; the resolved name stands
    }
  }
  const report = { ok: true, worktree: resolved, projects: names, stopped: [], problems: [] };
  for (const name of names) {
    const ps = exec("docker", ["ps", "-a", "--filter", `label=com.docker.compose.project=${name}`, "--format", '{{.Label "com.docker.compose.project"}}']);
    if (ps.error && ps.error.code === "ENOENT") {
      report.note = "docker not found";
      report.stopped = [];
      return report;
    }
    if (ps.status !== 0) {
      report.note = `docker did not answer: ${String(ps.stderr || "").trim().split("\n")[0] || `exit ${ps.status}`}`;
      return report;
    }
    if (!String(ps.stdout || "").split("\n").map((line) => line.trim()).includes(name)) continue;
    const down = exec("docker", ["compose", "-p", name, "-f", composeFile, "down", "-v", "--remove-orphans"]);
    if (down.status === 0) report.stopped.push(name);
    else {
      report.ok = false;
      report.problems.push(`ERROR fixtures: docker compose down for ${name} failed (exit ${down.status}): ${String(down.stderr || "").trim()}`);
    }
  }
  return report;
}

function main(argv) {
  const { values } = parseArgs({ args: argv, options: { worktree: { type: "string" }, "compose-file": { type: "string" } }, strict: true });
  if (!values.worktree || !values["compose-file"]) {
    console.error("ERROR fixtures: pass --worktree <dir> and --compose-file <file>");
    process.exit(1);
  }
  const report = tearDown({ worktree: values.worktree, composeFile: resolve(values["compose-file"]) });
  console.log(JSON.stringify(report));
  if (report.problems.length) console.error(report.problems.join("\n"));
  process.exit(report.ok ? 0 : 1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
