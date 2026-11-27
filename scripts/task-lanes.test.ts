// @vitest-environment node
// T1-19 item 1: a lane on every task in the task CLI, the owner tool and the task-list check.
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { shapeOf, findTaskListProblems } from "./check-flow.mjs";
import * as taskModule from "./task.mjs";
import { applyOps } from "./task-owner.mjs";

// The module is read through a cast: the lane exports do not exist yet.
const cli = taskModule as unknown as {
  LANES: string[];
  SERIAL_LANES: string[];
  nextTask(prd: unknown, filters?: { lane?: string }): { id: string; phase: string } | null;
  listLines(prd: unknown, filters?: { status?: string; phase?: string; lane?: string }): string[];
  parseListArgs(argv: string[]): { status?: string; phase?: string; lane?: string };
  parseNextArgs(argv: string[]): { lane?: string };
};

const TABLE = ["workflow", "core", "ui", "apk-checks", "tv-scripts", "release", "web", "native-session", "player", "device"];
const SERIAL = ["native-session", "player", "device"];

const mk = (id: string, extra: Record<string, unknown> = {}) => ({
  id, title: `Task ${id}`, domain: "Process", lane: "workflow", model: "sonnet", skill: "exec-plan", human: false, depends_on: [] as string[], acceptance: ["one"], verify: "pnpm check",
  status: "todo", owner: null, passes: false, evidence: "", ...extra,
});
const prdOf = (tasks: Record<string, unknown>[], extraPhases: Record<string, unknown>[] = []) => ({
  product: "p", updated: "2026-01-01", rules: ["r1"], status_values: ["todo", "in_progress", "blocked", "done"],
  phases: [{ id: "T9", name: "n", goal: "g", exit: "e", tasks }, ...extraPhases],
});
const text = (prd: unknown) => JSON.stringify(prd, null, 2) + "\n";

describe("lanes in the task CLI", () => {
  it("T1-19 item 1: LANES and SERIAL_LANES are the spec's table", () => {
    expect(cli.LANES).toEqual(TABLE);
    expect(cli.SERIAL_LANES).toEqual(SERIAL);
  });

  const mixed = () =>
    prdOf([
      mk("T9-01", { lane: "core" }),
      mk("T9-02", { lane: "ui" }),
      mk("T9-03", { lane: "ui", status: "done", passes: true, evidence: "PR #1" }),
      mk("T9-04", { lane: "ui", depends_on: ["T9-01"] }),
      mk("T9-05", { lane: "ui", human: true }),
      mk("T9-06", { lane: "ui", depends_on: ["T9-03"] }),
    ]);

  it("T1-19 item 1: nextTask with a lane skips the ready tasks of other lanes, and without one keeps file order", () => {
    expect(cli.nextTask(mixed())?.id).toBe("T9-01");
    expect(cli.nextTask(mixed(), { lane: "ui" })?.id).toBe("T9-02");
    expect(cli.nextTask(mixed(), { lane: "core" })?.id).toBe("T9-01");
    expect(cli.nextTask(mixed(), { lane: "player" })).toBeNull();
  });

  it("T1-19 item 1: nextTask with a lane still needs todo, not human, and every dependency passing", () => {
    const only = prdOf([mk("T9-01", { lane: "core" }), mk("T9-04", { lane: "ui", depends_on: ["T9-01"] }), mk("T9-05", { lane: "ui", human: true })]);
    expect(cli.nextTask(only, { lane: "ui" })).toBeNull();
  });

  it("T1-19 item 1: listLines with a lane lists only that lane, in the same line format", () => {
    expect(cli.listLines(mixed(), { lane: "ui" })).toEqual(["T9-02\ttodo\tTask T9-02", "T9-03\tdone\tTask T9-03", "T9-04\ttodo\tTask T9-04", "T9-05\ttodo\tTask T9-05", "T9-06\ttodo\tTask T9-06"]);
    expect(cli.listLines(mixed(), { lane: "ui", status: "done" })).toEqual(["T9-03\tdone\tTask T9-03"]);
    expect(cli.listLines(mixed())).toHaveLength(6);
  });

  it("T1-19 item 1: an unknown lane is refused by listLines, parseListArgs and parseNextArgs", () => {
    expect(() => cli.listLines(mixed(), { lane: "x" })).toThrow("ERROR task: unknown lane x");
    expect(() => cli.parseListArgs(["--lane", "x"])).toThrow("ERROR task: unknown lane x");
    expect(() => cli.parseNextArgs(["--lane", "x"])).toThrow("ERROR task: unknown lane x");
  });

  it("T1-19 item 1: parseListArgs and parseNextArgs read --lane", () => {
    expect(cli.parseListArgs(["--status", "todo", "--lane", "ui"])).toMatchObject({ status: "todo", lane: "ui" });
    expect(cli.parseNextArgs(["--lane", "player"])).toMatchObject({ lane: "player" });
    expect(cli.parseNextArgs([]).lane).toBeUndefined();
  });

  const tree = (prd: unknown) => {
    const root = mkdtempSync(join(tmpdir(), "task-lane-cli-"));
    mkdirSync(join(root, "repo", "scripts"), { recursive: true });
    mkdirSync(join(root, "repo", "tasks"));
    mkdirSync(join(root, "elsewhere"));
    copyFileSync(join(process.cwd(), "scripts", "task.mjs"), join(root, "repo", "scripts", "task.mjs"));
    writeFileSync(join(root, "repo", "tasks", "prd.json"), text(prd));
    return { script: join(root, "repo", "scripts", "task.mjs"), cwd: join(root, "elsewhere") };
  };
  const run = (t: ReturnType<typeof tree>, args: string[]) => spawnSync(process.execPath, [t.script, ...args], { cwd: t.cwd, encoding: "utf8" });

  it("T1-19 item 1: pnpm task next --lane and list --lane work and refuse an unknown lane", () => {
    const t = tree(mixed());
    const next = run(t, ["next", "--lane", "ui"]);
    expect(next.status, next.stderr).toBe(0);
    expect(JSON.parse(next.stdout).id).toBe("T9-02");
    const list = run(t, ["list", "--lane", "core"]);
    expect(list.status, list.stderr).toBe(0);
    expect(list.stdout.trim()).toBe("T9-01\ttodo\tTask T9-01");
    for (const args of [["next", "--lane", "x"], ["list", "--lane", "x"]]) {
      const bad = run(t, args);
      expect(bad.status).toBe(1);
      expect(bad.stderr).toContain("ERROR task: unknown lane x");
    }
  });

  it("T1-19 item 1: pnpm task set still refuses --lane", () => {
    const t = tree(mixed());
    const out = run(t, ["set", "T9-01", "--status", "todo", "--lane", "ui"]);
    expect(out.status).toBe(1);
    expect(out.stderr).toContain("set changes only status, owner, passes and evidence");
  });
});

describe("lanes in the owner tool", () => {
  const prdText = () => text(prdOf([mk("T9-01"), mk("T9-02", { lane: undefined })]));
  const files = () => ({ prd: prdText(), backlog: `{"what": "Alpha", "why": "w", "source": "s", "size": "S", "date": "2026-11-20"}\n` });
  const opts = { date: "2026-11-21", readApproval: () => null };
  const NEW = { id: "T9-03", title: "New", domain: "Process", lane: "ui", model: "opus", skill: "exec-plan", human: false, depends_on: ["T9-01"], acceptance: ["a"], verify: "pnpm check" };
  const add = (task: Record<string, unknown>) => () => applyOps(files(), [{ op: "add", phase: "T9", after: "T9-02", task, takes: ["Alpha"] }], opts);
  const task = (out: { prd: string }, i: number) => JSON.parse(out.prd).phases[0].tasks[i] as Record<string, unknown>;

  it("T1-19 item 1: add requires a lane from LANES", () => {
    const noLane: Record<string, unknown> = { ...NEW };
    delete noLane.lane;
    expect(add(noLane)).toThrow(/lane/);
    expect(add({ ...NEW, lane: "x" })).toThrow("ERROR owner: T9-03: lane has an invalid value");
    expect(add({ ...NEW, lane: "" })).toThrow(/lane/);
    expect(add(NEW)).not.toThrow();
  });

  it("T1-19 item 1: add writes the lane right after domain", () => {
    const out = applyOps(files(), [{ op: "add", phase: "T9", after: "T9-02", task: NEW, takes: ["Alpha"] }], opts);
    expect(Object.keys(task(out, 2)).slice(0, 5)).toEqual(["id", "title", "domain", "lane", "model"]);
    expect(task(out, 2).lane).toBe("ui");
  });

  it("T1-19 item 1: edit of lane needs no owner_approval or scope and is in the summary", () => {
    const out = applyOps(files(), [{ op: "edit", id: "T9-01", fields: { lane: "core" } }], opts);
    expect(task(out, 0).lane).toBe("core");
    expect(out.summary).toContain("edited T9-01: lane");
  });

  it("T1-19 item 1: edit of an unknown lane is refused", () => {
    expect(() => applyOps(files(), [{ op: "edit", id: "T9-01", fields: { lane: "x" } }], opts)).toThrow("ERROR owner: T9-01: lane has an invalid value");
    expect(() => applyOps(files(), [{ op: "edit", id: "T9-01", fields: { lane: "" } }], opts)).toThrow(/lane/);
  });

  it("T1-19 item 1: an edit that gives a lane to a task without one puts the key right after domain", () => {
    expect("lane" in task({ prd: prdText() }, 1)).toBe(false);
    const out = applyOps(files(), [{ op: "edit", id: "T9-02", fields: { lane: "player", title: "Renamed" } }], opts);
    expect(Object.keys(task(out, 1)).slice(0, 5)).toEqual(["id", "title", "domain", "lane", "model"]);
    expect(task(out, 1).lane).toBe("player");
    expect(task(out, 1).title).toBe("Renamed");
    expect(out.prd).toBe(JSON.stringify(JSON.parse(out.prd), null, 2) + "\n");
  });

  it("T1-19 item 1: an edit of a task that has a lane keeps the key where it is", () => {
    const out = applyOps(files(), [{ op: "edit", id: "T9-01", fields: { lane: "device" } }], opts);
    expect(Object.keys(task(out, 0)).slice(0, 5)).toEqual(["id", "title", "domain", "lane", "model"]);
  });
});

describe("lanes and the task-list check", () => {
  const PRD = "tasks/prd.json";
  const LOG = "tasks/product-owner-log.md";
  const base = prdOf([mk("T9-01"), mk("T9-02")]);
  const laneOnly = prdOf([mk("T9-01", { lane: "core" }), mk("T9-02")]);
  const statusOnly = prdOf([mk("T9-01", { status: "in_progress", owner: "x", evidence: "PR #2" }), mk("T9-02")]);
  const shapes = (tip: unknown): Record<string, string> => ({ base: JSON.stringify(shapeOf(base)), tip: JSON.stringify(shapeOf(tip)), po: JSON.stringify(shapeOf(tip)) });
  const run = (commits: { sha: string; changed: string[]; trailers?: string[] }[], tip: unknown) => {
    const shape = shapes(tip);
    return findTaskListProblems({ commits: commits.map((c) => ({ sha: c.sha, added: [], changed: c.changed, trailers: c.trailers ?? [] })), base: "base", tip: "tip", shapeAt: (rev: string) => shape[rev] });
  };

  it("T1-19 item 1: a status-only change is not a task-list change, and a lane-only change is", () => {
    expect(run([{ sha: "c", changed: [PRD] }], statusOnly).problems).toEqual([]);
    expect(run([{ sha: "c", changed: [PRD] }], laneOnly).changed).toBe(true);
  });

  it("T1-19 item 1: a lane-only change with no trailer commit is reported, and a Product Owner pass that logs it passes", () => {
    expect(run([{ sha: "c", changed: [PRD] }], laneOnly).problems).toHaveLength(1);
    const trailers = ["Product-Owner-Pass: 2026-11-22"];
    expect(run([{ sha: "po", changed: [PRD, LOG], trailers }], laneOnly).problems).toEqual([]);
    expect(run([{ sha: "po", changed: [PRD], trailers }], laneOnly).problems).toHaveLength(1);
  });
});
