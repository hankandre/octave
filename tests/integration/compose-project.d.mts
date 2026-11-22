// Types for compose-project.mjs, so the TypeScript tripwire can import it under strict mode.
export const FIXTURE_PORTS: number[];
export function composeProjectName(root: string): string;
export function composeArgs(): string[];
export function judgePortHolders(holders: { port: number; project: string | null }[], ours: string): string[];
export function readPortHolders(ports?: number[]): { port: number; project: string | null }[];
