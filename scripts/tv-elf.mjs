// A small reader of an ELF64 little-endian shared library (T3-28, docs/specs/T3-28.md, "The reader"): its dynamic
// symbols, the relocations that name them, and whether it holds a packed relocation section. It takes bytes and runs
// no tool. It never throws: what it cannot read is a `problems` entry.

const SHT_NOBITS = 8;
const SHT_RELA = 4;
const SHT_REL = 9;
const SHT_DYNSYM = 11;
const PACKED = new Set([0x60000001, 0x60000002, 0x40000014]); // SHT_ANDROID_REL, SHT_ANDROID_RELA, SHT_CREL

const TYPES = ["NOTYPE", "OBJECT", "FUNC", "SECTION", "FILE", "COMMON", "TLS"];
const BINDS = ["LOCAL", "GLOBAL", "WEAK"];
const VISIBILITIES = ["DEFAULT", "INTERNAL", "HIDDEN", "PROTECTED"];

const nameOf = (names, value) => names[value] ?? `UNKNOWN(${value})`;

function cString(bytes, start, end) {
  const stop = bytes.indexOf(0, start);
  return bytes.toString("utf8", start, stop === -1 || stop > end ? end : stop);
}

function readSections(bytes, problems) {
  if (bytes.length < 64) {
    problems.push(`a ${bytes.length}-byte file is shorter than an ELF64 header`);
    return null;
  }
  if (bytes.readUInt32BE(0) !== 0x7f454c46 || bytes[4] !== 2 || bytes[5] !== 1) {
    problems.push("not ELF64 little-endian");
    return null;
  }
  const shoff = Number(bytes.readBigUInt64LE(40));
  const shentsize = bytes.readUInt16LE(58);
  const shnum = bytes.readUInt16LE(60);
  const shstrndx = bytes.readUInt16LE(62);
  if (shnum === 0 || shentsize < 64 || shoff + shnum * shentsize > bytes.length) {
    problems.push(`the section header table (offset ${shoff}, ${shnum} entries of ${shentsize} bytes) is not inside the file`);
    return null;
  }
  const sections = [];
  for (let i = 0; i < shnum; i += 1) {
    const h = shoff + i * shentsize;
    const section = {
      index: i,
      nameOffset: bytes.readUInt32LE(h),
      type: bytes.readUInt32LE(h + 4),
      offset: Number(bytes.readBigUInt64LE(h + 24)),
      size: Number(bytes.readBigUInt64LE(h + 32)),
      link: bytes.readUInt32LE(h + 40),
      entsize: Number(bytes.readBigUInt64LE(h + 56)),
      name: "",
    };
    // A NOBITS section (.bss) has a size but no bytes in the file.
    if (section.type !== SHT_NOBITS && section.offset + section.size > bytes.length) {
      problems.push(`section ${i} (offset ${section.offset}, ${section.size} bytes) runs past the end of the ${bytes.length}-byte file`);
    }
    sections.push(section);
  }
  if (problems.length > 0) return null;
  const names = sections[shstrndx];
  if (names === undefined) {
    problems.push(`the section name table index ${shstrndx} is not a section`);
    return null;
  }
  for (const section of sections) {
    section.name = section.nameOffset < names.size ? cString(bytes, names.offset + section.nameOffset, names.offset + names.size) : "";
  }
  return sections;
}

function readSymbols(bytes, dynsym, sections, problems) {
  const strtab = sections[dynsym.link];
  if (strtab === undefined) {
    problems.push(`.dynsym links to section ${dynsym.link}, which does not exist`);
    return [];
  }
  const entsize = dynsym.entsize || 24;
  if (entsize < 24) {
    problems.push(`.dynsym entries are ${entsize} bytes, less than an ELF64 symbol`);
    return [];
  }
  const symbols = [];
  for (let at = dynsym.offset; at + 24 <= dynsym.offset + dynsym.size; at += entsize) {
    const nameOffset = bytes.readUInt32LE(at);
    const info = bytes[at + 4];
    symbols.push({
      name: nameOffset < strtab.size ? cString(bytes, strtab.offset + nameOffset, strtab.offset + strtab.size) : "",
      defined: bytes.readUInt16LE(at + 6) !== 0,
      type: nameOf(TYPES, info & 0xf),
      bind: nameOf(BINDS, info >> 4),
      visibility: nameOf(VISIBILITIES, bytes[at + 5] & 0x3),
    });
  }
  return symbols;
}

function readRelocations(bytes, section, symbols, problems) {
  const rela = section.type === SHT_RELA;
  const minimum = rela ? 24 : 16;
  const entsize = section.entsize || minimum;
  if (entsize < minimum) {
    problems.push(`${section.name}: entries are ${entsize} bytes, less than an ELF64 ${rela ? "RELA" : "REL"} entry`);
    return [];
  }
  const relocations = [];
  for (let at = section.offset; at + minimum <= section.offset + section.size; at += entsize) {
    const index = bytes.readUInt32LE(at + 12); // the high half of r_info
    if (index === 0) continue;
    const symbol = symbols[index];
    if (symbol === undefined) {
      problems.push(`${section.name}: a relocation names symbol ${index}, past the end of .dynsym`);
      continue;
    }
    relocations.push({ section: section.name, name: symbol.name });
  }
  return relocations;
}

/** Reads `bytes` as an ELF64 little-endian library: { problems, symbols, relocations, packedRelocations }. Never throws. */
export function readElf(bytes) {
  const problems = [];
  const result = { problems, symbols: [], relocations: [], packedRelocations: false };
  try {
    const sections = readSections(bytes, problems);
    if (sections === null) return result;
    result.packedRelocations = sections.some((section) => PACKED.has(section.type));
    const dynsym = sections.find((section) => section.type === SHT_DYNSYM);
    if (dynsym === undefined) {
      problems.push("no .dynsym section");
      return result;
    }
    result.symbols = readSymbols(bytes, dynsym, sections, problems);
    for (const section of sections) {
      if ((section.type === SHT_RELA || section.type === SHT_REL) && section.link === dynsym.index) {
        result.relocations.push(...readRelocations(bytes, section, result.symbols, problems));
      }
    }
  } catch (error) {
    problems.push(`unreadable: ${error instanceof Error ? error.message : String(error)}`);
  }
  return result;
}

/** Whether `bytes` holds the UTF-8 bytes of `text`. */
export function hasBytes(bytes, text) {
  return bytes.indexOf(Buffer.from(text, "utf8")) !== -1;
}
