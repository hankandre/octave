// T3-28 test support (frozen): builds a small ELF64 little-endian shared library and a stored zip in memory, so the
// tests of scripts/tv-elf.mjs and scripts/tv-apk-native-inspector.mjs need no Android build (docs/specs/T3-28.md,
// "Test plan"). The ELF it writes was checked with llvm-readelf -S -r --dyn-syms -W when this file was frozen.
//
// Layout: a null section, .text, .rodata (the given strings), .dynstr, .dynsym (a null symbol, then the given symbols),
// one SHT_RELA section per relocation section named (.rela.plt, .rela.dyn, …) linked to .dynsym, any extra sections
// asked for (packed or RELR relocations), and .shstrtab. No program headers.
import { crc32 } from "node:zlib";

export const DISPATCHER_NAME =
  "_ZN8facebook5react18jsinspector_modern14NetworkIOAgent13handleRequestERKNS1_3cdp16PreparsedRequestERNS1_27LoadNetworkResourceDelegateE";
export const LOADER_NAME =
  "_ZN8facebook5react18jsinspector_modern14NetworkIOAgent25handleLoadNetworkResourceERKNS1_3cdp16PreparsedRequestERNS1_27LoadNetworkResourceDelegateE";
export const DEBUGGER_ONLY_STRING = "React Native DevTools";
export const ALWAYS_PRESENT_STRING = "is not implemented by this host target delegate";

export const SHT_RELA = 4;
export const SHT_REL = 9;
export const SHT_RELR = 19;
export const SHT_ANDROID_REL = 0x60000001;
export const SHT_ANDROID_RELA = 0x60000002;
export const SHT_CREL = 0x40000014;

export type SymbolType = "NOTYPE" | "OBJECT" | "FUNC";
export type SymbolBind = "LOCAL" | "GLOBAL" | "WEAK";
export type SymbolVisibility = "DEFAULT" | "INTERNAL" | "HIDDEN" | "PROTECTED";
export type ElfSymbol = { name: string; defined: boolean; type: SymbolType; bind: SymbolBind; visibility: SymbolVisibility };
/** A relocation in a SHT_RELA section; `name: null` is a relocation against symbol index 0 (a relative one). */
export type ElfRelocation = { section: string; name: string | null };
export type ElfSpec = {
  symbols?: ElfSymbol[];
  relocations?: ElfRelocation[];
  strings?: string[];
  /** Extra sections by name and type, holding a few opaque bytes (packed relocations, RELR). */
  extraSections?: { name: string; type: number }[];
  /** Leave out .dynsym (and so every relocation section). */
  noDynsym?: boolean;
  /** Write ELFCLASS32 in e_ident instead of ELFCLASS64. */
  elfClass32?: boolean;
  /** Give the named section an sh_offset past the end of the file. */
  offsetPastEndOf?: string;
};

const TYPES: Record<SymbolType, number> = { NOTYPE: 0, OBJECT: 1, FUNC: 2 };
const BINDS: Record<SymbolBind, number> = { LOCAL: 0, GLOBAL: 1, WEAK: 2 };
const VISIBILITIES: Record<SymbolVisibility, number> = { DEFAULT: 0, INTERNAL: 1, HIDDEN: 2, PROTECTED: 3 };

export const func = (name: string, over: Partial<ElfSymbol> = {}): ElfSymbol => ({ name, defined: true, type: "FUNC", bind: "GLOBAL", visibility: "DEFAULT", ...over });

/** The anchors a release libreactnative.so holds: both NetworkIOAgent functions, the LOADER relocation, the string. */
export function releaseLibrary(extra: ElfSpec = {}): ElfSpec {
  return {
    symbols: [func(DISPATCHER_NAME), func(LOADER_NAME), ...(extra.symbols ?? [])],
    relocations: [{ section: ".rela.plt", name: LOADER_NAME }, ...(extra.relocations ?? [])],
    strings: [ALWAYS_PRESENT_STRING, ...(extra.strings ?? [])],
    extraSections: extra.extraSections,
  };
}

class StringTable {
  bytes: number[] = [0];
  add(text: string): number {
    const offset = this.bytes.length;
    this.bytes.push(...Buffer.from(text, "utf8"), 0);
    return offset;
  }
  buffer(): Buffer {
    return Buffer.from(this.bytes);
  }
}

type Section = { name: string; type: number; flags: number; data: Buffer; link: number; info: number; align: number; entsize: number };

export function buildElf(spec: ElfSpec = {}): Buffer {
  const symbols = spec.symbols ?? [];
  const relocations = spec.relocations ?? [];
  const sections: Section[] = [];
  // Returns the section's index in the header table, where 0 is the null section.
  const add = (section: Section) => sections.push(section);

  const text = add({ name: ".text", type: 1, flags: 0x6, data: Buffer.alloc(16, 0xcc), link: 0, info: 0, align: 16, entsize: 0 });
  const rodata = Buffer.from((spec.strings ?? []).map((s) => `${s}\0`).join(""), "utf8");
  add({ name: ".rodata", type: 1, flags: 0x2, data: rodata.length > 0 ? rodata : Buffer.alloc(1), link: 0, info: 0, align: 1, entsize: 0 });

  if (!spec.noDynsym) {
    const dynstr = new StringTable();
    const dynsym = Buffer.alloc(24 * (symbols.length + 1));
    symbols.forEach((symbol, i) => {
      const at = 24 * (i + 1);
      dynsym.writeUInt32LE(dynstr.add(symbol.name), at);
      dynsym.writeUInt8((BINDS[symbol.bind] << 4) | TYPES[symbol.type], at + 4);
      dynsym.writeUInt8(VISIBILITIES[symbol.visibility], at + 5);
      dynsym.writeUInt16LE(symbol.defined ? text : 0, at + 6);
      dynsym.writeBigUInt64LE(symbol.defined ? BigInt(0x1000 + 16 * i) : 0n, at + 8);
      dynsym.writeBigUInt64LE(symbol.defined && symbol.type === "FUNC" ? 4n : 0n, at + 16);
    });
    const dynstrIndex = add({ name: ".dynstr", type: 3, flags: 0x2, data: dynstr.buffer(), link: 0, info: 0, align: 1, entsize: 0 });
    const firstGlobal = 1 + symbols.filter((symbol) => symbol.bind === "LOCAL").length;
    const dynsymIndex = add({ name: ".dynsym", type: 11, flags: 0x2, data: dynsym, link: dynstrIndex, info: firstGlobal, align: 8, entsize: 24 });

    const bySection = new Map<string, ElfRelocation[]>();
    for (const relocation of relocations) bySection.set(relocation.section, [...(bySection.get(relocation.section) ?? []), relocation]);
    for (const [name, entries] of bySection) {
      const data = Buffer.alloc(24 * entries.length);
      entries.forEach((relocation, i) => {
        const at = 24 * i;
        const index = relocation.name === null ? 0 : symbols.findIndex((symbol) => symbol.name === relocation.name) + 1;
        if (relocation.name !== null && index === 0) throw new Error(`buildElf: relocation names ${relocation.name}, which is not a symbol`);
        // R_AARCH64_JUMP_SLOT (1026) in .rela.plt, R_AARCH64_GLOB_DAT (1025) elsewhere, R_AARCH64_RELATIVE (1027) for index 0.
        const type = index === 0 ? 1027 : name === ".rela.plt" ? 1026 : 1025;
        data.writeBigUInt64LE(BigInt(0x2000 + 8 * i), at);
        data.writeBigUInt64LE((BigInt(index) << 32n) | BigInt(type), at + 8);
        data.writeBigInt64LE(0n, at + 16);
      });
      add({ name, type: SHT_RELA, flags: name === ".rela.plt" ? 0x42 : 0x2, data, link: dynsymIndex, info: 0, align: 8, entsize: 24 });
    }
  }

  for (const extra of spec.extraSections ?? []) {
    const relr = extra.type === SHT_RELR;
    const data = relr ? Buffer.alloc(8) : Buffer.from("APS2\0\0\0\0", "latin1");
    if (relr) data.writeBigUInt64LE(0x3000n, 0);
    add({ name: extra.name, type: extra.type, flags: 0x2, data, link: 0, info: 0, align: 8, entsize: relr ? 8 : 1 });
  }

  const shstrtab = new StringTable();
  const nameOffsets = sections.map((section) => shstrtab.add(section.name));
  const shstrtabName = shstrtab.add(".shstrtab");
  sections.push({ name: ".shstrtab", type: 3, flags: 0, data: shstrtab.buffer(), link: 0, info: 0, align: 1, entsize: 0 });
  nameOffsets.push(shstrtabName);

  // Lay the section data out after the 64-byte header, each aligned, then the section header table.
  const offsets: number[] = [];
  let at = 64;
  for (const section of sections) {
    at = Math.ceil(at / Math.max(section.align, 1)) * Math.max(section.align, 1);
    offsets.push(at);
    at += section.data.length;
  }
  const shoff = Math.ceil(at / 8) * 8;
  const shnum = sections.length + 1;
  const file = Buffer.alloc(shoff + 64 * shnum);

  file.write("\x7fELF", 0, "latin1");
  file.writeUInt8(spec.elfClass32 ? 1 : 2, 4); // EI_CLASS
  file.writeUInt8(1, 5); // EI_DATA little-endian
  file.writeUInt8(1, 6); // EI_VERSION
  file.writeUInt16LE(3, 16); // ET_DYN
  file.writeUInt16LE(0xb7, 18); // EM_AARCH64
  file.writeUInt32LE(1, 20);
  file.writeBigUInt64LE(BigInt(shoff), 40);
  file.writeUInt16LE(64, 52); // e_ehsize
  file.writeUInt16LE(56, 54); // e_phentsize
  file.writeUInt16LE(64, 58); // e_shentsize
  file.writeUInt16LE(shnum, 60);
  file.writeUInt16LE(shnum - 1, 62); // .shstrtab is last

  sections.forEach((section, i) => {
    section.data.copy(file, offsets[i]);
    const h = shoff + 64 * (i + 1);
    const offset = spec.offsetPastEndOf === section.name ? file.length + 4096 : offsets[i];
    file.writeUInt32LE(nameOffsets[i], h);
    file.writeUInt32LE(section.type, h + 4);
    file.writeBigUInt64LE(BigInt(section.flags), h + 8);
    file.writeBigUInt64LE(BigInt(offset), h + 24);
    file.writeBigUInt64LE(BigInt(section.data.length), h + 32);
    file.writeUInt32LE(section.link, h + 40);
    file.writeUInt32LE(section.info, h + 44);
    file.writeBigUInt64LE(BigInt(section.align), h + 48);
    file.writeBigUInt64LE(BigInt(section.entsize), h + 56);
  });
  return file;
}

/** A zip of stored entries (local headers, central directory, end record), as an APK stores its native libraries. */
export function zipStored(entries: { name: string; data: Buffer }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const crc = crc32(entry.data);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(10, 4);
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt16LE(0x21, 12); // 1980-01-01
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(entry.data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(10, 6);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(entry.data.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    locals.push(local, entry.data);
    centrals.push(central);
    offset += local.length + entry.data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
