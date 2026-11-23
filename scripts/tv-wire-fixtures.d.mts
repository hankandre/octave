// Types for tv-wire-fixtures.mjs.
export function readWireCredentials(credentialsFile?: string, recordFile?: string): Record<string, string>;
export function fixtureTargets(recordFile?: string): Record<string, string>;
export function upstreamPort(target: string, credentials: Record<string, string>): number;
export function ensureFixtures(
  targets: string[],
  options?: {
    recordFile?: string;
    credentialsFile?: string;
    answers?: (url: string) => Promise<boolean>;
    pnpm?: (script: string) => void;
  },
): Promise<void>;
export const READS_JELLYFIN_LIBRARY: readonly string[];
export const SCANNED_SAMPLES: readonly string[];
export const SCAN_LIMIT_MS: number;
export function scanTargetsOf(pairs: { test: string; target: string }[]): string[];
export function scanJellyfinLibraries(
  pairs: { test: string; target: string }[],
  options: {
    credentials: Record<string, string>;
    secrets: Set<string>;
    fetch?: (url: string, init: RequestInit) => Promise<Response>;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
    log?: (line: string) => void;
  },
): Promise<void>;
