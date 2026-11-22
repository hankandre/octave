// Types for tv-wire-device.mjs.
export interface WireDevice {
  clearProxy(): void;
  setProxy(devicePort: number): void;
  reverse(devicePort: number, hostPort: number): void;
  reversed(): number[];
  listReverses(): string;
  onStop(fn: () => void): void;
  restore(): void;
}
export function openDevice(options: {
  adb: (...args: string[]) => { status: number | null; stdout?: string };
  appId: string;
  proc?: { on(signal: string, listener: () => void): unknown; exit(code: number): unknown };
}): WireDevice;
