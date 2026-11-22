import type { DexLists } from "./tv-apk-dex-lists.mjs";
export { judgeDex } from "./tv-apk-dex-judge.mjs";
export { parseMapping } from "./tv-apk-dex-mapping.mjs";
type Writer = { write(text: string): unknown };
export const RELEASE_APK: string;
export const RELEASE_MAPPING: string;
export function readApkDex(apk: string): { dex: { name: string; markers: { tool: string; pgMapId: string | null }[] }[]; problems: string[]; damage: string | null };
export function readDexDump(dexdump: string, apk: string): { lines: AsyncIterable<string>; exit: Promise<{ code: number; stderr: string }> };
export function main(args?: string[], system?: { dexdump?: string; lists?: DexLists | Record<string, unknown>; stdout?: Writer; stderr?: Writer; repoRoot?: string }): Promise<number>;
