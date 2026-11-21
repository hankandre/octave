export const E2E_APK: string;
export const E2E_STAMP: string;
export function judgeBundle(bytes: Uint8Array, flavour: "release" | "e2e"): string[];
export function e2eSourceHash(root?: string): string;
export function e2eApkIsCurrent(): boolean;
export function buildTv(options: { e2e: boolean }): string[];
