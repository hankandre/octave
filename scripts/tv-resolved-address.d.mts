import type { CleartextReport, ServedRequest } from "./tv-cleartext.mjs";

export const RESOLVED_REPORT_KEYS: string[];
export const RESOLVED_PRIVATE_PATH: string;
export const RESOLVED_MIXED_PATH: string;
export const RESOLVED_PUBLIC_PATH: string;
export function judgeResolvedAddress(report: CleartextReport, served: ServedRequest[], expected: { port: number }): string[];
export function runResolvedAddressProbe(options: { adbPath: string; serial: string; apk: string; evidenceDir: string }): Promise<{
  errors: string[];
  report: CleartextReport;
  served: ServedRequest[];
}>;
