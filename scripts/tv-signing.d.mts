export const SIGNING_VARIABLE: string;
export const SIGNING_KEYS: string[];
export function parseProperties(text: string): Record<string, string>;
export function signingProblems(env: Record<string, string | undefined>, options?: { repoRoot?: string }): string[];
export function makeThrowawayKey(dir: string): string;
