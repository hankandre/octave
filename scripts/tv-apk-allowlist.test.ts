// @vitest-environment node
// T3-33 item 3 (docs/specs/T3-33.md, "The allowlist", "A release build holds none"): scripts/tv-build.mjs hands Gradle
// the canary octave-allowlist-canary.invalid as the allowlist for every release and e2e build, replacing whatever the
// machine holds, and scripts/tv-apk-allowlist.mjs fails, naming the entry, when an APK entry holds the canary's bytes.
// pnpm tv:apk:check runs it on the release APK. A list that reached a release APK by any route would bring the canary
// with it.
//
// judgeAllowlist(entries) takes [{ name, bytes }] (the uncompressed entries, as scripts/tv-zip.mjs reads them) and
// returns its error lines, none when the canary is absent. The CLI takes an APK path. The variable's name is assembled
// from two parts, so this file never sets it in its text.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { judgeAllowlist } from "./tv-apk-allowlist.mjs";
import { type TvBuildSystem, buildTv } from "./tv-build.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(repo, "scripts", "tv-apk-allowlist.mjs");
const NAME = ["OCTAVE_DEV", "SERVERS"].join("_");
const CANARY = "octave-allowlist-canary.invalid";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "octave-t3-33-allowlist-"));
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

// A zip of stored and deflated entries, CRCs left zero (scripts/tv-zip.mjs does not check them).
function zip(files: { name: string; data: Buffer; deflate: boolean }[]): Buffer {
  const locals: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  for (const { name, data, deflate } of files) {
    const body = deflate ? deflateRawSync(data) : data;
    const nameBytes = Buffer.from(name, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(deflate ? 8 : 0, 10);
    entry.writeUInt32LE(body.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, body);
    directory.push(entry, nameBytes);
    offset += 30 + nameBytes.length + body.length;
  }
  const dir = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

// Bytes with the canary in the middle, the way a dex string table would hold it.
const holding = (text: string) => Buffer.concat([Buffer.from("dex\n039\0", "latin1"), Buffer.from([0, 1, 2, 31]), Buffer.from(text, "utf8"), Buffer.from([0, 9, 8])]);
const clean = () => Buffer.concat([Buffer.from("dex\n039\0", "latin1"), Buffer.from("dev.octave.session.BuildConfig octave-allowlist-canary.invali", "utf8")]);

function runCli(files: { name: string; data: Buffer; deflate: boolean }[]) {
  const apk = join(root, "app.apk");
  writeFileSync(apk, zip(files));
  return spawnSync(process.execPath, [SCRIPT, apk], { cwd: repo, encoding: "utf8" });
}

describe("T3-33 item 3: judgeAllowlist finds the canary in an APK entry", () => {
  it("T3-33 item 3: entries without the canary pass", () => {
    expect(judgeAllowlist([])).toEqual([]);
    expect(judgeAllowlist([{ name: "classes.dex", bytes: clean() }, { name: "AndroidManifest.xml", bytes: Buffer.from("<manifest/>") }])).toEqual([]);
  });

  it("T3-33 item 3: an entry holding the canary fails, and the error names the entry", () => {
    const errors = judgeAllowlist([{ name: "classes.dex", bytes: clean() }, { name: "classes3.dex", bytes: holding(CANARY) }]) as string[];
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join("\n")).toContain("classes3.dex");
    for (const line of errors) expect(line).toMatch(/^ERROR /);
  });

  it("T3-33 item 3: the canary in a list among other hosts fails too", () => {
    const errors = judgeAllowlist([{ name: "assets/x.bin", bytes: holding(`dev-jellyfin.invalid,${CANARY},media-test.invalid`) }]) as string[];
    expect(errors.join("\n")).toContain("assets/x.bin");
  });
});

describe("T3-33 item 3: node scripts/tv-apk-allowlist.mjs <apk> reads every entry, stored or deflated", () => {
  it("T3-33 item 3: an APK without the canary passes", () => {
    const out = runCli([
      { name: "AndroidManifest.xml", data: Buffer.from("<manifest/>"), deflate: false },
      { name: "classes.dex", data: clean(), deflate: true },
    ]);
    expect(out.status, out.stderr).toBe(0);
  });

  it("T3-33 item 3: a stored entry holding the canary fails, naming the entry", () => {
    const out = runCli([
      { name: "AndroidManifest.xml", data: Buffer.from("<manifest/>"), deflate: true },
      { name: "resources.arsc", data: holding(CANARY), deflate: false },
    ]);
    expect(out.status).not.toBe(0);
    expect(out.stderr).toContain("resources.arsc");
    expect(out.stderr).toMatch(/^ERROR /m);
  });

  it("T3-33 item 3: a deflated entry holding the canary fails, naming the entry", () => {
    const out = runCli([
      { name: "AndroidManifest.xml", data: Buffer.from("<manifest/>"), deflate: false },
      { name: "classes2.dex", data: holding(CANARY), deflate: true },
    ]);
    expect(out.status).not.toBe(0);
    expect(out.stderr).toContain("classes2.dex");
  });
});

// A system whose Gradle records the environment it was handed and writes what a build would (scripts/tv-build-cleanup.test.ts).
function system(seen: NodeJS.ProcessEnv[]): TvBuildSystem {
  const put = (path: string, text: string) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  };
  const s: TvBuildSystem = {
    prebuildIsCurrent: () => true,
    prebuild: () => 0,
    sourceHash: () => "hash",
    gradle: (_tasks, env) => {
      seen.push({ ...env });
      put(s.releaseApk, "apk");
      put(s.releaseMapping, "# pg_map_id: abc\n");
      put(join(s.bundleDir, "react", "release", "index.android.bundle"), env.OCTAVE_E2E === "1" ? "x OCTAVE_E2E x" : "x");
      put(join(s.probeBuildDir, "session-debug-androidTest.apk"), "probe");
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

describe("T3-33 item 3: scripts/tv-build.mjs hands Gradle the canary as the allowlist", () => {
  for (const e2e of [false, true]) {
    const flavour = e2e ? "e2e" : "release";
    for (const machine of [undefined, "", "192.0.2.10,media.example"]) {
      it(`T3-33 item 3: the ${flavour} build's Gradle environment holds the canary when the machine's value is ${JSON.stringify(machine)}`, () => {
        const previous = process.env[NAME];
        if (machine === undefined) delete process.env[NAME];
        else process.env[NAME] = machine;
        try {
          const seen: NodeJS.ProcessEnv[] = [];
          expect(buildTv({ e2e }, system(seen))).toEqual([]);
          expect(seen.length).toBeGreaterThan(0);
          for (const env of seen) expect(env[NAME]).toBe(CANARY);
        } finally {
          if (previous === undefined) delete process.env[NAME];
          else process.env[NAME] = previous;
        }
      });
    }
  }
});

describe("T3-33 item 3: pnpm tv:apk:check runs the allowlist step", () => {
  it("T3-33 item 3: package.json's tv:apk:check runs node scripts/tv-apk-allowlist.mjs", () => {
    const pkg = JSON.parse(readFileSync(join(repo, "package.json"), "utf8")) as { scripts: Record<string, string> };
    const steps = (pkg.scripts["tv:apk:check"] ?? "").split("&&").map((step) => step.trim());
    expect(steps, pkg.scripts["tv:apk:check"]).toContain("node scripts/tv-apk-allowlist.mjs");
  });
});
