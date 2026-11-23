// @vitest-environment node
// T3-05 acceptance items 2, 3, 4 and 6, the pure half of `pnpm tv:wire` (docs/specs/T3-05.md, "The wire runner").
// The device half (the same rules applied to a real run on the emulator) is item 7's evidence.
//
// The contract frozen here:
// - apps/tv/src/e2e/wire/wire-tests.json: { basePort, tests: [{ id, task, targets }] }, the tagged list the app and the
//   runner both read. A target is one of mock, jellyfin-10-11, jellyfin-12, jellyscale. Each id has a device file
//   apps/tv/src/e2e/wire/<id>.ts.
// - apps/tv/src/e2e/wire/find-secret.ts: findSecret(value, secrets) is truthy when any string or key at any depth of
//   value holds a secret raw, percent-encoded one to four rounds, base64 or base64url; falsy otherwise.
// - scripts/tv-wire.mjs (importing it runs nothing): selectTests({ task? }) returns the list's entries for that task
//   (all entries without one); tasksWithWireTests() returns the task ids that have a wire test.
// - scripts/tv-wire-judge.mjs, each judge returning `ERROR ...` lines, empty for a pass, never quoting a secret:
//   - judgeCapture(records, { expected, host, secrets }): records are what the recorder keeps per request,
//     { method, path, queryNames, authorization, scheme, token, host, status, retryAfter, secretInUrl }, where
//     authorization says whether the header was present, scheme is its scheme (null when absent), token whether its
//     Token field was non-empty, status is null when no answer was recorded, and secretInUrl is the recorder's own
//     finding on the query values it does not keep. expected is the list of "METHOD /path" the test sends. The six
//     tokenless routes (decision 0005: the four PRE_SIGN_IN_ROUTES and the two sign-in posts) must carry an empty
//     Token field; every other request a non-empty one.
//   - judgeLogcat(lines, secrets): the whole logcat dump of the run.
//   - judgeWire({ pairs, lines }): pairs are the selected (test, target) pairs with the host's counts,
//     { test, target, task, requests, redirector?, canaryOrigin? }; lines are the app's OCTAVE_WIRE lines in order:
//     `OCTAVE_WIRE result test=<id> target=<name> task=<task> <word>=<value> ...`, `OCTAVE_WIRE unreachable test=<id>
//     target=<name>` and `OCTAVE_WIRE done`. transport-redirect reports code= and gateway=; transport-canary reports
//     crossings=, selftest= and canary=.
//   - WIRE_JUDGES: the host judge per test id.
//
// Causes are matched with loose patterns, not exact messages. Modules that later milestones create are loaded at run
// time from a path built here, so `pnpm typecheck` does not depend on them existing.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const wireDir = join(repo, "apps", "tv", "src", "e2e", "wire");

type CaptureRecord = {
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
type CaptureOptions = { expected: string[]; host: string; secrets: string[] };
type WirePair = { test: string; target: string; task: string; requests: number; redirector?: number; canaryOrigin?: number };
type WireRun = { pairs: WirePair[]; lines: string[] };
type JudgeModule = {
  judgeCapture: (records: CaptureRecord[], options: CaptureOptions) => string[];
  judgeLogcat: (lines: string[], secrets: string[]) => string[];
  judgeWire: (run: WireRun) => string[];
  WIRE_JUDGES: Record<string, unknown>;
};
type WireEntry = { id: string; task: string; targets: string[] };
type RunnerModule = {
  selectTests: (options: { task?: string }) => WireEntry[];
  tasksWithWireTests: () => Iterable<string>;
};
type FindSecret = (value: unknown, secrets: string[]) => unknown;

async function load<T>(path: string): Promise<T> {
  return (await import(pathToFileURL(join(repo, path)).href)) as T;
}

const loadJudge = () => load<JudgeModule>("scripts/tv-wire-judge.mjs");
const loadRunner = () => load<RunnerModule>("scripts/tv-wire.mjs");
const loadFindSecret = async () => (await load<{ findSecret: FindSecret }>("apps/tv/src/e2e/wire/find-secret.ts")).findSecret;

function wireTests(): { basePort: number; tests: WireEntry[] } {
  return JSON.parse(readFileSync(join(wireDir, "wire-tests.json"), "utf8")) as { basePort: number; tests: WireEntry[] };
}

const T3_05_TESTS = ["transport-probe-then-signed-in", "transport-redirect", "transport-canary", "transport-errors", "transport-private-lan-and-proxy"];
const TARGETS = ["mock", "jellyfin-10-11", "jellyfin-12", "jellyscale"];

// The secrets: a canary of 30 bytes (base64 without padding, and base64 and base64url differ) and a token with
// characters percent-encoding changes.
const CANARY = "octave-canary/7f3e+9b2c=4d1a?>";
const TOKEN = "tok/3f9a+b7c=0d1e";
const PASSWORD = "fixture-pw-5b1c9e";
const PLACEHOLDER = "wire-placeholder-pw";

function encodeRounds(text: string, rounds: number): string {
  let out = text;
  for (let i = 0; i < rounds; i += 1) out = encodeURIComponent(out);
  return out;
}

const base64 = (text: string) => Buffer.from(text, "utf8").toString("base64");
const base64url = (text: string) => Buffer.from(text, "utf8").toString("base64url");

// Every form a judge must not print.
function secretForms(secret: string): string[] {
  return [secret, encodeRounds(secret, 1), encodeRounds(secret, 2), base64(secret)];
}

function expectNoSecretIn(errors: string[], secrets: string[]) {
  const text = errors.join("\n");
  for (const secret of secrets) for (const form of secretForms(secret)) expect(text).not.toContain(form);
}

// ---- item 3: the capture of transport-probe-then-signed-in ----

const HOST = "127.0.0.1:47301";
const EXPECTED = ["GET /System/Info/Public", "POST /Users/AuthenticateByName", "GET /UserViews", "POST /Sessions/Logout"];

function record(method: string, path: string, token: boolean, extra: Partial<CaptureRecord> = {}): CaptureRecord {
  return { method, path, queryNames: [], authorization: true, scheme: "MediaBrowser", token, host: HOST, status: 200, retryAfter: null, secretInUrl: false, ...extra };
}

function capture(): CaptureRecord[] {
  return [
    record("GET", "/System/Info/Public", false),
    record("POST", "/Users/AuthenticateByName", false),
    record("GET", "/UserViews", true, { queryNames: ["userId"] }),
    record("POST", "/Sessions/Logout", true, { status: 204 }),
  ];
}

const OPTIONS: CaptureOptions = { expected: EXPECTED, host: HOST, secrets: [TOKEN, PLACEHOLDER] };

async function captureErrors(records: CaptureRecord[], options: CaptureOptions = OPTIONS): Promise<string[]> {
  const errors = (await loadJudge()).judgeCapture(records, options);
  expectNoSecretIn(errors, options.secrets);
  return errors;
}

function withRecord(index: number, change: Partial<CaptureRecord>): CaptureRecord[] {
  const records = capture();
  records[index] = { ...records[index], ...change };
  return records;
}

describe("T3-05 item 3: the probe and the signed-in call carry the header, the token only on the second, and no URL holds it", () => {
  it("passes the expected four-request capture", async () => {
    expect(await captureErrors(capture())).toEqual([]);
  });

  it("fails a token on the probe or on the sign-in", async () => {
    const probe = await captureErrors(withRecord(0, { token: true }));
    expect(probe.length).toBeGreaterThan(0);
    expect(probe.join("\n")).toMatch(/System\/Info\/Public/);
    expect(probe.join("\n")).toMatch(/token/i);
    const signIn = await captureErrors(withRecord(1, { token: true }));
    expect(signIn.length).toBeGreaterThan(0);
    expect(signIn.join("\n")).toMatch(/AuthenticateByName/);
  });

  it("fails no token on the signed-in call or on the logout", async () => {
    const views = await captureErrors(withRecord(2, { token: false }));
    expect(views.length).toBeGreaterThan(0);
    expect(views.join("\n")).toMatch(/UserViews/);
    expect(views.join("\n")).toMatch(/token/i);
    const logout = await captureErrors(withRecord(3, { token: false }));
    expect(logout.length).toBeGreaterThan(0);
    expect(logout.join("\n")).toMatch(/Sessions\/Logout/);
  });

  it("fails a request without the Authorization header, on any of the four", async () => {
    for (let index = 0; index < 4; index += 1) {
      const errors = await captureErrors(withRecord(index, { authorization: false, scheme: null, token: false }));
      expect(errors.length, String(index)).toBeGreaterThan(0);
      expect(errors.join("\n")).toMatch(/authorization|header/i);
    }
  });

  it("fails a scheme other than MediaBrowser", async () => {
    for (const scheme of ["Emby", "Bearer", "mediabrowser2"]) {
      const errors = await captureErrors(withRecord(2, { scheme }));
      expect(errors.length, scheme).toBeGreaterThan(0);
      expect(errors.join("\n")).toMatch(/scheme|MediaBrowser/i);
    }
  });

  it("fails a credential query name", async () => {
    for (const name of ["api_key", "ApiKey", "X-Emby-Token", "access_token"]) {
      const errors = await captureErrors(withRecord(2, { queryNames: ["userId", name] }));
      expect(errors.length, name).toBeGreaterThan(0);
      expect(errors.join("\n")).toMatch(/query|credential/i);
    }
  });

  it("fails a URL that holds a known secret, raw or percent-encoded up to four rounds, in the path or a query name", async () => {
    for (const secret of [TOKEN, PLACEHOLDER]) {
      for (let rounds = 0; rounds <= 4; rounds += 1) {
        const form = encodeRounds(secret, rounds);
        const errors = await captureErrors(withRecord(2, { queryNames: ["userId", `x${form}`] }));
        expect(errors.length, `${secret} after ${rounds} rounds`).toBeGreaterThan(0);
      }
    }
    const inPath = await captureErrors([...capture(), record("GET", `/Users/${encodeRounds(TOKEN, 2)}`, true)], {
      ...OPTIONS,
      expected: [...EXPECTED, `GET /Users/${encodeRounds(TOKEN, 2)}`],
    });
    expect(inPath.length).toBeGreaterThan(0);
  });

  it("fails a request the recorder found a secret in", async () => {
    const errors = await captureErrors(withRecord(2, { secretInUrl: true }));
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join("\n")).toMatch(/URL|query|secret|token/i);
  });

  it("fails a 3xx relayed to the app", async () => {
    for (const status of [301, 302, 307, 308]) {
      const errors = await captureErrors(withRecord(0, { status }));
      expect(errors.length, String(status)).toBeGreaterThan(0);
      expect(errors.join("\n")).toMatch(/redirect|3\d\d/i);
    }
  });

  it("fails a Host that is not the recorder's", async () => {
    const errors = await captureErrors(withRecord(2, { host: "jellyfin.example:8096" }));
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join("\n")).toMatch(/host/i);
  });

  it("fails an empty capture", async () => {
    const errors = await captureErrors([]);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("fails a request count other than expected", async () => {
    expect((await captureErrors(capture().slice(0, 3))).length).toBeGreaterThan(0);
    expect((await captureErrors([...capture(), record("GET", "/Users/Me", true)])).length).toBeGreaterThan(0);
  });

  it("allows the transport's one re-send of a GET whose first attempt has no recorded status", async () => {
    const records = capture();
    records.splice(2, 0, { ...records[2], status: null });
    expect(await captureErrors(records)).toEqual([]);
  });

  it("allows OkHttp's one re-send straight after a 503 with Retry-After: 0", async () => {
    const records = capture();
    records.splice(0, 0, { ...records[0], status: 503, retryAfter: "0" });
    expect(await captureErrors(records)).toEqual([]);
  });

  it("fails a second identical GET after a recorded status (spec check note 8)", async () => {
    const records = capture();
    records.splice(2, 0, { ...records[2], status: 200 });
    expect((await captureErrors(records)).length).toBeGreaterThan(0);
  });

  it("fails a second send of a POST, a third send of a GET, and a re-send that is not identical", async () => {
    const post = capture();
    post.splice(1, 0, { ...post[1], status: null });
    expect((await captureErrors(post)).length, "POST re-sent").toBeGreaterThan(0);

    const third = capture();
    third.splice(2, 0, { ...third[2], status: null }, { ...third[2], status: null });
    expect((await captureErrors(third)).length, "GET sent three times").toBeGreaterThan(0);

    const different = capture();
    different.splice(2, 0, { ...different[2], status: null, queryNames: ["userId", "Fields"] });
    expect((await captureErrors(different)).length, "a different request before the GET").toBeGreaterThan(0);
  });
});

// ---- item 4: the canary appears nowhere ----

describe("T3-05 item 4: a canary token appears in no logcat line, React Native event, prop or error message", () => {
  it("findSecret finds the canary raw and percent-encoded one to four rounds", async () => {
    const findSecret = await loadFindSecret();
    for (let rounds = 0; rounds <= 4; rounds += 1) {
      expect(findSecret(`before ${encodeRounds(CANARY, rounds)} after`, [CANARY]), `${rounds} rounds`).toBeTruthy();
    }
  });

  it("findSecret finds the canary as base64 and as base64url", async () => {
    const findSecret = await loadFindSecret();
    expect(base64(CANARY)).not.toBe(base64url(CANARY));
    expect(findSecret(`blob ${base64(CANARY)} end`, [CANARY])).toBeTruthy();
    expect(findSecret(`blob ${base64url(CANARY)} end`, [CANARY])).toBeTruthy();
  });

  it("findSecret finds the canary in a nested value and in a key", async () => {
    const findSecret = await loadFindSecret();
    expect(findSecret({ a: [1, null, true, { b: [`x${CANARY}y`] }] }, [CANARY])).toBeTruthy();
    expect(findSecret({ a: [{ [`key-${CANARY}`]: 1 }] }, [CANARY])).toBeTruthy();
    expect(findSecret({ a: { [encodeRounds(CANARY, 2)]: "v" } }, [CANARY])).toBeTruthy();
    expect(findSecret(["ok", { message: "fine" }], [TOKEN, CANARY])).toBeFalsy();
    expect(findSecret({ a: [{ b: [`x${TOKEN}y`] }] }, [CANARY, TOKEN])).toBeTruthy();
  });

  it("findSecret finds nothing in a clean value, including one that holds only part of the canary", async () => {
    const findSecret = await loadFindSecret();
    const part = CANARY.slice(0, CANARY.length - 3);
    expect(findSecret({ session: "session-1", items: [{ Id: "a", Name: part }], n: 3, ok: true, none: null }, [CANARY])).toBeFalsy();
    expect(findSecret("", [CANARY])).toBeFalsy();
    expect(findSecret(undefined, [CANARY])).toBeFalsy();
  });

  const CLEAN = [
    "11-21 19:00:00.000  4242  4260 I ReactNativeJS: OCTAVE_WIRE result test=transport-canary target=mock task=T3-05 crossings=64 selftest=ok canary=absent",
    "11-21 19:00:00.100  4242  4242 D OkHttp  : nothing here",
    "11-21 19:00:00.200   812   900 I ActivityManager: Start proc 4242:cloud.jellyscale.octave/u0a123",
    "11-21 19:00:00.300  4242  4260 I ReactNativeJS: OCTAVE_WIRE done",
  ];
  const SECRETS = [CANARY, TOKEN, PASSWORD, PLACEHOLDER];

  async function logcatErrors(lines: string[]): Promise<string[]> {
    const errors = (await loadJudge()).judgeLogcat(lines, SECRETS);
    expectNoSecretIn(errors, SECRETS);
    return errors;
  }

  it("judgeLogcat passes a clean dump", async () => {
    expect(await logcatErrors(CLEAN)).toEqual([]);
  });

  it("judgeLogcat fails a planted canary line and a planted password line", async () => {
    for (const secret of SECRETS) {
      const planted = [...CLEAN.slice(0, 2), `11-21 19:00:00.150  4242  4260 W ReactNativeJS: oops ${secret}`, ...CLEAN.slice(2)];
      expect((await logcatErrors(planted)).length, secret).toBeGreaterThan(0);
    }
    const encoded = [...CLEAN, `11-21 19:00:00.400  4242  4261 E OctaveSession: url=/x?y=${encodeURIComponent(CANARY)}`];
    expect((await logcatErrors(encoded)).length).toBeGreaterThan(0);
  });

  it('judgeLogcat fails Token=" followed by a non-quote, whatever the token', async () => {
    const header = [...CLEAN, '11-21 19:00:00.400  4242  4261 I System.out: MediaBrowser Client="Octave", Token="0123456789abcdef"'];
    expect((await logcatErrors(header)).length).toBeGreaterThan(0);
  });

  const REDIRECT_PAIR: WirePair = { test: "transport-redirect", target: "mock", task: "T3-05", requests: 1, redirector: 1, canaryOrigin: 0 };
  const CANARY_PAIR: WirePair = { test: "transport-canary", target: "mock", task: "T3-05", requests: 6, canaryOrigin: 0 };
  const CANARY_LINE = "OCTAVE_WIRE result test=transport-canary target=mock task=T3-05 crossings=64 selftest=ok canary=absent";

  it("judgeWire passes a transport-canary report with enough crossings, a passing self-test and no canary", async () => {
    const { judgeWire } = await loadJudge();
    expect(judgeWire({ pairs: [CANARY_PAIR], lines: [CANARY_LINE, "OCTAVE_WIRE done"] })).toEqual([]);
  });

  it("judgeWire fails a transport-canary report with too few crossings, a failed self-test or the canary present", async () => {
    const { judgeWire } = await loadJudge();
    const run = (line: string) => judgeWire({ pairs: [CANARY_PAIR], lines: [line, "OCTAVE_WIRE done"] });
    expect(run(CANARY_LINE.replace("crossings=64", "crossings=0")).join("\n")).toMatch(/crossing/i);
    expect(run(CANARY_LINE.replace("selftest=ok", "selftest=fail")).join("\n")).toMatch(/self-?test/i);
    expect(run(CANARY_LINE.replace("canary=absent", "canary=present")).join("\n")).toMatch(/canary/i);
    expect(run(CANARY_LINE.replace(" crossings=64", "")).length).toBeGreaterThan(0);
    expect(run(CANARY_LINE.replace(" canary=absent", "")).length).toBeGreaterThan(0);
  });

  it("judgeWire still passes a redirect pair beside it, so the canary cases fail for their own cause", async () => {
    const { judgeWire } = await loadJudge();
    const lines = ["OCTAVE_WIRE result test=transport-redirect target=mock task=T3-05 code=redirect gateway=redirect", CANARY_LINE, "OCTAVE_WIRE done"];
    expect(judgeWire({ pairs: [REDIRECT_PAIR, CANARY_PAIR], lines })).toEqual([]);
  });
});

// ---- item 2: the redirect pair ----

describe("T3-05 item 2: judgeWire holds the redirect test to the redirect error and an untouched canary origin", () => {
  const PAIR: WirePair = { test: "transport-redirect", target: "mock", task: "T3-05", requests: 1, redirector: 1, canaryOrigin: 0 };
  const LINE = "OCTAVE_WIRE result test=transport-redirect target=mock task=T3-05 code=redirect gateway=redirect";
  const judge = async (pair: WirePair, line: string) => (await loadJudge()).judgeWire({ pairs: [pair], lines: [line, "OCTAVE_WIRE done"] });

  it("passes a report with code redirect, a redirector that saw the request and a canary origin that saw none", async () => {
    expect(await judge(PAIR, LINE)).toEqual([]);
  });

  it("fails a report whose code is not redirect", async () => {
    for (const code of ["network", "refused", "unexpected-response", "ok"]) {
      const errors = await judge(PAIR, LINE.replace("code=redirect", `code=${code}`));
      expect(errors.length, code).toBeGreaterThan(0);
      expect(errors.join("\n")).toMatch(/redirect/i);
    }
    expect((await judge(PAIR, LINE.replace(" code=redirect", ""))).length).toBeGreaterThan(0);
  });

  it("fails a run whose redirector saw no request", async () => {
    const errors = await judge({ ...PAIR, redirector: 0 }, LINE);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join("\n")).toMatch(/redirector/i);
  });

  it("fails a run whose canary origin saw any request", async () => {
    for (const canaryOrigin of [1, 3]) {
      const errors = await judge({ ...PAIR, canaryOrigin }, LINE);
      expect(errors.length, String(canaryOrigin)).toBeGreaterThan(0);
      expect(errors.join("\n")).toMatch(/canary/i);
    }
  });
});

// ---- item 6: pnpm tv:wire, the tagged list and the run judge ----

describe("T3-05 item 6: pnpm tv:wire runs tagged wire tests, each carrying the id of the task it proves", () => {
  it("is a root script that runs scripts/tv-wire.mjs", () => {
    const scripts = (JSON.parse(readFileSync(join(repo, "package.json"), "utf8")) as { scripts: Record<string, string> }).scripts;
    expect(scripts["tv:wire"]).toMatch(/^node scripts\/tv-wire\.mjs\b/);
    expect(existsSync(join(repo, "scripts", "tv-wire.mjs"))).toBe(true);
  });

  it("lists each test once with a task id and at least one known target, and a device file per test", () => {
    const list = wireTests();
    expect(Number.isInteger(list.basePort)).toBe(true);
    expect(list.basePort).toBeGreaterThan(1023);
    expect(list.basePort).toBeLessThan(65536);
    expect(list.tests.length).toBeGreaterThan(0);
    const ids = list.tests.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of list.tests) {
      expect(entry.id, JSON.stringify(entry)).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(entry.task, entry.id).toMatch(/^T\d+-\d+$/);
      expect(Array.isArray(entry.targets) && entry.targets.length > 0, entry.id).toBe(true);
      expect(new Set(entry.targets).size, entry.id).toBe(entry.targets.length);
      for (const target of entry.targets) expect(TARGETS, `${entry.id} ${target}`).toContain(target);
      expect(existsSync(join(wireDir, `${entry.id}.ts`)), `apps/tv/src/e2e/wire/${entry.id}.ts`).toBe(true);
    }
  });

  it("gives T3-05 its five tests, with the capture on the mock and all three pinned servers", () => {
    const byId = new Map(wireTests().tests.map((entry) => [entry.id, entry]));
    for (const id of T3_05_TESTS) expect(byId.get(id)?.task, id).toBe("T3-05");
    expect([...(byId.get("transport-probe-then-signed-in")?.targets ?? [])].sort()).toEqual([...TARGETS].sort());
    for (const id of ["transport-redirect", "transport-canary", "transport-errors", "transport-private-lan-and-proxy"]) {
      expect(byId.get(id)?.targets, id).toEqual(["mock"]);
    }
  });

  it("has a host judge for every test", async () => {
    const { WIRE_JUDGES } = await loadJudge();
    for (const entry of wireTests().tests) expect(typeof WIRE_JUDGES[entry.id], entry.id).toBe("function");
  });

  it("selects exactly T3-05's five tests by task, and every test without one", async () => {
    const { selectTests } = await loadRunner();
    const selected = selectTests({ task: "T3-05" });
    expect(selected.map((entry) => entry.id).sort()).toEqual([...T3_05_TESTS].sort());
    for (const entry of selected) expect(entry.task).toBe("T3-05");
    expect(selectTests({}).map((entry) => entry.id).sort()).toEqual(wireTests().tests.map((entry) => entry.id).sort());
    expect(selectTests({ task: "T99-99" })).toEqual([]);
  });

  it("names T3-05 among the tasks that have wire tests", async () => {
    const { tasksWithWireTests } = await loadRunner();
    const tasks = [...tasksWithWireTests()];
    expect(tasks).toContain("T3-05");
    expect(new Set(tasks)).toEqual(new Set(wireTests().tests.map((entry) => entry.task)));
  });

  const PAIRS: WirePair[] = [
    { test: "transport-redirect", target: "mock", task: "T3-05", requests: 1, redirector: 1, canaryOrigin: 0 },
    { test: "transport-canary", target: "mock", task: "T3-05", requests: 6, canaryOrigin: 0 },
  ];
  const LINES = [
    "OCTAVE_WIRE result test=transport-redirect target=mock task=T3-05 code=redirect gateway=redirect",
    "OCTAVE_WIRE result test=transport-canary target=mock task=T3-05 crossings=64 selftest=ok canary=absent",
    "OCTAVE_WIRE done",
  ];

  it("judgeWire passes a complete run", async () => {
    const { judgeWire } = await loadJudge();
    expect(judgeWire({ pairs: PAIRS, lines: LINES })).toEqual([]);
  });

  it("judgeWire fails a run with a selected test missing", async () => {
    const { judgeWire } = await loadJudge();
    const errors = judgeWire({ pairs: PAIRS, lines: LINES.filter((line) => !line.includes("test=transport-canary")) });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join("\n")).toMatch(/transport-canary/);
  });

  it("judgeWire fails a run with a selected target unreachable", async () => {
    const { judgeWire } = await loadJudge();
    const errors = judgeWire({ pairs: PAIRS, lines: ["OCTAVE_WIRE unreachable test=transport-canary target=mock", ...LINES] });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join("\n")).toMatch(/unreachable/i);
  });

  it("judgeWire fails a run with no done line", async () => {
    const { judgeWire } = await loadJudge();
    const errors = judgeWire({ pairs: PAIRS, lines: LINES.filter((line) => line !== "OCTAVE_WIRE done") });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join("\n")).toMatch(/done/i);
  });

  it("judgeWire fails a run with zero recorded requests", async () => {
    const { judgeWire } = await loadJudge();
    const errors = judgeWire({ pairs: [{ ...PAIRS[1], requests: 0 }], lines: [LINES[1], "OCTAVE_WIRE done"] });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join("\n")).toMatch(/request|empty|capture/i);
  });

  it("judgeWire fails a run that selected nothing", async () => {
    const { judgeWire } = await loadJudge();
    expect(judgeWire({ pairs: [], lines: ["OCTAVE_WIRE done"] }).length).toBeGreaterThan(0);
  });
});
