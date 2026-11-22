// @vitest-environment node
// T3-31 item 1 (docs/specs/T3-31.md, "The build"): an e2e build moves Gradle's R8 mapping beside the e2e APK
// (E2E_MAPPING) before it writes the stamp, fails when Gradle wrote none, and e2eApkIsCurrent() requires the mapping.
// buildTv runs against a temporary tree and a fake Gradle, as scripts/tv-build-cleanup.test.ts does. That the release
// mapping is gone after an e2e build is asserted in the non-frozen scripts/tv-build-cleanup.test.ts.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RELEASE_MAPPING } from "./tv-apk-dex.mjs";
import { E2E_APK, E2E_MAPPING, type TvBuildSystem, buildTv } from "./tv-build.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
let root: string;

const put = (path: string, text: string) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};

type Fake = TvBuildSystem & { releaseMapping: string; e2eMapping: string };

function system({ mapping = "# pg_map_id: abc123\n" as string | null } = {}): Fake {
  const s: Fake = {
    prebuildIsCurrent: () => true,
    prebuild: () => 0,
    sourceHash: () => "hash",
    gradle: (_tasks, env) => {
      put(s.releaseApk, "apk");
      put(join(s.bundleDir, "react", "release", "index.android.bundle"), env.OCTAVE_E2E === "1" ? "x OCTAVE_E2E x" : "x");
      put(join(s.probeBuildDir, "session-debug-androidTest.apk"), "probe");
      if (mapping !== null) put(s.releaseMapping, mapping);
      return { status: 0 };
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
  root = mkdtempSync(join(tmpdir(), "octave-t3-31-build-"));
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

describe("T3-31 item 1: an e2e build keeps its R8 mapping beside the e2e APK", () => {
  it("T3-31 item 1: Gradle's mapping bytes are at e2eMapping after an e2e build, and the stamp exists", () => {
    const s = system({ mapping: "# pg_map_id: e2e-build-id\nsome.Class -> a.b:\n" });
    expect(buildTv({ e2e: true }, s)).toEqual([]);
    expect(readFileSync(s.e2eMapping, "utf8")).toBe("# pg_map_id: e2e-build-id\nsome.Class -> a.b:\n");
    expect(existsSync(s.e2eStamp)).toBe(true);
    expect(readFileSync(s.e2eApk, "utf8")).toBe("apk");
  });

  it("T3-31 item 1: an e2e build whose Gradle wrote no mapping fails with one 'no R8 mapping' line and keeps nothing", () => {
    const s = system({ mapping: null });
    const errors = buildTv({ e2e: true }, s);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^ERROR tv build: /);
    expect(errors[0]).toMatch(/no R8 mapping/);
    expect(existsSync(s.e2eApk)).toBe(false);
    expect(existsSync(s.e2eStamp)).toBe(false);
    expect(existsSync(s.releaseApk)).toBe(false);
  });

  it("T3-31 item 1: an old file at e2eMapping is replaced by the new e2e build's mapping", () => {
    const s = system({ mapping: "# pg_map_id: new\n" });
    put(s.e2eMapping, "# pg_map_id: old\n");
    expect(buildTv({ e2e: true }, s)).toEqual([]);
    expect(readFileSync(s.e2eMapping, "utf8")).toBe("# pg_map_id: new\n");
  });

  it("T3-31 item 1: a release build leaves the release mapping in place and writes no e2eMapping", () => {
    const s = system({ mapping: "# pg_map_id: rel\n" });
    expect(buildTv({ e2e: false }, s)).toEqual([]);
    expect(readFileSync(s.releaseMapping, "utf8")).toBe("# pg_map_id: rel\n");
    expect(existsSync(s.e2eMapping)).toBe(false);
  });

  it("T3-31 item 1: E2E_MAPPING is in the directory of E2E_APK and is not the release mapping path", () => {
    expect(typeof E2E_MAPPING).toBe("string");
    expect(dirname(E2E_MAPPING)).toBe(dirname(E2E_APK));
    expect(E2E_MAPPING).not.toBe(RELEASE_MAPPING);
    expect(E2E_MAPPING).toMatch(/octave-tv-e2e\.mapping\.txt$/);
  });

  it("T3-31 item 1: e2eApkIsCurrent() requires the mapping file (its body names E2E_MAPPING)", () => {
    const source = readFileSync(join(repo, "scripts", "tv-build.mjs"), "utf8");
    const start = source.indexOf("export function e2eApkIsCurrent()");
    expect(start, "e2eApkIsCurrent exists").toBeGreaterThan(-1);
    const body = source.slice(start, source.indexOf("\n}\n", start));
    expect(body).toContain("existsSync(E2E_MAPPING)");
  });

  it("T3-31 item 3: scripts/tv-e2e-apk.mjs passes no lists and imports nothing from tv-apk-dex-lists.mjs (no e2e-only list)", () => {
    const source = readFileSync(join(repo, "scripts", "tv-e2e-apk.mjs"), "utf8");
    expect(source).not.toMatch(/\blists\b/);
    expect(source).not.toContain("tv-apk-dex-lists");
  });
});
