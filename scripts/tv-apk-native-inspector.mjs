// Checks that no native library of the release APK is wired to call the C++ inspector's network dispatcher (T3-28,
// docs/specs/T3-28.md). NetworkIOAgent::handleRequest is the one C++ route from a debugger's Network.loadNetworkResource
// message to ReactHostImpl.loadNetworkResource, and only a library compiled with REACT_NATIVE_DEBUGGER_ENABLED calls it.
// Rules: L0 every library is readable; L1 the anchors that show the reading works are there; L2 nothing calls the
// dispatcher; L3 no library holds a string only the debugger-enabled HostAgent holds.
// Run: node scripts/tv-apk-native-inspector.mjs [apk]   (the last step of pnpm tv:apk:check)
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { RELEASE_APK } from "./tv-apk-check.mjs";
import { hasBytes, readElf } from "./tv-elf.mjs";
import { readZipEntries } from "./tv-zip.mjs";
import { hideHostPaths, shownPath } from "./tv-host-paths.mjs";

export const DISPATCHER = "_ZN8facebook5react18jsinspector_modern14NetworkIOAgent13handleRequestE";
export const LOADER = "_ZN8facebook5react18jsinspector_modern14NetworkIOAgent25handleLoadNetworkResourceE";
export const DEBUGGER_ONLY_MARKERS = ["React Native DevTools"];
export const ALWAYS_PRESENT_MARKER = "is not implemented by this host target delegate";

const PREFIX = "ERROR tv native inspector:";
const LIBRARY = /^lib\/([^/]+)\/([^/]+\.so)$/;
const MAX_NAMED = 20;
const REDERIVE = "if React Native changed, re-derive the reading as docs/specs/T3-28.md does";

const isDispatcher = (name) => name.startsWith(DISPATCHER);
const isLoader = (name) => name.startsWith(LOADER);
const isExportedFunction = (symbol) => symbol.defined && symbol.type === "FUNC" && symbol.bind === "GLOBAL" && symbol.visibility === "DEFAULT";

/** Reads one `lib/<abi>/<name>.so` entry into the facts the judge needs; symbols and relocations cut to the two names. */
export function readLibraryFacts(entryName, bytes) {
  const match = LIBRARY.exec(entryName);
  const elf = readElf(bytes);
  const named = (name) => isDispatcher(name) || isLoader(name);
  return {
    entry: entryName,
    abi: match?.[1] ?? "",
    name: match?.[2] ?? entryName,
    problems: elf.problems,
    packedRelocations: elf.packedRelocations,
    symbols: elf.symbols.filter((symbol) => named(symbol.name)),
    relocations: elf.relocations.filter((relocation) => named(relocation.name)),
    markers: [...DEBUGGER_ONLY_MARKERS, ALWAYS_PRESENT_MARKER].filter((marker) => hasBytes(bytes, marker)),
  };
}

function capped(rule, lines, what) {
  const out = lines.slice(0, MAX_NAMED);
  if (lines.length > MAX_NAMED) out.push(`${PREFIX} ${rule} and ${lines.length - MAX_NAMED} more ${what}`);
  return out;
}

/** Applies L0 to L3 to `{ libraries }`; returns `ERROR tv native inspector: <rule> …` lines, empty on a pass. */
export function judgeNativeInspector({ libraries }) {
  const l0 = [];
  const l1 = [];
  const l2 = [];
  const l3 = [];

  if (libraries.length === 0) l0.push(`${PREFIX} L0 the APK holds no lib/<abi>/<name>.so entry`);
  const abis = [...new Set(libraries.map((library) => library.abi))].sort();
  if (libraries.length > 0 && !abis.includes("arm64-v8a")) l0.push(`${PREFIX} L0 no lib/arm64-v8a/ library; the ABIs are ${abis.join(", ")}`);
  for (const library of libraries) {
    for (const problem of library.problems) l0.push(`${PREFIX} L0 ${library.entry} cannot be read: ${problem}`);
    if (library.packedRelocations && library.symbols.some((symbol) => isDispatcher(symbol.name))) {
      l0.push(`${PREFIX} L0 ${library.entry} names the dispatcher and has a packed relocation section, which this check cannot read`);
    }
  }

  for (const abi of abis) {
    const definers = libraries.filter((library) => library.abi === abi && library.symbols.some((symbol) => symbol.defined && isDispatcher(symbol.name)));
    if (definers.length !== 1) {
      const which = definers.length === 0 ? "no library" : definers.map((library) => library.entry).join(" and ");
      l1.push(`${PREFIX} L1 in ${abi}, ${which} defines NetworkIOAgent::handleRequest, where exactly one should; ${REDERIVE}`);
      continue;
    }
    const inspector = definers[0];
    for (const [label, test] of [
      ["NetworkIOAgent::handleRequest", isDispatcher],
      ["NetworkIOAgent::handleLoadNetworkResource", isLoader],
    ]) {
      const symbols = inspector.symbols.filter((symbol) => test(symbol.name));
      if (symbols.length === 0 || !symbols.every(isExportedFunction)) {
        l1.push(`${PREFIX} L1 ${inspector.entry} does not define ${label} as a FUNC GLOBAL DEFAULT symbol; ${REDERIVE}`);
      }
    }
    if (!inspector.relocations.some((relocation) => isLoader(relocation.name))) {
      l1.push(`${PREFIX} L1 ${inspector.entry} holds no relocation naming NetworkIOAgent::handleLoadNetworkResource, so a call to the dispatcher may not show as one; ${REDERIVE}`);
    }
    if (!inspector.markers.includes(ALWAYS_PRESENT_MARKER)) {
      l1.push(`${PREFIX} L1 ${inspector.entry} does not hold the string "${ALWAYS_PRESENT_MARKER}"; ${REDERIVE}`);
    }
  }

  for (const library of libraries) {
    for (const relocation of library.relocations.filter((candidate) => isDispatcher(candidate.name))) {
      l2.push(`${PREFIX} L2 ${library.entry} ${relocation.section} holds a relocation naming NetworkIOAgent::handleRequest: the C++ inspector can dispatch Network.loadNetworkResource`);
    }
    if (library.symbols.some((symbol) => !symbol.defined && isDispatcher(symbol.name))) {
      l2.push(`${PREFIX} L2 ${library.entry} imports NetworkIOAgent::handleRequest from another library`);
    }
    for (const marker of library.markers.filter((candidate) => DEBUGGER_ONLY_MARKERS.includes(candidate))) {
      l3.push(`${PREFIX} L3 ${library.entry} holds "${marker}", a string only the debugger-enabled HostAgent holds`);
    }
  }

  return [
    ...capped("L0", l0, "unreadable libraries"),
    ...capped("L1", l1, "missing anchors"),
    ...capped("L2", l2, "dispatcher callers"),
    ...capped("L3", l3, "debugger-only strings"),
  ];
}

/** The command. Returns the exit code. */
export function main(args = [], system = {}) {
  const stdout = system.stdout ?? process.stdout;
  const stderr = system.stderr ?? process.stderr;
  const apk = args[0] ?? RELEASE_APK;
  if (!existsSync(apk)) {
    stderr.write(`${PREFIX} no APK at ${shownPath(apk)}; run pnpm tv:prebuild and pnpm tv:build first\n`);
    return 1;
  }
  let entries;
  try {
    entries = readZipEntries(apk, (name) => LIBRARY.test(name));
  } catch (error) {
    stderr.write(`${PREFIX} L0 ${shownPath(apk)} cannot be read as a zip: ${hideHostPaths(error instanceof Error ? error.message : String(error))}\n`);
    return 1;
  }
  const libraries = entries.map((entry) => readLibraryFacts(entry.name, entry.bytes));
  const errors = judgeNativeInspector({ libraries });
  if (errors.length > 0) {
    for (const line of errors) stderr.write(`${line}\n`);
    return 1;
  }
  const abis = new Set(libraries.map((library) => library.abi));
  const inspectors = [...new Set(libraries.filter((library) => library.symbols.some((symbol) => symbol.defined && isDispatcher(symbol.name))).map((library) => library.name))];
  stdout.write(
    `tv native inspector: ${shownPath(apk)} passes (${libraries.length} libraries in ${abis.size} ABIs; ${inspectors.join(", ")} defines the C++ inspector's network dispatcher in each and nothing calls it; no debugger-only string)\n`,
  );
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
