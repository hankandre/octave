// T3-19 test support (frozen): runs scripts/tv-apk-dex.mjs's main(args, system) on the dex fixtures with a fake
// dexdump and a small APK built here, so the frozen tests need no Android SDK.
//
// The interface these frozen tests hold (spec, Approach "Shape" and "Why the frozen dex tests use their own lists"):
// - main(args, system) in scripts/tv-apk-dex.mjs: args is [apk, mapping]. system is { dexdump, lists, stdout, stderr }:
//   `dexdump` is the path of the dexdump executable, run as `dexdump -d <apk>`; `lists` is the lists object
//   ({ sinks, libraryInternal, entryPoints, hooks, oneClient, devSupportCallers, absentPackages }); `stdout` and
//   `stderr` are objects with write(text). main writes its lines there (never through console or process.exit) and
//   returns, or resolves to, the exit code: 0 when the APK passes, 1 when it does not.
// - Each finding is a line `ERROR tv apk dex: …`; a pass is one line `tv apk dex: <apk> passes (…)`.
// - scripts/tv-apk-dex-lists.mjs exports NETWORK_SINKS (rows with an `id`, S1 to S6), LIBRARY_INTERNAL,
//   ONE_CLIENT_CLASSES, APK_NETWORK_ENTRY_POINTS ({ id, classes, sinks, what, reason, linkedPath }), ENTRY_POINT_HOOKS
//   (fully qualified class names), DEV_SUPPORT_CLIENT_CALLERS ({ class, offInRelease }), ABSENT_PACKAGES (Java package
//   prefixes ending in "."), KEPT_EXPO_MODULES ({ package, reason, evidence }), SOURCE_ONLY_LINKED_PATHS ({ id, reason })
//   and PRODUCTION_LISTS.
// - The fake dexdump prints the composed dump with the fixture's APK path replaced by the APK it was given.
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { crc32, deflateRawSync } from "node:zlib";

export const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
export const FIXTURES = join(repo, "scripts", "fixtures", "tv", "dex");
const FIXTURE_APK = "apps/tv/android/app/build/outputs/apk/release/app-release.apk";

export const PG_MAP_ID = "c316ccec17af5cb29d9c92451cf5f9f80d95458c0e4ff0c51bcd115f2ee01a1e";
export const r8Marker = (id = PG_MAP_ID) =>
  `~~R8{"backend":"dex","compilation-mode":"release","has-checksums":false,"min-api":24,"pg-map-id":"${id}","r8-mode":"full","version":"9.2.14"}`;

export type Lists = Record<string, unknown>;
type Writer = { write(text: string): unknown };
export type DexSystem = { dexdump: string; lists: Lists; stdout: Writer; stderr: Writer };
type DexModule = { main(args: string[], system?: DexSystem): number | Promise<number> };

export async function loadDex(): Promise<DexModule> {
  return (await import(pathToFileURL(join(repo, "scripts", "tv-apk-dex.mjs")).href)) as DexModule;
}

export async function loadProductionLists(): Promise<Record<string, unknown>> {
  return (await import(pathToFileURL(join(repo, "scripts", "tv-apk-dex-lists.mjs")).href)) as Record<string, unknown>;
}

export async function loadFixtureLists(): Promise<{ FIXTURE_LISTS: Lists; FIXTURE_ENTRY_POINTS: Lists[]; FIXTURE_DEV_SUPPORT_CALLERS: Lists[] }> {
  return (await import(pathToFileURL(join(FIXTURES, "lists.mjs")).href)) as {
    FIXTURE_LISTS: Lists;
    FIXTURE_ENTRY_POINTS: Lists[];
    FIXTURE_DEV_SUPPORT_CALLERS: Lists[];
  };
}

// Drops the fixture's leading `#` provenance lines.
function stripHeader(text: string): string {
  const lines = text.split("\n");
  let i = 0;
  while (i < lines.length && lines[i].startsWith("#")) i += 1;
  return lines.slice(i).join("\n");
}

const read = (path: string) => readFileSync(join(FIXTURES, path), "utf8");
const withNewline = (text: string) => (text.endsWith("\n") ? text : `${text}\n`);

/** release-dump.txt with the named extra class blocks (extra/<name>.dump.txt) appended. */
export function composeDump(extras: string[] = []): string {
  return [stripHeader(read("release-dump.txt")), ...extras.map((name) => stripHeader(read(join("extra", `${name}.dump.txt`))))].map(withNewline).join("");
}

/** release-mapping.txt as cut (its R8 header kept) with the named extra sections (extra/<name>.mapping.txt) appended. */
export function composeMapping(extras: string[] = []): string {
  return [read("release-mapping.txt"), ...extras.map((name) => stripHeader(read(join("extra", `${name}.mapping.txt`))))].map(withNewline).join("");
}

/** The bytes of a dex file that holds the R8 marker string; dexdump is faked, so the rest is filler. */
export function dexBytes(marker: string | null = r8Marker()): Buffer {
  const head = Buffer.concat([Buffer.from("dex\n037\0", "latin1"), Buffer.alloc(104)]);
  if (marker === null) return Buffer.concat([head, Buffer.from("\u0005hello\0", "latin1")]);
  const text = Buffer.from(marker, "utf8");
  const length: number[] = [];
  for (let n = text.length; ; n >>>= 7) {
    if (n < 0x80) {
      length.push(n);
      break;
    }
    length.push((n & 0x7f) | 0x80);
  }
  return Buffer.concat([head, Buffer.from(length), text, Buffer.from([0]), Buffer.alloc(16)]);
}

export type ZipEntry = { name: string; data: Buffer; deflate?: boolean };

/** A minimal zip (local headers, central directory, end record), stored or deflated per entry. */
export function zip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const body = entry.deflate ? deflateRawSync(entry.data) : entry.data;
    const crc = crc32(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(entry.deflate ? 8 : 0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(entry.deflate ? 8 : 0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, body);
    centrals.push(central, name);
    offset += local.length + name.length + body.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, directory, end]);
}

export const RELEASE_APK_ENTRIES: ZipEntry[] = [
  { name: "AndroidManifest.xml", data: Buffer.from("not read by the dex check") },
  { name: "classes.dex", data: dexBytes(), deflate: true },
];

export type DexCase = {
  dump?: string;
  mapping?: string;
  apkEntries?: ZipEntry[];
  dexdumpExit?: number;
  lists?: Lists;
  noApk?: boolean;
  noMapping?: boolean;
};

export type DexRun = { code: number; out: string; dexdumpArgs: string[] | null };

const temps: string[] = [];
export function cleanTemps(): void {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/** Runs main([apk, mapping], system) on one case. Defaults: the release excerpt, its APK and the fixture lists. */
export async function runDex(c: DexCase = {}): Promise<DexRun> {
  const dir = mkdtempSync(join(tmpdir(), "octave-tv-apk-dex-"));
  temps.push(dir);
  const apk = join(dir, "app-release.apk");
  const mapping = join(dir, "mapping.txt");
  const dumpFile = join(dir, "dump.txt");
  const log = join(dir, "dexdump-args.json");
  const dexdump = join(dir, "dexdump");
  if (!c.noApk) writeFileSync(apk, zip(c.apkEntries ?? RELEASE_APK_ENTRIES));
  if (!c.noMapping) writeFileSync(mapping, c.mapping ?? composeMapping());
  writeFileSync(dumpFile, c.dump ?? composeDump());
  writeFileSync(
    dexdump,
    [
      `#!${process.execPath}`,
      'const { readFileSync, writeFileSync } = require("node:fs");',
      "const args = process.argv.slice(2);",
      `writeFileSync(${JSON.stringify(log)}, JSON.stringify(args));`,
      'const apk = args.find((arg) => arg.endsWith(".apk")) ?? "";',
      `process.stdout.write(readFileSync(${JSON.stringify(dumpFile)}, "utf8").split(${JSON.stringify(FIXTURE_APK)}).join(apk));`,
      `process.exitCode = ${c.dexdumpExit ?? 0};`,
      "",
    ].join("\n"),
  );
  chmodSync(dexdump, 0o755);
  const lists = c.lists ?? (await loadFixtureLists()).FIXTURE_LISTS;
  let out = "";
  const writer = { write: (text: string) => ((out += String(text)), true) };
  const { main } = await loadDex();
  const code = await main([apk, mapping], { dexdump, lists, stdout: writer, stderr: writer });
  let dexdumpArgs: string[] | null = null;
  try {
    dexdumpArgs = JSON.parse(readFileSync(log, "utf8")) as string[];
  } catch {
    dexdumpArgs = null;
  }
  return { code, out, dexdumpArgs };
}
