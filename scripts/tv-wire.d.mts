// Types for tv-wire.mjs.
import type { CaptureRecord } from "./tv-wire-judge.mjs";
import type { LogKept } from "./tv-wire-logcat.mjs";
export interface WireEntry {
  id: string;
  task: string;
  targets: string[];
}
export interface WireList {
  basePort: number;
  canaryPort: number;
  proxyPort: number;
  closedPort: number;
  user: string;
  password: string;
  canary: string;
  tests: WireEntry[];
}
export const PROBE_THEN_SIGNED_IN: string[];
export function readWireList(): WireList;
export function selectTests(options?: { task?: string }, list?: WireList): WireEntry[];
export function tasksWithWireTests(list?: WireList): Set<string>;
export function pairsOf(list?: WireList): { test: string; target: string; task: string; devicePort: number }[];
export const ADBD_STEADY_S: number;
export function adbdOf(psOutput: string): { pid: number; elapsed: number } | null;
export function missingReverses(listOutput: string, devicePorts: number[]): number[];
export function adbRestartErrors(state: {
  before: { pid: number; elapsed: number } | null;
  after: { pid: number; elapsed: number } | null;
  missing: number[];
  reversed: number;
}): string[];
export function resumedPackage(dumpsys: string): string;
export function judgeRun(
  input: {
    pairs: { test: string; target: string; task: string; devicePort: number; records: CaptureRecord[] }[];
    counts: { canaryOrigin: number; redirector: number; privateLan: number };
    lines: string[];
    logLines: string[];
    seen: { method: string; target: string; host: string }[];
    devicePorts: number[];
    secrets: readonly string[];
    voids: string[];
    kept: LogKept;
    deviceLines: string[];
  },
  deps: { write: (evidence: Record<string, unknown>) => string[] },
): { summary: string[]; errors: string[]; failed: boolean };
