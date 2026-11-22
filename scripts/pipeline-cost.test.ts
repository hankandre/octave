// @vitest-environment node
//
// T1-20 items 1 and 2: scripts/pipeline-cost.mjs sums the wall time and the tokens of each
// workflow stage per merged task, and prints no prompt text, credential, address or path.
//
// Pinned output shapes (the implementer follows these):
//   text line  <task>\t<stage>\tagents=<n>\twall_ms=<n>\tinput=<n|n/a>\tcache_write=<n|n/a>\tcache_read=<n|n/a>\toutput=<n|n/a>\tcontext=<n>\tmodels=<a>[,<b>…][\tpartial=<n>][\tmerge=unrecorded]
//   --json     {header, rows}
//     header   {journals, task_runs, merged_tasks, unmerged_tasks, agents, unattributed, no_transcript}  (numbers, snake_case)
//     row      {task, stage, agents, wall_ms, input, cache_write, cache_read, output, context, models, partial, merge}
//              numbers, with null for n/a; models is a string array; partial is a number (0 when absent
//              from the text line); merge is "merged" or "unrecorded" ("unrecorded" for a --merged task).
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { stageOf } from "./pipeline-cost.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, "pipeline-cost.mjs");
const MAIN = join(HERE, "fixtures", "pipeline-cost", "projects");
const RESUME = join(HERE, "fixtures", "pipeline-cost", "resume");
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function run(...args: string[]) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

type Row = Record<string, unknown>;
const FIELDS = ["agents", "wall_ms", "input", "cache_write", "cache_read", "output", "context"] as const;

function parseText(stdout: string) {
  const lines = stdout.split("\n").filter((l) => l !== "");
  const header = lines.filter((l) => l.startsWith("# "));
  const rows = lines.filter((l) => !l.startsWith("# ")).map((line) => {
    const [task, stage, ...rest] = line.split("\t");
    const kv: Record<string, string> = {};
    for (const f of rest) kv[f.slice(0, f.indexOf("="))] = f.slice(f.indexOf("=") + 1);
    return { line, task, stage, kv };
  });
  return { header, rows };
}

function headerOf(stdout: string) {
  const line = parseText(stdout).header[0] ?? "";
  const kv: Record<string, number> = {};
  for (const m of line.matchAll(/([a-z-]+)=(\d+)/g)) kv[m[1]] = Number(m[2]);
  return kv;
}

function linesFor(stdout: string, task: string) {
  return parseText(stdout).rows.filter((r) => r.task === task);
}

const T907 = [
  ["Sync gate", 1, 5296, 4, 1855, 69976, 453, 36848],
  ["Check", 1, 500280, 28, 77252, 746206, 23301, 77278],
  ["Tests", 1, 57952, 14, 44729, 361747, 5718, 66006],
  ["Red gate", 1, 8084, 4, 37100, 34952, 663, 37124],
  ["Implement", 1, 520697, 40, 85292, 1716353, 38921, 106349],
  ["Frozen gate", 2, 9716, 8, 53414, 90565, 1227, 74056],
  ["Review", 2, 307839, 34, 76769, 604321, 18831, 106286],
  ["Green gate", 1, 7419, 4, 16512, 55606, 636, 37151],
  ["Ship", 1, 5344874, 56, 268398, 981899, 6041, 50679],
  ["Fixtures down", 1, 7202, 4, 36877, 35083, 489, 36885],
  ["Total", 12, 6769359, 196, 698198, 4696708, 96280, 628662],
] as const;

describe("T1-20 item 1: per-task, per-stage wall time and tokens", () => {
  it("T1-20 item 1: T9-07 stage lines carry the recorded numbers, in stage order", () => {
    const r = run("--projects", MAIN);
    expect(r.status).toBe(0);
    const lines = linesFor(r.stdout, "T9-07");
    expect(lines.map((l) => l.stage)).toEqual(T907.map((t) => t[0]));
    for (const [i, expected] of T907.entries()) {
      const { kv } = lines[i];
      expect(
        FIELDS.map((f) => Number(kv[f])),
        expected[0],
      ).toEqual(expected.slice(1));
      expect(kv.partial).toBeUndefined();
      expect(kv.models).toMatch(/^claude-[a-z0-9-]+(,claude-[a-z0-9-]+)*$/);
    }
    expect(lines[1].kv.models).toBe("claude-fable-5-2");
    expect(lines[5].kv.models).toBe("claude-haiku-5-5");
    expect(lines[10].kv.models.split(",").sort()).toEqual(
      ["claude-fable-5-2", "claude-haiku-5-5", "claude-opus-5-5", "claude-sonnet-5-5"],
    );
  });

  it("T1-20 item 1: the header carries counts, and an unmerged task prints no line", () => {
    const r = run("--projects", MAIN);
    const { header } = parseText(r.stdout);
    expect(header).toHaveLength(1);
    expect(r.stdout.split("\n")[0]).toBe(header[0]);
    expect(header[0]).toMatch(
      /^# journals=\d+ task-runs=\d+ merged-tasks=\d+ unmerged-tasks=\d+ agents=\d+ unattributed=\d+ no-transcript=\d+$/,
    );
    const h = headerOf(r.stdout);
    expect(h["task-runs"]).toBe(3);
    expect(h["merged-tasks"]).toBe(2);
    expect(h["unmerged-tasks"]).toBe(1);
    expect(h.agents).toBe(15);
    expect(h.unattributed).toBe(0);
    expect(h["no-transcript"]).toBe(3);
    expect(h.journals).toBeGreaterThanOrEqual(3);
    expect(linesFor(r.stdout, "T9-92")).toHaveLength(0);
    expect(linesFor(r.stdout, "T9-93")).toHaveLength(0);
  });

  it("T1-20 item 1: tasks are printed in task-id order", () => {
    const r = run("--projects", MAIN);
    const tasks = [...new Set(parseText(r.stdout).rows.map((l) => l.task))];
    expect(tasks).toEqual(["T9-07", "T9-91"]);
  });

  it("T1-20 item 1: two journals of one task are summed, and a missing transcript gives partial", () => {
    const r = run("--projects", RESUME);
    expect(r.status).toBe(0);
    const lines = linesFor(r.stdout, "T9-07");
    const spec = lines.find((l) => l.stage === "Spec");
    expect(spec?.kv).toMatchObject({ agents: "1", wall_ms: "60000", input: "n/a", cache_write: "n/a", cache_read: "n/a", output: "n/a", context: "50000" });
    expect(spec?.kv.partial).toBeUndefined();
    const total = lines.find((l) => l.stage === "Total");
    expect(total?.kv).toMatchObject({
      agents: "13", wall_ms: "6829359", input: "196", cache_write: "698198", cache_read: "4696708", output: "96280", context: "678662", partial: "1",
    });
    expect(lines.find((l) => l.stage === "Check")?.kv.wall_ms).toBe("500280");
    const h = headerOf(r.stdout);
    expect(h.agents).toBe(13);
    expect(h["no-transcript"]).toBe(1);
  });

  it("T1-20 item 1: the older result.merged === true shape counts, and an unlabelled agent goes to its run's task", () => {
    const r = run("--projects", MAIN);
    const lines = linesFor(r.stdout, "T9-91");
    expect(lines.map((l) => l.stage)).toEqual(["Spec", "Ship", "Total"]);
    expect(lines[0].kv).toMatchObject({ agents: "1", wall_ms: "1000", context: "1000" });
    expect(lines[1].kv).toMatchObject({ agents: "1", wall_ms: "2000", context: "3000" });
    expect(lines[1].kv.models).toBe("claude-sonnet-5-5");
    expect(lines[2].kv).toMatchObject({ agents: "2", wall_ms: "3000", context: "4000" });
    expect(headerOf(r.stdout).unattributed).toBe(0);
  });

  it("T1-20 item 1: an agent without a transcript prints n/a tokens and keeps its context", () => {
    const r = run("--projects", MAIN);
    for (const l of linesFor(r.stdout, "T9-91")) {
      expect(l.kv).toMatchObject({ input: "n/a", cache_write: "n/a", cache_read: "n/a", output: "n/a" });
      expect(Number(l.kv.context)).toBeGreaterThan(0);
      expect(l.kv.partial).toBeUndefined();
    }
  });

  it("T1-20 item 1: a journal of another workflow is skipped", () => {
    const r = run("--projects", MAIN);
    expect(parseText(r.stdout).rows.some((l) => l.task === "T9-93")).toBe(false);
    expect(headerOf(r.stdout)["task-runs"]).toBe(3);
  });

  it("T1-20 item 1: zero task journals read gives exit 1 and an ERROR line", () => {
    const dir = mkdtempSync(join(tmpdir(), "pipeline-cost-empty-"));
    dirs.push(dir);
    mkdirSync(join(dir, "-repo", "session-1", "workflows"), { recursive: true });
    const r = run("--projects", dir);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/^ERROR pipeline-cost: no task journals read$/m);
  });

  it("T1-20 item 1: --merged adds a task as merge=unrecorded, and without it the task is counted unmerged", () => {
    const without = run("--projects", MAIN);
    expect(headerOf(without.stdout)["unmerged-tasks"]).toBe(1);
    const withFlag = run("--projects", MAIN, "--merged", "T9-92");
    expect(withFlag.status).toBe(0);
    const h = headerOf(withFlag.stdout);
    expect(h["merged-tasks"]).toBe(3);
    expect(h["unmerged-tasks"]).toBe(0);
    const lines = linesFor(withFlag.stdout, "T9-92");
    expect(lines.map((l) => l.stage)).toEqual(["Spec", "Total"]);
    for (const l of lines) expect(l.line.split("\t")).toContain("merge=unrecorded");
    expect(lines[0].kv).toMatchObject({ wall_ms: "4000", context: "5000" });
    for (const l of linesFor(withFlag.stdout, "T9-07")) expect(l.line).not.toContain("merge=");
    expect(parseText(withFlag.stdout).rows.map((l) => l.task)).toEqual(
      [...parseText(withFlag.stdout).rows.map((l) => l.task)].sort(),
    );
  });

  it("T1-20 item 1: --merged takes a comma list", () => {
    const r = run("--projects", MAIN, "--merged", "T9-92,T9-93");
    expect(linesFor(r.stdout, "T9-92").length).toBeGreaterThan(0);
    expect(linesFor(r.stdout, "T9-93")).toHaveLength(0);
  });

  it("T1-20 item 1: --json gives the same rows, with numbers and null", () => {
    const r = run("--projects", MAIN, "--merged", "T9-92", "--json");
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout) as { header: Record<string, number>; rows: Row[] };
    expect(Object.keys(out).sort()).toEqual(["header", "rows"]);
    expect(out.header).toMatchObject({ task_runs: 3, merged_tasks: 3, unmerged_tasks: 0, agents: 15, unattributed: 0, no_transcript: 3 });
    const text = parseText(run("--projects", MAIN, "--merged", "T9-92").stdout).rows;
    expect(out.rows).toHaveLength(text.length);
    const frozen = out.rows.find((x) => x.task === "T9-07" && x.stage === "Frozen gate");
    expect(frozen).toMatchObject({ agents: 2, wall_ms: 9716, input: 8, cache_write: 53414, cache_read: 90565, output: 1227, context: 74056, partial: 0, merge: "merged" });
    expect(frozen?.models).toEqual(["claude-haiku-5-5"]);
    const old = out.rows.find((x) => x.task === "T9-91" && x.stage === "Ship");
    expect(old).toMatchObject({ input: null, cache_write: null, cache_read: null, output: null, context: 3000, merge: "merged" });
    expect(out.rows.find((x) => x.task === "T9-92" && x.stage === "Total")).toMatchObject({ merge: "unrecorded" });
    const resume = JSON.parse(run("--projects", RESUME, "--json").stdout) as { rows: Row[] };
    expect(resume.rows.find((x) => x.task === "T9-07" && x.stage === "Total")).toMatchObject({ partial: 1, context: 678662 });
  });

  it("T1-20 item 1: stageOf maps a label and phase to a stage", () => {
    const cases: Array<[string | undefined, string | undefined, string]> = [
      ["sync T9-07", "Check", "Sync gate"],
      ["sync T9-07", "Spec", "Sync gate"],
      ["spec T9-07", "Spec", "Spec"],
      ["check T9-07", "Check", "Check"],
      ["spec check", "Check", "Check"],
      ["spec re-check", "Check", "Check"],
      ["revise T1-17", "Check", "Check"],
      ["spec revision", "Check", "Check"],
      ["owner ruling T1-17", "Check", "Ruling"],
      ["rule on frozen tests T1-17", "Implement", "Ruling"],
      ["rule on frozen tests T1-17", "Review", "Ruling"],
      ["ruling history T1-17", "Check", "Ruling log gate"],
      ["ruling log T1-17", "Check", "Ruling log gate"],
      ["tests T9-07", "Tests", "Tests"],
      ["red gate T9-07", "Tests", "Red gate"],
      ["implement T9-07", "Implement", "Implement"],
      ["implement T1-17 (after ruling)", "Implement", "Implement"],
      ["frozen gate T9-07", "Implement", "Frozen gate"],
      ["frozen gate T9-07", "Review", "Frozen gate"],
      ["frozen gate T9-07", "Ship", "Frozen gate"],
      ["review T9-07", "Review", "Review"],
      ["review (guardian)", "Review", "Review"],
      ["follow-ups T2-07 (fable)", "Review", "Review"],
      ["review follow-ups", "Review", "Review"],
      ["verify after review", "Review", "Review"],
      ["green gate T9-07", "Review", "Green gate"],
      ["verify", "Verify", "Verify"],
      ["ship T9-07", "Ship", "Ship"],
      [undefined, "Ship", "Ship"],
      ["fix CI T3-24 (retry)", "Ship", "Fix CI"],
      ["fixtures down T9-07", "Ship", "Fixtures down"],
      ["mystery thing", undefined, "Other"],
      [undefined, undefined, "Other"],
    ];
    for (const [label, phaseTitle, stage] of cases) {
      expect(stageOf({ label, phaseTitle }), `${label} / ${phaseTitle}`).toBe(stage);
    }
  });
});

const CANARIES = ["CANARY-PROMPT-T1-20", "CANARY-TOKEN-0123456789abcdef", "192.0.2.44", "http://", "api_key", "/home/canary-user", "canary-user"];
const STAGES = "(Spec|Sync gate|Check|Ruling|Ruling log gate|Tests|Red gate|Implement|Frozen gate|Review|Green gate|Verify|Ship|Fix CI|Fixtures down|Other|Total)";
const NUMNA = "(\\d+|n/a)";
const STAGE_LINE = new RegExp(
  `^[A-Z]+\\d+-\\d+\\t${STAGES}\\tagents=\\d+\\twall_ms=\\d+\\tinput=${NUMNA}\\tcache_write=${NUMNA}\\tcache_read=${NUMNA}\\toutput=${NUMNA}\\tcontext=\\d+\\tmodels=claude-[a-z0-9-]+(,claude-[a-z0-9-]+)*(\\tpartial=\\d+)?(\\tmerge=unrecorded)?$`,
);
const HEADER_LINE = /^# journals=\d+ task-runs=\d+ merged-tasks=\d+ unmerged-tasks=\d+ agents=\d+ unattributed=\d+ no-transcript=\d+$/;
const ERROR_LINE = /^ERROR pipeline-cost: (wf_[A-Za-z0-9._-]+\.json unreadable|no task journals read)$/;
const PATH_START = /(^|[\s="'])\/[A-Za-z0-9._-]/m;

describe("T1-20 item 2: no prompt text, credential, address or path in the output", () => {
  it("T1-20 item 2: text and --json output hold no canary, no fixture path and no path", () => {
    for (const args of [[], ["--json"], ["--merged", "T9-92"]]) {
      for (const root of [MAIN, RESUME]) {
        const r = run("--projects", root, ...args);
        expect(r.status).toBe(0);
        const both = `${r.stdout}\n${r.stderr}`;
        for (const canary of CANARIES) expect(both, canary).not.toContain(canary);
        expect(both).not.toContain(root);
        expect(both).not.toContain(dirname(root));
        expect(both).not.toContain(HERE);
        expect(both).not.toMatch(PATH_START);
      }
    }
  });

  it("T1-20 item 2: every text line matches the line grammar", () => {
    const r = run("--projects", MAIN, "--merged", "T9-92");
    const lines = r.stdout.split("\n").filter((l) => l !== "");
    expect(lines.length).toBeGreaterThan(5);
    for (const line of lines) {
      expect(line.startsWith("# ") ? HEADER_LINE.test(line) : STAGE_LINE.test(line), line).toBe(true);
    }
    for (const line of r.stderr.split("\n").filter((l) => l !== "")) expect(line).toMatch(ERROR_LINE);
    const resume = run("--projects", RESUME);
    for (const line of resume.stdout.split("\n").filter((l) => l !== "")) {
      expect(line.startsWith("# ") ? HEADER_LINE.test(line) : STAGE_LINE.test(line), line).toBe(true);
    }
  });

  it("T1-20 item 2: --json carries only the pinned keys and no string beyond ids, stages and models", () => {
    const out = JSON.parse(run("--projects", MAIN, "--json").stdout) as { header: Record<string, unknown>; rows: Row[] };
    expect(Object.keys(out.header).sort()).toEqual(["agents", "journals", "merged_tasks", "no_transcript", "task_runs", "unattributed", "unmerged_tasks"]);
    for (const row of out.rows) {
      expect(Object.keys(row).sort()).toEqual(["agents", "cache_read", "cache_write", "context", "input", "merge", "models", "output", "partial", "stage", "task", "wall_ms"]);
      expect(row.task).toMatch(/^[A-Z]+\d+-\d+$/);
      expect(row.stage).toMatch(new RegExp(`^${STAGES}$`));
      for (const m of row.models as string[]) expect(m).toMatch(/^claude-[a-z0-9-]+$/);
    }
  });

  it("T1-20 item 2: an unreadable journal with a canary is named by wf_<id>.json only", () => {
    const dir = mkdtempSync(join(tmpdir(), "pipeline-cost-CANARY-DIR-"));
    dirs.push(dir);
    const wf = join(dir, "-repo", "session-1", "workflows");
    mkdirSync(wf, { recursive: true });
    cpSync(join(MAIN, "-repo", "session-1", "workflows", "wf_fixture-old.json"), join(wf, "wf_fixture-old.json"));
    writeFileSync(join(wf, "wf_broken-1.json"), '{ "summary": "CANARY-PROMPT-T1-20 /home/canary-user/secret CANARY-TOKEN-0123456789abcdef", nope');
    const r = run("--projects", dir);
    expect(r.status).toBe(0);
    expect(r.stderr.trim().split("\n")).toEqual(["ERROR pipeline-cost: wf_broken-1.json unreadable"]);
    const both = `${r.stdout}\n${r.stderr}`;
    for (const canary of [...CANARIES, "CANARY-DIR", dir]) expect(both, canary).not.toContain(canary);
    expect(both).not.toMatch(PATH_START);
  });
});
