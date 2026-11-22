// @vitest-environment node
// T3-26 item 1 (docs/specs/T3-26.md, "The evidence" and Test plan): no file `pnpm tv:wire` writes under
// release-evidence/wire holds a known secret, and the runner's judging of a run is a pure function that reaches every
// pair. The modules are loaded at run time from a built path, so `pnpm typecheck` does not depend on them existing.
//
// The contract frozen here, beyond the spec's own names:
// - scripts/tv-wire.mjs exports judgeRun(input, { write }) -> { summary, errors, failed }. input is
//   { pairs: [{ test, target, task, devicePort, records }], counts: { canaryOrigin, redirector, privateLan }, lines
//   (the app's OCTAVE_WIRE lines), logLines (every logcat line judged), seen (the global-proxy listener's requests),
//   devicePorts, secrets (an array), voids, kept (the counting attempt's keeper result), deviceLines }. write is the
//   evidence writer, injected: write({ captures: [{ name, records }], appLines, deviceLines, proxyLines, secrets })
//   returns the ERROR lines writeEvidence would. summary is one `<test> <target> <task> pass|fail` line per pair;
//   errors are the lines the runner prints; failed is true when any summary line fails. The deviceLines handed to
//   write end with the kept-log line (describeLogKept(kept)).
import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { request as httpRequest, createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const wire = JSON.parse(readFileSync(join(repo, "apps", "tv", "src", "e2e", "wire", "wire-tests.json"), "utf8")) as { canary: string };
const CANARY = wire.canary;
const TOKEN = "tok-9f8e7d6c5b4a3210";
const LATE = "late-token-0a1b2c3d4e5f";
const SPAN = "span-left?span-right";

type Rec = {
  method: string;
  path: string;
  queryNames: string[];
  authorization: boolean;
  scheme: string | null;
  token: boolean;
  host: string;
  status: number | null;
  retryAfter: string | null;
  secretInUrl: boolean;
};
type Recorder = { port: number; records: Rec[]; close: () => Promise<void> };
type EvidenceModule = {
  STAND_IN: string;
  safeUrlParts: (rawUrl: string, secrets: string[]) => { path: string; queryNames: string[]; secretInUrl: boolean };
  safeRecord: (record: Rec, secrets: string[]) => Rec;
  safeLines: (lines: string[], secrets: string[]) => string[];
  writeEvidence: (
    dir: string,
    input: { captures?: { name: string; records: Rec[] }[]; appLines?: string[]; deviceLines?: string[]; proxyLines?: string[]; secrets: string[] },
  ) => string[];
  writeSummary: (dir: string, lines: string[]) => void;
};
type ProxyModule = { startRecorder: (options: { upstream: { port: number }; secrets: Set<string>; swap?: unknown }) => Promise<Recorder> };
type JudgeModule = { judgeRecords: (records: Rec[], options: { host: string; secrets: string[]; redirects?: boolean }) => string[] };
type RunInput = {
  pairs: { test: string; target: string; task: string; devicePort: number; records: Rec[] }[];
  counts: { canaryOrigin: number; redirector: number; privateLan: number };
  lines: string[];
  logLines: string[];
  seen: { method: string; target: string; host: string }[];
  devicePorts: number[];
  secrets: string[];
  voids: string[];
  kept: { how: string; lines: number; start: boolean; end: boolean; open: boolean };
  deviceLines: string[];
};
type RunnerModule = { judgeRun: (input: RunInput, deps: { write: (evidence: Record<string, unknown>) => string[] }) => { summary: string[]; errors: string[]; failed: boolean } };

const load = async <T>(path: string) => (await import(pathToFileURL(join(repo, path)).href)) as T;
let findSecret: (value: unknown, secrets: string[]) => boolean;
let secretForms: (secret: string) => string[];
const loadEvidence = () => load<EvidenceModule>("scripts/tv-wire-evidence.mjs");
const loadProxy = () => load<ProxyModule>("scripts/tv-wire-proxy.mjs");
const loadJudge = () => load<JudgeModule>("scripts/tv-wire-judge.mjs");
const loadRunner = () => load<RunnerModule>("scripts/tv-wire.mjs");

const b64url = (text: string) => Buffer.from(text, "utf8").toString("base64url");
// Forms with no URL delimiter in them, so each can stand alone in a path segment or a query name.
const SAFE_FORMS = [
  TOKEN,
  encodeURIComponent(TOKEN),
  encodeURIComponent(encodeURIComponent(TOKEN)),
  b64url(TOKEN),
  encodeURIComponent(CANARY),
  encodeURIComponent(encodeURIComponent(CANARY)),
  b64url(CANARY),
];
let ALL_FORMS: string[] = [];

let upstream: Server;
let upstreamPort = 0;
let recorder: Recorder;

function send(port: number, path: string, headers: Record<string, string> = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port, method: "GET", path, headers }, (res) => {
      res.resume();
      res.on("end", () => resolve());
    });
    req.on("error", reject);
    req.end();
  });
}

function filesIn(dir: string): { name: string; text: string }[] {
  return readdirSync(dir).map((name) => ({ name, text: readFileSync(join(dir, name), "utf8") }));
}

function expectClean(dir: string) {
  for (const { name, text } of filesIn(dir)) {
    for (const form of ALL_FORMS) expect(text.includes(form), `${name} holds a form of a secret`).toBe(false);
    expect(findSecret(text, [TOKEN, CANARY, LATE, SPAN]), `${name} holds a secret`).toBe(false);
  }
}

const KNOWN = [TOKEN, CANARY, SPAN];

beforeAll(async () => {
  ({ findSecret, secretForms } = await load<{ findSecret: typeof findSecret; secretForms: typeof secretForms }>("apps/tv/src/e2e/wire/find-secret.ts"));
  ALL_FORMS = [TOKEN, CANARY, LATE, SPAN].flatMap((secret) => secretForms(secret));
  upstream = createServer((_req, res) => res.writeHead(200, { "content-type": "application/json" }).end("{}"));
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", () => resolve()));
  upstreamPort = (upstream.address() as { port: number }).port;
  const { startRecorder } = await loadProxy();
  recorder = await startRecorder({ upstream: { port: upstreamPort }, secrets: new Set(KNOWN) });
});

afterAll(async () => {
  await recorder?.close();
  await new Promise<void>((resolve) => upstream.close(() => resolve()));
});

describe("T3-26 item 1: the recorder and the evidence files", () => {
  it("T3-26 item 1: the recorder's own records hold the stand-in, not a secret, in a path segment", async () => {
    const { STAND_IN } = await loadEvidence();
    const before = recorder.records.length;
    for (const form of SAFE_FORMS) await send(recorder.port, `/Items/${form}/Images`, { authorization: `MediaBrowser Token="${TOKEN}"` });
    const made = recorder.records.slice(before);
    expect(made).toHaveLength(SAFE_FORMS.length);
    for (const record of made) {
      expect(record.path).toBe(STAND_IN);
      expect(record.secretInUrl).toBe(true);
      expect(JSON.stringify(record).includes(TOKEN)).toBe(false);
      for (const form of ALL_FORMS) expect(JSON.stringify(record).includes(form), "a form of a secret in memory").toBe(false);
    }
  });

  it("T3-26 item 1: the recorder's own records hold the stand-in, not a secret, in a query name", async () => {
    const { STAND_IN } = await loadEvidence();
    const before = recorder.records.length;
    for (const form of SAFE_FORMS) await send(recorder.port, `/Items?${form}=1&limit=5`);
    const made = recorder.records.slice(before);
    expect(made).toHaveLength(SAFE_FORMS.length);
    for (const record of made) {
      expect(record.path).toBe("/Items");
      expect(record.queryNames).toEqual([STAND_IN, "limit"]);
      expect(record.secretInUrl).toBe(true);
      for (const form of ALL_FORMS) expect(JSON.stringify(record).includes(form), "a form of a secret in memory").toBe(false);
    }
  });

  it("T3-26 item 1: the written files and the judge, for a secret in a path segment and in a query name", async () => {
    const { writeEvidence } = await loadEvidence();
    const { judgeRecords } = await loadJudge();
    const fresh = await (await loadProxy()).startRecorder({ upstream: { port: upstreamPort }, secrets: new Set(KNOWN) });
    try {
      const sent: string[] = [];
      for (const form of SAFE_FORMS) {
        sent.push(`/Items/${form}/Images`, `/Items?${form}=1`);
      }
      for (const path of sent) await send(fresh.port, path, { authorization: `MediaBrowser Token="${TOKEN}"` });
      const dir = join(mkdtempSync(join(tmpdir(), "wire-ev-")), "release-evidence", "wire");
      writeEvidence(dir, { captures: [{ name: "probe-mock", records: fresh.records }], secrets: KNOWN });
      expectClean(dir);
      const errors = judgeRecords(fresh.records, { host: `127.0.0.1:${fresh.port}`, secrets: KNOWN });
      fresh.records.forEach((_record, index) => {
        expect(
          errors.some((error) => error.includes(`request ${index + 1} `) && /known secret/.test(error)),
          `request ${index + 1} is failed for a secret`,
        ).toBe(true);
      });
      for (const error of errors) for (const form of ALL_FORMS) expect(error.includes(form), "an error quotes a secret").toBe(false);
    } finally {
      await fresh.close();
    }
  });

  it("T3-26 item 1: a secret that spans the question mark replaces the path and every name", async () => {
    const { STAND_IN, writeEvidence } = await loadEvidence();
    const { judgeRecords } = await loadJudge();
    const fresh = await (await loadProxy()).startRecorder({ upstream: { port: upstreamPort }, secrets: new Set(KNOWN) });
    try {
      await send(fresh.port, "/Items/span-left?span-right=1&other=2");
      const [record] = fresh.records;
      expect(record.path).toBe(STAND_IN);
      expect(record.queryNames).toEqual([STAND_IN, STAND_IN]);
      expect(record.secretInUrl).toBe(true);
      const dir = join(mkdtempSync(join(tmpdir(), "wire-ev-")), "release-evidence", "wire");
      writeEvidence(dir, { captures: [{ name: "probe-mock", records: fresh.records }], secrets: KNOWN });
      expectClean(dir);
      expect(judgeRecords(fresh.records, { host: `127.0.0.1:${fresh.port}`, secrets: KNOWN }).some((error) => /known secret/.test(error))).toBe(true);
    } finally {
      await fresh.close();
    }
  });

  it("T3-26 item 1: a secret only in a query value keeps the path and names (the canary raw, with its plus and equals signs)", async () => {
    const { STAND_IN, writeEvidence } = await loadEvidence();
    const { judgeRecords } = await loadJudge();
    const fresh = await (await loadProxy()).startRecorder({ upstream: { port: upstreamPort }, secrets: new Set(KNOWN) });
    try {
      await send(fresh.port, `/Items?api=${CANARY}&limit=5`);
      await send(fresh.port, `/Items?api=${encodeURIComponent(CANARY)}&limit=5`);
      await send(fresh.port, `/Items?api=${TOKEN}&limit=5`);
      expect(fresh.records).toHaveLength(3);
      for (const record of fresh.records) {
        expect(record.path).toBe("/Items");
        expect(record.queryNames).toEqual(["api", "limit"]);
        expect(record.queryNames).not.toContain(STAND_IN);
        expect(record.secretInUrl).toBe(true);
      }
      const dir = join(mkdtempSync(join(tmpdir(), "wire-ev-")), "release-evidence", "wire");
      writeEvidence(dir, { captures: [{ name: "probe-mock", records: fresh.records }], secrets: KNOWN });
      expectClean(dir);
      const errors = judgeRecords(fresh.records, { host: `127.0.0.1:${fresh.port}`, secrets: KNOWN });
      for (let index = 1; index <= 3; index += 1) expect(errors.some((error) => error.includes(`request ${index} `) && /known secret/.test(error))).toBe(true);
    } finally {
      await fresh.close();
    }
  });

  it("T3-26 item 1: a clean request keeps its path and query names exactly, and writeEvidence reports nothing", async () => {
    const { writeEvidence, safeUrlParts } = await loadEvidence();
    expect(safeUrlParts("/Items/abc-123?limit=5&sort=a+b", KNOWN)).toEqual({ path: "/Items/abc-123", queryNames: ["limit", "sort"], secretInUrl: false });
    const fresh = await (await loadProxy()).startRecorder({ upstream: { port: upstreamPort }, secrets: new Set(KNOWN) });
    try {
      await send(fresh.port, "/Items/abc-123?limit=5&sort=a+b", { authorization: 'MediaBrowser Client="x", Token="tok"' });
      const [record] = fresh.records;
      expect(record.path).toBe("/Items/abc-123");
      expect(record.queryNames).toEqual(["limit", "sort"]);
      expect(record.secretInUrl).toBe(false);
      expect(record.scheme).toBe("MediaBrowser");
      const dir = join(mkdtempSync(join(tmpdir(), "wire-ev-")), "release-evidence", "wire");
      expect(writeEvidence(dir, { captures: [{ name: "probe-mock", records: fresh.records }], appLines: ["OCTAVE_WIRE done"], secrets: KNOWN })).toEqual([]);
    } finally {
      await fresh.close();
    }
  });

  it("T3-26 item 1: an Authorization value that is the bare token is recorded with the stand-in scheme", async () => {
    const { STAND_IN } = await loadEvidence();
    const fresh = await (await loadProxy()).startRecorder({ upstream: { port: upstreamPort }, secrets: new Set(KNOWN) });
    try {
      await send(fresh.port, "/Items", { authorization: TOKEN });
      expect(fresh.records[0].scheme).toBe(STAND_IN);
      expect(JSON.stringify(fresh.records[0]).includes(TOKEN)).toBe(false);
    } finally {
      await fresh.close();
    }
  });

  it("T3-26 item 1: a token that joins the secrets after the request is replaced at write time, with an error", async () => {
    const { STAND_IN, writeEvidence } = await loadEvidence();
    const record: Rec = {
      method: "GET",
      path: `/Items/${LATE}`,
      queryNames: ["limit"],
      authorization: true,
      scheme: "MediaBrowser",
      token: true,
      host: "127.0.0.1:47300",
      status: 200,
      retryAfter: null,
      secretInUrl: false,
    };
    const dir = join(mkdtempSync(join(tmpdir(), "wire-ev-")), "release-evidence", "wire");
    const errors = writeEvidence(dir, { captures: [{ name: "probe-mock", records: [record] }], secrets: [...KNOWN, LATE] });
    expectClean(dir);
    expect(errors.length).toBeGreaterThan(0);
    for (const error of errors) {
      expect(error).toMatch(/^ERROR tv wire:/);
      for (const form of ALL_FORMS) expect(error.includes(form)).toBe(false);
    }
    const written = JSON.parse(readFileSync(join(dir, "probe-mock.jsonl"), "utf8").trim().split("\n")[0]) as Rec;
    expect(written.path).toBe(STAND_IN);
    expect(written.secretInUrl).toBe(true);
  });

  it("T3-26 item 1: a bare-token scheme, an app line, a proxied Host and a device line holding a secret are written as the stand-in", async () => {
    const { STAND_IN, writeEvidence } = await loadEvidence();
    const record: Rec = {
      method: "GET",
      path: "/Items",
      queryNames: [],
      authorization: true,
      scheme: TOKEN,
      token: true,
      host: "127.0.0.1:47300",
      status: 200,
      retryAfter: null,
      secretInUrl: false,
    };
    const dir = join(mkdtempSync(join(tmpdir(), "wire-ev-")), "release-evidence", "wire");
    const errors = writeEvidence(dir, {
      captures: [{ name: "probe-mock", records: [record] }],
      appLines: ["OCTAVE_WIRE done", `OCTAVE_WIRE result leaked=${CANARY}`],
      deviceLines: ["adbd up 90 s", `resumed ${TOKEN}`],
      proxyLines: ["1 request(s) reached the global proxy listener", `GET ${CANARY}.example`],
      secrets: KNOWN,
    });
    expectClean(dir);
    expect(errors.length).toBeGreaterThan(0);
    for (const error of errors) expect(error).toMatch(/^ERROR tv wire:/);
    const written = JSON.parse(readFileSync(join(dir, "probe-mock.jsonl"), "utf8").trim().split("\n")[0]) as Rec;
    expect(written.scheme).toBe(STAND_IN);
    expect(readFileSync(join(dir, "app-lines.txt"), "utf8")).toContain(STAND_IN);
    expect(readFileSync(join(dir, "app-lines.txt"), "utf8")).toContain("OCTAVE_WIRE done");
    expect(readFileSync(join(dir, "global-proxy.txt"), "utf8")).toContain(STAND_IN);
    expect(readFileSync(join(dir, "device.txt"), "utf8")).toContain(STAND_IN);
  });

  it("T3-26 item 1: safeRecord never turns secretInUrl false, and safeLines replaces only the lines that hold a secret", async () => {
    const { STAND_IN, safeRecord, safeLines } = await loadEvidence();
    const clean: Rec = {
      method: "GET",
      path: "/Items",
      queryNames: ["limit"],
      authorization: true,
      scheme: "MediaBrowser",
      token: true,
      host: "127.0.0.1:47300",
      status: 200,
      retryAfter: null,
      secretInUrl: true,
    };
    expect(safeRecord(clean, KNOWN).secretInUrl).toBe(true);
    expect(safeRecord({ ...clean, secretInUrl: false }, KNOWN).secretInUrl).toBe(false);
    const dirty = safeRecord({ ...clean, secretInUrl: false, queryNames: [TOKEN, "limit"] }, KNOWN);
    expect(dirty.queryNames).toEqual([STAND_IN, "limit"]);
    expect(dirty.secretInUrl).toBe(true);
    expect(safeLines(["fine", `bad ${TOKEN}`, "fine too"], KNOWN)).toEqual(["fine", STAND_IN, "fine too"]);
  });

  it("T3-26 item 1: writeSummary writes summary.txt with the lines it is given", async () => {
    const { writeSummary } = await loadEvidence();
    const dir = join(mkdtempSync(join(tmpdir(), "wire-ev-")), "release-evidence", "wire");
    writeSummary(dir, ["probe mock T3-05 pass"]);
    expect(existsSync(join(dir, "summary.txt"))).toBe(true);
    expect(readFileSync(join(dir, "summary.txt"), "utf8")).toBe("probe mock T3-05 pass\n");
  });
});

describe("T3-26 item 1: the runner's judging of a run", () => {
  const record = (overrides: Partial<Rec>): Rec => ({
    method: "GET",
    path: "/",
    queryNames: [],
    authorization: true,
    scheme: "MediaBrowser",
    token: true,
    host: "127.0.0.1:47300",
    status: 200,
    retryAfter: null,
    secretInUrl: false,
    ...overrides,
  });
  const PROBE = [
    record({ method: "GET", path: "/System/Info/Public", token: false }),
    record({ method: "POST", path: "/Users/AuthenticateByName", token: false }),
    record({ method: "GET", path: "/UserViews" }),
    record({ method: "POST", path: "/Sessions/Logout" }),
  ];
  const input = (): RunInput => ({
    pairs: [{ test: "transport-probe-then-signed-in", target: "mock", task: "T3-05", devicePort: 47300, records: PROBE }],
    counts: { canaryOrigin: 0, redirector: 0, privateLan: 0 },
    lines: ["OCTAVE_WIRE result test=transport-probe-then-signed-in target=mock task=T3-05 outcome=ok", "OCTAVE_WIRE done"],
    logLines: ["01-01 00:00:00.000  1  1 I ReactNativeJS: fine"],
    seen: [],
    devicePorts: [47300],
    secrets: KNOWN,
    voids: [],
    kept: { how: "stream", lines: 5210, start: true, end: true, open: true },
    deviceLines: ["adbd up 90 s before the reverses"],
  });

  it("T3-26 item 1: with a clean run and a clean write, every pair passes", async () => {
    const { judgeRun } = await loadRunner();
    const result = judgeRun(input(), { write: () => [] });
    expect(result.summary).toEqual(["transport-probe-then-signed-in mock T3-05 pass"]);
    expect(result.failed).toBe(false);
    expect(result.errors).toEqual([]);
  });

  it("T3-26 item 1: a writeEvidence error fails every pair and is printed", async () => {
    const { judgeRun } = await loadRunner();
    const two = input();
    two.pairs.push({ test: "transport-probe-then-signed-in", target: "jellyscale", task: "T3-05", devicePort: 47301, records: PROBE });
    two.lines.splice(1, 0, "OCTAVE_WIRE result test=transport-probe-then-signed-in target=jellyscale task=T3-05 outcome=ok");
    const baseline = judgeRun(two, { write: () => [] });
    expect(baseline.summary.every((line) => line.endsWith(" pass")), baseline.errors.join("\n")).toBe(true);
    const result = judgeRun(two, { write: () => ["ERROR tv wire: app-lines.txt held a secret and was replaced"] });
    expect(result.summary).toHaveLength(2);
    expect(result.summary.every((line) => line.endsWith(" fail"))).toBe(true);
    expect(result.errors).toContain("ERROR tv wire: app-lines.txt held a secret and was replaced");
    expect(result.failed).toBe(true);
  });

  it("T3-26 item 1: the evidence is written once, from the run's records, lines and final secrets", async () => {
    const { judgeRun } = await loadRunner();
    const calls: Record<string, unknown>[] = [];
    judgeRun(input(), {
      write: (evidence) => {
        calls.push(evidence);
        return [];
      },
    });
    expect(calls).toHaveLength(1);
    const [evidence] = calls as { captures: { name: string; records: Rec[] }[]; appLines: string[]; secrets: string[] }[];
    expect(evidence.captures.map((capture) => capture.name)).toEqual(["transport-probe-then-signed-in-mock"]);
    expect(evidence.captures[0].records).toEqual(PROBE);
    expect(evidence.appLines).toContain("OCTAVE_WIRE done");
    expect(evidence.secrets).toEqual(expect.arrayContaining(KNOWN));
  });

  it("T3-26 item 1: scripts/tv-wire.mjs writes only through writeEvidence and writeSummary", () => {
    const source = readFileSync(join(repo, "scripts", "tv-wire.mjs"), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "");
    expect(code).not.toMatch(/writeFileSync|appendFileSync|createWriteStream/);
    expect(code).toMatch(/writeEvidence/);
    expect(code).toMatch(/writeSummary/);
  });
});
