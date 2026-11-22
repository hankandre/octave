// @vitest-environment node
// T3-28 items 1 and 2 (docs/specs/T3-28.md, "The rules" and "The command"): scripts/tv-apk-native-inspector.mjs, a step
// of `pnpm tv:apk:check`, reads every lib/<abi>/*.so of the release APK and fails when the C++ inspector's network
// dispatcher (NetworkIOAgent::handleRequest, the one C++ route to ReactHostImpl.loadNetworkResource) is wired to a
// caller, which only a library compiled with REACT_NATIVE_DEBUGGER_ENABLED has.
//
// The rules:
// - L0, readable: at least one lib/<abi>/<name>.so, arm64-v8a among the ABIs, no library with a problem, and no packed
//   relocations in a library whose symbols name DISPATCHER.
// - L1, anchors: in each ABI exactly one library defines DISPATCHER; its DISPATCHER and LOADER are defined FUNC GLOBAL
//   DEFAULT; it holds a relocation naming LOADER and the always-present string.
// - L2, no caller: no library holds a relocation naming DISPATCHER or an undefined DISPATCHER symbol.
// - L3: no library holds a debugger-only string.
//
// Fixtures (scripts/fixtures/tv/native/, each with a `header` naming the sample's sha256 and the commands that cut it
// with llvm-readelf, grep and jq, never with the code under test): release-apk.json (the 44 libraries of a release
// APK), debug-apk.json and debug-optimized-aar.json (libreactnative.so of the two builds with the inspector on). The
// planted cases are built here from the release cut; the spawned cases zip an ELF fixtures/tv/native/elf.ts builds.
//
// Shapes this file freezes:
// - The module exports DISPATCHER, LOADER, DEBUGGER_ONLY_MARKERS and ALWAYS_PRESENT_MARKER with the spec's values,
//   readLibraryFacts(entryName, bytes) returning { entry, abi, name, problems, packedRelocations, symbols, relocations,
//   markers } (symbols and relocations cut to names starting with DISPATCHER or LOADER; markers the subset of the two
//   marker lists the bytes hold), and judgeNativeInspector({ libraries }) returning `ERROR tv native inspector: <rule> …`
//   lines, empty on a pass.
// - Errors name the rule and the entry (lib/<abi>/<name>.so) and, for an L2 relocation, its section.
// - The command is `node scripts/tv-apk-native-inspector.mjs [apk]`. On a pass it writes one stdout line starting
//   `tv native inspector: ` and containing `passes`; on a failure an `ERROR tv native inspector:` line to stderr, nothing
//   to stdout, a non-zero exit and no stack trace.
//
// Not frozen: wording after the rule id beyond the entry and section names; the order of lines.
//
// The module is loaded at run time from a path built here, so `pnpm typecheck` does not depend on it existing.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { ALWAYS_PRESENT_STRING, buildElf, DEBUGGER_ONLY_STRING, DISPATCHER_NAME, func, LOADER_NAME, releaseLibrary, zipStored } from "./fixtures/tv/native/elf";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(repo, "scripts", "tv-apk-native-inspector.mjs");
const FIXTURES = join(repo, "scripts", "fixtures", "tv", "native");

type LibrarySymbol = { name: string; defined: boolean; type: string; bind: string; visibility: string };
type Library = {
  entry: string;
  abi: string;
  name: string;
  problems: string[];
  packedRelocations: boolean;
  symbols: LibrarySymbol[];
  relocations: { section: string; name: string }[];
  markers: string[];
};
type NativeModule = {
  DISPATCHER: string;
  LOADER: string;
  DEBUGGER_ONLY_MARKERS: string[];
  ALWAYS_PRESENT_MARKER: string;
  readLibraryFacts(entryName: string, bytes: Buffer): Library;
  judgeNativeInspector(facts: { libraries: Library[] }): string[];
};

async function loadNative(): Promise<NativeModule> {
  return (await import(pathToFileURL(SCRIPT).href)) as NativeModule;
}

const cut = (file: string): Library[] => (JSON.parse(readFileSync(join(FIXTURES, file), "utf8")) as { libraries: Library[] }).libraries;
const release = () => cut("release-apk.json");

function find(libraries: Library[], entry: string): Library {
  const library = libraries.find((candidate) => candidate.entry === entry);
  if (library === undefined) throw new Error(`the cut holds no ${entry}`);
  return library;
}

const DISPATCHER_PREFIX = "_ZN8facebook5react18jsinspector_modern14NetworkIOAgent13handleRequestE";
const LOADER_PREFIX = "_ZN8facebook5react18jsinspector_modern14NetworkIOAgent25handleLoadNetworkResourceE";

const INSPECTOR_ARM = "lib/arm64-v8a/libreactnative.so";
const INSPECTOR_X86 = "lib/x86_64/libreactnative.so";
const OTHER_ARM = "lib/arm64-v8a/libappmodules.so";
const dispatcherSymbol = (libraries: Library[], entry: string) => {
  const symbol = find(libraries, entry).symbols.find((candidate) => candidate.name.startsWith(DISPATCHER_PREFIX));
  if (symbol === undefined) throw new Error(`${entry} defines no dispatcher in the cut`);
  return symbol;
};
const loaderSymbol = (libraries: Library[], entry: string) => {
  const symbol = find(libraries, entry).symbols.find((candidate) => candidate.name.startsWith(LOADER_PREFIX));
  if (symbol === undefined) throw new Error(`${entry} defines no loader in the cut`);
  return symbol;
};

const rule = (errors: string[], id: string) => errors.filter((line) => line.startsWith(`ERROR tv native inspector: ${id}`));
function expectOnly(errors: string[], ids: string[]) {
  expect(errors.length, errors.join("\n")).toBeGreaterThan(0);
  for (const line of errors) expect(line, errors.join("\n")).toMatch(new RegExp(`^ERROR tv native inspector: (?:${ids.join("|")})\\b`));
  for (const id of ids) expect(rule(errors, id).length, `an ${id} line in:\n${errors.join("\n")}`).toBeGreaterThan(0);
}
function expectRule(errors: string[], id: string) {
  expect(rule(errors, id).length, `an ${id} line in:\n${errors.join("\n")}`).toBeGreaterThan(0);
}

// --- item 1 ---------------------------------------------------------------------------------------------------

describe("T3-28 item 1: the native inspector check tells a release library from one with the inspector on", () => {
  it("T3-28 item 1: exports the dispatcher and loader prefixes and the two marker lists the spec names", async () => {
    const native = await loadNative();
    expect(native.DISPATCHER).toBe(DISPATCHER_PREFIX);
    expect(native.LOADER).toBe(LOADER_PREFIX);
    expect(native.DEBUGGER_ONLY_MARKERS).toEqual([DEBUGGER_ONLY_STRING]);
    expect(native.ALWAYS_PRESENT_MARKER).toBe(ALWAYS_PRESENT_STRING);
  });

  it("T3-28 item 1: the recorded release APK's 44 libraries pass", async () => {
    const { judgeNativeInspector } = await loadNative();
    const libraries = release();
    expect(libraries).toHaveLength(44);
    expect(judgeNativeInspector({ libraries })).toEqual([]);
  });

  it("T3-28 item 1: the recorded debug library fails on L2 and L3 and on no other rule", async () => {
    const { judgeNativeInspector } = await loadNative();
    expectOnly(judgeNativeInspector({ libraries: cut("debug-apk.json") }), ["L2", "L3"]);
  });

  it("T3-28 item 1: the recorded debugOptimized library fails on L2 and L3 and on no other rule", async () => {
    const { judgeNativeInspector } = await loadNative();
    expectOnly(judgeNativeInspector({ libraries: cut("debug-optimized-aar.json") }), ["L2", "L3"]);
  });

  it("T3-28 item 1: a relocation naming the dispatcher in libreactnative.so fails L2 only, naming the entry and section", async () => {
    const { judgeNativeInspector } = await loadNative();
    const libraries = release();
    find(libraries, INSPECTOR_ARM).relocations.push({ section: ".rela.plt", name: DISPATCHER_NAME });
    const errors = judgeNativeInspector({ libraries });
    expectOnly(errors, ["L2"]);
    expect(rule(errors, "L2").some((line) => line.includes(INSPECTOR_ARM) && line.includes(".rela.plt")), errors.join("\n")).toBe(true);
  });

  it("T3-28 item 1: an undefined dispatcher symbol in another library (an import) fails L2 only, naming that library", async () => {
    const { judgeNativeInspector } = await loadNative();
    const libraries = release();
    find(libraries, OTHER_ARM).symbols.push({ name: DISPATCHER_NAME, defined: false, type: "NOTYPE", bind: "GLOBAL", visibility: "DEFAULT" });
    const errors = judgeNativeInspector({ libraries });
    expectOnly(errors, ["L2"]);
    expect(rule(errors, "L2").some((line) => line.includes(OTHER_ARM)), errors.join("\n")).toBe(true);
  });

  it("T3-28 item 1: a debugger-only string in another library fails L3 only, naming that library", async () => {
    const { judgeNativeInspector } = await loadNative();
    const libraries = release();
    find(libraries, OTHER_ARM).markers.push(DEBUGGER_ONLY_STRING);
    const errors = judgeNativeInspector({ libraries });
    expectOnly(errors, ["L3"]);
    expect(rule(errors, "L3").some((line) => line.includes(OTHER_ARM)), errors.join("\n")).toBe(true);
  });

  it("T3-28 item 1: a symbol that only begins like the dispatcher's class passes", async () => {
    const { judgeNativeInspector } = await loadNative();
    const libraries = release();
    const lookalike = "_ZN8facebook5react18jsinspector_modern14NetworkIOAgentX13handleRequestERKNS1_3cdp16PreparsedRequestE";
    find(libraries, OTHER_ARM).symbols.push({ name: lookalike, defined: false, type: "NOTYPE", bind: "GLOBAL", visibility: "DEFAULT" });
    find(libraries, OTHER_ARM).relocations.push({ section: ".rela.plt", name: lookalike });
    expect(judgeNativeInspector({ libraries })).toEqual([]);
  });

  it("T3-28 item 1: readLibraryFacts reads a built library into the cut's shape, and the judge passes it", async () => {
    const { readLibraryFacts, judgeNativeInspector } = await loadNative();
    const bytes = buildElf(releaseLibrary({ symbols: [func("_ZN8facebook5react5OtherE")], relocations: [{ section: ".rela.dyn", name: "_ZN8facebook5react5OtherE" }] }));
    const library = readLibraryFacts(INSPECTOR_ARM, bytes);
    expect(library).toMatchObject({ entry: INSPECTOR_ARM, abi: "arm64-v8a", name: "libreactnative.so", problems: [], packedRelocations: false });
    expect(library.symbols).toHaveLength(2);
    expect(library.symbols).toContainEqual(expect.objectContaining(func(DISPATCHER_NAME)));
    expect(library.symbols).toContainEqual(expect.objectContaining(func(LOADER_NAME)));
    expect(library.relocations).toEqual([expect.objectContaining({ section: ".rela.plt", name: LOADER_NAME })]);
    expect(library.markers).toEqual([ALWAYS_PRESENT_STRING]);
    expect(judgeNativeInspector({ libraries: [library] })).toEqual([]);
  });

  it("T3-28 item 1: readLibraryFacts on a built library with a dispatcher relocation and the debugger-only string fails L2 and L3", async () => {
    const { readLibraryFacts, judgeNativeInspector } = await loadNative();
    const bytes = buildElf(releaseLibrary({ relocations: [{ section: ".rela.plt", name: DISPATCHER_NAME }], strings: [DEBUGGER_ONLY_STRING] }));
    const library = readLibraryFacts(INSPECTOR_ARM, bytes);
    expect(library.markers).toContain(DEBUGGER_ONLY_STRING);
    expectOnly(judgeNativeInspector({ libraries: [library] }), ["L2", "L3"]);
  });
});

// --- item 2: fail closed, on the judge ------------------------------------------------------------------------

describe("T3-28 item 2: the check fails closed when it cannot read what it needs", () => {
  it("T3-28 item 2: no libraries fail L0", async () => {
    const { judgeNativeInspector } = await loadNative();
    expectRule(judgeNativeInspector({ libraries: [] }), "L0");
  });

  it("T3-28 item 2: no arm64-v8a library fails L0", async () => {
    const { judgeNativeInspector } = await loadNative();
    expectRule(judgeNativeInspector({ libraries: release().filter((library) => library.abi !== "arm64-v8a") }), "L0");
  });

  it("T3-28 item 2: a library with a problem fails L0", async () => {
    const { judgeNativeInspector } = await loadNative();
    const libraries = release();
    find(libraries, OTHER_ARM).problems.push("not ELF64 little-endian");
    expectRule(judgeNativeInspector({ libraries }), "L0");
  });

  it("T3-28 item 2: packed relocations in the inspector library fail L0", async () => {
    const { judgeNativeInspector } = await loadNative();
    const libraries = release();
    find(libraries, INSPECTOR_X86).packedRelocations = true;
    expectRule(judgeNativeInspector({ libraries }), "L0");
  });

  it("T3-28 item 2: packed relocations in a library that names no dispatcher pass", async () => {
    const { judgeNativeInspector } = await loadNative();
    const libraries = release();
    expect(find(libraries, "lib/arm64-v8a/libexpo-modules-v2.so").packedRelocations, "the release cut records libexpo-modules-v2.so as packed").toBe(true);
    find(libraries, OTHER_ARM).packedRelocations = true;
    expect(judgeNativeInspector({ libraries })).toEqual([]);
  });

  it("T3-28 item 2: no library defining the dispatcher in one ABI fails L1", async () => {
    const { judgeNativeInspector } = await loadNative();
    const libraries = release();
    const inspector = find(libraries, INSPECTOR_X86);
    inspector.symbols = inspector.symbols.filter((symbol) => !symbol.name.startsWith(DISPATCHER_PREFIX));
    expectRule(judgeNativeInspector({ libraries }), "L1");
  });

  it("T3-28 item 2: two libraries defining the dispatcher in one ABI fail L1", async () => {
    const { judgeNativeInspector } = await loadNative();
    const libraries = release();
    find(libraries, OTHER_ARM).symbols.push(func(DISPATCHER_NAME));
    expectRule(judgeNativeInspector({ libraries }), "L1");
  });

  it.each([
    ["not FUNC", { type: "OBJECT" }],
    ["not GLOBAL", { bind: "WEAK" }],
    ["not DEFAULT", { visibility: "HIDDEN" }],
  ])("T3-28 item 2: a dispatcher symbol that is %s fails L1", async (_label, change) => {
    const { judgeNativeInspector } = await loadNative();
    const libraries = release();
    Object.assign(dispatcherSymbol(libraries, INSPECTOR_ARM), change);
    expectRule(judgeNativeInspector({ libraries }), "L1");
  });

  it("T3-28 item 2: a loader symbol that is not defined fails L1", async () => {
    const { judgeNativeInspector } = await loadNative();
    const libraries = release();
    loaderSymbol(libraries, INSPECTOR_ARM).defined = false;
    expectRule(judgeNativeInspector({ libraries }), "L1");
  });

  it("T3-28 item 2: a missing loader symbol fails L1", async () => {
    const { judgeNativeInspector } = await loadNative();
    const libraries = release();
    const inspector = find(libraries, INSPECTOR_ARM);
    inspector.symbols = inspector.symbols.filter((symbol) => !symbol.name.startsWith(LOADER_PREFIX));
    expectRule(judgeNativeInspector({ libraries }), "L1");
  });

  it("T3-28 item 2: no relocation naming the loader fails L1", async () => {
    const { judgeNativeInspector } = await loadNative();
    const libraries = release();
    find(libraries, INSPECTOR_X86).relocations = [];
    expectRule(judgeNativeInspector({ libraries }), "L1");
  });

  it("T3-28 item 2: no always-present string in the inspector library fails L1", async () => {
    const { judgeNativeInspector } = await loadNative();
    const libraries = release();
    find(libraries, INSPECTOR_ARM).markers = [];
    expectRule(judgeNativeInspector({ libraries }), "L1");
  });
});

// --- item 2: the step and the command -------------------------------------------------------------------------

describe("T3-28 item 2: pnpm tv:apk:check runs the native inspector check and the command prints one line", () => {
  it("T3-28 item 2: package.json's tv:apk:check runs the native inspector script after the four existing steps", () => {
    const pkg = JSON.parse(readFileSync(join(repo, "package.json"), "utf8")) as { scripts: Record<string, string> };
    const steps = (pkg.scripts["tv:apk:check"] ?? "").split("&&").map((step) => step.trim());
    const native = steps.indexOf("node scripts/tv-apk-native-inspector.mjs");
    expect(native, pkg.scripts["tv:apk:check"]).toBeGreaterThan(-1);
    for (const earlier of ["node scripts/tv-apk-check.mjs", "node scripts/tv-apk-manifest.mjs", "node scripts/tv-apk-inspector.mjs", "node scripts/tv-apk-dex.mjs"]) {
      const at = steps.indexOf(earlier);
      expect(at, `tv:apk:check runs ${earlier}`).toBeGreaterThan(-1);
      expect(native, `the native inspector step runs after ${earlier}`).toBeGreaterThan(at);
    }
  });

  const temps: string[] = [];
  afterEach(() => {
    for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function apkWith(bytes: Buffer | null): string {
    const dir = mkdtempSync(join(tmpdir(), "octave-t3-28-native-"));
    temps.push(dir);
    const apk = join(dir, "app-release.apk");
    if (bytes !== null) writeFileSync(apk, bytes);
    return apk;
  }

  function run(apk: string) {
    return spawnSync(process.execPath, [SCRIPT, apk], { cwd: repo, encoding: "utf8", timeout: 60_000 });
  }

  const NO_STACK = /\n\s+at /;

  it("T3-28 item 2: on an APK whose library holds the anchors and no caller, it exits 0 with one stdout line", () => {
    const apk = apkWith(zipStored([{ name: INSPECTOR_ARM, data: buildElf(releaseLibrary()) }]));
    const child = run(apk);
    expect(child.status, child.stderr).toBe(0);
    expect(child.stderr).toBe("");
    const lines = child.stdout.split("\n").filter((line) => line !== "");
    expect(lines, child.stdout).toHaveLength(1);
    expect(lines[0].startsWith("tv native inspector: "), lines[0]).toBe(true);
    expect(lines[0]).toContain("passes");
  });

  it("T3-28 item 2: on an APK whose library holds a dispatcher relocation, it exits non-zero with an L2 line and no stdout", () => {
    const apk = apkWith(zipStored([{ name: INSPECTOR_ARM, data: buildElf(releaseLibrary({ relocations: [{ section: ".rela.plt", name: DISPATCHER_NAME }] })) }]));
    const child = run(apk);
    expect(child.status, child.stderr).not.toBe(0);
    expect(child.stderr).toMatch(/^ERROR tv native inspector: L2/m);
    expect(child.stdout).toBe("");
  });

  it.each([
    ["a missing APK", () => apkWith(null)],
    ["a file that is not a zip", () => apkWith(Buffer.from("this is not a zip file\n".repeat(8)))],
    ["a zip with no lib/ entry", () => apkWith(zipStored([{ name: "classes.dex", data: Buffer.from("dex\n039\0") }]))],
    ["a zip whose .so is not ELF", () => apkWith(zipStored([{ name: INSPECTOR_ARM, data: Buffer.from("not an ELF library\n".repeat(8)) }]))],
  ])("T3-28 item 2: on %s, it exits non-zero with an ERROR line, no stdout and no stack trace", (_label, make) => {
    const child = run(make());
    expect(child.status, child.stderr).not.toBe(0);
    expect(child.status).not.toBeNull();
    expect(child.stderr).toMatch(/^ERROR tv native inspector: /m);
    expect(child.stdout).toBe("");
    expect(child.stderr).not.toMatch(NO_STACK);
  });
});
