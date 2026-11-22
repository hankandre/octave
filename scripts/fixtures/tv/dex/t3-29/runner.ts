// T3-29 test support (frozen): runs scripts/tv-apk-dex.mjs's main(args, system) for the cases the frozen T3-19
// harness's runDex cannot make: raw APK bytes (a cut or damaged zip), a `repoRoot` for rule D8, and a dump or mapping
// judged alone (the as-built DirectSocketFactory fixture). It writes its own temp APK, mapping, dump and fake dexdump,
// and takes `zip`, `dexBytes`, `composeDump` and `composeMapping` from the frozen harness (re-exported here).
//
// The interface these tests hold (docs/specs/T3-29.md, Test plan): main(args, system) takes an optional
// `system.repoRoot`, the root whose module source rule D8 reads; without it D8 reads this repository. main never throws
// for an APK's content: it resolves to 1 with one `ERROR tv apk dex: … truncated or damaged …; run pnpm tv:build …`
// line. The runner still catches a throw and returns it, so a test fails on its assertion and not on a rejection.
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { composeDump, composeMapping, dexBytes, r8Marker, repo, zip, type ZipEntry } from "../harness";

export { composeDump, composeMapping, dexBytes, r8Marker, repo, zip, type ZipEntry };

export const T3_29_FIXTURES = dirname(fileURLToPath(import.meta.url));

type Writer = { write(text: string): unknown };
type Lists = Record<string, unknown>;
type DexMain = (args: string[], system: { dexdump: string; lists: Lists; stdout: Writer; stderr: Writer; repoRoot?: string }) => number | Promise<number>;

export type RawCase = {
  /** The APK's bytes as written to disk; a damaged zip is fine. */
  apk: Buffer;
  /** The mapping file's text. */
  mapping: string;
  /** What the fake dexdump prints, `#` header lines already stripped; `{apk}` is replaced by the APK's path. */
  dump: string;
  lists: Lists;
  repoRoot?: string;
  dexdumpExit?: number;
};

export type RawRun = { code: number | null; out: string; threw: unknown };

const temps: string[] = [];
export function cleanRunnerTemps(): void {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
}

export function tempDir(prefix = "octave-t3-29-"): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

/** Drops leading `#` provenance lines (the frozen harness's rule, which it does not export). */
export function stripHeader(text: string): string {
  const lines = text.split("\n");
  let i = 0;
  while (i < lines.length && lines[i].startsWith("#")) i += 1;
  return lines.slice(i).join("\n");
}

/** The two lines dexdump prints before the first class, with `{apk}` for the APK path. */
export const DUMP_PREAMBLE = "Processing '{apk}'...\nOpened '{apk}', DEX version '037'\n";

export async function loadProductionLists(): Promise<Record<string, unknown>> {
  return (await import(pathToFileURL(join(repo, "scripts", "tv-apk-dex-lists.mjs")).href)) as Record<string, unknown>;
}

export async function runRaw(c: RawCase): Promise<RawRun> {
  const dir = tempDir();
  const apk = join(dir, "app-release.apk");
  const mapping = join(dir, "mapping.txt");
  const dumpFile = join(dir, "dump.txt");
  const dexdump = join(dir, "dexdump");
  writeFileSync(apk, c.apk);
  writeFileSync(mapping, c.mapping);
  writeFileSync(dumpFile, c.dump);
  writeFileSync(
    dexdump,
    [
      `#!${process.execPath}`,
      'const { readFileSync } = require("node:fs");',
      'const apk = process.argv.slice(2).find((arg) => arg.endsWith(".apk")) ?? "";',
      `process.stdout.write(readFileSync(${JSON.stringify(dumpFile)}, "utf8").split("{apk}").join(apk));`,
      `process.exitCode = ${c.dexdumpExit ?? 0};`,
      "",
    ].join("\n"),
  );
  chmodSync(dexdump, 0o755);
  let out = "";
  const writer = { write: (text: string) => ((out += String(text)), true) };
  const { main } = (await import(pathToFileURL(join(repo, "scripts", "tv-apk-dex.mjs")).href)) as { main: DexMain };
  const system: Parameters<DexMain>[1] = { dexdump, lists: c.lists, stdout: writer, stderr: writer };
  if (c.repoRoot !== undefined) system.repoRoot = c.repoRoot;
  try {
    const code = await main([apk, mapping], system);
    return { code, out, threw: undefined };
  } catch (error) {
    return { code: null, out, threw: error ?? new Error("main threw") };
  }
}

export const readFixture = (name: string) => readFileSync(join(T3_29_FIXTURES, name), "utf8");
