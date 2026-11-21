// @vitest-environment node
// T3-02 acceptance item 1: the app supplies the core's Clock, Crypto and URL from Expo's implementations through the
// ports. The Clock and Crypto adapters live in apps/tv/src/host/ (hostClock over the runtime's Date.now and timers,
// hostCrypto over expo-crypto); URL has no port (T2-06 D1), so the app supplies it by loading Expo's runtime, which
// installs whatwg-url-minimum as the global URL and URLSearchParams, each tagged Symbol.for("expo.builtin").
// urlIsExpoBuiltin() reports whether both globals carry that tag. The app adds no URL or crypto polyfill and writes
// no crypto or URL global. ESLint keeps expo-crypto inside apps/tv/src/host/.
//
// hostCrypto calls a native module, so it runs only on the device (item 2's run in the tv job). The judge's cases here
// are the item 1 half of judgeConformance(lines, expected) in scripts/tv-e2e.mjs: the host line must say
// url=expo-builtin, the crypto line random-id=ok, and every clock part ok.
//
// Modules that later milestones create are loaded at run time from a path built here, so `pnpm typecheck` does not
// depend on them existing (spec check note 9).
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const app = join(repo, "apps", "tv");
const TIMEOUT = 60_000;
const ESLINT = ["--import", "./scripts/typescript-6-resolve.mjs", "node_modules/eslint/bin/eslint.js", "--max-warnings", "0"];

type Clock = {
  now(): number;
  after(ms: number, run: () => void): () => void;
  every(ms: number, run: () => void): () => void;
};
type Expected = { url: number; deviceId: number };
type JudgeConformance = (lines: string[], expected: Expected) => string[];

async function load<T>(path: string): Promise<T> {
  return (await import(pathToFileURL(join(repo, path)).href)) as T;
}

const loadJudge = async () => (await load<{ judgeConformance: JudgeConformance }>("scripts/tv-e2e.mjs")).judgeConformance;
const loadHostClock = async () => (await load<{ hostClock: Clock }>("apps/tv/src/host/clock.ts")).hostClock;
const loadUrlIsExpoBuiltin = async () => (await load<{ urlIsExpoBuiltin: () => boolean }>("apps/tv/src/host/url.ts")).urlIsExpoBuiltin;

type Manifest = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

function manifest(): Manifest {
  return JSON.parse(readFileSync(join(app, "package.json"), "utf8")) as Manifest;
}

function declared(pkg: Manifest): Record<string, string> {
  return { ...pkg.peerDependencies, ...pkg.optionalDependencies, ...pkg.devDependencies, ...pkg.dependencies };
}

const POLYFILLS = ["react-native-url-polyfill", "whatwg-url", "whatwg-url-without-unicode", "react-native-get-random-values", "react-native-quick-crypto"];

// Generated trees sit at the app root only; node_modules is skipped at any depth.
const GENERATED = new Set(["android", "ios", ".expo", "dist"]);
const CODE = /\.(?:[cm]?[jt]sx?)$/;

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules" || (dir === app && GENERATED.has(entry.name))) return [];
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

// Removes `//` and `/* */` comments, keeping string and template literals, so a comment may name what the code avoids.
function stripComments(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (c === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i += 1;
    } else if (c === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? source.length : end + 2;
    } else if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < source.length && source[j] !== c) j += source[j] === "\\" ? 2 : 1;
      out += source.slice(i, j + 1);
      i = j + 1;
    } else {
      out += c;
      i += 1;
    }
  }
  return out;
}

const GLOBAL_WRITE = [
  /\b(?:globalThis|global|window|self)\s*\.\s*(?:crypto|URL|URLSearchParams)\s*=(?!=)/,
  /\b(?:globalThis|global|window|self)\s*\[\s*["'`](?:crypto|URL|URLSearchParams)["'`]\s*\]\s*=(?!=)/,
  /\bdefineProperty\s*\(\s*(?:globalThis|global|window|self)\s*,\s*["'`](?:crypto|URL|URLSearchParams)["'`]/,
];

function offendingFiles(test: (code: string) => boolean): string[] {
  return walk(app)
    .filter((path) => CODE.test(path))
    .filter((path) => test(stripComments(readFileSync(path, "utf8"))))
    .map((path) => relative(repo, path));
}

function eslintStdin(path: string, code: string): { status: number | null; output: string } {
  const child = spawnSync(process.execPath, [...ESLINT, "--stdin", "--stdin-filename", path], {
    cwd: repo,
    input: code,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return { status: child.status, output: `${child.stdout ?? ""}\n${child.stderr ?? ""}` };
}

// A transcript the judge passes (the format of docs/specs/T3-02.md, "The device test", with spec check note 2's engine).
const EXPECTED: Expected = { url: 202, deviceId: 13 };
function transcript(overrides: Partial<Record<"host" | "crypto" | "clock", string>> = {}): string[] {
  return [
    "OCTAVE_E2E start conformance",
    overrides.host ?? "OCTAVE_E2E host url=expo-builtin engine=hermes",
    "OCTAVE_E2E url total=202 passed=202",
    "OCTAVE_E2E device-id total=13 passed=13",
    overrides.crypto ?? "OCTAVE_E2E crypto random-id=ok",
    overrides.clock ?? "OCTAVE_E2E clock now=ok after=ok every=ok",
    "OCTAVE_E2E done",
  ];
}

function expectFailure(errors: string[], reason: RegExp): void {
  expect(errors.length).toBeGreaterThanOrEqual(1);
  for (const error of errors) expect(error).toMatch(/^ERROR tv e2e: /);
  expect(errors.join("\n")).toMatch(reason);
}

const realUrl = globalThis.URL;
const realSearchParams = globalThis.URLSearchParams;
const BUILTIN = Symbol.for("expo.builtin");

function tagged<T extends object>(base: T): T {
  // A subclass, so tagging it never touches Node's own URL classes.
  const copy = class extends (base as unknown as new (...args: unknown[]) => object) {};
  Object.defineProperty(copy, BUILTIN, { value: true, enumerable: false });
  return copy as unknown as T;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("apps/tv declares the host's dependencies", () => {
  it("T3-02 item 1: depends on expo-crypto ~58.0.8 at runtime", () => {
    expect(manifest().dependencies?.["expo-crypto"]).toBe("~58.0.8");
  });

  it("T3-02 item 1: depends on the core as the workspace package @octave/core", () => {
    expect(manifest().dependencies?.["@octave/core"]).toBe("workspace:*");
  });

  it.each(POLYFILLS)("T3-02 item 1: declares no URL or crypto polyfill: %s", (name) => {
    expect(declared(manifest())[name]).toBeUndefined();
  });
});

describe("app source writes no crypto or URL global", () => {
  it("T3-02 item 1: the comment stripper keeps code and strings and drops comments", () => {
    const code = 'const a = "http://x/*y*/"; // crypto.subtle\n/* globalThis.URL = 1 */ const b = `//${a}`;\n';
    const stripped = stripComments(code);
    expect(stripped).toContain('"http://x/*y*/"');
    expect(stripped).toContain("`//${a}`");
    expect(stripped).not.toContain("crypto.subtle");
    expect(stripped).not.toContain("globalThis.URL");
  });

  it("T3-02 item 1: the global-write patterns catch the forms they name", () => {
    const writes = ["globalThis.crypto = c;", "global.URL = U;", 'globalThis["URLSearchParams"] = P;', 'Object.defineProperty(globalThis, "crypto", {});'];
    for (const write of writes) expect(GLOBAL_WRITE.some((pattern) => pattern.test(write)), write).toBe(true);
    for (const read of ["const u = new globalThis.URL(x);", "if (globalThis.crypto === undefined) {}"]) {
      expect(GLOBAL_WRITE.some((pattern) => pattern.test(read)), read).toBe(false);
    }
  });

  it("T3-02 item 1: no code under apps/tv assigns globalThis.crypto, global.crypto, globalThis.URL or global.URL", () => {
    expect(walk(app).filter((path) => CODE.test(path)).length).toBeGreaterThan(0);
    expect(offendingFiles((code) => GLOBAL_WRITE.some((pattern) => pattern.test(code)))).toEqual([]);
  });

  it("T3-02 item 1: no code under apps/tv mentions crypto.subtle", () => {
    expect(offendingFiles((code) => /\bcrypto\s*\.\s*subtle\b|\bcrypto\s*\[\s*["'`]subtle["'`]\s*\]/.test(code))).toEqual([]);
  });

  it("T3-02 item 1: the three host adapters exist in apps/tv/src/host/", () => {
    for (const name of ["clock.ts", "crypto.ts", "url.ts"]) expect(existsSync(join(app, "src", "host", name)), name).toBe(true);
  });
});

describe("expo-crypto is importable only in apps/tv/src/host/", () => {
  it(
    "T3-02 item 1: rejects an expo-crypto import in other app code",
    () => {
      for (const code of ['import * as C from "expo-crypto";\nexport const c = C;\n', 'import { randomUUID } from "expo-crypto";\nexport const id = randomUUID;\n']) {
        const { status, output } = eslintStdin("apps/tv/src/probe.ts", code);
        expect(status, output).not.toBe(0);
        expect(output).toMatch(/no-restricted-imports/);
        expect(output).toContain("expo-crypto");
      }
    },
    TIMEOUT,
  );

  it(
    "T3-02 item 1: accepts an expo-crypto import in apps/tv/src/host/",
    () => {
      const { status, output } = eslintStdin("apps/tv/src/host/probe.ts", 'import * as C from "expo-crypto";\nexport const c = C;\n');
      expect(output).not.toMatch(/error|warning/);
      expect(status).toBe(0);
    },
    TIMEOUT,
  );

  it(
    "T3-02 item 1: still refuses T3-01's Android-only imports in apps/tv/src/host/",
    () => {
      for (const code of ['import { ToastAndroid } from "react-native";\nexport const toast = ToastAndroid;\n', 'import { requireNativeModule } from "expo-modules-core";\nexport const probe = requireNativeModule("Probe");\n']) {
        const { status, output } = eslintStdin("apps/tv/src/host/probe.ts", code);
        expect(status, output).not.toBe(0);
        expect(output).toMatch(/\.android\.ts/);
      }
    },
    TIMEOUT,
  );
});

describe("hostClock", () => {
  it("T3-02 item 1: now() is the wall clock in epoch milliseconds", async () => {
    const hostClock = await loadHostClock();
    const before = Date.now();
    const now = hostClock.now();
    expect(Number.isInteger(now)).toBe(true);
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
  });

  it("T3-02 item 1: after() runs once after its delay, and a cancelled after() never runs", async () => {
    const hostClock = await loadHostClock();
    vi.useFakeTimers();
    const ran = vi.fn();
    const cancelled = vi.fn();
    hostClock.after(50, ran);
    const cancel = hostClock.after(50, cancelled);
    cancel();
    vi.advanceTimersByTime(49);
    expect(ran).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(ran).toHaveBeenCalledTimes(1);
    expect(cancelled).not.toHaveBeenCalled();
  });

  it("T3-02 item 1: every() repeats, first after its interval, and stops after its cancel", async () => {
    const hostClock = await loadHostClock();
    vi.useFakeTimers();
    const ran = vi.fn();
    const cancel = hostClock.every(20, ran);
    vi.advanceTimersByTime(19);
    expect(ran).not.toHaveBeenCalled();
    vi.advanceTimersByTime(41);
    expect(ran).toHaveBeenCalledTimes(3);
    cancel();
    vi.advanceTimersByTime(200);
    expect(ran).toHaveBeenCalledTimes(3);
  });
});

describe("urlIsExpoBuiltin", () => {
  it("T3-02 item 1: is true when both URL and URLSearchParams carry Expo's builtin tag", async () => {
    const urlIsExpoBuiltin = await loadUrlIsExpoBuiltin();
    vi.stubGlobal("URL", tagged(realUrl));
    vi.stubGlobal("URLSearchParams", tagged(realSearchParams));
    expect(urlIsExpoBuiltin()).toBe(true);
  });

  it("T3-02 item 1: is false for Node's own URL, which Expo did not install", async () => {
    const urlIsExpoBuiltin = await loadUrlIsExpoBuiltin();
    expect(urlIsExpoBuiltin()).toBe(false);
  });

  it("T3-02 item 1: is false when only URL carries the tag", async () => {
    const urlIsExpoBuiltin = await loadUrlIsExpoBuiltin();
    vi.stubGlobal("URL", tagged(realUrl));
    expect(urlIsExpoBuiltin()).toBe(false);
  });

  it("T3-02 item 1: is false when only URLSearchParams carries the tag", async () => {
    const urlIsExpoBuiltin = await loadUrlIsExpoBuiltin();
    vi.stubGlobal("URLSearchParams", tagged(realSearchParams));
    expect(urlIsExpoBuiltin()).toBe(false);
  });

  it("T3-02 item 1: is false when the tag is present but not true", async () => {
    const urlIsExpoBuiltin = await loadUrlIsExpoBuiltin();
    const url = class extends realUrl {};
    Object.defineProperty(url, BUILTIN, { value: "yes" });
    vi.stubGlobal("URL", url);
    vi.stubGlobal("URLSearchParams", tagged(realSearchParams));
    expect(urlIsExpoBuiltin()).toBe(false);
  });
});

describe("judgeConformance, the host half", () => {
  it("T3-02 item 1: passes a transcript whose host is Expo's URL, with a good random id and clock", async () => {
    const judge = await loadJudge();
    expect(judge(transcript(), EXPECTED)).toEqual([]);
  });

  it("T3-02 item 1: fails a transcript whose host line is url=other", async () => {
    const judge = await loadJudge();
    expectFailure(judge(transcript({ host: "OCTAVE_E2E host url=other engine=hermes" }), EXPECTED), /url/i);
  });

  it("T3-02 item 1: fails a transcript with no host line", async () => {
    const judge = await loadJudge();
    expectFailure(judge(transcript().filter((line) => !line.startsWith("OCTAVE_E2E host ")), EXPECTED), /host|url/i);
  });

  it.each([
    ["now=bad after=ok every=ok"],
    ["now=ok after=timeout every=ok"],
    ["now=ok after=ok every=bad"],
    ["now=ok after=ok"],
  ])("T3-02 item 1: fails a clock line that is not all ok: %s", async (parts) => {
    const judge = await loadJudge();
    expectFailure(judge(transcript({ clock: `OCTAVE_E2E clock ${parts}` }), EXPECTED), /clock/i);
  });

  it("T3-02 item 1: fails a transcript with no clock line", async () => {
    const judge = await loadJudge();
    expectFailure(judge(transcript().filter((line) => !line.startsWith("OCTAVE_E2E clock ")), EXPECTED), /clock/i);
  });

  it("T3-02 item 1: fails a crypto line that is not random-id=ok", async () => {
    const judge = await loadJudge();
    expectFailure(judge(transcript({ crypto: "OCTAVE_E2E crypto random-id=bad" }), EXPECTED), /random-id|crypto/i);
  });

  it("T3-02 item 1: fails a transcript with no crypto line", async () => {
    const judge = await loadJudge();
    expectFailure(judge(transcript().filter((line) => !line.startsWith("OCTAVE_E2E crypto ")), EXPECTED), /random-id|crypto/i);
  });

  it("T3-02 item 1: fails a section that threw in place of its line", async () => {
    const judge = await loadJudge();
    expectFailure(judge(transcript({ crypto: "OCTAVE_E2E crypto threw" }), EXPECTED), /crypto|threw/i);
    expectFailure(judge(transcript({ clock: "OCTAVE_E2E clock threw" }), EXPECTED), /clock|threw/i);
  });
});
