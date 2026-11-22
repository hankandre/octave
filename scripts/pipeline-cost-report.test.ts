// @vitest-environment node
//
// T1-20 item 3: docs/research/pipeline-cost.md holds the numbers for the merged tasks and proposes
// lighter pipelines for small low-risk tasks. It finds things by heading and words, never by line number.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPORT = join(dirname(fileURLToPath(import.meta.url)), "..", "docs", "research", "pipeline-cost.md");
const MERGED = [
  "T1-10", "T1-12", "T1-13", "T1-14", "T1-17",
  "T2-02", "T2-03", "T2-04", "T2-05", "T2-06", "T2-07", "T2-08", "T2-09", "T2-10",
  "T3-01", "T3-04", "T3-05", "T3-06", "T3-15", "T3-16", "T3-19", "T3-20", "T3-22", "T3-24", "T3-25", "T3-26", "T3-30",
  "T8-22", "T8-24", "T9-07",
];
const HEADINGS = [
  "How the numbers were taken",
  "What the journals do not record",
  "Cost per merged task",
  "Cost per stage",
  "Options for small low-risk tasks",
  "For the owner to decide",
];

const read = () => readFileSync(REPORT, "utf8");

function section(text: string, heading: string) {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => /^##\s/.test(l) && l.replace(/^##\s+/, "").trim() === heading);
  if (start < 0) return "";
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^##\s/.test(l));
  return (end < 0 ? rest : rest.slice(0, end)).join("\n");
}

const cells = (line: string) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

describe("T1-20 item 3: docs/research/pipeline-cost.md", () => {
  it("T1-20 item 3: the report exists and has each required heading", () => {
    expect(existsSync(REPORT)).toBe(true);
    const text = read();
    for (const h of HEADINGS) expect(section(text, h).trim().length, h).toBeGreaterThan(0);
  });

  it("T1-20 item 3: the per-task table has a row for each of the 30 merged T-tasks", () => {
    const body = section(read(), "Cost per merged task");
    const rows = body.split("\n").filter((l) => l.trim().startsWith("|")).map(cells);
    for (const task of MERGED) {
      const row = rows.find((c) => c[0] === task);
      expect(row, task).toBeDefined();
      expect(row?.slice(1).some((c) => /\d/.test(c)), `${task} has numbers`).toBe(true);
    }
  });

  it("T1-20 item 3: the options table has Option, Saves and Gives up, at least three rows, each Saves with a number", () => {
    const body = section(read(), "Options for small low-risk tasks");
    const table = body.split("\n").filter((l) => l.trim().startsWith("|")).map(cells);
    const headerAt = table.findIndex((c) => c.includes("Option") && c.includes("Saves") && c.includes("Gives up"));
    expect(headerAt).toBeGreaterThanOrEqual(0);
    const header = table[headerAt];
    const rows = table.slice(headerAt + 1).filter((c) => !c.every((x) => /^:?-+:?$/.test(x)));
    expect(rows.length).toBeGreaterThanOrEqual(3);
    for (const row of rows) {
      expect(row[header.indexOf("Option")].length).toBeGreaterThan(0);
      expect(row[header.indexOf("Gives up")].length).toBeGreaterThan(0);
      expect(row[header.indexOf("Saves")], row[0]).toMatch(/\d/);
    }
  });

  it("T1-20 item 3: it says the owner decides and that no stage is changed by this task", () => {
    const body = section(read(), "For the owner to decide");
    expect(body).toMatch(/owner (decides|chooses|picks)|the owner'?s? (decision|choice)|for the owner to (decide|choose|pick)/i);
    expect(body).toMatch(/(changes|does not change|doesn't change|no) (no )?stage|no stage (is|was) (cut|changed)/i);
    expect(body).toMatch(/recommend/i);
  });

  it("T1-20 item 3: it holds no /home/ path, no IPv4 address and no URL beyond anthropic.com or claude.com", () => {
    const text = read();
    expect(text).not.toMatch(/\/home\//);
    expect(text).not.toMatch(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
    for (const m of text.matchAll(/https?:\/\/[^\s)>\]"']+/g)) {
      expect(m[0], m[0]).toMatch(/^https:\/\/([a-z0-9-]+\.)*(anthropic|claude)\.com(\/|$)/);
    }
  });
});
