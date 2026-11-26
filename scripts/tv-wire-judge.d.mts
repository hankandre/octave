// Types for tv-wire-judge.mjs.
export interface CaptureRecord {
  method: string;
  path: string;
  queryNames: string[];
  authorization: boolean;
  scheme: string | null;
  token: boolean;
  host: string;
  status: number | null;
  retryAfter: string | null;
  secretInUrl: boolean;
  /** On the Quick Connect Initiate and sign-in records only: the recorder learned the answer's secret value. */
  learned?: boolean;
}
export interface WirePair {
  test: string;
  target: string;
  task: string;
  requests: number;
  redirector?: number;
  canaryOrigin?: number;
  privateLan?: number;
}
export function holdsSecret(text: string, secrets: readonly string[]): boolean;
export const TOKENLESS_CALLS: string[];
export const MIN_CANARY_CROSSINGS: number;
export function judgeRecords(records: CaptureRecord[], options: { host: string; secrets: string[]; redirects?: boolean }): string[];
export function judgeCapture(records: CaptureRecord[], options: { expected: string[]; host: string; secrets: string[] }): string[];
export function judgeLogcat(lines: string[], secrets: string[]): string[];
export function judgeWire(run: { pairs: WirePair[]; lines: string[] }): string[];
export function judgeQuickConnectCapture(records: CaptureRecord[], said: Record<string, string>): string[];
export const WIRE_JUDGES: Record<string, (pair: WirePair, said: Record<string, string>) => string[]>;
