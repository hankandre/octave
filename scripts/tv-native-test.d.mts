export type NativeTestReport = { project: string; hasTestSources: boolean; xml: string[] };
export function summarizeResults(reports: NativeTestReport[]): { line: string; errors: string[] };
