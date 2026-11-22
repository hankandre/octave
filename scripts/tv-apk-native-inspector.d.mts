import type { ElfSymbol } from "./tv-elf.mjs";
type Writer = { write(text: string): unknown };
export type NativeLibraryFacts = {
  entry: string;
  abi: string;
  name: string;
  problems: string[];
  packedRelocations: boolean;
  symbols: ElfSymbol[];
  relocations: { section: string; name: string }[];
  markers: string[];
};
export const DISPATCHER: string;
export const LOADER: string;
export const DEBUGGER_ONLY_MARKERS: string[];
export const ALWAYS_PRESENT_MARKER: string;
export function readLibraryFacts(entryName: string, bytes: Buffer): NativeLibraryFacts;
export function judgeNativeInspector(facts: { libraries: NativeLibraryFacts[] }): string[];
export function main(args?: string[], system?: { stdout?: Writer; stderr?: Writer }): number;
