export interface E2eApkInput {
  apk: string;
  mapping: string;
}
export interface E2eApkCheck {
  script: string;
  run(input: E2eApkInput): number | Promise<number>;
}
export const E2E_APK_CHECKS: E2eApkCheck[];
export function checkE2eApk(input: E2eApkInput, checks?: E2eApkCheck[]): Promise<string[]>;
