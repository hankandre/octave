// Types for tv-wire-evidence.mjs.
import type { CaptureRecord } from "./tv-wire-judge.mjs";
export const STAND_IN: string;
export function evidenceDir(env?: Record<string, string | undefined>): string;
export function clearEvidence(dir: string): void;
export function safeUrlParts(rawUrl: string, secrets: readonly string[]): { path: string; queryNames: string[]; secretInUrl: boolean };
export function safeRecord(record: CaptureRecord, secrets: readonly string[]): CaptureRecord;
export function safeLines(lines: string[], secrets: readonly string[]): string[];
export function writeEvidence(
  dir: string,
  input: { captures?: { name: string; records: CaptureRecord[] }[]; appLines?: string[]; deviceLines?: string[]; proxyLines?: string[]; secrets: readonly string[] },
): string[];
export function writeSummary(dir: string, lines: string[], secrets?: readonly string[]): void;
