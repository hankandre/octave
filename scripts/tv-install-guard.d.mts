export interface InstallFacts {
  emulator: boolean | undefined;
  badging: string;
  certs: string;
}
export function installRefusal(facts: InstallFacts): string | null;
export function probeStageDecision(facts: { emulator: boolean | undefined; mustRun: boolean }): "run" | "skip" | "fail";
export function readInstallFacts(
  run: (args: string[]) => { status: number | null; stdout: string } | Promise<{ status: number | null; stdout: string }>,
  apk: string,
  options?: { env?: NodeJS.ProcessEnv },
): Promise<InstallFacts>;
