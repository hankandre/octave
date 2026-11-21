export interface SourceFile {
  path: string;
  text: string;
}
export interface NamePattern {
  re: RegExp;
  what: string;
  rule?: string;
  inStrings?: boolean;
  socket?: boolean;
  oneClient?: boolean;
}
export interface KotlinRule {
  id: string;
  alternative: string;
  names: NamePattern[];
}
export const OCTAVE_HTTP: string;
export const DIRECT_SOCKETS: string;
export const NETWORK_OPENERS: (NamePattern & { rule: string })[];
export const KOTLIN_RULES: KotlinRule[];
export function splitSource(text: string): { code: string; strings: string[] }[];
export function findSourceViolations(files: SourceFile[]): string[];
export function readOctaveSource(root: string): SourceFile[];
export function main(args?: string[]): number;
