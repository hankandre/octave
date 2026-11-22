export type ElfSymbol = { name: string; defined: boolean; type: string; bind: string; visibility: string };
export type ElfRelocation = { section: string; name: string };
export type Elf = { problems: string[]; symbols: ElfSymbol[]; relocations: ElfRelocation[]; packedRelocations: boolean };
export function readElf(bytes: Buffer): Elf;
export function hasBytes(bytes: Buffer, text: string): boolean;
