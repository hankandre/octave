export interface CostRow {
  task: string;
  stage: string;
  agents: number;
  wall_ms: number;
  input: number | null;
  cache_write: number | null;
  cache_read: number | null;
  output: number | null;
  context: number;
  models: string[];
  partial: number;
  merge: "merged" | "unrecorded";
}
export interface CostHeader {
  journals: number;
  task_runs: number;
  merged_tasks: number;
  unmerged_tasks: number;
  agents: number;
  unattributed: number;
  no_transcript: number;
}
export const STAGE_ORDER: string[];
export function stageOf(agent: { label?: string; phaseTitle?: string }): string;
export function collect(input: { projects: string[]; merged?: string[] }): { header: CostHeader; rows: CostRow[]; errors: string[] };
export function formatRow(row: CostRow): string;
export function formatHeader(header: CostHeader): string;
