// @vitest-environment node
// A Product Owner pass can add the first task of a phase that has none yet.
import { describe, expect, it } from "vitest";
import { applyOps } from "./task-owner.mjs";

const existing = {
  id: "T9-01", title: "Old", domain: "Process", lane: "workflow", model: "sonnet", skill: "exec-plan", human: false, depends_on: [], acceptance: ["one"], verify: "pnpm check",
  status: "todo", owner: null, passes: false, evidence: "",
};
const prd = () =>
  JSON.stringify(
    {
      product: "p", updated: "2026-01-01", rules: ["r1"], status_values: ["todo", "in_progress", "blocked", "done"],
      phases: [
        { id: "T9", name: "n", goal: "g", exit: ["e"], tasks: [existing] },
        { id: "T10", name: "m", goal: "g", exit: ["e"], tasks: [] },
      ],
    },
    null,
    2,
  ) + "\n";
const backlog = '{"what": "Alpha", "why": "w", "source": "s", "size": "S", "date": "2026-11-20"}\n{"what": "Beta", "why": "w", "source": "s", "size": "S", "date": "2026-11-20"}\n';
const task = (id: string) => ({ id, title: "New", domain: "Process", lane: "web", model: "opus", skill: "verify", human: false, depends_on: [], acceptance: ["a"], verify: "pnpm check" });
const opts = { date: "2026-11-26", readApproval: () => null };
const idsOf = (text: string, phase: number) => (JSON.parse(text).phases[phase].tasks as { id: string }[]).map((item) => item.id);

describe("adding to an empty phase", () => {
  it("places the first task of an empty phase with no anchor, and the next one after it", () => {
    const out = applyOps({ prd: prd(), backlog }, [
      { op: "add", phase: "T10", task: task("T10-01"), takes: ["Alpha"] },
      { op: "add", phase: "T10", after: "T10-01", task: task("T10-02"), takes: ["Beta"] },
    ], opts);
    expect(idsOf(out.prd, 1)).toEqual(["T10-01", "T10-02"]);
    expect(out.backlog).toContain('"taken_by": "T10-01"');
  });

  it("still needs an anchor in a phase that has tasks", () => {
    expect(() => applyOps({ prd: prd(), backlog }, [{ op: "add", phase: "T9", task: task("T9-02"), takes: ["Alpha"] }], opts)).toThrow(/exactly one of after and before/);
  });
});
