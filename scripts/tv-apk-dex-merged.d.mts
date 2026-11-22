import type { Mapping } from "./tv-apk-dex-mapping.mjs";
export function referenceSets(
  mapping: Mapping,
  operand: { member: { owner: string; name: string; descriptor: string; method: boolean } | null; types: string[]; otherTypes?: string[] },
): Set<string>[];
export function judgeSet(set: Set<string>, isListed: (name: string) => boolean): { listed: string[]; mixed: boolean };
export function mixedClasses(mapping: Mapping, dexClasses: Iterable<string>): { dex: string; original: string; other: string }[];
