export const SKIPPABLE_PREFIXES: readonly string[];
export function deviceJobsDecision(input: { eventName: string | undefined; paths: readonly string[] | undefined }): { decision: "skip" | "run"; reason: string };
export function changedPaths(input: { repo: string; headSha: string | undefined }): { paths: string[] } | { unreadable: string };
