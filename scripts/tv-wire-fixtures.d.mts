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
