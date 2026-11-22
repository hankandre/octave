// Checks the network fence on the built release APK (T3-19, docs/specs/T3-19.md): reads its dex through `dexdump -d`
// and R8's mapping, finds every instruction that can open a connection, attributes it to its original class, and fails
// when Octave's code holds one outside the one client (D1), when a class outside APK_NETWORK_ENTRY_POINTS holds one
// (D2), when a row is stale (D3), when Octave's code references a listed class (D4), when an excluded package is back
// (D5), when a class outside DEV_SUPPORT_CLIENT_CALLERS references DevSupportHttpClient (D6), when an Octave module's
// source declares a package outside dev.octave. (D8, T3-29; rule D8 is not the D8 dexer whose ~~D8 marker MARKER
// reads), or when the input is not whole (D0). It checks direct references, not a call graph.
// Run: node scripts/tv-apk-dex.mjs [apk] [mapping]   (the fourth step of pnpm tv:apk:check)
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";
import { inflateRawSync } from "node:zlib";
import { androidSdk, newestBuildTool } from "./tv-android-sdk.mjs";
import { PRODUCTION_LISTS } from "./tv-apk-dex-lists.mjs";
import { judgeDex } from "./tv-apk-dex-judge.mjs";
import { parseMapping, readMapping } from "./tv-apk-dex-mapping.mjs";
import { REPO_ROOT, foreignPackages, packageProblems } from "./octave-module-packages.mjs";

export { judgeDex, parseMapping };

export const RELEASE_APK = fileURLToPath(new URL("../apps/tv/android/app/build/outputs/apk/release/app-release.apk", import.meta.url));
export const RELEASE_MAPPING = fileURLToPath(new URL("../apps/tv/android/app/build/outputs/mapping/release/mapping.txt", import.meta.url));

const MARKER = /~~(R8|D8|L8)(\{[^}]*\})/g;

/**
 * Reads an APK's zip central directory and returns each `classes*.dex` entry with the compiler markers its bytes hold:
 * `{ dex: { name, markers: { tool, pgMapId }[] }[], problems: string[], damage: string | null }`. Every offset and length
 * is checked against the file before it is read (T3-29): a cut-short or damaged APK gives `damage`, what was wrong, and
 * no dex; it never throws for the file's content.
 */
export function readApkDex(apk) {
  const buf = readFileSync(apk);
  const damaged = (what) => ({ dex: [], problems: [], damage: what });
  const fits = (at, length) => at >= 0 && at + length <= buf.length;
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end === -1) return damaged("no zip end record");
  const count = buf.readUInt16LE(end + 10);
  const dirSize = buf.readUInt32LE(end + 12);
  let at = buf.readUInt32LE(end + 16);
  if (at + dirSize > end) return damaged("the central directory runs past the end record");
  const problems = [];
  const dex = [];
  for (let n = 0; n < count; n += 1) {
    if (!fits(at, 46) || buf.readUInt32LE(at) !== 0x02014b50) return damaged(`central header ${n + 1} of ${count} is missing`);
    const method = buf.readUInt16LE(at + 10);
    const compressedSize = buf.readUInt32LE(at + 20);
    const size = buf.readUInt32LE(at + 24);
    const nameLength = buf.readUInt16LE(at + 28);
    const extraLength = buf.readUInt16LE(at + 30);
    const commentLength = buf.readUInt16LE(at + 32);
    const local = buf.readUInt32LE(at + 42);
    if (!fits(at, 46 + nameLength + extraLength + commentLength)) return damaged(`central header ${n + 1} of ${count} is cut short`);
    const name = buf.toString("utf8", at + 46, at + 46 + nameLength);
    at += 46 + nameLength + extraLength + commentLength;
    if (!/^classes\d*\.dex$/.test(name)) continue;
    if (compressedSize === 0xffffffff || size === 0xffffffff || local === 0xffffffff) {
      problems.push(`${name} is a zip64 entry, which this check does not read`);
      continue;
    }
    if (!fits(local, 30) || buf.readUInt32LE(local) !== 0x04034b50) return damaged(`${name}'s local header is outside the file`);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    // The stored body is the compressed size (central +20); what it inflates to is the uncompressed size (+24).
    if (!fits(start, compressedSize)) return damaged(`${name}'s body is cut short`);
    const body = buf.subarray(start, start + compressedSize);
    let data;
    if (method === 0) data = body;
    else if (method === 8) {
      try {
        data = inflateRawSync(body);
      } catch {
        return damaged(`${name} does not inflate`);
      }
    } else {
      problems.push(`${name} uses zip method ${method}, which this check does not read`);
      continue;
    }
    if (data.length !== size) return damaged(`${name} holds ${data.length} bytes, but its entry says ${size}`);
    const markers = [];
    for (const m of data.toString("latin1").matchAll(MARKER)) {
      let fields = {};
      try {
        fields = JSON.parse(m[2]);
      } catch {
        fields = {};
      }
      markers.push({ tool: m[1], pgMapId: typeof fields["pg-map-id"] === "string" ? fields["pg-map-id"] : null });
    }
    dex.push({ name, markers });
  }
  return { dex, problems, damage: null };
}

/** Runs `dexdump -d <apk>` and returns its output as lines, and its exit code once it has finished. */
export function readDexDump(dexdump, apk) {
  const child = spawn(dexdump, ["-d", apk], { stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (text) => {
    if (stderr.length < 4000) stderr += text;
  });
  const exit = new Promise((resolve) => {
    child.on("error", (error) => resolve({ code: -1, stderr: error.message }));
    child.on("close", (code) => resolve({ code: code ?? -1, stderr }));
  });
  return { lines: createInterface({ input: child.stdout, crlfDelay: Infinity }), exit };
}

const defaultDexdump = () => newestBuildTool(androidSdk(), "dexdump");

// Rule D8 on this repository is read once per process: every run of main without a repoRoot reads the same source.
let repositoryPackages = null;
function d8Problems(repoRoot) {
  if (repoRoot !== undefined) return packageProblems(foreignPackages(repoRoot), repoRoot);
  repositoryPackages ??= packageProblems(foreignPackages(REPO_ROOT), REPO_ROOT);
  return repositoryPackages;
}

/**
 * The command. `system` carries what it reads and runs: { dexdump, lists, stdout, stderr, repoRoot }; the command line
 * cannot replace the lists. `repoRoot` is the root whose module source rule D8 reads (default: this repository).
 * Resolves to the exit code.
 */
export async function main(args = [], system = {}) {
  const stdout = system.stdout ?? process.stdout;
  const stderr = system.stderr ?? process.stderr;
  const lists = system.lists ?? PRODUCTION_LISTS;
  const [apk = RELEASE_APK, mappingPath = RELEASE_MAPPING] = args;
  const fail = (lines) => {
    for (const line of lines) stderr.write(`ERROR tv apk dex: ${line}\n`);
    return 1;
  };

  const missing = [];
  if (!existsSync(apk)) missing.push(`no release APK at ${apk}; run pnpm tv:build`);
  if (!existsSync(mappingPath)) missing.push(`no R8 mapping at ${mappingPath}; run pnpm tv:build, which writes it beside the APK`);
  if (missing.length > 0) return fail(missing);

  // D8: the dex check finds Octave's code by the dev.octave. prefix; a module outside it would be judged as a library.
  const d8 = d8Problems(system.repoRoot);
  if (d8.length > 0) {
    return fail(d8.map((problem) => `D8 ${problem}; the check finds Octave's code by that prefix and would judge this module as a library (a row, D2) instead of failing it (D1); move it under dev.octave.`));
  }

  // D0: a cut-short or damaged APK is one line, before any other rule adds to it.
  const damaged = (what) => fail([`${apk} is truncated or damaged (${what}); run pnpm tv:build to rebuild it`]);
  let apkDex;
  try {
    apkDex = readApkDex(apk);
  } catch (error) {
    return damaged(error instanceof Error ? error.message : String(error));
  }
  if (apkDex.damage !== null) return damaged(apkDex.damage);
  const errors = [...apkDex.problems];
  if (apkDex.dex.length === 0 && apkDex.problems.length === 0) errors.push(`${apk} holds no classes*.dex`);
  const mapping = await readMapping(mappingPath);
  if (!mapping.pgMapId) errors.push(`${mappingPath} has no pg_map_id line; it is not an R8 mapping`);
  for (const dex of apkDex.dex) {
    const r8 = dex.markers.filter((marker) => marker.tool === "R8");
    if (r8.length === 0) errors.push(`${dex.name} has no R8 marker; the APK was not minified by R8`);
    else if (r8.every((marker) => marker.pgMapId === null)) {
      errors.push(`${dex.name} has an R8 marker but no pg-map-id, so it cannot be matched to ${mappingPath}; run pnpm tv:build`);
    }
    for (const marker of dex.markers.filter((m) => m.pgMapId !== null)) {
      if (marker.pgMapId !== mapping.pgMapId) {
        errors.push(
          `${dex.name} was built with mapping ${marker.pgMapId}, but ${mappingPath} is ${mapping.pgMapId ?? "unnamed"}: the mapping is from another build (for example after pnpm tv:e2e:build); run pnpm tv:build`,
        );
      }
    }
  }
  if (errors.length > 0) return fail(errors);

  let dexdump;
  try {
    dexdump = system.dexdump ?? defaultDexdump();
  } catch (error) {
    return fail([error instanceof Error ? error.message : String(error)]);
  }
  const dump = readDexDump(dexdump, apk);
  const verdict = await judgeDex(dump.lines, mapping, lists);
  const exit = await dump.exit;
  if (exit.code !== 0) errors.push(`dexdump exited ${exit.code}${exit.stderr ? `: ${exit.stderr.trim().split("\n")[0]}` : ""}`);
  if (verdict.stats.opened !== apkDex.dex.length) {
    errors.push(`dexdump opened ${verdict.stats.opened} dex files, but the APK holds ${apkDex.dex.length} (${apkDex.dex.map((d) => d.name).join(", ")})`);
  }
  errors.push(...verdict.errors);
  if (errors.length > 0) return fail(errors);
  const { classes, sinkReferences, entryPoints, leftBeforeR8 } = verdict.stats;
  stdout.write(
    `tv apk dex: ${apk} passes (${classes} classes in ${apkDex.dex.length} dex files, ${sinkReferences} sink references in ${entryPoints} listed entry points, 0 in Octave's code outside the one client)\n`,
  );
  // Decision log 27: a reference to a merged class whose originals are partly listed is refused before R8 instead.
  stdout.write(
    `tv apk dex: ${leftBeforeR8} ${leftBeforeR8 === 1 ? "reference" : "references"} from Octave's code named a merged class with listed and unlisted originals; NetworkPathsBytecodeTest (pnpm tv:native:test) refuses a listed class in Octave's classes before R8\n`,
  );
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
