import type { CleartextReport } from "./tv-cleartext.mjs";

export const SAVE_REPORT_KEYS: string[];
export const RESTORE_REPORT_KEYS: string[];
export function judgeStoredCredential(save: CleartextReport, restore: CleartextReport): string[];
export function runStoredCredentialProbe(options: { adbPath: string; serial: string; apk: string; evidenceDir: string }): Promise<{
  errors: string[];
  save: CleartextReport;
  restore: CleartextReport;
}>;
