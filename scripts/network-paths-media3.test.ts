// @vitest-environment node
// T8-02 item 9 (docs/specs/T8-02.md, "Build fences"): apps/tv/native's NetworkPathsBytecodeTest runs compiled Media3
// samples in place of the descriptors T3-04 wrote by hand, and the RTSP and RTMP names it still probes by name carry
// the Media3 version they were re-read at. The Kotlin changes are not frozen (milestone 3); this file holds them.
//
// The contract frozen here (comments stripped before every scan):
// - samples/Media3Samples.kt exists in package dev.octave.buildcheck.samples and calls ExoPlayer.Builder five times
//   (its five constructors), DefaultMediaSourceFactory five times (its five), setMediaSourceFactory,
//   setDataSourceFactory, DefaultHttpDataSource.Factory(), DefaultDataSource.Factory( and UdpDataSource().
// - NetworkPathsBytecodeTest.kt names Media3Samples' compiled classes (an import from dev.octave.buildcheck.samples
//   whose class is declared in Media3Samples.kt), keeps media3_rules_by_descriptor, and holds no hand-written string
//   for the internal names androidx/media3/exoplayer/ExoPlayer$Builder, androidx/media3/exoplayer/source/
//   DefaultMediaSourceFactory or androidx/media3/datasource/UdpDataSource.
// - RtspMediaSource$Factory and RtmpDataSource$Factory stay as name probes, and the test holds
//   MEDIA3_NAMES_READ_AT = "1.11.1", equal to media3Version in modules/player/android/build.gradle, and compares it
//   with MediaLibraryInfo.VERSION.
// Where Media3Samples.kt's OkHttpDataSource.Factory sample sits, and whether it passes or fails K7 after the
// 2026-11-23 ruling, is left to the implementer (spec check issue 2), so nothing here names it.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = "apps/tv/native/app/src/test/java/dev/octave/buildcheck";
const TEST = `${dir}/NetworkPathsBytecodeTest.kt`;
const SAMPLES = `${dir}/samples/Media3Samples.kt`;
const GRADLE = "modules/player/android/build.gradle";

function read(path: string): string {
  expect(existsSync(join(repo, path)), `${path} exists`).toBe(true);
  return readFileSync(join(repo, path), "utf8");
}

const withoutComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, "");
const count = (text: string, pattern: RegExp) => (text.match(pattern) ?? []).length;

function media3Pin(): string {
  const match = /def\s+media3Version\s*=\s*['"]([^'"]+)['"]/.exec(withoutComments(read(GRADLE)));
  expect(match, `${GRADLE} has def media3Version`).not.toBeNull();
  return match?.[1] ?? "";
}

describe("T8-02 item 9: NetworkPathsBytecodeTest reads compiled Media3 samples", () => {
  it("T8-02 item 9: Media3Samples.kt calls every ExoPlayer.Builder and DefaultMediaSourceFactory constructor and the default sources", () => {
    const samples = withoutComments(read(SAMPLES));
    expect(samples).toMatch(/^\s*package\s+dev\.octave\.buildcheck\.samples\s*$/m);
    expect(count(samples, /\bExoPlayer\s*\.\s*Builder\s*\(/g), "ExoPlayer.Builder( calls").toBeGreaterThanOrEqual(5);
    expect(count(samples, /\bDefaultMediaSourceFactory\s*\(/g), "DefaultMediaSourceFactory( calls").toBeGreaterThanOrEqual(5);
    for (const call of [/\.\s*setMediaSourceFactory\s*\(/, /\.\s*setDataSourceFactory\s*\(/, /\bDefaultHttpDataSource\s*\.\s*Factory\s*\(\s*\)/, /\bDefaultDataSource\s*\.\s*Factory\s*\(/, /\bUdpDataSource\s*\(\s*\)/]) {
      expect(samples, `Media3Samples.kt calls ${call.source}`).toMatch(call);
    }
  });

  it("T8-02 item 9: the test names the compiled samples and keeps media3_rules_by_descriptor", () => {
    const test = withoutComments(read(TEST));
    const samples = withoutComments(read(SAMPLES));
    expect(test).toMatch(/@Test\s+fun media3_rules_by_descriptor\(\)/);
    const declared = [...samples.matchAll(/^\s*(?:(?:internal|private|public|open|abstract)\s+)*(?:class|object)\s+(\w+)/gm)].map((m) => m[1]);
    expect(declared.length, "Media3Samples.kt declares classes").toBeGreaterThan(0);
    const imported = [...test.matchAll(/^\s*import\s+dev\.octave\.buildcheck\.samples\.(\w+)/gm)].map((m) => m[1]);
    expect(imported.filter((name) => declared.includes(name)).length, "the test imports a class of Media3Samples.kt").toBeGreaterThan(0);
  });

  it("T8-02 item 9: the test holds no hand-written descriptor for ExoPlayer.Builder, DefaultMediaSourceFactory or UdpDataSource", () => {
    // A Kotlin string writes `$` as `\$`; read it as written.
    const test = withoutComments(read(TEST)).replace(/\\\$/g, "$");
    for (const name of ["androidx/media3/exoplayer/ExoPlayer$Builder", "androidx/media3/exoplayer/source/DefaultMediaSourceFactory", "androidx/media3/datasource/UdpDataSource"]) {
      expect(test, `NetworkPathsBytecodeTest.kt names ${name} by hand`).not.toContain(name);
    }
  });

  it("T8-02 item 9: RTSP and RTMP stay name probes stamped with the Media3 version they were re-read at", () => {
    const test = withoutComments(read(TEST));
    expect(test.replace(/\\\$/g, "$")).toContain("androidx/media3/exoplayer/rtsp/RtspMediaSource$Factory");
    expect(test.replace(/\\\$/g, "$")).toContain("androidx/media3/datasource/rtmp/RtmpDataSource$Factory");
    const stamp = /\bMEDIA3_NAMES_READ_AT\s*=\s*"([^"]+)"/.exec(test)?.[1];
    expect(stamp, "NetworkPathsBytecodeTest holds MEDIA3_NAMES_READ_AT").toBe("1.11.1");
    expect(stamp).toBe(media3Pin());
    expect(test).toMatch(/\bMediaLibraryInfo\s*\.\s*VERSION\b/);
  });
});
