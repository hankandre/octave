// @vitest-environment node
// T1-17 items 3 and 6 (docs/specs/T1-17.md, "Test plan"): a line-based reader of .github/workflows/ci.yml (no YAML
// parser, like the frozen tests that read the same file) returns a list of problems. The real file must give none, and
// each one-line change to a copy must give a problem that the real file does not have.
//
// What the reader pins, in short:
// - tv and wire: a shim step before the first emulator step; each emulator step is either a first attempt (an id,
//   continue-on-error, a start-marker path of its own, a script that is one `pnpm <name>` command) directly followed by
//   its decision step and a retry step, or that retry step; a retry step repeats its first attempt line for line, has
//   no continue-on-error and no marker, and runs only on the decision step's `retry` output.
// - tripwire, tv, wire: `needs: changes` and the exact `if`; checks and dependency-review are not changed; the `changes`
//   job decides with scripts/ci-device-jobs.mjs from a checkout of depth 2; no paths, paths-ignore or branches-ignore
//   filter under `on:`.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const CI = join(repo, ".github", "workflows", "ci.yml");

// ---- the reader ---------------------------------------------------------------------------------------------------

type Step = {
  index: number;
  id?: string;
  uses?: string;
  run: string;
  cond?: string;
  continueOnError?: string;
  env: Record<string, string>;
  withLines: string[];
  with: Record<string, string>;
};

const noComment = (value: string) => value.replace(/\s+#.*$/, "").trim();

function splitJobs(lines: string[]): Map<string, string[]> {
  const jobs = new Map<string, string[]>();
  const start = lines.findIndex((line) => /^jobs:\s*$/.test(line));
  if (start === -1) return jobs;
  let current: string[] | undefined;
  for (const line of lines.slice(start + 1)) {
    const header = /^ {2}([A-Za-z][\w-]*):\s*$/.exec(line);
    if (header) {
      current = [];
      jobs.set(header[1]!, current);
    } else if (/^ {2}\S/.test(line)) {
      current = undefined; // a comment between jobs belongs to no job (the frozen tests end a job there too)
    } else if (current) {
      current.push(line);
    }
  }
  return jobs;
}

function parseStep(raw: string[], index: number): Step {
  const lines = raw.filter((line) => line.trim() !== "" && !/^\s*#/.test(line));
  lines[0] = lines[0]!.replace(/^( {6})- /, "$1  ");
  const step: Step = { index, run: "", env: {}, withLines: [], with: {} };
  let block = "";
  for (const line of lines) {
    const top = /^ {8}([\w-]+):\s*(.*)$/.exec(line);
    if (top) {
      block = top[1]!;
      const value = noComment(top[2]!);
      if (block === "id") step.id = value;
      else if (block === "uses") step.uses = value;
      else if (block === "if") step.cond = value;
      else if (block === "continue-on-error") step.continueOnError = value;
      else if (block === "run") step.run = value;
      continue;
    }
    const nested = /^ {10}([\w-]+):\s*(.*)$/.exec(line);
    if (block === "env" && nested) step.env[nested[1]!] = noComment(nested[2]!);
    else if (block === "with") {
      step.withLines.push(noComment(line.trim()));
      if (nested) step.with[nested[1]!] = noComment(nested[2]!);
    } else if (block === "run") step.run += `\n${line.trim()}`;
  }
  return step;
}

function splitSteps(body: string[]): { props: string[]; steps: Step[] } {
  const at = body.findIndex((line) => /^ {4}steps:\s*$/.test(line));
  if (at === -1) return { props: body.filter((line) => !/^\s*#/.test(line)), steps: [] };
  const props = body.slice(0, at).filter((line) => !/^\s*#/.test(line));
  const rest = body.slice(at + 1);
  const starts = rest.flatMap((line, i) => (/^ {6}- /.test(line) ? [i] : []));
  const steps = starts.map((from, n) => parseStep(rest.slice(from, starts[n + 1] ?? rest.length), n));
  return { props, steps };
}

const MARKER = /^\$\{\{ runner\.temp \}\}\/octave-ci\/started\/[\w-]+$/;
const isEmulator = (step: Step) => (step.uses ?? "").startsWith("ReactiveCircus/android-emulator-runner@");
const SKIP_IF = "    if: ${{ !cancelled() && needs.changes.outputs.device-jobs != 'skip' }}";

function checkDeviceJob(job: string, steps: Step[], problems: string[]): void {
  const emulators = steps.filter(isEmulator).map((step) => step.index);
  const shims = steps.filter((step) => step.run.includes("scripts/ci-script-started.sh"));
  if (shims.length !== 1) problems.push(`${job}: expected one shim step running scripts/ci-script-started.sh, found ${shims.length}`);
  else {
    const shim = shims[0]!;
    if (emulators.length > 0 && shim.index > emulators[0]!) problems.push(`${job}: the shim step must come before the first emulator step`);
    if (!shim.run.includes("GITHUB_PATH") || !shim.run.includes("OCTAVE_CI_REAL_PNPM")) problems.push(`${job}: the shim step must put the shim first on PATH and set OCTAVE_CI_REAL_PNPM`);
  }

  const consumed = new Set<number>();
  const firstAttempts: Step[] = [];
  const markerOwner = new Map<string, string>();
  for (const at of emulators) {
    if (consumed.has(at)) continue;
    const first = steps[at]!;
    if (!first.id || first.continueOnError !== "true") {
      problems.push(`${job}: emulator step ${at} is neither a first attempt (id and continue-on-error: true) nor the retry directly after a decision step`);
      continue;
    }
    firstAttempts.push(first);
    const id = first.id;
    const marker = first.env.OCTAVE_CI_SCRIPT_STARTED;
    if (marker === undefined || !MARKER.test(marker)) problems.push(`${job}: first attempt ${id} needs OCTAVE_CI_SCRIPT_STARTED set to a path under runner.temp/octave-ci/started`);
    else if (markerOwner.has(marker)) problems.push(`${job}: first attempts ${markerOwner.get(marker)} and ${id} share the marker path ${marker}`);
    else markerOwner.set(marker, id);
    if (!/^pnpm [\w:-]+$/.test(first.with.script ?? "")) problems.push(`${job}: first attempt ${id} must have a script of one single-line "pnpm <name>" command, found "${first.with.script ?? ""}"`);

    const decision = steps[at + 1];
    if (!decision || decision.id !== `${id}-retry`) problems.push(`${job}: the step directly after first attempt ${id} must be its decision step with id ${id}-retry`);
    else {
      if (decision.cond !== `steps.${id}.outcome != 'success'` && decision.cond !== `steps.${id}.outcome == 'failure'`) problems.push(`${job}: decision step ${decision.id} must run only after ${id} did not succeed (if: steps.${id}.outcome != 'success'), found "${decision.cond ?? ""}"`);
      if (decision.run.trim() !== "node scripts/ci-emulator-retry.mjs") problems.push(`${job}: decision step ${decision.id} must run node scripts/ci-emulator-retry.mjs`);
      if (decision.env.OCTAVE_CI_STEP_OUTCOME !== `\${{ steps.${id}.outcome }}`) problems.push(`${job}: decision step ${decision.id} must pass OCTAVE_CI_STEP_OUTCOME from steps.${id}.outcome`);
      if (decision.env.OCTAVE_CI_SCRIPT_STARTED !== marker) problems.push(`${job}: decision step ${decision.id} must read the marker path of ${id}`);
      if (decision.continueOnError !== undefined) problems.push(`${job}: decision step ${decision.id} must not have continue-on-error`);
    }

    const retry = steps[at + 2];
    if (!retry || !isEmulator(retry)) problems.push(`${job}: the step after decision step ${id}-retry must be the retry of ${id}`);
    else {
      consumed.add(at + 2);
      if (retry.cond !== `steps.${id}-retry.outputs.retry == 'true'`) problems.push(`${job}: the retry of ${id} must run only on if: steps.${id}-retry.outputs.retry == 'true', found "${retry.cond ?? ""}"`);
      if (retry.continueOnError !== undefined) problems.push(`${job}: the retry of ${id} must not have continue-on-error`);
      if (retry.env.OCTAVE_CI_SCRIPT_STARTED !== undefined) problems.push(`${job}: the retry of ${id} must not set OCTAVE_CI_SCRIPT_STARTED`);
      if (retry.uses !== first.uses) problems.push(`${job}: the retry of ${id} must use the same action line as its first attempt`);
      if (retry.env.ANDROID_SERIAL === undefined || retry.env.ANDROID_SERIAL !== first.env.ANDROID_SERIAL) problems.push(`${job}: the retry of ${id} must set the same ANDROID_SERIAL as its first attempt`);
      if (JSON.stringify(retry.withLines) !== JSON.stringify(first.withLines)) problems.push(`${job}: the retry of ${id} must have the same with block as its first attempt, line for line`);
    }
    const retries = steps.filter((step) => step.cond === `steps.${id}-retry.outputs.retry == 'true'`).length;
    if (retries !== 1) problems.push(`${job}: expected one retry step of ${id}, found ${retries}`);
  }

  const deciders = steps.filter((step) => step.run.includes("scripts/ci-emulator-retry.mjs")).length;
  if (deciders !== firstAttempts.length) problems.push(`${job}: ${deciders} decision steps for ${firstAttempts.length} first attempts`);
  const firstIndexes = new Set(firstAttempts.map((step) => step.index));
  for (const step of steps) {
    if (step.continueOnError !== undefined && !firstIndexes.has(step.index)) problems.push(`${job}: step ${step.index} has continue-on-error but is not a first attempt with a decision step after it`);
  }
}

export function ciProblems(text: string): string[] {
  const problems: string[] = [];
  const lines = text.split("\n");

  const on = lines.findIndex((line) => /^on:\s*$/.test(line));
  if (on === -1) problems.push("ci.yml has no on: key");
  else {
    const end = lines.findIndex((line, i) => i > on && /^\S/.test(line));
    for (const line of lines.slice(on + 1, end === -1 ? undefined : end)) {
      if (/^\s*#/.test(line)) continue;
      if (/^\s+(paths|paths-ignore|branches-ignore)\s*:/.test(line)) problems.push(`on: holds a filter that can skip the workflow: ${line.trim()}`);
    }
  }

  const jobs = splitJobs(lines);
  const read = (name: string) => {
    const body = jobs.get(name);
    if (!body) {
      problems.push(`ci.yml has no job named ${name}`);
      return undefined;
    }
    return splitSteps(body);
  };

  const dependencyReview = read("dependency-review");
  if (dependencyReview) {
    if (!dependencyReview.props.includes("    if: github.event_name == 'pull_request'")) problems.push("dependency-review must keep its if: github.event_name == 'pull_request'");
    if (dependencyReview.props.some((line) => /^ {4}needs:/.test(line))) problems.push("dependency-review must have no needs");
  }
  const checks = read("checks");
  if (checks && checks.props.some((line) => /^ {4}(needs|if):/.test(line))) problems.push("checks must have no needs and no if: it always runs");

  const changes = read("changes");
  if (changes) {
    if (!changes.props.includes("      device-jobs: ${{ steps.decide.outputs.device-jobs }}")) problems.push("the changes job must output device-jobs from steps.decide.outputs.device-jobs");
    const decide = changes.steps.find((step) => step.id === "decide");
    if (!decide) problems.push("the changes job has no step with id decide");
    else {
      if (decide.run.trim() !== "node scripts/ci-device-jobs.mjs") problems.push("the decide step must run node scripts/ci-device-jobs.mjs");
      if (decide.cond !== "github.event_name == 'pull_request'") problems.push("the decide step must run only on pull_request");
      if (decide.env.OCTAVE_CI_HEAD_SHA !== "${{ github.event.pull_request.head.sha }}") problems.push("the decide step must pass OCTAVE_CI_HEAD_SHA from github.event.pull_request.head.sha");
    }
    const checkout = changes.steps.find((step) => (step.uses ?? "").startsWith("actions/checkout@"));
    if (!checkout) problems.push("the changes job has no checkout step");
    else if (checkout.with["fetch-depth"] !== "2") problems.push("the changes job's checkout must have fetch-depth: 2");
  }

  for (const name of ["tripwire", "tv", "wire"]) {
    const job = read(name);
    if (!job) continue;
    if (!job.props.includes("    needs: changes")) problems.push(`${name} must have exactly "needs: changes"`);
    if (!job.props.includes(SKIP_IF)) problems.push(`${name} must have exactly the line ${SKIP_IF.trim()}`);
    if (name !== "tripwire") checkDeviceJob(name, job.steps, problems);
  }
  return problems;
}

// ---- helpers to change a copy -------------------------------------------------------------------------------------

type Lines = string[];

function jobRange(lines: Lines, job: string): [number, number] {
  const from = lines.findIndex((line) => line === `  ${job}:`);
  if (from === -1) throw new Error(`mutation target: no job ${job}`);
  const rest = lines.slice(from + 1);
  const end = rest.findIndex((line) => /^ {2}\S/.test(line));
  return [from + 1, end === -1 ? lines.length : from + 1 + end];
}

// The step of `job` that holds a line matching `pattern`: [start, end) over the whole file.
function stepRange(lines: Lines, job: string, pattern: RegExp): [number, number] {
  const [from, to] = jobRange(lines, job);
  const at = lines.findIndex((line, i) => i >= from && i < to && pattern.test(line));
  if (at === -1) throw new Error(`mutation target: no line ${String(pattern)} in ${job}`);
  let start = at;
  while (start > from && !/^ {6}- /.test(lines[start]!)) start -= 1;
  let end = at + 1;
  while (end < to && !/^ {6}- /.test(lines[end]!)) end += 1;
  return [start, end];
}

function editStep(text: string, job: string, pattern: RegExp, edit: (step: Lines) => Lines): string {
  const lines = text.split("\n");
  const [start, end] = stepRange(lines, job, pattern);
  return [...lines.slice(0, start), ...edit(lines.slice(start, end)), ...lines.slice(end)].join("\n");
}

function editJob(text: string, job: string, edit: (body: Lines) => Lines): string {
  const lines = text.split("\n");
  const [from, to] = jobRange(lines, job);
  return [...lines.slice(0, from), ...edit(lines.slice(from, to)), ...lines.slice(to)].join("\n");
}

function swap(step: Lines, pattern: RegExp, replacement: string | string[] | null): Lines {
  const at = step.findIndex((line) => pattern.test(line));
  if (at === -1) throw new Error(`mutation target: no line ${String(pattern)} in the step`);
  const neu = replacement === null ? [] : Array.isArray(replacement) ? replacement : [replacement];
  return [...step.slice(0, at), ...neu, ...step.slice(at + 1)];
}

const id = (value: string) => new RegExp(`^\\s+(- )?id: ${value}\\s*$`);
const retryIf = (value: string) => new RegExp(`^\\s+if: steps\\.${value}-retry\\.outputs\\.retry == 'true'\\s*$`);

// ---- the tests ----------------------------------------------------------------------------------------------------

const real = readFileSync(CI, "utf8");
const baseline = new Set(ciProblems(real));

function newProblems(text: string): string[] {
  expect(text, "the mutation changed nothing").not.toBe(real);
  return ciProblems(text).filter((problem) => !baseline.has(problem));
}

describe("T1-17 item 3: the reader on the real ci.yml", () => {
  it("T1-17 item 3: the real ci.yml gives no problem", () => {
    expect(ciProblems(real)).toEqual([]);
  });

  it("T1-17 item 3: SKIPPABLE_PREFIXES deep-equals docs/ and tasks/", async () => {
    const mod = (await import(pathToFileURL(join(repo, "scripts", "ci-device-jobs.mjs")).href)) as { SKIPPABLE_PREFIXES: readonly string[] };
    expect([...mod.SKIPPABLE_PREFIXES]).toEqual(["docs/", "tasks/"]);
  });
});

describe("T1-17 item 3: no input of the device jobs is under a skippable path", () => {
  const made: string[] = [];
  afterAll(() => {
    for (const dir of made) rmSync(dir, { recursive: true, force: true });
  });

  it("T1-17 item 3: prebuildInputs() holds no repository path under docs/ or tasks/", async () => {
    const mod = (await import(pathToFileURL(join(repo, "scripts", "tv-prebuild.mjs")).href)) as { prebuildInputs: () => string[] };
    const inputs = mod.prebuildInputs().map((path) => relative(repo, path).split("\\").join("/"));
    expect(inputs.length).toBeGreaterThan(0);
    for (const path of inputs) {
      expect(path.startsWith("docs/"), path).toBe(false);
      expect(path.startsWith("tasks/"), path).toBe(false);
    }
  });

  it("T1-17 item 3: the e2e source hash ignores docs/ and tasks/ and follows apps/tv", async () => {
    const mod = (await import(pathToFileURL(join(repo, "scripts", "tv-build.mjs")).href)) as { e2eSourceHash: (root: string) => string };
    const root = mkdtempSync(join(tmpdir(), "ci-e2e-hash-"));
    made.push(root);
    const put = (path: string, text: string) => {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    };
    execFileSync("git", ["init", "-q"], { cwd: root });
    put("apps/tv/index.js", "one\n");
    put("pnpm-lock.yaml", "lock\n");
    put("docs/a.md", "a\n");
    put("tasks/prd.json", "{}\n");
    const before = mod.e2eSourceHash(root);
    put("docs/a.md", "changed\n");
    put("docs/new.md", "new\n");
    put("tasks/prd.json", '{"changed":true}\n');
    put("tasks/backlog.jsonl", "{}\n");
    expect(mod.e2eSourceHash(root)).toBe(before);
    put("apps/tv/index.js", "two\n");
    expect(mod.e2eSourceHash(root)).not.toBe(before);
  });
});

describe("T1-17 item 3: each change to a copy of ci.yml gives a problem", () => {
  const cases: Array<[string, (text: string) => string]> = [
    // retry: the decision step
    ["the decision step's if removed", (t) => editStep(t, "tv", id("smoke-retry"), (s) => swap(s, /^\s+if: steps\.smoke\.outcome/, null))],
    ["the decision step's if made always()", (t) => editStep(t, "tv", id("e2e-retry"), (s) => swap(s, /^\s+if: steps\.e2e\.outcome/, "        if: always()"))],
    ["the decision step's if made failure() in wire", (t) => editStep(t, "wire", id("wire-retry"), (s) => swap(s, /^\s+if: steps\.wire\.outcome/, "        if: failure()"))],
    ["a decision step deleted", (t) => editStep(t, "tv", id("smoke-retry"), () => [])],
    ["the decision step given continue-on-error", (t) => editStep(t, "tv", id("smoke-retry"), (s) => [...s, "        continue-on-error: true"])],
    // retry: the retry step
    ["the retry step's if made failure()", (t) => editStep(t, "tv", retryIf("smoke"), (s) => swap(s, retryIf("smoke"), "        if: failure()"))],
    ["the retry step's if made the first attempt's outcome == 'failure'", (t) => editStep(t, "tv", retryIf("e2e"), (s) => swap(s, retryIf("e2e"), "        if: steps.e2e.outcome == 'failure'"))],
    ["the retry step's if removed", (t) => editStep(t, "wire", retryIf("wire"), (s) => swap(s, retryIf("wire"), null))],
    ["continue-on-error added to a retry step", (t) => editStep(t, "tv", retryIf("smoke"), (s) => swap(s, retryIf("smoke"), ["        if: steps.smoke-retry.outputs.retry == 'true'", "        continue-on-error: true"]))],
    ["the retry step given the marker variable", (t) => editStep(t, "wire", retryIf("wire"), (s) => swap(s, /^\s+ANDROID_SERIAL:/, ["          ANDROID_SERIAL: emulator-5554", "          OCTAVE_CI_SCRIPT_STARTED: ${{ runner.temp }}/octave-ci/started/wire"]))],
    ["a second retry step for the same id", (t) => editStep(t, "tv", retryIf("smoke"), (s) => [...s, ...s])],
    ["the retry step's script changed", (t) => editStep(t, "tv", retryIf("e2e"), (s) => swap(s, /^\s+script: /, "          script: pnpm tv:smoke"))],
    ["the retry step's action line changed", (t) => editStep(t, "wire", retryIf("wire"), (s) => swap(s, /^\s+uses: /, "        uses: ReactiveCircus/android-emulator-runner@0000000000000000000000000000000000000000 # v0"))],
    ["the retry step's ANDROID_SERIAL changed", (t) => editStep(t, "tv", retryIf("smoke"), (s) => swap(s, /^\s+ANDROID_SERIAL:/, "          ANDROID_SERIAL: emulator-5556"))],
    ["the retry step's with value changed", (t) => editStep(t, "wire", retryIf("wire"), (s) => swap(s, /^\s+api-level:/, "          api-level: 35"))],
    ["the retry step's with input dropped", (t) => editStep(t, "tv", retryIf("smoke"), (s) => swap(s, /^\s+profile:/, null))],
    // retry: the first attempt
    ["continue-on-error removed from a first attempt", (t) => editStep(t, "tv", id("smoke"), (s) => swap(s, /^\s+continue-on-error:/, null))],
    ["the marker variable removed from a first attempt", (t) => editStep(t, "wire", id("wire"), (s) => swap(s, /^\s+OCTAVE_CI_SCRIPT_STARTED:/, null))],
    ["the marker path shared by two first attempts", (t) => editJob(t, "tv", (body) => body.map((line) => line.replace("octave-ci/started/e2e", "octave-ci/started/smoke")))],
    ["the first attempt's script a multi-line block", (t) => editStep(t, "wire", id("wire"), (s) => swap(s, /^\s+script: /, ["          script: |", "            pnpm tv:wire"]))],
    ["the first attempt's script another command", (t) => editStep(t, "wire", id("wire"), (s) => swap(s, /^\s+script: /, "          script: node scripts/tv-wire.mjs"))],
    ["the first attempt's script two commands", (t) => editStep(t, "wire", id("wire"), (s) => swap(s, /^\s+script: /, "          script: adb devices && pnpm tv:wire"))],
    // retry: the shim and stray emulator steps
    ["the shim step removed from tv", (t) => editStep(t, "tv", /ci-script-started\.sh/, () => [])],
    ["the shim step removed from wire", (t) => editStep(t, "wire", /ci-script-started\.sh/, () => [])],
    [
      "the shim step moved after the emulator steps",
      (t) => {
        const lines = t.split("\n");
        const [start, end] = stepRange(lines, "wire", /ci-script-started\.sh/);
        const shim = lines.slice(start, end);
        const without = [...lines.slice(0, start), ...lines.slice(end)];
        const [from, to] = jobRange(without, "wire");
        const upload = without.findIndex((line, i) => i >= from && i < to && /name: Upload the wire evidence/.test(line));
        return [...without.slice(0, upload), ...shim, ...without.slice(upload)].join("\n");
      },
    ],
    [
      "an emulator step that is neither a first attempt nor a retry",
      (t) => editStep(t, "wire", retryIf("wire"), (s) => [...s, ...swap(swap(s, retryIf("wire"), null), /^\s+- name:/, "      - name: A third emulator run")]),
    ],
    // skip
    ["needs removed from tripwire", (t) => editJob(t, "tripwire", (b) => b.filter((l) => l !== "    needs: changes"))],
    ["needs removed from tv", (t) => editJob(t, "tv", (b) => b.filter((l) => l !== "    needs: changes"))],
    ["needs removed from wire", (t) => editJob(t, "wire", (b) => b.filter((l) => l !== "    needs: changes"))],
    ["needs of tv widened", (t) => editJob(t, "tv", (b) => b.map((l) => (l === "    needs: changes" ? "    needs: [changes, checks]" : l)))],
    ["the if removed from tripwire", (t) => editJob(t, "tripwire", (b) => b.filter((l) => l !== SKIP_IF))],
    ["the if removed from tv", (t) => editJob(t, "tv", (b) => b.filter((l) => l !== SKIP_IF))],
    ["the if removed from wire", (t) => editJob(t, "wire", (b) => b.filter((l) => l !== SKIP_IF))],
    ["the if of tv lacks !cancelled()", (t) => editJob(t, "tv", (b) => b.map((l) => (l === SKIP_IF ? "    if: ${{ needs.changes.outputs.device-jobs != 'skip' }}" : l)))],
    ["the if of wire tests for run instead of skip", (t) => editJob(t, "wire", (b) => b.map((l) => (l === SKIP_IF ? "    if: ${{ !cancelled() && needs.changes.outputs.device-jobs == 'run' }}" : l)))],
    ["checks gets needs: changes", (t) => editJob(t, "checks", (b) => ["    needs: changes", ...b])],
    ["checks gets an if", (t) => editJob(t, "checks", (b) => [SKIP_IF, ...b])],
    ["dependency-review's if changed", (t) => editJob(t, "dependency-review", (b) => b.map((l) => (l === "    if: github.event_name == 'pull_request'" ? "    if: github.event_name != 'push'" : l)))],
    ["the decide step runs something else", (t) => editStep(t, "changes", id("decide"), (s) => swap(s, /^\s+run: /, "        run: node scripts/ci-device-jobs.mjs --all"))],
    ["the job output not wired to the decide step", (t) => editJob(t, "changes", (b) => b.map((l) => (l.includes("device-jobs: ${{") ? "      device-jobs: ${{ steps.other.outputs.device-jobs }}" : l)))],
    ["the checkout without fetch-depth: 2", (t) => editStep(t, "changes", /actions\/checkout@/, (s) => swap(s, /^\s+fetch-depth:/, null))],
    ["the checkout with fetch-depth: 1", (t) => editStep(t, "changes", /actions\/checkout@/, (s) => swap(s, /^\s+fetch-depth:/, "          fetch-depth: 1"))],
    // on: filters
    ["a paths filter on pull_request", (t) => t.replace("\n  pull_request:\n", "\n  pull_request:\n    paths: ['apps/**']\n")],
    ["a paths-ignore filter on pull_request", (t) => t.replace("\n  pull_request:\n", "\n  pull_request:\n    paths-ignore: ['docs/**']\n")],
    ["a branches-ignore filter on pull_request", (t) => t.replace("\n  pull_request:\n", "\n  pull_request:\n    branches-ignore: ['wip/**']\n")],
    ["a paths-ignore filter on push", (t) => t.replace("    branches: [main]\n", "    branches: [main]\n    paths-ignore: ['docs/**']\n")],
  ];

  for (const [name, change] of cases) {
    it(`T1-17 item 3: ${name}`, () => {
      expect(newProblems(change(real)).length).toBeGreaterThan(0);
    });
  }
});

describe("T1-17 item 6: docs/commands.md states both rules", () => {
  const commands = readFileSync(join(repo, "docs", "commands.md"), "utf8");

  it("T1-17 item 6: has a CI section", () => {
    expect(commands).toMatch(/^#{1,4} .*\bCI\b/m);
  });

  it("T1-17 item 6: names the skip script and the two skippable paths", () => {
    expect(commands).toContain("scripts/ci-device-jobs.mjs");
    expect(commands).toContain("`docs/`");
    expect(commands).toContain("`tasks/`");
  });

  it("T1-17 item 6: names the retry script and says a started script is never retried", () => {
    expect(commands).toContain("scripts/ci-emulator-retry.mjs");
    expect(commands).toMatch(/a started script is never retried/i);
  });
});
