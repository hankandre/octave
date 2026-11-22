export function extractE2eLines(logcatLines: string[]): string[];
export function expectedCounts(): { url: number; deviceId: number };
export function judgeConformance(lines: string[], expected: { url: number; deviceId: number }): string[];
export function e2eMappingPath(args: string[]): string;
