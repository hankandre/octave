export const DEVICE_STAND_IN: string;
export function serialForms(serial: string): string[];
export function redactSerial(text: string, serial: string): string;
export type AdbOptions = { timeoutMs?: number; maxBuffer?: number };
export type AdbRunner = {
  run(args: string[], options?: AdbOptions): { status: number; stdout: string; stderr: string };
  runAsync(args: string[], options?: AdbOptions): Promise<{ code: number; stdout: string; stderr: string; killed: boolean }>;
  bytes(args: string[]): { status: number; stdout: Buffer; stderr: string };
  stream(args: string[]): {
    stdout: { setEncoding(encoding: string): void; on(event: string, listener: (chunk: string) => void): unknown };
    on(event: string, listener: (...args: unknown[]) => void): unknown;
    kill(signal?: NodeJS.Signals): void;
  };
  redact(text: string): string;
};
export function openAdb(options: { adbPath: string; serial: string }): AdbRunner;
