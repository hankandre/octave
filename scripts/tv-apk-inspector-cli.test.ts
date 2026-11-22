// @vitest-environment node
// T3-28 item 4 (docs/specs/T3-28.md, "The recorded APK for item 4"): runs the tv-apk-inspector command,
// `node scripts/tv-apk-inspector.mjs <apk> [mapping]`, on a recorded APK and asserts its summary line, so N1 to N4 no
// longer rest on quoted manual runs (backlog entry 200).
//
// The recorded APK: from scripts/fixtures/tv/inspector/release-build.json or debug-build.json (T3-16's recordings), a
// temporary directory gets
// - the APK, a stored zip with one entry per recorded marker object, named by its `dex` and holding its `marker` string
//   (or bytes with no `~~` marker when `marker` is null); the command reads markers from the bytes, not a parsed dex;
// - a replay file, one `Opened '<entry>', DEX version '039'` line per dex entry zipped, then one
//   `Class descriptor  : '<descriptor>'` line per recorded descriptor;
// - an SDK whose build-tools/1.0.0/dexdump is a /bin/sh script that cats the replay file, as
//   scripts/tv-apk-manifest.test.ts does for aapt2. The command is spawned with ANDROID_HOME set to it and
//   ANDROID_SDK_ROOT removed.
// The mapping, where the recording has one, is its text in a file passed as the second argument.
//
// scripts/tv-apk-inspector.mjs is not changed by T3-28, so these tests pass before the implement step; the manifest
// records item 4 as a met gate and names this file's command as its evidence.
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { zipStored } from "./fixtures/tv/native/elf";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(repo, "scripts", "tv-apk-inspector.mjs");

type Recording = { descriptors: string[]; markers: { dex: string; marker: string | null }[]; mapping: string | null };
const recording = (name: string): Recording => JSON.parse(readFileSync(join(repo, "scripts", "fixtures", "tv", "inspector", name), "utf8")) as Recording;

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

type Options = { extraDescriptors?: string[]; extraMappingLines?: string[]; withMapping?: boolean };

/** Writes the recorded APK, the replay file, the fake SDK and the mapping; spawns the command on them. */
function runRecorded(rec: Recording, options: Options = {}) {
  const dir = mkdtempSync(join(tmpdir(), "octave-t3-28-inspector-"));
  temps.push(dir);
  const apk = join(dir, "app-release.apk");
  writeFileSync(
    apk,
    zipStored(rec.markers.map(({ dex, marker }) => ({ name: dex, data: Buffer.from(marker ?? "dex\n039\0 a dex with no marker", "utf8") }))),
  );

  const replay = join(dir, "dexdump.txt");
  const opened = rec.markers.map(({ dex }) => `Opened '${dex}', DEX version '039'`);
  const descriptors = [...rec.descriptors, ...(options.extraDescriptors ?? [])].map((descriptor) => `  Class descriptor  : '${descriptor}'`);
  writeFileSync(replay, `${[...opened, ...descriptors].join("\n")}\n`);

  const tools = join(dir, "sdk", "build-tools", "1.0.0");
  mkdirSync(tools, { recursive: true });
  const dexdump = join(tools, "dexdump");
  writeFileSync(dexdump, `#!/bin/sh\ncat '${replay}'\nexit 0\n`);
  chmodSync(dexdump, 0o755);

  const args = [SCRIPT, apk];
  if (options.withMapping !== false && rec.mapping !== null) {
    const mapping = join(dir, "mapping.txt");
    const extra = options.extraMappingLines ?? [];
    writeFileSync(mapping, extra.length > 0 ? `${rec.mapping.replace(/\n?$/, "\n")}${extra.join("\n")}\n` : rec.mapping);
    args.push(mapping);
  }

  const env: NodeJS.ProcessEnv = { ...process.env, ANDROID_HOME: join(dir, "sdk") };
  delete env.ANDROID_SDK_ROOT;
  return spawnSync(process.execPath, args, { cwd: repo, encoding: "utf8", env, timeout: 60_000 });
}

const SUMMARY = (classes: number) =>
  new RegExp(`^tv inspector: .* passes \\(1 dex, ${classes} classes, R8 release with its mapping; no class of expo\\.modules\\.kotlin\\.devtools, .* kept or renamed\\)$`);

describe("T3-28 item 4: the tv-apk-inspector command on a recorded APK", () => {
  it("T3-28 item 4: the release recording with its mapping exits 0 and prints the one summary line", () => {
    const rec = recording("release-build.json");
    expect(rec.markers).toHaveLength(1);
    const child = runRecorded(rec);
    expect(child.status, child.stderr).toBe(0);
    expect(child.stderr).toBe("");
    const lines = child.stdout.split("\n").filter((line) => line !== "");
    expect(lines, child.stdout).toHaveLength(1);
    // The class count is the recording's sample size, not the build's.
    expect(lines[0]).toMatch(SUMMARY(rec.descriptors.length));
  });

  it("T3-28 item 4: the debug recording, APK only, exits non-zero with N1, N2 and N3 lines and no stdout", () => {
    const rec = recording("debug-build.json");
    expect(rec.mapping).toBeNull();
    const child = runRecorded(rec, { withMapping: false });
    expect(child.status, child.stderr).not.toBe(0);
    expect(child.stdout).toBe("");
    for (const id of ["N1", "N2", "N3"]) expect(child.stderr, id).toMatch(new RegExp(`^ERROR tv inspector: ${id}\\b`, "m"));
  });

  it("T3-28 item 4: the release recording with a planted expo.modules.kotlin.devtools descriptor fails N3", () => {
    const child = runRecorded(recording("release-build.json"), { extraDescriptors: ["Lexpo/modules/kotlin/devtools/ExpoRequestInterceptor;"] });
    expect(child.status, child.stderr).not.toBe(0);
    expect(child.stderr).toMatch(/^ERROR tv inspector: N3\b/m);
  });

  it("T3-28 item 4: the release recording with a planted mapping line naming expo.modules.kotlin.devtools fails N4", () => {
    const child = runRecorded(recording("release-build.json"), {
      extraMappingLines: ["expo.modules.kotlin.devtools.ExpoRequestInterceptor -> a.b.c:"],
    });
    expect(child.status, child.stderr).not.toBe(0);
    expect(child.stderr).toMatch(/^ERROR tv inspector: N4\b/m);
  });
});
