export type SourceFile = { path: string; text: string };
export function stripSource(text: string, language: "kt" | "java" | "ts"): string;
export function findLogViolations(files: readonly SourceFile[]): string[];
export function readScopedFiles(root: string): SourceFile[];
export function main(root?: string): number;
