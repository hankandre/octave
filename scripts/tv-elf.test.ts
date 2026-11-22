// @vitest-environment node
// T3-28 item 1 (docs/specs/T3-28.md, "The reader, scripts/tv-elf.mjs"): the ELF reader the native inspector check
// reads every library of the APK with. It is tested on ELF64 files scripts/fixtures/tv/native/elf.ts builds (checked
// with llvm-readelf when frozen), so a reader that misreads a section fails here and not only on a real APK.
//
// Shapes this file freezes:
// - readElf(bytes) returns { problems, symbols, relocations, packedRelocations } and never throws: an unreadable file
//   is a `problems` entry (a non-empty string).
// - symbols: every .dynsym entry as { name, defined, type, bind, visibility }, defined being st_shndx !== 0 and the
//   others the ELF names (FUNC, OBJECT, NOTYPE; GLOBAL, WEAK, LOCAL; DEFAULT, HIDDEN, PROTECTED, INTERNAL).
// - relocations: { section, name } for each entry of a SHT_RELA or SHT_REL section linked to .dynsym whose symbol index
//   is not 0.
// - packedRelocations: true when a SHT_ANDROID_REL, SHT_ANDROID_RELA or SHT_CREL section exists; SHT_RELR does not count.
// - hasBytes(bytes, text): whether the file holds text's UTF-8 bytes.
//
// The module is loaded at run time from a path built here, so `pnpm typecheck` does not depend on it existing.
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { buildElf, func, SHT_ANDROID_REL, SHT_ANDROID_RELA, SHT_CREL, SHT_RELR, type ElfSymbol } from "./fixtures/tv/native/elf";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");

type Elf = {
  problems: string[];
  symbols: ElfSymbol[];
  relocations: { section: string; name: string }[];
  packedRelocations: boolean;
};
type ElfModule = { readElf(bytes: Buffer): Elf; hasBytes(bytes: Buffer, text: string): boolean };

async function loadElf(): Promise<ElfModule> {
  return (await import(pathToFileURL(join(repo, "scripts", "tv-elf.mjs")).href)) as ElfModule;
}

const DEFINED_FUNC = func("defined_function");
const UNDEFINED: ElfSymbol = { name: "imported_symbol", defined: false, type: "NOTYPE", bind: "GLOBAL", visibility: "DEFAULT" };
const WEAK_OBJECT: ElfSymbol = { name: "weak_object", defined: true, type: "OBJECT", bind: "WEAK", visibility: "HIDDEN" };
const STRING = "a string the reader must find";

const sample = () =>
  buildElf({
    symbols: [DEFINED_FUNC, UNDEFINED, WEAK_OBJECT],
    relocations: [
      { section: ".rela.plt", name: DEFINED_FUNC.name },
      { section: ".rela.dyn", name: WEAK_OBJECT.name },
      { section: ".rela.dyn", name: null },
    ],
    strings: [STRING],
  });

describe("T3-28 item 1: readElf reads a library's dynamic symbols and relocations", () => {
  it("T3-28 item 1: returns each .dynsym entry with its name, definition, type, binding and visibility", async () => {
    const { readElf } = await loadElf();
    const elf = readElf(sample());
    expect(elf.problems).toEqual([]);
    const named = elf.symbols.filter((symbol) => symbol.name !== "");
    expect(named).toHaveLength(3);
    expect(named).toContainEqual(expect.objectContaining(DEFINED_FUNC));
    expect(named).toContainEqual(expect.objectContaining(UNDEFINED));
    expect(named).toContainEqual(expect.objectContaining(WEAK_OBJECT));
  });

  it("T3-28 item 1: returns each relocation that names a symbol, with its section, and none for symbol index 0", async () => {
    const { readElf } = await loadElf();
    const elf = readElf(sample());
    expect(elf.relocations).toHaveLength(2);
    expect(elf.relocations).toContainEqual(expect.objectContaining({ section: ".rela.plt", name: DEFINED_FUNC.name }));
    expect(elf.relocations).toContainEqual(expect.objectContaining({ section: ".rela.dyn", name: WEAK_OBJECT.name }));
    expect(elf.packedRelocations).toBe(false);
  });

  it("T3-28 item 1: hasBytes finds a string in the file and not one that is absent", async () => {
    const { hasBytes } = await loadElf();
    const bytes = sample();
    expect(hasBytes(bytes, STRING)).toBe(true);
    expect(hasBytes(bytes, "a string nobody wrote")).toBe(false);
  });

  it.each([
    ["SHT_ANDROID_RELA", SHT_ANDROID_RELA],
    ["SHT_ANDROID_REL", SHT_ANDROID_REL],
    ["SHT_CREL", SHT_CREL],
  ])("T3-28 item 1: a %s section sets packedRelocations", async (_label, type) => {
    const { readElf } = await loadElf();
    const elf = readElf(buildElf({ symbols: [DEFINED_FUNC], extraSections: [{ name: ".packed", type }] }));
    expect(elf.problems).toEqual([]);
    expect(elf.packedRelocations).toBe(true);
  });

  it("T3-28 item 1: a SHT_RELR section does not set packedRelocations", async () => {
    const { readElf } = await loadElf();
    const elf = readElf(buildElf({ symbols: [DEFINED_FUNC], extraSections: [{ name: ".relr.dyn", type: SHT_RELR }] }));
    expect(elf.problems).toEqual([]);
    expect(elf.packedRelocations).toBe(false);
  });
});

describe("T3-28 item 1: readElf reports what it cannot read and never throws", () => {
  const cases: [string, () => Buffer][] = [
    ["an ELF32 header", () => buildElf({ symbols: [DEFINED_FUNC], elfClass32: true })],
    ["a truncated file", () => sample().subarray(0, 40)],
    ["a section offset past the end of the file", () => buildElf({ symbols: [DEFINED_FUNC], offsetPastEndOf: ".dynsym" })],
    ["a file with no .dynsym", () => buildElf({ noDynsym: true, strings: [STRING] })],
    ["a file that is not ELF", () => Buffer.from("this is not an ELF file at all, only text\n".repeat(4))],
  ];

  it.each(cases)("T3-28 item 1: %s is a problem, not an exception", async (_label, make) => {
    const { readElf } = await loadElf();
    let elf: Elf | undefined;
    expect(() => {
      elf = readElf(make());
    }).not.toThrow();
    expect(elf?.problems.length, JSON.stringify(elf)).toBeGreaterThan(0);
    for (const problem of elf?.problems ?? []) expect(typeof problem === "string" && problem.length > 0).toBe(true);
  });
});
