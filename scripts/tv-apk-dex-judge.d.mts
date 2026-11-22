import type { DexLists } from "./tv-apk-dex-lists.mjs";
import type { Mapping } from "./tv-apk-dex-mapping.mjs";
export type DexVerdict = { errors: string[]; stats: { opened: number; classes: number; sinkReferences: number; entryPoints: number; leftBeforeR8: number } };
export function readOperand(
  opcode: string,
  operand: string,
): { member: { owner: string; name: string; descriptor: string; method: boolean } | null; types: string[]; otherTypes?: string[] };
export function judgeDex(lines: Iterable<string> | AsyncIterable<string>, mapping: Mapping, lists: DexLists): Promise<DexVerdict>;
