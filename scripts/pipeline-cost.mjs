#!/usr/bin/env node
// Sums the wall time and the tokens of each workflow stage per merged task, from the Workflow
// tool's journals and the subagent transcripts beside them. Read-only. Prints ids, stage names,
// models and numbers only; no path, label text or prompt text ever reaches the output.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const STAGE_ORDER = [
  "Spec", "Sync gate", "Check", "Ruling", "Ruling log gate", "Tests", "Red gate", "Implement",
  "Frozen gate", "Review", "Green gate", "Verify", "Ship", "Fix CI", "Fixtures down", "Other",
];
const VERBS = {
  sync: "Sync gate",
  "red gate": "Red gate",
  "frozen gate": "Frozen gate",
  "green gate": "Green gate",
  "fixtures down": "Fixtures down",
  "ruling history": "Ruling log gate",
  "ruling log": "Ruling log gate",
  "owner ruling": "Ruling",
  "rule on frozen tests": "Ruling",
  "fix ci": "Fix CI",
};
const TASK_ID = /^[A-Z]+\d+-\d+$/;
const TASK_IN_LABEL = /\b[A-Z]+\d+-\d+\b/;
const MODEL = /^claude-[a-z0-9-]+$/;
const AGENT_ID = /^[A-Za-z0-9]+$/;
const TOKEN_KEYS = ["input", "cache_write", "cache_read", "output"];
const USAGE_KEYS = {
  input: "input_tokens",
  cache_write: "cache_creation_input_tokens",
  cache_read: "cache_read_input_tokens",
  output: "output_tokens",
};

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export function stageOf({ label, phaseTitle }) {
  if (typeof label === "string") {
    const verb = label.replace(TASK_IN_LABEL, "").replace(/\s*\([^)]*\)\s*$/, "").trim().toLowerCase();
    if (Object.hasOwn(VERBS, verb)) return VERBS[verb];
  }
  return STAGE_ORDER.includes(phaseTitle) ? phaseTitle : "Other";
}

function taskOrder(a, b) {
  const p = (t) => /^([A-Z]+)(\d+)-(\d+)$/.exec(t).slice(1);
  const [la, a1, a2] = p(a);
  const [lb, b1, b2] = p(b);
  if (la !== lb) return la < lb ? -1 : 1;
  return Number(a1) - Number(b1) || Number(a2) - Number(b2);
}

function readUsage(file) {
  const sum = { input: 0, cache_write: 0, cache_read: 0, output: 0 };
  const seen = new Set();
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let msg;
    try {
      msg = JSON.parse(line)?.message;
    } catch {
      continue;
    }
    const usage = msg?.usage;
    if (!usage || typeof usage !== "object") continue;
    if (typeof msg.id === "string") {
      if (seen.has(msg.id)) continue;
      seen.add(msg.id);
    }
    for (const k of TOKEN_KEYS) sum[k] += num(usage[USAGE_KEYS[k]]);
  }
  return sum;
}

function findJournals(projects) {
  const found = [];
  const dirs = (p) => {
    try {
      return readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    } catch {
      return [];
    }
  };
  for (const root of projects) {
    for (const project of dirs(root)) {
      for (const session of dirs(join(root, project))) {
        const wfDir = join(root, project, session, "workflows");
        let names = [];
        try {
          names = readdirSync(wfDir);
        } catch {
          continue;
        }
        for (const name of names.sort()) {
          if (/^wf_.+\.json$/.test(name)) found.push({ name, file: join(wfDir, name), session: join(root, project, session) });
        }
      }
    }
  }
  return found;
}

export function collect({ projects, merged: extraMerged = [] }) {
  const header = { journals: 0, task_runs: 0, merged_tasks: 0, unmerged_tasks: 0, agents: 0, unattributed: 0, no_transcript: 0 };
  const errors = [];
  const mergedIds = new Set();
  const seenTasks = new Set();
  const agents = [];
  for (const j of findJournals(projects)) {
    let journal;
    try {
      journal = JSON.parse(readFileSync(j.file, "utf8"));
    } catch {
      errors.push(`ERROR pipeline-cost: ${j.name} unreadable`);
      continue;
    }
    header.journals++;
    if (journal?.workflowName !== "task") continue;
    header.task_runs++;
    const args = journal.args ?? {};
    const runTasks = [args.task, ...(Array.isArray(args.tasks) ? args.tasks : [])].filter((t) => typeof t === "string" && TASK_ID.test(t));
    for (const t of runTasks) seenTasks.add(t);
    const result = journal.result ?? {};
    if (Array.isArray(result.merged)) {
      for (const m of result.merged) {
        if (m?.outcome === "merged" && typeof m.task === "string" && TASK_ID.test(m.task)) mergedIds.add(m.task);
      }
    } else if (result.merged === true && typeof result.task === "string" && TASK_ID.test(result.task)) {
      mergedIds.add(result.task);
    }
    const base = j.name.replace(/\.json$/, "");
    for (const e of Array.isArray(journal.workflowProgress) ? journal.workflowProgress : []) {
      if (e?.type !== "workflow_agent") continue;
      header.agents++;
      const label = typeof e.label === "string" ? e.label : "";
      let task = TASK_IN_LABEL.exec(label)?.[0];
      if (!task && runTasks.length === 1) task = runTasks[0];
      if (!task) header.unattributed++;
      else seenTasks.add(task);
      let usage = null;
      if (typeof e.agentId === "string" && AGENT_ID.test(e.agentId)) {
        const tf = join(j.session, "subagents", "workflows", base, `agent-${e.agentId}.jsonl`);
        if (existsSync(tf)) {
          try {
            usage = readUsage(tf);
          } catch {
            usage = null;
          }
        }
      }
      if (!usage) header.no_transcript++;
      agents.push({
        task,
        stage: stageOf({ label, phaseTitle: e.phaseTitle }),
        wall: num(e.durationMs),
        context: num(e.tokens),
        model: typeof e.model === "string" && MODEL.test(e.model) ? e.model : null,
        usage,
      });
    }
  }
  const unrecorded = new Set(extraMerged.filter((t) => TASK_ID.test(t) && !mergedIds.has(t)));
  const all = new Set([...mergedIds, ...unrecorded]);
  header.merged_tasks = all.size;
  header.unmerged_tasks = [...seenTasks].filter((t) => !all.has(t)).length;
  const rows = [];
  for (const task of [...all].sort(taskOrder)) {
    const mine = agents.filter((a) => a.task === task);
    const merge = unrecorded.has(task) ? "unrecorded" : "merged";
    const line = (stage, list) => {
      const withUsage = list.filter((a) => a.usage);
      const row = { task, stage, agents: list.length, wall_ms: 0, input: null, cache_write: null, cache_read: null, output: null, context: 0, models: [], partial: 0, merge };
      for (const a of list) {
        row.wall_ms += a.wall;
        row.context += a.context;
      }
      if (withUsage.length) {
        for (const k of TOKEN_KEYS) row[k] = withUsage.reduce((s, a) => s + a.usage[k], 0);
        row.partial = list.length - withUsage.length;
      }
      row.models = [...new Set(list.map((a) => a.model).filter(Boolean))].sort();
      return row;
    };
    for (const stage of STAGE_ORDER) {
      const list = mine.filter((a) => a.stage === stage);
      if (list.length) rows.push(line(stage, list));
    }
    if (mine.length) rows.push(line("Total", mine));
  }
  return { header, rows, errors };
}

export function formatRow(r) {
  const n = (v) => (v === null ? "n/a" : String(v));
  const parts = [r.task, r.stage, `agents=${r.agents}`, `wall_ms=${r.wall_ms}`, `input=${n(r.input)}`, `cache_write=${n(r.cache_write)}`, `cache_read=${n(r.cache_read)}`, `output=${n(r.output)}`, `context=${r.context}`, `models=${r.models.join(",") || "n/a"}`];
  if (r.partial) parts.push(`partial=${r.partial}`);
  if (r.merge === "unrecorded") parts.push("merge=unrecorded");
  return parts.join("\t");
}

export function formatHeader(h) {
  return `# journals=${h.journals} task-runs=${h.task_runs} merged-tasks=${h.merged_tasks} unmerged-tasks=${h.unmerged_tasks} agents=${h.agents} unattributed=${h.unattributed} no-transcript=${h.no_transcript}`;
}

function main(argv) {
  const projects = [];
  const merged = [];
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--projects") projects.push(argv[++i] ?? "");
    else if (argv[i] === "--merged") merged.push(...(argv[++i] ?? "").split(",").map((s) => s.trim()).filter(Boolean));
    else if (argv[i] === "--json") json = true;
  }
  if (!projects.length) projects.push(join(homedir(), ".claude", "projects"));
  const { header, rows, errors } = collect({ projects, merged });
  for (const e of errors) console.error(e);
  if (header.task_runs === 0) {
    console.error("ERROR pipeline-cost: no task journals read");
    return 1;
  }
  if (json) console.log(JSON.stringify({ header, rows }, null, 2));
  else console.log([formatHeader(header), ...rows.map(formatRow)].join("\n"));
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
