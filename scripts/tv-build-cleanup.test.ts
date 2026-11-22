// @vitest-environment node
// T3-15 review (medium): a failed e2e build leaves no harness APK at the release path. buildTv runs here against a
// temporary tree and a fake Gradle that writes what the real one would before failing.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type TvBuildSystem, buildTv } from "./tv-build.mjs";

let root: string;

const put = (path: string, text: string) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};

// A system whose Gradle writes an APK and a bundle (with the harness marker when OCTAVE_E2E=1), then the given probe
// APKs, and exits with `status`. `bundle: false` writes no bundle.
function system({ status = 0, probes = ["session-debug-androidTest.apk"], bundle = true } = {}): TvBuildSystem {
  const s: TvBuildSystem = {
    prebuildIsCurrent: () => true,
    prebuild: () => 0,
    sourceHash: () => "hash",
    gradle: (_tasks, env) => {
      put(s.releaseApk, "apk");
      put(s.releaseMapping, "# pg_map_id: abc\n");
      if (bundle) put(join(s.bundleDir, "react", "release", "index.android.bundle"), env.OCTAVE_E2E === "1" ? "x OCTAVE_E2E x" : "x");
      for (const name of probes) put(join(s.probeBuildDir, name), "probe");
      return { status };
    },
    releaseApk: join(root, "android/app/build/outputs/apk/release/app-release.apk"),
    releaseMapping: join(root, "android/app/build/outputs/mapping/release/mapping.txt"),
    bundleDir: join(root, "android/app/build/generated/assets"),
    probeBuildDir: join(root, "modules/session/android/build/outputs/apk/androidTest/debug"),
    e2eApk: join(root, "dist/e2e/octave-tv-e2e.apk"),
    e2eMapping: join(root, "dist/e2e/octave-tv-e2e.mapping.txt"),
    e2eStamp: join(root, "dist/e2e/octave-tv-e2e.hash"),
    probeApk: join(root, "dist/e2e/octave-session-probe.apk"),
  };
  return s;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "octave-tv-build-"));
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

describe("a failed e2e build", () => {
  it("removes the release APK when Gradle fails after assembleRelease (the probe task failed)", () => {
    const s = system({ status: 1 });
    expect(buildTv({ e2e: true }, s)).toEqual(["ERROR tv build: Gradle exited with 1"]);
    expect(existsSync(s.releaseApk)).toBe(false);
    expect(existsSync(s.e2eApk)).toBe(false);
  });

  it("removes the release APK when Gradle writes more than one probe APK", () => {
    const s = system({ probes: ["a.apk", "b.apk"] });
    const errors = buildTv({ e2e: true }, s);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/expected one probe APK .*found 2$/);
    expect(existsSync(s.releaseApk)).toBe(false);
    expect(existsSync(s.e2eApk)).toBe(false);
    expect(existsSync(s.e2eStamp)).toBe(false);
  });

  it("removes the release APK when Gradle writes no probe APK", () => {
    const s = system({ probes: [] });
    expect(buildTv({ e2e: true }, s)[0]).toMatch(/found 0$/);
    expect(existsSync(s.releaseApk)).toBe(false);
  });

  it("removes the release APK when no bundle is found", () => {
    const s = system({ bundle: false });
    expect(buildTv({ e2e: true }, s)[0]).toMatch(/expected one index\.android\.bundle/);
    expect(existsSync(s.releaseApk)).toBe(false);
  });
});

describe("builds that succeed", () => {
  it("moves the e2e APK and the probe APK out of the build tree and stamps them", () => {
    const s = system();
    expect(buildTv({ e2e: true }, s)).toEqual([]);
    expect(existsSync(s.releaseApk)).toBe(false);
    expect(readFileSync(s.e2eApk, "utf8")).toBe("apk");
    expect(readFileSync(s.probeApk, "utf8")).toBe("probe");
    expect(readFileSync(s.e2eStamp, "utf8")).toBe("hash\n");
    expect(existsSync(s.releaseMapping)).toBe(false);
    expect(readFileSync(s.e2eMapping, "utf8")).toBe("# pg_map_id: abc\n");
  });

  it("leaves a release build at the release path", () => {
    const s = system({ probes: [] });
    expect(buildTv({ e2e: false }, s)).toEqual([]);
    expect(readFileSync(s.releaseApk, "utf8")).toBe("apk");
  });
});
