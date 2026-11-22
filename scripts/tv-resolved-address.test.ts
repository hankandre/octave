// @vitest-environment node
// T3-20 item 4, the device half (docs/specs/T3-20.md, "The emulator check"): CleartextProbe's resolved-address check
// sends through the one client with a fake resolver on the emulator, and scripts/tv-resolved-address.mjs judges its
// report and the host server's record inside pnpm tv:e2e.
//
// The frozen layer is the pure judge and the tv:e2e call:
// - judgeResolvedAddress(report, served, expected) returns `ERROR tv e2e: resolved-address ...` lines, empty only for
//   a finished report with every key of RESOLVED_REPORT_KEYS, the private and mixed cases at 200, the public case
//   refused resolved-public, all three names asked, the plain-HTTP re-entry refused and the HTTPS re-entry unjudged, an
//   HTTPS call that failed (not refused) after its name was asked, and exactly the two expected requests at the server.
// - scripts/tv-e2e.mjs calls runResolvedAddressProbe, and the script judges with judgeResolvedAddress.
//
// Shapes this file freezes:
// - report = Record<string, string>, values as `am instrument` gives them ("200", "3", "failed-SSLException").
// - served = one record per request the host server saw, as scripts/tv-cleartext.mjs records it:
//   { path: string; host: string; header: boolean }, where header says whether Authorization equalled the canary value.
// - expected = { port: number }, the host server's port.
//
// The module is loaded at run time from a path built here, so `pnpm typecheck` does not depend on it existing.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path: string) => readFileSync(join(repo, path), "utf8");

const SCRIPT = "scripts/tv-resolved-address.mjs";

type Report = Record<string, string>;
type Served = { path: string; host: string; header: boolean };
type Expected = { port: number };
type ResolvedModule = {
  RESOLVED_REPORT_KEYS: string[];
  judgeResolvedAddress: (report: Report, served: Served[], expected: Expected) => string[];
  runResolvedAddressProbe: unknown;
};

async function loadResolved(): Promise<ResolvedModule> {
  const module = (await import(pathToFileURL(join(repo, SCRIPT)).href)) as ResolvedModule;
  expect(typeof module.judgeResolvedAddress, `${SCRIPT} exports judgeResolvedAddress`).toBe("function");
  expect(typeof module.runResolvedAddressProbe, `${SCRIPT} exports runResolvedAddressProbe`).toBe("function");
  expect(Array.isArray(module.RESOLVED_REPORT_KEYS), `${SCRIPT} exports RESOLVED_REPORT_KEYS`).toBe(true);
  return module;
}

const PORT = 41235;
const PRIVATE_PATH = "/octave-probe/resolved-private";
const MIXED_PATH = "/octave-probe/resolved-mixed";
const PUBLIC_PATH = "/octave-probe/resolved-public";
const PRIVATE_HOST = `octave-probe-private.home.arpa:${PORT}`;
const MIXED_HOST = `octave-probe-mixed.home.arpa:${PORT}`;
const OLD_SHARED_HOST = `octave-probe.home.arpa:${PORT}`;

const KEYS = [
  "resolved-private",
  "resolved-mixed",
  "resolved-public",
  "resolved-asked",
  "http-outside",
  "https-call",
  "https-asked",
  "https-outside",
  "done",
];

const passingReport = (overrides: Report = {}): Report => ({
  "resolved-private": "200",
  "resolved-mixed": "200",
  "resolved-public": "refused-resolved-public",
  "resolved-asked": "3",
  "http-outside": "refused-resolved-public",
  "https-call": "failed-SSLException",
  "https-asked": "yes",
  "https-outside": "unjudged",
  done: "yes",
  ...overrides,
});

const passingServed = (): Served[] => [
  { path: PRIVATE_PATH, host: PRIVATE_HOST, header: true },
  { path: MIXED_PATH, host: MIXED_HOST, header: true },
];

const expected: Expected = { port: PORT };

function expectErrors(errors: string[], cause: RegExp) {
  expect(errors.length, "the judge refuses this run").toBeGreaterThan(0);
  for (const error of errors) expect(error).toMatch(/^ERROR tv e2e: resolved-address /);
  expect(errors.join("\n")).toMatch(cause);
}

const escape = (text: string) => text.replace(/[-/.]/g, (char) => `\\${char}`);

describe("judgeResolvedAddress: the device refuses a name whose answer is public, through the one client", () => {
  it("T3-20 item 4: the report keys are the check's nine keys", async () => {
    const { RESOLVED_REPORT_KEYS } = await loadResolved();
    expect([...RESOLVED_REPORT_KEYS].sort()).toEqual([...KEYS].sort());
  });

  it("T3-20 item 4: passes a full report and the two expected requests", async () => {
    const { judgeResolvedAddress } = await loadResolved();
    expect(judgeResolvedAddress(passingReport(), passingServed(), expected)).toEqual([]);
  });

  it("T3-20 item 4: passes any failure class of the HTTPS call that is not a refusal", async () => {
    const { judgeResolvedAddress } = await loadResolved();
    for (const value of ["failed-SSLHandshakeException", "failed-SSLProtocolException", "failed-SocketException"]) {
      expect(judgeResolvedAddress(passingReport({ "https-call": value }), passingServed(), expected), value).toEqual([]);
    }
  });

  for (const key of KEYS) {
    it(`T3-20 item 4: fails a report without ${key} and names it`, async () => {
      const { judgeResolvedAddress } = await loadResolved();
      const report = passingReport();
      delete report[key];
      expectErrors(judgeResolvedAddress(report, passingServed(), expected), new RegExp(escape(key)));
    });
  }

  it("T3-20 item 4: fails an empty report, as from a probe that never ran", async () => {
    const { judgeResolvedAddress } = await loadResolved();
    expectErrors(judgeResolvedAddress({}, [], expected), /done/);
  });

  const reportCases: [string, Report, RegExp][] = [
    ["the probe did not finish", { done: "no" }, /done|finish/i],
    ["the private case got another status", { "resolved-private": "500" }, /resolved-private/],
    ["the private case was refused", { "resolved-private": "refused-resolved-public" }, /resolved-private/],
    ["the private case failed", { "resolved-private": "failed-ConnectException" }, /resolved-private/],
    ["the mixed case got another status", { "resolved-mixed": "404" }, /resolved-mixed/],
    ["the mixed case was refused", { "resolved-mixed": "refused-resolved-public" }, /resolved-mixed/],
    ["the mixed case failed", { "resolved-mixed": "failed-SocketTimeoutException" }, /resolved-mixed/],
    ["the public case answered", { "resolved-public": "200" }, /resolved-public/],
    ["the public case was refused with another code", { "resolved-public": "refused-public-http" }, /resolved-public/],
    ["the public case failed without a refusal", { "resolved-public": "failed-ConnectException" }, /resolved-public/],
    ["only one of the three names was asked (a pooled connection)", { "resolved-asked": "1" }, /resolved-asked/],
    ["two of the three names were asked", { "resolved-asked": "2" }, /resolved-asked/],
    ["the asked count is not a number", { "resolved-asked": "many" }, /resolved-asked/],
    ["the plain-HTTP re-entry came back unjudged", { "http-outside": "unjudged" }, /http-outside/],
    ["the plain-HTTP re-entry was filtered", { "http-outside": "filtered" }, /http-outside/],
    ["the plain-HTTP re-entry never ran", { "http-outside": "not-run" }, /http-outside/],
    ["the HTTPS call was refused", { "https-call": "refused-resolved-public" }, /https-call/],
    ["the HTTPS call answered", { "https-call": "200" }, /https-call/],
    ["the HTTPS name was never asked", { "https-asked": "no" }, /https-asked/],
    ["the HTTPS re-entry was refused", { "https-outside": "refused-resolved-public" }, /https-outside/],
    ["the HTTPS re-entry was filtered", { "https-outside": "filtered" }, /https-outside/],
    ["the HTTPS re-entry never ran", { "https-outside": "not-run" }, /https-outside/],
    ["the HTTPS re-entry failed", { "https-outside": "failed-UnknownHostException" }, /https-outside/],
  ];

  for (const [what, overrides, cause] of reportCases) {
    it(`T3-20 item 4: fails when ${what}`, async () => {
      const { judgeResolvedAddress } = await loadResolved();
      expectErrors(judgeResolvedAddress(passingReport(overrides), passingServed(), expected), cause);
    });
  }

  const routes: [string, string][] = [
    ["private", PRIVATE_PATH],
    ["mixed", MIXED_PATH],
  ];

  for (const [what, path] of routes) {
    it(`T3-20 item 4: fails when the server never saw the ${what} request`, async () => {
      const { judgeResolvedAddress } = await loadResolved();
      const served = passingServed().filter((record) => record.path !== path);
      expectErrors(judgeResolvedAddress(passingReport(), served, expected), new RegExp(`${what}|${escape(path)}`));
    });

    it(`T3-20 item 4: fails when the server saw the ${what} request twice`, async () => {
      const { judgeResolvedAddress } = await loadResolved();
      const served = [...passingServed(), ...passingServed().filter((record) => record.path === path)];
      expectErrors(judgeResolvedAddress(passingReport(), served, expected), new RegExp(`${what}|${escape(path)}`));
    });

    it(`T3-20 item 4: fails a ${what} request the server saw without the header`, async () => {
      const { judgeResolvedAddress } = await loadResolved();
      const served = passingServed().map((record) => (record.path === path ? { ...record, header: false } : record));
      expectErrors(judgeResolvedAddress(passingReport(), served, expected), new RegExp(`${what}|${escape(path)}`));
    });

    it(`T3-20 item 4: fails a ${what} request that arrived with the old shared Host`, async () => {
      const { judgeResolvedAddress } = await loadResolved();
      const served = passingServed().map((record) => (record.path === path ? { ...record, host: OLD_SHARED_HOST } : record));
      expectErrors(judgeResolvedAddress(passingReport(), served, expected), new RegExp(`${what}|${escape(path)}`));
    });
  }

  it("T3-20 item 4: fails a mixed request that arrived with the private case's Host", async () => {
    const { judgeResolvedAddress } = await loadResolved();
    const served = passingServed().map((record) => (record.path === MIXED_PATH ? { ...record, host: PRIVATE_HOST } : record));
    expectErrors(judgeResolvedAddress(passingReport(), served, expected), /mixed/);
  });

  it("T3-20 item 4: fails a private request that arrived on another port", async () => {
    const { judgeResolvedAddress } = await loadResolved();
    const served = passingServed().map((record) =>
      record.path === PRIVATE_PATH ? { ...record, host: `octave-probe-private.home.arpa:${PORT + 1}` } : record,
    );
    expectErrors(judgeResolvedAddress(passingReport(), served, expected), /private/);
  });

  it("T3-20 item 4: fails when the server saw a request for the public case", async () => {
    const { judgeResolvedAddress } = await loadResolved();
    const served = [...passingServed(), { path: PUBLIC_PATH, host: `octave-probe-public.home.arpa:${PORT}`, header: true }];
    expectErrors(judgeResolvedAddress(passingReport(), served, expected), /public/);
  });

  it("T3-20 item 4: fails when the server saw any other request", async () => {
    const { judgeResolvedAddress } = await loadResolved();
    for (const extra of [
      { path: "/octave-probe/https-call", host: `octave-probe-tls.home.arpa:${PORT}`, header: false },
      { path: "/", host: `10.0.2.2:${PORT}`, header: false },
    ]) {
      expectErrors(judgeResolvedAddress(passingReport(), [...passingServed(), extra], expected), /request/);
    }
  });
});

describe("pnpm tv:e2e runs the resolved-address check", () => {
  it("T3-20 item 4: scripts/tv-e2e.mjs calls runResolvedAddressProbe", () => {
    const source = read("scripts/tv-e2e.mjs");
    expect(source).toContain("./tv-resolved-address.mjs");
    expect(source).toMatch(/\bawait\s+runResolvedAddressProbe\s*\(/);
  });

  it("T3-20 item 4: the script judges its run with judgeResolvedAddress", async () => {
    await loadResolved();
    const source = read(SCRIPT);
    expect(source).toMatch(/export\s+function\s+judgeResolvedAddress\s*\(/);
    const calls = [...source.matchAll(/(?<!function\s+)\bjudgeResolvedAddress\s*\(/g)];
    expect(calls.length, `${SCRIPT} calls judgeResolvedAddress, not only defines it`).toBeGreaterThan(0);
    expect(source, "the run selects the probe's resolved-address check").toMatch(/["']resolved-address["']/);
  });
});
