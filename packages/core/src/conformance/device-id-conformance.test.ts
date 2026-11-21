// @vitest-environment node
// T3-02 acceptance item 3: the DeviceId derived on the device equals the value Node derives for the same inputs.
// packages/core/tests/fixtures/device-ids.json holds the inputs and the DeviceId Node derives (computed with node:crypto
// and String.prototype.toLowerCase when these tests were frozen). runDeviceIdConformance(crypto) derives each with
// deriveDeviceId and the given Crypto and compares; Node runs it here with webCrypto, and the app runs it on the device
// with hostCrypto inside item 2's run. Like the URL suite it imports no test runner and no Node module, never throws,
// and reports vector names and fixed words only: never a derived value or an error message.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { webCrypto } from "../adapters/web-crypto";
import { deriveDeviceId } from "../jellyfin/device-id";
import type { Crypto } from "../ports/crypto";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(HERE, "../../tests/fixtures/device-ids.json");

interface DeviceIdVector {
  name: string;
  installId: string;
  serverId: string;
  username: string;
  deviceId: string;
}

interface DeviceIdConformanceReport {
  total: number;
  passed: number;
  failures: { vector: string; actual: "different" | "threw" }[];
}

type RunDeviceIdConformance = (crypto: Crypto) => Promise<DeviceIdConformanceReport>;

// Loaded at run time from a built path, so the fixture tests run and `pnpm typecheck` holds before the suite exists.
const SUITE = pathToFileURL(resolve(HERE, "device-id-conformance.ts")).href;

async function loadSuite(): Promise<RunDeviceIdConformance> {
  const module = (await import(SUITE)) as { runDeviceIdConformance: RunDeviceIdConformance };
  return module.runDeviceIdConformance;
}

const fixture = JSON.parse(readFileSync(FIXTURE, "utf8")) as { description: string; vectors: DeviceIdVector[] };
const vectors = fixture.vectors;

// The two values packages/core/src/jellyfin/device-id.test.ts pins (T2-03).
const LOUISE = "07bce1a97d44b7008418adc02ad74694142287bef4bd4007377574dc451aaf78";
const NON_ASCII = "53ec180397a5cca67368c4103ddb5e9c5ba4871bdbbcde8fb4d27a4badfdc0e5";

const nodeHash = (vector: DeviceIdVector) =>
  createHash("sha256").update(`${vector.installId}:${vector.serverId}:${vector.username.toLowerCase()}`, "utf8").digest("hex");

describe("device-ids.json", () => {
  it("T3-02 item 3: has at least ten vectors, each with a unique name and a lowercase SHA-256 hex DeviceId", () => {
    expect(vectors.length).toBeGreaterThanOrEqual(10);
    expect(new Set(vectors.map((vector) => vector.name)).size).toBe(vectors.length);
    for (const vector of vectors) {
      expect(vector.name, JSON.stringify(vector)).toMatch(/\S/);
      for (const key of ["installId", "serverId", "username"] as const) expect(typeof vector[key], `${vector.name} ${key}`).toBe("string");
      expect(vector.deviceId, vector.name).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("T3-02 item 3: holds no lone surrogate, which Kotlin and WebCrypto encode differently", () => {
    for (const vector of vectors) {
      for (const key of ["installId", "serverId", "username"] as const) expect(vector[key], `${vector.name} ${key}`).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
    }
  });

  it("T3-02 item 3: holds the two values device-id.test.ts pins", () => {
    const pinned = (deviceId: string) => vectors.find((vector) => vector.deviceId === deviceId);
    expect(pinned(LOUISE)).toMatchObject({ installId: "install-1", serverId: "server-1", username: "Louise" });
    expect(pinned(NON_ASCII)).toMatchObject({ installId: "install-1", serverId: "server-1", username: "ZOË Ångström" });
  });

  it("T3-02 item 3: covers the cases the spec names", () => {
    const usernames = vectors.map((vector) => vector.username);
    const lower = vectors.find((vector) => /^[a-z]+$/.test(vector.username));
    expect(lower, "an already-lowercase ASCII name").toBeDefined();
    const upper = vectors.find((vector) => vector.username === lower!.username.toUpperCase() && vector.installId === lower!.installId && vector.serverId === lower!.serverId);
    expect(upper, "the same name in upper case").toBeDefined();
    expect(upper!.deviceId).toBe(lower!.deviceId);
    expect(vectors.some((vector) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(vector.installId))).toBe(true);
    expect(vectors.some((vector) => /^https?:\/\//.test(vector.serverId))).toBe(true);
    for (const name of ["#quick-connect", "a:b", "İREM", "ΟΔΥΣΣΕΥΣ", "STRAẞE"]) expect(usernames, name).toContain(name);
    expect(usernames.some((name) => /\p{Script=Han}/u.test(name)), "a CJK username").toBe(true);
    expect(usernames.some((name) => [...name].some((char) => char.codePointAt(0)! > 0xffff)), "a username outside the BMP").toBe(true);
  });

  it("T3-02 item 3: every DeviceId is the SHA-256 Node computes independently with node:crypto", () => {
    for (const vector of vectors) expect(nodeHash(vector), vector.name).toBe(vector.deviceId);
  });

  it("T3-02 item 3: every DeviceId is what deriveDeviceId gives with webCrypto", async () => {
    for (const vector of vectors) {
      expect(await deriveDeviceId(webCrypto, vector.installId, vector.serverId, vector.username), vector.name).toBe(vector.deviceId);
    }
  });
});

describe("runDeviceIdConformance", () => {
  it("T3-02 item 3: passes every vector in Node with webCrypto", async () => {
    const run = await loadSuite();
    const report = await run(webCrypto);
    expect(report).toEqual({ total: vectors.length, passed: vectors.length, failures: [] });
  });

  it("T3-02 item 3: derives through the given Crypto, handing it the lowercased input", async () => {
    const run = await loadSuite();
    const seen: string[] = [];
    const recording: Crypto = {
      sha256Hex: async (text) => {
        seen.push(text);
        return webCrypto.sha256Hex(text);
      },
      randomId: () => webCrypto.randomId(),
    };
    const report = await run(recording);
    expect(report.passed).toBe(vectors.length);
    expect(seen).toHaveLength(vectors.length);
    for (const vector of vectors) expect(seen).toContain(`${vector.installId}:${vector.serverId}:${vector.username.toLowerCase()}`);
  });

  it("T3-02 item 3: reports one `different` failure per vector for a Crypto with the wrong digest, and no digest", async () => {
    const run = await loadSuite();
    const wrong: Crypto = { sha256Hex: async () => "f".repeat(64), randomId: () => webCrypto.randomId() };
    const report = await run(wrong);
    expect(report.total).toBe(vectors.length);
    expect(report.passed).toBe(0);
    expect(report.failures).toEqual(vectors.map((vector) => ({ vector: vector.name, actual: "different" })));
    const text = JSON.stringify(report);
    expect(text).not.toContain("f".repeat(64));
    for (const vector of vectors) expect(text).not.toContain(vector.deviceId);
  });

  it("T3-02 item 3: reports a failure only for the vectors whose digest differs", async () => {
    const run = await loadSuite();
    const target = vectors.find((vector) => vector.username === "ΟΔΥΣΣΕΥΣ")!;
    const input = `${target.installId}:${target.serverId}:${target.username.toLowerCase()}`;
    const oneWrong: Crypto = {
      sha256Hex: async (text) => (text === input ? "0".repeat(64) : webCrypto.sha256Hex(text)),
      randomId: () => webCrypto.randomId(),
    };
    const report = await run(oneWrong);
    expect(report).toEqual({ total: vectors.length, passed: vectors.length - 1, failures: [{ vector: target.name, actual: "different" }] });
  });

  it("T3-02 item 3: reports `threw` for a Crypto that rejects, without throwing or naming the error", async () => {
    const run = await loadSuite();
    const rejecting: Crypto = { sha256Hex: async () => Promise.reject(new Error("secret-detail")), randomId: () => webCrypto.randomId() };
    const report = await run(rejecting);
    expect(report.passed).toBe(0);
    expect(report.failures).toEqual(vectors.map((vector) => ({ vector: vector.name, actual: "threw" })));
    expect(JSON.stringify(report)).not.toContain("secret-detail");
  });

  it("T3-02 item 3: reports `threw` for a Crypto that throws synchronously, without throwing", async () => {
    const run = await loadSuite();
    const throwing: Crypto = {
      sha256Hex: () => {
        throw new Error("secret-detail");
      },
      randomId: () => webCrypto.randomId(),
    };
    const report = await run(throwing);
    expect(report.passed).toBe(0);
    expect(report.failures).toEqual(vectors.map((vector) => ({ vector: vector.name, actual: "threw" })));
    expect(JSON.stringify(report)).not.toContain("secret-detail");
  });

  it("T3-02 item 3: is a named export of a module with no test-runner or Node import", async () => {
    expect(typeof (await loadSuite())).toBe("function");
    const source = readFileSync(resolve(HERE, "device-id-conformance.ts"), "utf8");
    expect(source).toMatch(/export\s+(?:(?:async\s+)?function|const)\s+runDeviceIdConformance\b/);
    expect(source).not.toMatch(/vitest/);
    expect(source).not.toMatch(/node:/);
    const specifiers = [...source.matchAll(/(?:from|import)\s+["']([^"']+)["']/g)].map((match) => match[1]);
    expect(specifiers.length).toBeGreaterThan(0);
    for (const specifier of specifiers) expect(specifier.startsWith(".")).toBe(true);
    expect(source).toMatch(/device-ids\.json/);
  });
});
