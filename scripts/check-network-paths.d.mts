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
export interface LinkedEntry {
  id: string;
  package: string;
  file: string;
  what: string;
  verdict: string;
  reason: string;
  refusedBy: string[];
}
export interface LinkedClient {
  package: string;
  file: string;
}
export const LINKED_NETWORK_PATHS: LinkedEntry[];
export function opensConnection(text: string): boolean;
export function findLinkedClients(packages: { name: string; dir: string }[]): LinkedClient[];
export function judgeLinkedClients(found: LinkedClient[], allowlist: LinkedEntry[]): string[];
export function linkedPackages(root: string): { packages: { name: string; dir: string }[]; errors: string[] };
