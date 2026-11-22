export type StageOutcome = "ran" | "skipped" | "failed";
export type Launch = string[];
export interface InstallIdRun {
  fresh: Launch;
  relaunch: Launch;
  afterClear: Launch;
  afterRestore: Launch;
  transport: string;
  backup: string;
}
export interface ResultWords {
  relaunch: string;
  clear: string;
  restore: string;
  transport: string;
  backup: string;
}
export interface AdbAnswer {
  status: number;
  stdout: string;
  stderr: string;
}
export interface AdbRunner {
  run(args: string[], options?: { timeoutMs?: number; maxBuffer?: number }): AdbAnswer;
}

export const INSTALL_ID_SKIP_LINE: string;
export const INSTALL_ID_NOT_RUN_LINE: string;
export const INSTALL_ID_NOT_RUN_ERROR: string;
export const INSTALL_ID_SKIP_PRINT: string;
export const EMULATOR_PROPERTIES: string[];

export function extractInstallIdLines(logcatLines: string[]): string[];
export function judgeInstallId(input: InstallIdRun): string[];
export function installIdResultLine(words: ResultWords): string;
export function resultWords(input: InstallIdRun): ResultWords;
export function isEmulator(properties: Record<string, unknown> | null | undefined): boolean;
export function stageDecision(input: { emulator: boolean; mustRun: boolean }): "run" | "skip" | "fail";
export function stageRequired(env: Record<string, string | undefined> | undefined): boolean;
export function backupOutcome(output: string, applicationId: string): "success" | "refused" | "none";
export function transportSelected(output: string): "selected" | "missing";
export function formerTransport(output: string): string | undefined;
export function backupEnabled(output: string): boolean | undefined;
export function restoreToken(output: string): string | undefined;
export function runInstallIdStage(options: {
  adbPath: string;
  serial: string;
  evidenceDir: string;
  env?: Record<string, string | undefined>;
  open?: (options: { adbPath: string; serial: string }) => AdbRunner;
  sleep?: (ms: number) => Promise<unknown>;
  print?: (line: string) => void;
  launchMs?: number;
}): Promise<{ outcome: StageOutcome; errors: string[] }>;
