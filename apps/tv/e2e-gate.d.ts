export type Resolution = { type: string; filePath?: string; filePaths?: string[] };
export function isE2eOnly(filePath: string, appDir: string): boolean;
export function gateResolution(resolution: Resolution, options: { e2e: boolean; appDir: string }): Resolution;
