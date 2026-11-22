type Writer = { write(text: string): unknown };
export const REPO_ROOT: string;
export function isOctavePackage(name: string): boolean;
export function readOctavePackages(root: string): { files: { path: string; name: string }[]; namespaces: { path: string; name: string }[] };
export type ForeignPackages = { foreign: { path: string; kind: "package" | "namespace"; name: string }[]; files: number; namespaces: number; empty: boolean };
export function foreignPackages(root: string): ForeignPackages;
export function packageProblems(found: ForeignPackages, root: string): string[];
export function main(args?: string[], out?: Writer, err?: Writer): number;
