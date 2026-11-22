// Types for tv-wire-logcat.mjs.
export interface LogChild {
  stdout: { setEncoding?(encoding: string): unknown; on(event: "data", listener: (chunk: unknown) => void): unknown };
  on(event: "exit" | "error", listener: (...args: unknown[]) => void): unknown;
  kill(): unknown;
}
export interface LogKept {
  how: string;
  lines: number;
  start: boolean;
  end: boolean;
  open: boolean;
  markers?: number;
  missed?: number;
}
export function startLogKeeper(options: {
  stream: () => LogChild;
  mark: (text: string) => unknown;
  nonce: string;
  waitMs?: number;
  tickMs?: number;
}): Promise<{ lines(): string[]; finish(): Promise<LogKept>; stop(): void }>;
export function logKeptErrors(kept: LogKept): string[];
export function describeLogKept(kept: LogKept): string;
