// @vitest-environment node
// T3-02 acceptance item 2: a device test runs the core's conformance suite inside the app under Hermes on the
// emulator, and every vector in the two shared URL files passes.
//
// The pieces, each a pure rule tested here; the tv job applies them to the real APK on the emulator (item 4's evidence):
// - apps/tv/src/e2e/conformance-run.ts: runConformance(host, log), host = { clock, crypto, urlSource, engine }, writes
//   the OCTAVE_E2E lines (docs/specs/T3-02.md, "The device test"; the host line carries the engine, spec check note 2).
// - scripts/tv-e2e.mjs: extractE2eLines(logcatLines), judgeConformance(lines, expected), expectedCounts().
// - scripts/tv-build.mjs: judgeBundle(bytes, flavour) and e2eSourceHash(root) (spec check note 3: a root parameter,
//   defaulting to the repository, so this test hashes a temporary tree).
// - apps/tv/e2e-gate.js: isE2eOnly(filePath, appDir) and gateResolution(resolution, { e2e, appDir }), which
//   apps/tv/metro.config.js applies to Metro's default resolution.
// - The tv job builds the e2e APK after the first emulator step and runs pnpm tv:e2e in a second emulator step.
//
// Modules that later milestones create are loaded at run time from a path built here, so `pnpm typecheck` does not
// depend on them existing (spec check note 9).
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { systemClock } from "../packages/core/src/adapters/system-clock";
import { webCrypto } from "../packages/core/src/adapters/web-crypto";
import type { Clock } from "../packages/core/src/ports/clock";
import type { Crypto } from "../packages/core/src/ports/crypto";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const app = join(repo, "apps", "tv");
const fixtures = join(repo, "packages", "core", "tests", "fixtures");
const require = createRequire(import.meta.url);
const RUN_TIMEOUT = 20_000;

type Expected = { url: number; deviceId: number };
type E2eModule = {
  judgeConformance: (lines: string[], expected: Expected) => string[];
  extractE2eLines: (logcatLines: string[]) => string[];
  expectedCounts: () => Expected;
};
type Host = { clock: Clock; crypto: Crypto; urlSource: "expo-builtin" | "other"; engine: "hermes" | "other" };
type RunConformance = (host: Host, log: (line: string) => void) => unknown;
type BuildModule = {
  judgeBundle: (bytes: Uint8Array, flavour: "release" | "e2e") => string[];
  e2eSourceHash: (root?: string) => string;
};
type Resolution = { type: string; filePath?: string; filePaths?: string[] };
type Gate = {
  isE2eOnly: (filePath: string, appDir: string) => boolean;
  gateResolution: (resolution: Resolution, options: { e2e: boolean; appDir: string }) => Resolution;
};

async function load<T>(path: string): Promise<T> {
  return (await import(pathToFileURL(join(repo, path)).href)) as T;
}

const loadE2e = () => load<E2eModule>("scripts/tv-e2e.mjs");
const loadBuild = () => load<BuildModule>("scripts/tv-build.mjs");
const loadRun = async () => (await load<{ runConformance: RunConformance }>("apps/tv/src/e2e/conformance-run.ts")).runConformance;
const loadHostClock = async () => (await load<{ hostClock: Clock }>("apps/tv/src/host/clock.ts")).hostClock;
const loadGate = () => require(join(app, "e2e-gate.js")) as Gate;

function readJson<T>(name: string): T {
  return JSON.parse(readFileSync(join(fixtures, name), "utf8")) as T;
}

const hostClasses = readJson<{ vectors: unknown[] }>("host-classes.json");
const hlsMasterUrls = readJson<{ vectors: unknown[]; refusals: unknown[] }>("hls-master-urls.json");
const deviceIds = readJson<{ vectors: { name: string; deviceId: string }[] }>("device-ids.json");
const URL_COUNT = hostClasses.vectors.length + hlsMasterUrls.vectors.length + hlsMasterUrls.refusals.length;
const ID_COUNT = deviceIds.vectors.length;
const EXPECTED: Expected = { url: URL_COUNT, deviceId: ID_COUNT };

const START = "OCTAVE_E2E start conformance";
const HOST = "OCTAVE_E2E host url=expo-builtin engine=hermes";
const URL_LINE = `OCTAVE_E2E url total=${URL_COUNT} passed=${URL_COUNT}`;
const ID_LINE = `OCTAVE_E2E device-id total=${ID_COUNT} passed=${ID_COUNT}`;
const CRYPTO = "OCTAVE_E2E crypto random-id=ok";
const CLOCK = "OCTAVE_E2E clock now=ok after=ok every=ok";
const DONE = "OCTAVE_E2E done";
const GOOD = [START, HOST, URL_LINE, ID_LINE, CRYPTO, CLOCK, DONE];

const replace = (from: string, to: string) => GOOD.map((line) => (line === from ? to : line));
const without = (gone: string) => GOOD.filter((line) => line !== gone);
const insertBefore = (before: string, added: string) => GOOD.flatMap((line) => (line === before ? [added, line] : [line]));

function expectFailure(errors: string[], reason: RegExp): void {
  expect(errors.length).toBeGreaterThanOrEqual(1);
  for (const error of errors) expect(error).toMatch(/^ERROR tv e2e: /);
  expect(errors.join("\n")).toMatch(reason);
}

// `adb logcat` default (threadtime) format, as scripts/tv-first-focus.test.ts records it.
const rn = (message: string, time = "10:00:01.000") => `11-21 ${time}  4321  4377 I ReactNativeJS: ${message}`;

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.OCTAVE_E2E;
});

describe("extractE2eLines", () => {
  it("T3-02 item 2: keeps the message of each ReactNativeJS line that starts with OCTAVE_E2E, in order", async () => {
    const { extractE2eLines } = await loadE2e();
    const logcat = [
      "--------- beginning of main",
      rn('Running "main" with {"rootTag":11}', "10:00:00.500"),
      ...GOOD.map((line, i) => rn(line, `10:00:01.${String(100 + i)}`)),
      "11-21 10:00:02.000  6000  6000 I ActivityManager: OCTAVE_E2E done",
      rn("not OCTAVE_E2E done"),
    ];
    expect(extractE2eLines(logcat)).toEqual(GOOD);
  });

  it("T3-02 item 2: reads tag and message, not the columns (logcat -v epoch)", async () => {
    const { extractE2eLines } = await loadE2e();
    const logcat = GOOD.map((line, i) => `     1795255201.${String(100 + i)}  4321  4377 I ReactNativeJS: ${line}`);
    expect(extractE2eLines(logcat)).toEqual(GOOD);
  });

  it("T3-02 item 2: a logcat transcript of a good run passes the judge, and a spoofed tag does not finish it", async () => {
    const { extractE2eLines, judgeConformance } = await loadE2e();
    expect(judgeConformance(extractE2eLines(GOOD.map((line) => rn(line))), EXPECTED)).toEqual([]);
    const spoofed = [...without(DONE).map((line) => rn(line)), "11-21 10:00:02.000  6000  6000 I ActivityManager: OCTAVE_E2E done"];
    expectFailure(judgeConformance(extractE2eLines(spoofed), EXPECTED), /done/i);
  });
});

describe("judgeConformance", () => {
  it("T3-02 item 2: passes a run with every URL and DeviceId vector passing", async () => {
    const { judgeConformance } = await loadE2e();
    expect(URL_COUNT).toBe(202);
    expect(judgeConformance(GOOD, EXPECTED)).toEqual([]);
  });

  it("T3-02 item 2: fails a url-fail line", async () => {
    const { judgeConformance } = await loadE2e();
    const fail = 'OCTAVE_E2E url-fail file=host-classes expected=private-lan actual=public vector="http://10.0.0.1/"';
    expectFailure(judgeConformance(insertBefore(URL_LINE, fail), EXPECTED), /url/i);
  });

  it("T3-02 item 2: fails passed below total for the URL vectors", async () => {
    const { judgeConformance } = await loadE2e();
    expectFailure(judgeConformance(replace(URL_LINE, `OCTAVE_E2E url total=${URL_COUNT} passed=${URL_COUNT - 1}`), EXPECTED), /url/i);
  });

  it.each([
    ["a short run", URL_COUNT - 10],
    ["an empty run", 0],
    ["a longer run", URL_COUNT + 1],
  ])("T3-02 item 2: fails a URL total that differs from the files' count: %s", async (_name, total) => {
    const { judgeConformance } = await loadE2e();
    const errors = judgeConformance(replace(URL_LINE, `OCTAVE_E2E url total=${total} passed=${total}`), EXPECTED);
    expectFailure(errors, /url/i);
    expect(errors.join("\n")).toContain(String(URL_COUNT));
  });

  it("T3-02 item 2: fails a run with no url line", async () => {
    const { judgeConformance } = await loadE2e();
    expectFailure(judgeConformance(without(URL_LINE), EXPECTED), /url/i);
  });

  it("T3-02 item 2: fails a url section that threw", async () => {
    const { judgeConformance } = await loadE2e();
    expectFailure(judgeConformance(replace(URL_LINE, "OCTAVE_E2E url threw"), EXPECTED), /url|threw/i);
  });

  it("T3-02 item 2: fails a run with no done line", async () => {
    const { judgeConformance } = await loadE2e();
    expectFailure(judgeConformance(without(DONE), EXPECTED), /done/i);
  });

  it("T3-02 item 2: fails a run with no start line", async () => {
    const { judgeConformance } = await loadE2e();
    expectFailure(judgeConformance(without(START), EXPECTED), /start/i);
  });

  it("T3-02 item 2: fails two runs in one transcript", async () => {
    const { judgeConformance } = await loadE2e();
    expectFailure(judgeConformance([...GOOD, ...GOOD], EXPECTED), /start|done|run|once|twice|more than one/i);
  });

  it("T3-02 item 2: fails an empty transcript", async () => {
    const { judgeConformance } = await loadE2e();
    expectFailure(judgeConformance([], EXPECTED), /start|done/i);
  });

  it("T3-02 item 2: fails a device-id-fail line", async () => {
    const { judgeConformance } = await loadE2e();
    const fail = 'OCTAVE_E2E device-id-fail actual=different vector="greek final sigma"';
    expectFailure(judgeConformance(insertBefore(ID_LINE, fail), EXPECTED), /device-id/i);
  });

  it("T3-02 item 2: fails device-id passed below total", async () => {
    const { judgeConformance } = await loadE2e();
    expectFailure(judgeConformance(replace(ID_LINE, `OCTAVE_E2E device-id total=${ID_COUNT} passed=${ID_COUNT - 1}`), EXPECTED), /device-id/i);
  });

  it("T3-02 item 2: fails a device-id total that differs from the DeviceId file's count", async () => {
    const { judgeConformance } = await loadE2e();
    const errors = judgeConformance(replace(ID_LINE, "OCTAVE_E2E device-id total=2 passed=2"), EXPECTED);
    expectFailure(errors, /device-id/i);
    expect(errors.join("\n")).toContain(String(ID_COUNT));
  });

  it("T3-02 item 2: fails a run with no device-id line", async () => {
    const { judgeConformance } = await loadE2e();
    expectFailure(judgeConformance(without(ID_LINE), EXPECTED), /device-id/i);
  });

  it("T3-02 item 2: fails a device-id section that threw", async () => {
    const { judgeConformance } = await loadE2e();
    expectFailure(judgeConformance(replace(ID_LINE, "OCTAVE_E2E device-id threw"), EXPECTED), /device-id|threw/i);
  });

  it.each([["OCTAVE_E2E host url=expo-builtin engine=other"], ["OCTAVE_E2E host url=expo-builtin engine=jsc"], ["OCTAVE_E2E host url=expo-builtin"]])(
    "T3-02 item 2: fails a run that was not under Hermes: %s",
    async (host) => {
      const { judgeConformance } = await loadE2e();
      expectFailure(judgeConformance(replace(HOST, host), EXPECTED), /hermes|engine/i);
    },
  );

  it("T3-02 item 2: judges against the counts it is given, not fixed numbers", async () => {
    const { judgeConformance } = await loadE2e();
    expectFailure(judgeConformance(GOOD, { url: URL_COUNT + 1, deviceId: ID_COUNT }), /url/i);
    expectFailure(judgeConformance(GOOD, { url: URL_COUNT, deviceId: ID_COUNT + 1 }), /device-id/i);
  });
});

describe("expectedCounts", () => {
  it("T3-02 item 2: reads the URL count from the two shared URL files: 202", async () => {
    const { expectedCounts } = await loadE2e();
    expect(expectedCounts().url).toBe(URL_COUNT);
    expect(expectedCounts().url).toBe(202);
  });

  it("T3-02 item 2: reads the DeviceId count from device-ids.json", async () => {
    const { expectedCounts } = await loadE2e();
    expect(expectedCounts().deviceId).toBe(ID_COUNT);
    expect(ID_COUNT).toBeGreaterThanOrEqual(10);
  });
});

describe("runConformance in Node, judged", () => {
  async function record(host: Partial<Host> = {}): Promise<string[]> {
    const runConformance = await loadRun();
    const lines: string[] = [];
    await runConformance({ clock: systemClock, crypto: webCrypto, urlSource: "expo-builtin", engine: "hermes", ...host }, (line) => lines.push(line));
    return lines;
  }

  it(
    "T3-02 item 2: the lines it writes with the core's webCrypto and systemClock pass the judge",
    async () => {
      const { judgeConformance, expectedCounts } = await loadE2e();
      const lines = await record();
      for (const line of lines) expect(line).toMatch(/^OCTAVE_E2E /);
      expect(lines[0]).toBe(START);
      expect(lines).toContain(HOST);
      expect(lines).toContain(URL_LINE);
      expect(lines).toContain(ID_LINE);
      expect(lines.at(-1)).toBe(DONE);
      expect(judgeConformance(lines, expectedCounts())).toEqual([]);
    },
    RUN_TIMEOUT,
  );

  it(
    "T3-02 item 2: the lines it writes with the app's hostClock pass the judge",
    async () => {
      const { judgeConformance, expectedCounts } = await loadE2e();
      const lines = await record({ clock: await loadHostClock() });
      expect(lines).toContain(CLOCK);
      expect(judgeConformance(lines, expectedCounts())).toEqual([]);
    },
    RUN_TIMEOUT,
  );

  it(
    "T3-02 item 2: a host whose URL is not Expo's writes url=other, and the judge fails it",
    async () => {
      const { judgeConformance, expectedCounts } = await loadE2e();
      const lines = await record({ urlSource: "other" });
      expect(lines.some((line) => /^OCTAVE_E2E host url=other\b/.test(line))).toBe(true);
      expectFailure(judgeConformance(lines, expectedCounts()), /url/i);
    },
    RUN_TIMEOUT,
  );

  it(
    "T3-02 item 2: a host that is not Hermes writes engine=other, and the judge fails it",
    async () => {
      const { judgeConformance, expectedCounts } = await loadE2e();
      const lines = await record({ engine: "other" });
      expect(lines.some((line) => /^OCTAVE_E2E host .*\bengine=other\b/.test(line))).toBe(true);
      expectFailure(judgeConformance(lines, expectedCounts()), /hermes|engine/i);
    },
    RUN_TIMEOUT,
  );

  it(
    "T3-02 item 2: a URL that does not normalise a host gives a url-fail line naming the vector, still finishes, and the judge fails it",
    async () => {
      const { judgeConformance, expectedCounts } = await loadE2e();
      const runConformance = await loadRun();
      // The pattern of url-conformance.test.ts: a URL whose hostname for http://0x7f.1/ is not normalised. The modules
      // are loaded before the stub, so only the run sees it.
      const NodeURL = URL;
      class UnnormalizedUrl extends NodeURL {
        private readonly written: string;
        constructor(input: string | URL, base?: string | URL) {
          super(input, base);
          this.written = String(input);
        }
        override get hostname(): string {
          return this.written === "http://0x7f.1/" ? "0x7f.1" : super.hostname;
        }
      }
      const lines: string[] = [];
      vi.stubGlobal("URL", UnnormalizedUrl);
      try {
        await runConformance({ clock: systemClock, crypto: webCrypto, urlSource: "expo-builtin", engine: "hermes" }, (line) => lines.push(line));
      } finally {
        vi.unstubAllGlobals();
      }
      const fails = lines.filter((line) => line.startsWith("OCTAVE_E2E url-fail "));
      expect(fails.length).toBeGreaterThanOrEqual(1);
      expect(fails.some((line) => line.includes("file=host-classes") && line.includes("http://0x7f.1/"))).toBe(true);
      expect(lines.at(-1)).toBe(DONE);
      expectFailure(judgeConformance(lines, expectedCounts()), /url/i);
    },
    RUN_TIMEOUT,
  );

  it(
    "T3-02 item 2: a Crypto with the wrong digest gives one device-id-fail per vector, logs no digest, and fails the judge",
    async () => {
      const { judgeConformance, expectedCounts } = await loadE2e();
      const wrong: Crypto = { sha256Hex: async () => "0".repeat(64), randomId: () => webCrypto.randomId() };
      const lines = await record({ crypto: wrong });
      expect(lines.filter((line) => line.startsWith("OCTAVE_E2E device-id-fail "))).toHaveLength(ID_COUNT);
      for (const line of lines) expect(line).not.toMatch(/[0-9a-f]{64}/);
      expect(lines.at(-1)).toBe(DONE);
      expectFailure(judgeConformance(lines, expectedCounts()), /device-id/i);
    },
    RUN_TIMEOUT,
  );

  it(
    "T3-02 item 2: a Crypto whose random ids repeat fails the judge",
    async () => {
      const { judgeConformance, expectedCounts } = await loadE2e();
      const fixed: Crypto = { sha256Hex: (text) => webCrypto.sha256Hex(text), randomId: () => "3f2c8a1e-0b7d-4c55-9a1e-6d2f4b8c7e10" };
      const lines = await record({ crypto: fixed });
      expect(lines).toContain("OCTAVE_E2E crypto random-id=bad");
      expectFailure(judgeConformance(lines, expectedCounts()), /random-id|crypto/i);
    },
    RUN_TIMEOUT,
  );
});

describe("judgeBundle", () => {
  const bytes = (text: string) => Uint8Array.from([0xc6, 0x1f, 0xbc, 0x03, 0x00, ...Buffer.from(text, "latin1"), 0x00, 0xff]);
  const plain = bytes("registerComponent main OCTAVE_FOCUS tile-0");
  const harness = bytes("registerComponent main OCTAVE_E2E start conformance");

  it("T3-02 item 2: passes a release bundle without the harness and an e2e bundle with it", async () => {
    const { judgeBundle } = await loadBuild();
    expect(judgeBundle(plain, "release")).toEqual([]);
    expect(judgeBundle(harness, "e2e")).toEqual([]);
  });

  it("T3-02 item 2: refuses a release bundle that contains OCTAVE_E2E", async () => {
    const { judgeBundle } = await loadBuild();
    const errors = judgeBundle(harness, "release");
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0]).toMatch(/^ERROR tv build: /);
    expect(errors.join("\n")).toMatch(/release/i);
  });

  it("T3-02 item 2: refuses an e2e bundle that lacks OCTAVE_E2E", async () => {
    const { judgeBundle } = await loadBuild();
    const errors = judgeBundle(plain, "e2e");
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0]).toMatch(/^ERROR tv build: /);
    expect(errors.join("\n")).toMatch(/e2e/i);
  });

  it("T3-02 item 2: refuses an empty e2e bundle", async () => {
    const { judgeBundle } = await loadBuild();
    expect(judgeBundle(new Uint8Array(), "e2e").length).toBeGreaterThanOrEqual(1);
  });
});

describe("e2eSourceHash", () => {
  let root: string;

  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "octave-e2e-hash-"));
    write(".gitignore", "node_modules/\n*.log\n");
    write("pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
    write("apps/tv/package.json", '{ "name": "@octave/tv" }\n');
    write("apps/tv/index.js", "registerRootComponent(App);\n");
    write("apps/tv/metro.config.js", "module.exports = {};\n");
    write("apps/tv/src/App.tsx", "export const App = 1;\n");
    write("apps/tv/src/e2e/root.tsx", "export default function Root() { return null; }\n");
    write("apps/tv/android/app/build.gradle", "android {}\n");
    write("apps/tv/dist/e2e/octave-tv-e2e.hash", "old\n");
    write("apps/tv/.expo/state.json", "{}\n");
    write("packages/core/src/domain/a.ts", "export const a = 1;\n");
    write("packages/core/src/domain/a.test.ts", "export const t = 1;\n");
    for (const name of ["host-classes.json", "hls-master-urls.json", "device-ids.json"]) write(`packages/core/tests/fixtures/${name}`, '{ "vectors": [] }\n');
    write("docs/notes.md", "# notes\n");
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["add", "-A"], { cwd: root });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("T3-02 item 2: is the same for the same tree", async () => {
    const { e2eSourceHash } = await loadBuild();
    const first = e2eSourceHash(root);
    expect(first).toMatch(/\S/);
    expect(e2eSourceHash(root)).toBe(first);
  });

  it.each([
    ["apps/tv/src/App.tsx", "export const App = 2;\n"],
    ["apps/tv/src/e2e/root.tsx", "export default function Root() { return 1; }\n"],
    ["apps/tv/index.js", "registerRootComponent(Other);\n"],
    ["packages/core/src/domain/a.ts", "export const a = 2;\n"],
    ["packages/core/tests/fixtures/device-ids.json", '{ "vectors": [1] }\n'],
    ["packages/core/tests/fixtures/host-classes.json", '{ "vectors": [1] }\n'],
    ["pnpm-lock.yaml", "lockfileVersion: '9.1'\n"],
  ])("T3-02 item 2: changes when %s changes, so a stale e2e APK is rebuilt", async (path, text) => {
    const { e2eSourceHash } = await loadBuild();
    const before = e2eSourceHash(root);
    write(path, text);
    expect(e2eSourceHash(root)).not.toBe(before);
  });

  it("T3-02 item 2: changes when a source file is added under packages/core/src", async () => {
    const { e2eSourceHash } = await loadBuild();
    const before = e2eSourceHash(root);
    write("packages/core/src/domain/b.ts", "export const b = 1;\n");
    execFileSync("git", ["add", "-A"], { cwd: root });
    expect(e2eSourceHash(root)).not.toBe(before);
  });

  it.each([
    ["packages/core/src/domain/a.test.ts", "export const t = 2;\n"],
    ["apps/tv/android/app/build.gradle", "android { changed }\n"],
    ["apps/tv/dist/e2e/octave-tv-e2e.hash", "new\n"],
    ["apps/tv/.expo/state.json", '{ "changed": true }\n'],
    ["apps/tv/build.log", "a git-ignored file a build wrote\n"],
    ["docs/notes.md", "# other notes\n"],
  ])("T3-02 item 2: does not change when %s changes", async (path, text) => {
    const { e2eSourceHash } = await loadBuild();
    const before = e2eSourceHash(root);
    write(path, text);
    expect(e2eSourceHash(root)).toBe(before);
  });
});

describe("the e2e gate in Metro", () => {
  const e2eRoot = join(app, "src", "e2e", "root.tsx");
  const appRoot = join(app, "src", "App.tsx");

  it("T3-02 item 2: isE2eOnly is true only for a path under <appDir>/src/e2e/", () => {
    const { isE2eOnly } = loadGate();
    expect(isE2eOnly(e2eRoot, app)).toBe(true);
    expect(isE2eOnly(join(app, "src", "e2e", "nested", "run.ts"), app)).toBe(true);
    expect(isE2eOnly(appRoot, app)).toBe(false);
    expect(isE2eOnly(join(app, "src", "e2e-other", "x.ts"), app)).toBe(false);
    expect(isE2eOnly(join(app, "src", "first-screen", "e2e", "x.ts"), app)).toBe(false);
    expect(isE2eOnly(join(repo, "packages", "core", "src", "conformance", "url-conformance.ts"), app)).toBe(false);
  });

  it("T3-02 item 2: gateResolution empties a module under src/e2e/ when the flag is off", () => {
    const { gateResolution } = loadGate();
    expect(gateResolution({ type: "sourceFile", filePath: e2eRoot }, { e2e: false, appDir: app })).toEqual({ type: "empty" });
  });

  it("T3-02 item 2: gateResolution passes a module under src/e2e/ when the flag is on", () => {
    const { gateResolution } = loadGate();
    const resolution = { type: "sourceFile", filePath: e2eRoot };
    expect(gateResolution(resolution, { e2e: true, appDir: app })).toEqual(resolution);
  });

  it("T3-02 item 2: gateResolution passes every other resolution unchanged", () => {
    const { gateResolution } = loadGate();
    const other = { type: "sourceFile", filePath: appRoot };
    expect(gateResolution(other, { e2e: false, appDir: app })).toEqual(other);
    const asset = { type: "assetFiles", filePaths: [join(app, "assets", "icon.png")] };
    expect(gateResolution(asset, { e2e: false, appDir: app })).toEqual(asset);
    const empty = { type: "empty" };
    expect(gateResolution(empty, { e2e: true, appDir: app })).toEqual(empty);
  });

  function loadMetroConfig(flag: string | undefined): { resolver: { resolveRequest?: (context: unknown, name: string, platform: string | null) => Resolution } } {
    for (const key of Object.keys(require.cache)) if (key.startsWith(app) && !key.includes("node_modules")) delete require.cache[key];
    if (flag === undefined) delete process.env.OCTAVE_E2E;
    else process.env.OCTAVE_E2E = flag;
    return require(join(app, "metro.config.js"));
  }

  function context(filePath: string) {
    return { resolveRequest: () => ({ type: "sourceFile", filePath }) };
  }

  it(
    "T3-02 item 2: metro.config.js empties src/e2e/ modules unless OCTAVE_E2E=1, and passes other modules",
    () => {
      const release = loadMetroConfig(undefined);
      expect(typeof release.resolver.resolveRequest).toBe("function");
      expect(release.resolver.resolveRequest!(context(e2eRoot), "./src/e2e/root", "android")).toEqual({ type: "empty" });
      expect(release.resolver.resolveRequest!(context(appRoot), "./src/App", "android")).toEqual({ type: "sourceFile", filePath: appRoot });

      const e2e = loadMetroConfig("1");
      expect(e2e.resolver.resolveRequest!(context(e2eRoot), "./src/e2e/root", "android")).toEqual({ type: "sourceFile", filePath: e2eRoot });

      const other = loadMetroConfig("true");
      expect(other.resolver.resolveRequest!(context(e2eRoot), "./src/e2e/root", "android")).toEqual({ type: "empty" });
    },
    60_000,
  );
});

describe("the tv job runs the device test", () => {
  function tvJob(): string[] {
    const lines = readFileSync(join(repo, ".github", "workflows", "ci.yml"), "utf8").split("\n");
    const start = lines.findIndex((line) => line === "  tv:");
    expect(start, "ci.yml has a job named tv").toBeGreaterThan(-1);
    const rest = lines.slice(start + 1);
    const end = rest.findIndex((line) => /^ {2}\S/.test(line));
    return end === -1 ? rest : rest.slice(0, end);
  }

  const isRunner = (line: string) => line.includes("ReactiveCircus/android-emulator-runner@");

  function stepAround(job: string[], index: number): string[] {
    const stepStart = job.findLastIndex((line, i) => i <= index && /^\s+- /.test(line));
    const nextStep = job.findIndex((line, i) => i > index && /^\s+- /.test(line));
    return job.slice(stepStart, nextStep === -1 ? undefined : nextStep);
  }

  it("T3-02 item 2: has the root scripts tv:e2e and tv:e2e:build, and tv:build goes through the bundle check", () => {
    const pkg = JSON.parse(readFileSync(join(repo, "package.json"), "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts["tv:e2e"]).toBe("node scripts/tv-e2e.mjs");
    expect(pkg.scripts["tv:e2e:build"]).toBe("node scripts/tv-build.mjs --e2e");
    expect(pkg.scripts["tv:build"]).toBe("node scripts/tv-build.mjs");
  });

  it("T3-02 item 2: builds the e2e APK in a single-line step after the first emulator step", () => {
    const job = tvJob();
    const firstRunner = job.findIndex(isRunner);
    expect(firstRunner, "an android-emulator-runner step").toBeGreaterThan(-1);
    const build = job.findIndex((line) => /^\s+(?:- )?run: pnpm tv:e2e:build\s*$/.test(line));
    expect(build, "a single-line step `run: pnpm tv:e2e:build`").toBeGreaterThan(firstRunner);
  });

  it("T3-02 item 2: runs `pnpm tv:e2e` in a later android-emulator-runner step on an Android TV image", () => {
    const job = tvJob();
    const build = job.findIndex((line) => /^\s+(?:- )?run: pnpm tv:e2e:build\s*$/.test(line));
    expect(build).toBeGreaterThan(-1);
    const runner = job.findIndex((line, i) => i > build && isRunner(line));
    expect(runner, "an android-emulator-runner step after the e2e build").toBeGreaterThan(build);
    const step = stepAround(job, runner);
    expect(step.some((line) => /^\s+script: pnpm tv:e2e\s*$/.test(line))).toBe(true);
    expect(step.join("\n")).toMatch(/target: android-tv/);
    expect(step.join("\n")).toMatch(/ANDROID_SERIAL:/);
  });
});
