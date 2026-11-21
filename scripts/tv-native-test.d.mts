export type NativeTestReport = { project: string; hasTestSources: boolean; xml: string[] };
export function summarizeResults(reports: NativeTestReport[]): { line: string; errors: string[] };
export type NativeTestProject = { project: string; testSources: string; results: string[] };
export function projects(): NativeTestProject[];
export function reportsIn(dirs: string[]): string[];
