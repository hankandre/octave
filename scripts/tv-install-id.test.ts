// @vitest-environment node
// T4-09 items 1 and 2 (docs/specs/T4-09.md, "Acceptance" and "Test plan"): the TV keeps one install id, made by the
// Crypto port and stored by the native module modules/install-id, and every gateway the app builds takes it.
//
// - apps/tv/src/host/install-id.ts: createInstallIdSource(native, crypto). The first call asks crypto.randomId() for a
//   candidate and hands it to native().keep(candidate), which answers the stored id. The answer is kept for the life of
//   the runtime; a rejection, a null or an answer that is not a lowercase version 4 UUID rejects with
//   "The install id is not available." and the next call tries again.
// - modules/install-id: one function, keep(candidate). Its TypeScript declares only that; its Expo module defines only
//   that. The module's own JVM tests (InstallIdStoreTest, ModuleSurfaceTest) are the implementer's.
// - apps/tv/src/host/gateway.ts: createGatewayFactory({ crypto, transport, installId }) awaits the id and passes it as
//   the gateway's fourth argument; it is the only place under apps/tv that constructs a JellyfinGateway or imports the
//   class as a value, and ESLint fails any other.
// - apps/tv/src/e2e/install-id-run.ts: runInstallId({ crypto, installId }, log), the app's side of the device stage.
//
// Modules this task creates are loaded at run time from a path built here, so `pnpm typecheck` does not depend on them
// existing (as scripts/tv-host.test.ts does).
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { webCrypto } from "../packages/core/src/adapters/web-crypto";
import { JellyfinGateway } from "../packages/core/src/jellyfin/gateway";
import { deriveDeviceId } from "../packages/core/src/jellyfin/device-id";
import type { Crypto } from "../packages/core/src/ports/crypto";
import type { SignInRequest, Transport, TransportRequest } from "../packages/core/src/ports/transport";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const TIMEOUT = 60_000;
const ESLINT = ["--import", "./scripts/typescript-6-resolve.mjs", "node_modules/eslint/bin/eslint.js", "--max-warnings", "0"];

const NOT_AVAILABLE = "The install id is not available.";
const RULE_MESSAGE = "Build gateways with the factory in apps/tv/src/host/gateway.ts";
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const CANDIDATE = "0b6f3c2e-8d1a-4f5b-9c7e-2a4d6e8f0a1b";
const STORED = "7e1d9a4c-3b2f-4a6e-8d5c-1f0e9b8a7c6d";
const OTHER = "c4a8e2f6-1b3d-4e5f-a7b9-0c2d4e6f8a0b";

const SERVER = "https://octave-e2e.invalid";
const SERVER_ID = "0f1e2d3c4b5a69788796a5b4c3d2e1f0";
const USER = "octave-e2e-user";

type Keep = (candidate: string) => Promise<string | null>;
type InstallIdSource = () => Promise<string>;
type InstallIdModule = {
  createInstallIdSource: (native: () => { keep: Keep }, crypto: Crypto) => InstallIdSource;
};
type GatewayHost = { crypto: Crypto; transport: Transport; installId: InstallIdSource };
type GatewayModule = {
  createGatewayFactory: (host: GatewayHost) => (serverUrl: string, stores?: Record<string, unknown>) => Promise<JellyfinGateway>;
};
type RunModule = {
  runInstallId: (host: { crypto: Crypto; installId: InstallIdSource }, log: (line: string) => void) => Promise<unknown>;
};

async function load<T>(path: string): Promise<T> {
  return (await import(pathToFileURL(join(repo, path)).href)) as T;
}

const loadSource = async () => (await load<InstallIdModule>("apps/tv/src/host/install-id.ts")).createInstallIdSource;
const loadFactory = async () => (await load<GatewayModule>("apps/tv/src/host/gateway.ts")).createGatewayFactory;
const loadRun = async () => (await load<RunModule>("apps/tv/src/e2e/install-id-run.ts")).runInstallId;

// A Crypto that hashes with WebCrypto, hands out fixed random ids in order, and records both.
function recordingCrypto(ids: string[] = [CANDIDATE]) {
  const hashes: string[] = [];
  let next = 0;
  const randomId = vi.fn(() => {
    const id = ids[Math.min(next, ids.length - 1)];
    next += 1;
    return id;
  });
  const crypto: Crypto = {
    async sha256Hex(text) {
      const hash = await webCrypto.sha256Hex(text);
      hashes.push(hash);
      return hash;
    },
    randomId,
  };
  return { crypto, randomId, hashes };
}

// A Transport that answers the public-info probe and a sign-in in memory and keeps the DeviceId of each sign-in.
function recordingTransport() {
  const deviceIds: string[] = [];
  const requests: TransportRequest[] = [];
  const signIns: SignInRequest[] = [];
  const transport: Transport = {
    async signIn(request) {
      signIns.push(request);
      deviceIds.push(request.deviceId);
      return { session: "session-1", userId: "user-1", userName: USER, serverId: SERVER_ID };
    },
    async request(request) {
      requests.push(request);
      return { status: 200, body: { Version: "10.11.0", Id: SERVER_ID, ServerName: "Fixture" } };
    },
    async endSession() {},
  };
  return { transport, deviceIds, requests, signIns };
}

function fakeNative(keep: Keep) {
  const spy = vi.fn(keep);
  const native = vi.fn(() => ({ keep: spy }));
  return { native, keep: spy };
}

async function signedInDeviceId(gateway: JellyfinGateway, deviceIds: string[]): Promise<string> {
  await gateway.connect();
  await gateway.login(USER, "password");
  return deviceIds[deviceIds.length - 1];
}

// --- the source -------------------------------------------------------------------------------------------------------

describe("T4-09 item 1: createInstallIdSource makes the id once, from the Crypto port, and keeps it", () => {
  it("T4-09 item 1: the fixture ids are lowercase version 4 UUIDs (harness check)", () => {
    for (const id of [CANDIDATE, STORED, OTHER]) expect(id).toMatch(UUID_V4);
  });

  it("T4-09 item 1: loads no native module until the id is first asked for", async () => {
    const createInstallIdSource = await loadSource();
    const { crypto, randomId } = recordingCrypto();
    const { native, keep } = fakeNative(async (candidate) => candidate);
    createInstallIdSource(native, crypto);
    expect(native).not.toHaveBeenCalled();
    expect(keep).not.toHaveBeenCalled();
    expect(randomId).not.toHaveBeenCalled();
  });

  it("T4-09 item 1: hands the Crypto port's random id to keep() and answers the stored id", async () => {
    const createInstallIdSource = await loadSource();
    const { crypto, randomId } = recordingCrypto([CANDIDATE]);
    const { native, keep } = fakeNative(async (candidate) => candidate);
    const source = createInstallIdSource(native, crypto);
    await expect(source()).resolves.toBe(CANDIDATE);
    expect(randomId).toHaveBeenCalledTimes(1);
    expect(keep).toHaveBeenCalledTimes(1);
    expect(keep).toHaveBeenCalledWith(CANDIDATE);
  });

  it("T4-09 item 1: two concurrent callers share one randomId() call and one keep() call", async () => {
    const createInstallIdSource = await loadSource();
    const { crypto, randomId } = recordingCrypto([CANDIDATE, OTHER]);
    let release!: (id: string) => void;
    const answered = new Promise<string>((resolve) => (release = resolve));
    const { native, keep } = fakeNative(() => answered);
    const source = createInstallIdSource(native, crypto);
    const both = Promise.all([source(), source()]);
    release(CANDIDATE);
    await expect(both).resolves.toEqual([CANDIDATE, CANDIDATE]);
    expect(randomId).toHaveBeenCalledTimes(1);
    expect(keep).toHaveBeenCalledTimes(1);
  });

  it("T4-09 item 1: a later call gets the kept id without asking the native module again", async () => {
    const createInstallIdSource = await loadSource();
    const { crypto, randomId } = recordingCrypto([CANDIDATE, OTHER]);
    const { native, keep } = fakeNative(async (candidate) => candidate);
    const source = createInstallIdSource(native, crypto);
    await expect(source()).resolves.toBe(CANDIDATE);
    await expect(source()).resolves.toBe(CANDIDATE);
    expect(randomId).toHaveBeenCalledTimes(1);
    expect(keep).toHaveBeenCalledTimes(1);
  });

  it("T4-09 item 1: an id already stored wins over the new candidate", async () => {
    const createInstallIdSource = await loadSource();
    const { crypto } = recordingCrypto([CANDIDATE]);
    const { native, keep } = fakeNative(async () => STORED);
    const source = createInstallIdSource(native, crypto);
    await expect(source()).resolves.toBe(STORED);
    expect(keep).toHaveBeenCalledWith(CANDIDATE);
  });

  it.each([
    ["null", async () => null],
    ["an empty string", async () => ""],
    ["an uppercase UUID", async () => STORED.toUpperCase()],
    ["a version 1 UUID", async () => "7e1d9a4c-3b2f-1a6e-8d5c-1f0e9b8a7c6d"],
    ["a token-shaped answer", async () => "0123456789abcdef0123456789abcdef"],
    ["an id followed by more text", async () => `${STORED}\n`],
    ["a rejection", async () => Promise.reject(new Error("native failure with detail"))],
  ] as Array<[string, Keep]>)(
    "T4-09 item 1: %s from keep() rejects with the fixed message, never the candidate, and the next call tries again",
    async (_name, failing) => {
      const createInstallIdSource = await loadSource();
      const { crypto, randomId } = recordingCrypto([CANDIDATE, OTHER]);
      let calls = 0;
      const { native, keep } = fakeNative(async (candidate) => {
        calls += 1;
        return calls === 1 ? failing(candidate) : STORED;
      });
      const source = createInstallIdSource(native, crypto);
      const first = source();
      await expect(first).rejects.toThrow(NOT_AVAILABLE);
      await first.catch((error: unknown) => {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe(NOT_AVAILABLE);
      });
      await expect(source()).resolves.toBe(STORED);
      expect(keep).toHaveBeenCalledTimes(2);
      expect(randomId).toHaveBeenCalled();
    },
  );
});

// --- the native module's surface --------------------------------------------------------------------------------------

// Removes `//` and `/* */` comments, keeping string literals, so a comment may name what the code avoids.
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

const MODULE_INDEX = "modules/install-id/src/index.ts";
const MODULE_KT = "modules/install-id/android/src/main/java/dev/octave/installid/OctaveInstallIdModule.kt";

function readSource(path: string): string {
  expect(existsSync(join(repo, path)), `${path} exists`).toBe(true);
  return stripComments(readFileSync(join(repo, path), "utf8"));
}

describe("T4-09 item 1: modules/install-id exposes one function, keep", () => {
  it("T4-09 item 1: the comment stripper drops comments and keeps strings", () => {
    const stripped = stripComments('Name("OctaveInstallId") // Function("read")\n/* Events("x") */ AsyncFunction("keep")\n');
    expect(stripped).toContain('Name("OctaveInstallId")');
    expect(stripped).toContain('AsyncFunction("keep")');
    expect(stripped).not.toContain('Function("read")');
    expect(stripped).not.toContain("Events(");
  });

  it("T4-09 item 1: the TypeScript declares OctaveInstallIdNative with exactly keep(candidate: string): Promise<string | null>", () => {
    const source = readSource(MODULE_INDEX);
    const body = /export\s+interface\s+OctaveInstallIdNative\s*\{([^}]*)\}/.exec(source);
    expect(body, "an exported interface OctaveInstallIdNative").not.toBeNull();
    const members = [...(body?.[1] ?? "").matchAll(/^\s*(?:readonly\s+)?([A-Za-z_$][\w$]*)\s*\??\s*[(:<]/gm)].map(([, name]) => name);
    expect(members).toEqual(["keep"]);
    expect(body?.[1]).toMatch(/keep\s*\(\s*\w+\s*:\s*string\s*\)\s*:\s*Promise\s*<\s*string\s*\|\s*null\s*>/);
  });

  it("T4-09 item 1: the module's TypeScript holds types only", () => {
    const source = readSource(MODULE_INDEX);
    expect(source).not.toMatch(/\bexport\s+(?:const|let|var|function|async|class|default|enum)\b/);
    expect(source).not.toMatch(/\brequireNativeModule\b|\brequireOptionalNativeModule\b/);
  });

  it("T4-09 item 1: the Expo module is OctaveInstallId with one AsyncFunction(\"keep\") and no other function, property, constant, event or view", () => {
    const source = readSource(MODULE_KT);
    expect(source).toMatch(/\bName\s*\(\s*"OctaveInstallId"\s*\)/);
    expect([...source.matchAll(/\bAsyncFunction\s*\(/g)].length).toBe(1);
    expect(source).toMatch(/\bAsyncFunction\s*\(\s*"keep"\s*\)/);
    expect(source).not.toMatch(/(?<!Async)\bFunction\s*\(/);
    for (const call of ["Property", "Constants", "Constant", "Events", "View", "Prop", "OnStartObserving"]) {
      expect(source, call).not.toMatch(new RegExp(`\\b${call}\\s*\\(`));
    }
  });
});

// --- the gateway factory ----------------------------------------------------------------------------------------------

describe("T4-09 item 2: createGatewayFactory passes the stored install id to every gateway", () => {
  it("T4-09 item 2: the fake Transport records the DeviceId derived from the install id the gateway was given (harness check)", async () => {
    const { crypto, randomId } = recordingCrypto([OTHER]);
    const { transport, deviceIds } = recordingTransport();
    const gateway = new JellyfinGateway(SERVER, crypto, transport, STORED);
    expect(await signedInDeviceId(gateway, deviceIds)).toBe(await deriveDeviceId(webCrypto, STORED, SERVER_ID, USER));
    expect(randomId).not.toHaveBeenCalled();
  });

  it("T4-09 item 2: the DeviceId a gateway from the factory signs in with is deriveDeviceId of the source's id", async () => {
    const createGatewayFactory = await loadFactory();
    const { crypto, randomId } = recordingCrypto([OTHER]);
    const { transport, deviceIds } = recordingTransport();
    const installId = vi.fn(async () => STORED);
    const factory = createGatewayFactory({ crypto, transport, installId });
    const gateway = await factory(SERVER);
    expect(await signedInDeviceId(gateway, deviceIds)).toBe(await deriveDeviceId(webCrypto, STORED, SERVER_ID, USER));
    expect(installId).toHaveBeenCalled();
    // The constructor's random default would call randomId(); the stored id means it is never asked.
    expect(randomId).not.toHaveBeenCalled();
  });

  it("T4-09 item 2: two gateways built for the same server and user send the same DeviceId (a relaunch keeps it)", async () => {
    const createGatewayFactory = await loadFactory();
    const { crypto } = recordingCrypto([CANDIDATE, OTHER]);
    const first = recordingTransport();
    const second = recordingTransport();
    const before = await createGatewayFactory({ crypto, transport: first.transport, installId: async () => STORED })(SERVER);
    const after = await createGatewayFactory({ crypto, transport: second.transport, installId: async () => STORED })(SERVER);
    const a = await signedInDeviceId(before, first.deviceIds);
    const b = await signedInDeviceId(after, second.deviceIds);
    expect(a).toBe(b);
    expect(a).toBe(await deriveDeviceId(webCrypto, STORED, SERVER_ID, USER));
  });

  it("T4-09 item 2: another stored id gives another DeviceId", async () => {
    const createGatewayFactory = await loadFactory();
    const { crypto } = recordingCrypto([CANDIDATE]);
    const first = recordingTransport();
    const second = recordingTransport();
    const a = await signedInDeviceId(await createGatewayFactory({ crypto, transport: first.transport, installId: async () => STORED })(SERVER), first.deviceIds);
    const b = await signedInDeviceId(await createGatewayFactory({ crypto, transport: second.transport, installId: async () => OTHER })(SERVER), second.deviceIds);
    expect(a).not.toBe(b);
  });

  it("T4-09 item 2: a source that rejects makes the factory reject, and no gateway is built", async () => {
    const createGatewayFactory = await loadFactory();
    const { crypto, randomId } = recordingCrypto([CANDIDATE]);
    const { transport, requests, signIns } = recordingTransport();
    const factory = createGatewayFactory({ crypto, transport, installId: async () => Promise.reject(new Error(NOT_AVAILABLE)) });
    await expect(factory(SERVER)).rejects.toThrow(NOT_AVAILABLE);
    expect(randomId).not.toHaveBeenCalled();
    expect(requests).toEqual([]);
    expect(signIns).toEqual([]);
  });

  it.each([
    ["undefined", undefined],
    ["an empty string", ""],
    ["an uppercase UUID", STORED.toUpperCase()],
    ["a token-shaped string", "0123456789abcdef0123456789abcdef"],
  ])("T4-09 item 2: a source that answers %s makes the factory reject without falling back to a random id", async (_name, answer) => {
    const createGatewayFactory = await loadFactory();
    const { crypto, randomId } = recordingCrypto([CANDIDATE]);
    const { transport, requests, signIns } = recordingTransport();
    const factory = createGatewayFactory({ crypto, transport, installId: async () => answer as unknown as string });
    await expect(factory(SERVER)).rejects.toThrow();
    expect(randomId).not.toHaveBeenCalled();
    expect(requests).toEqual([]);
    expect(signIns).toEqual([]);
  });
});

// --- the lint rule and the scan ---------------------------------------------------------------------------------------

function eslintStdin(path: string, code: string): { status: number | null; output: string } {
  const child = spawnSync(process.execPath, [...ESLINT, "--stdin", "--stdin-filename", path], {
    cwd: repo,
    input: code,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return { status: child.status, output: `${child.stdout ?? ""}\n${child.stderr ?? ""}` };
}

function eslintFile(path: string): { status: number | null; output: string } {
  const child = spawnSync(process.execPath, [...ESLINT, path], { cwd: repo, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return { status: child.status, output: `${child.stdout ?? ""}\n${child.stderr ?? ""}` };
}

const CORE_GATEWAY = "@octave/core/src/jellyfin/gateway";
const RELATIVE_GATEWAY = "../../../../packages/core/src/jellyfin/gateway";
const PROBES = ["apps/tv/src/probe.ts", "apps/tv/src/e2e/wire/probe.ts"];

const MUST_FAIL: Array<[string, string]> = [
  ["a construction by name", `import { JellyfinGateway } from "${CORE_GATEWAY}";\nexport const g = (c: never, t: never) => new JellyfinGateway("https://a.invalid", c, t);\n`],
  ["an aliased import", `import { JellyfinGateway as G } from "${CORE_GATEWAY}";\nexport const g = (c: never, t: never) => new G("https://a.invalid", c, t);\n`],
  ["an aliased import from a relative path", `import { JellyfinGateway as G } from "${RELATIVE_GATEWAY}";\nexport const g = (c: never, t: never) => new G("https://a.invalid", c, t);\n`],
  ["a namespace import", `import * as gateway from "${CORE_GATEWAY}";\nexport const g = (c: never, t: never) => new gateway.JellyfinGateway("https://a.invalid", c, t);\n`],
  ["a subclass", `import { JellyfinGateway } from "${CORE_GATEWAY}";\nexport class Mine extends JellyfinGateway {}\n`],
  ["a re-export", `export { JellyfinGateway } from "${CORE_GATEWAY}";\n`],
  ["a re-export of everything", `export * from "${CORE_GATEWAY}";\n`],
  ["a require()", `const core = require("${CORE_GATEWAY}");\nexport const g = core;\n`],
  ["an import()", `export const g = import("${CORE_GATEWAY}");\n`],
];

const MUST_PASS: Array<[string, string]> = [
  ["import type", `import type { JellyfinGateway } from "${CORE_GATEWAY}";\nexport type Held = JellyfinGateway | undefined;\n`],
  ["an inline type import", `import { type JellyfinGateway } from "${CORE_GATEWAY}";\nexport type Held = JellyfinGateway | undefined;\n`],
  ["a value import of HOME_ROW_LIMIT", `import { HOME_ROW_LIMIT } from "${CORE_GATEWAY}";\nexport const limit = HOME_ROW_LIMIT;\n`],
];

describe("T4-09 item 2: ESLint keeps JellyfinGateway's construction in apps/tv/src/host/gateway.ts", () => {
  for (const probe of PROBES) {
    it.each(MUST_FAIL)(
      `T4-09 item 2: fails %s in ${probe}`,
      (_name, code) => {
        const { status, output } = eslintStdin(probe, code);
        expect(status, output).not.toBe(0);
        expect(output).toContain(RULE_MESSAGE);
      },
      TIMEOUT,
    );

    it.each(MUST_PASS)(
      `T4-09 item 2: passes %s in ${probe}`,
      (_name, code) => {
        const { status, output } = eslintStdin(probe, code);
        expect(output).not.toMatch(/\berror\b|\bwarning\b/);
        expect(status).toBe(0);
      },
      TIMEOUT,
    );
  }

  it(
    "T4-09 item 2: passes apps/tv/src/host/gateway.ts, which constructs the gateway",
    () => {
      expect(existsSync(join(repo, "apps/tv/src/host/gateway.ts")), "apps/tv/src/host/gateway.ts exists").toBe(true);
      const { status, output } = eslintFile("apps/tv/src/host/gateway.ts");
      expect(output).not.toMatch(/\berror\b|\bwarning\b/);
      expect(status).toBe(0);
    },
    TIMEOUT,
  );
});

const CODE = /\.(?:[cm]?[jt]sx?)$/;
const TEST_FILE = /\.test\.[cm]?[jt]sx?$/;
const GATEWAY_MODULE = /(^|\/)jellyfin\/gateway$/;

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules") return [];
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

// True when the code constructs JellyfinGateway by name or imports the class (or the whole module) as a value.
function constructsOrImportsClass(code: string): boolean {
  if (/\bnew\s+JellyfinGateway\b/.test(code)) return true;
  for (const [, typeOnly, specifiers, from] of code.matchAll(/\bimport\s+(type\s+)?([^;]*?)\s+from\s*["']([^"']+)["']/g)) {
    if (!GATEWAY_MODULE.test(from) || typeOnly) continue;
    if (/\*\s*as\s+\w+/.test(specifiers) || /^\s*[A-Za-z_$][\w$]*\s*(,|$)/.test(specifiers)) return true;
    const named = /\{([^}]*)\}/.exec(specifiers)?.[1] ?? "";
    for (const specifier of named.split(",").map((part) => part.trim())) {
      if (/^JellyfinGateway\b/.test(specifier)) return true;
    }
  }
  return false;
}

describe("T4-09 item 2: only apps/tv/src/host/gateway.ts builds a gateway", () => {
  it("T4-09 item 2: the scan sees a construction, an aliased value import and a namespace import, and not a type import", () => {
    expect(constructsOrImportsClass("const g = new JellyfinGateway(a, b, c);")).toBe(true);
    expect(constructsOrImportsClass(`import { HOME_ROW_LIMIT, JellyfinGateway as G } from "${CORE_GATEWAY}";`)).toBe(true);
    expect(constructsOrImportsClass(`import * as core from "${CORE_GATEWAY}";`)).toBe(true);
    expect(constructsOrImportsClass(`import type { JellyfinGateway } from "${CORE_GATEWAY}";`)).toBe(false);
    expect(constructsOrImportsClass(`import { type JellyfinGateway, HOME_ROW_LIMIT } from "${CORE_GATEWAY}";`)).toBe(false);
  });

  it("T4-09 item 2: no file under apps/tv/src but host/gateway.ts constructs JellyfinGateway or imports it as a value", () => {
    const files = walk(join(repo, "apps", "tv", "src")).filter((path) => CODE.test(path) && !TEST_FILE.test(path));
    expect(files.length).toBeGreaterThan(0);
    const offenders = files.filter((path) => constructsOrImportsClass(stripComments(readFileSync(path, "utf8")))).map((path) => relative(repo, path));
    expect(offenders).toEqual(["apps/tv/src/host/gateway.ts"]);
  });
});

// --- the app's side of the device stage -------------------------------------------------------------------------------

const ID_LINE = /^OCTAVE_INSTALL id shape=ok stable=yes mark=([0-9a-f]{16})$/;

async function runWith(id: string | Error) {
  const runInstallId = await loadRun();
  const { crypto, hashes } = recordingCrypto([OTHER]);
  const lines: string[] = [];
  const installId = async () => (id instanceof Error ? Promise.reject(id) : id);
  await runInstallId({ crypto, installId }, (line) => lines.push(line));
  return { lines, hashes };
}

describe("T4-09 item 2: runInstallId writes the stage's lines", () => {
  it("T4-09 item 2: writes start, one id line with shape=ok stable=yes and a 16-hex mark, and done", async () => {
    const { lines } = await runWith(STORED);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe("OCTAVE_INSTALL start");
    expect(lines[1]).toMatch(ID_LINE);
    expect(lines[2]).toBe("OCTAVE_INSTALL done");
  });

  it("T4-09 item 2: the same id gives the same mark, another id another mark", async () => {
    const mark = (lines: string[]) => ID_LINE.exec(lines[1] ?? "")?.[1];
    const first = mark((await runWith(STORED)).lines);
    const again = mark((await runWith(STORED)).lines);
    const other = mark((await runWith(OTHER)).lines);
    expect(first).toMatch(/^[0-9a-f]{16}$/);
    expect(again).toBe(first);
    expect(other).toMatch(/^[0-9a-f]{16}$/);
    expect(other).not.toBe(first);
  });

  it("T4-09 item 2: a source that rejects writes threw in place of the id line", async () => {
    const { lines } = await runWith(new Error(NOT_AVAILABLE));
    expect(lines).toEqual(["OCTAVE_INSTALL start", "OCTAVE_INSTALL threw", "OCTAVE_INSTALL done"]);
  });

  it("T4-09 item 2: no line holds the install id, a DeviceId or any full hash, or an error message", async () => {
    for (const id of [STORED, new Error(`${NOT_AVAILABLE} ${STORED}`)]) {
      const { lines, hashes } = await runWith(id);
      const text = lines.join("\n");
      expect(text).not.toContain(STORED);
      expect(text).not.toContain(NOT_AVAILABLE);
      expect(text).not.toMatch(/[0-9a-f]{17,}/);
      for (const hash of hashes) expect(text).not.toContain(hash);
      for (const line of lines) expect(line).toMatch(/^OCTAVE_INSTALL /);
    }
  });
});
