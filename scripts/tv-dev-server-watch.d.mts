export type DevServerWatchResult = { controlsExpected: number; controlsSeen: number; appConnections: number };
export type DevServerWatch = {
  runControls(): Promise<string[]>;
  result(): DevServerWatchResult;
  stop(): Promise<void>;
};
export function startDevServerWatch(options: { adb: string; serial: string; port?: number }): Promise<DevServerWatch>;
export function judgeDevServerWatch(result: DevServerWatchResult): string[];
