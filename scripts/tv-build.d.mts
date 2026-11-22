export const E2E_APK: string;
export const E2E_STAMP: string;
export const PROBE_APK: string;
export function judgeBundle(bytes: Uint8Array, flavour: "release" | "e2e"): string[];
export function e2eSourceHash(root?: string): string;
export function e2eApkIsCurrent(): boolean;
export interface TvBuildSystem {
  prebuildIsCurrent(): boolean;
  prebuild(): number;
  sourceHash(): string;
  gradle(tasks: string[], env: NodeJS.ProcessEnv): { status: number | null; signal?: NodeJS.Signals | null };
  releaseApk: string;
  bundleDir: string;
  probeBuildDir: string;
  e2eApk: string;
  e2eStamp: string;
  probeApk: string;
}
export function buildTv(options: { e2e: boolean }, system?: TvBuildSystem): string[];
