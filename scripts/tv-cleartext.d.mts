export type CleartextReport = Record<string, string>;
export type ServedRequest = { path: string; host: string; header: boolean };
export const PROBE_PACKAGE: string;
export const PROBE_COMPONENT: string;
export const PRIVATE_LAN_PATH: string;
export const LOOPBACK_PATH: string;
export const CANARY_HEADER: string;
export const REPORT_KEYS: string[];
export function expectedPublicCount(): number;
export function parseInstrumentation(text: string): CleartextReport;
export function judgeCleartext(report: CleartextReport, served: ServedRequest[], expected: { publicTotal: number; port: number }): string[];
export function runCleartextProbe(options: { adbPath: string; serial: string; apk: string; evidenceDir: string }): Promise<{
  errors: string[];
  report: CleartextReport;
  served: ServedRequest[];
}>;
