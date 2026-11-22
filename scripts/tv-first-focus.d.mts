import type { DevServerWatch } from "./tv-dev-server-watch.mjs";

export function judgeFirstFocus(lines: string[]): string[];
export function runSmoke(options: {
  serial: string;
  adbPath: string;
  apk: string;
  port?: number;
  evidence?: string;
  onWatch?: (watch: DevServerWatch) => void;
}): Promise<string[]>;
export function smokeCli(options: { serial: string; adbPath: string; apk: string; port?: number; evidence?: string }): Promise<number>;
