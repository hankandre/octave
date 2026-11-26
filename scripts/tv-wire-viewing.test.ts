// @vitest-environment node
// T8-03 items 2, 4, 7 and 8, the host half of the wire test player-viewing (docs/specs/T8-03.md, D10 and Test plan).
// The device half (the same judges on a real run of `pnpm tv:wire --task T8-03`) is item 8's gate:
// release-evidence/wire/summary.txt from CI's wire job on the pull request's head.
//
// The contract frozen here, beside T3-05's (scripts/tv-wire.test.ts) and T8-02's (scripts/tv-wire-player.test.ts):
// - apps/tv/src/e2e/wire/wire-tests.json lists { "id": "player-viewing", "task": "T8-03", "targets": ["jellyscale"] }
//   once, with a device file apps/tv/src/e2e/wire/player-viewing.ts that run-wire.ts names in TESTS, and
//   scripts/tv-wire-judge.mjs has a WIRE_JUDGES entry for it.
// - The recorder (scripts/tv-wire-proxy.mjs, startRecorder) adds `report` to every POST /Sessions/Playing,
//   /Sessions/Playing/Progress and /Sessions/Playing/Stopped record and to no other: { position, paused, failed,
//   method }, where position is the whole seconds of the body's PositionTicks, paused its IsPaused, failed its Failed
//   and method its PlayMethod, each read only when its JSON type is right and else null. Nothing else of the body is
//   kept.
// - scripts/tv-wire-judge.mjs exports judgeViewingCapture(records, words) -> ERROR lines, where `words` is the app's
//   result line as an object. It needs outcome=ok start=after-first-frame resume=at-reported resumed=within-10s; two
//   viewings, each in order exactly one POST /Sessions/Playing, progress posts, exactly one
//   POST /Sessions/Playing/Stopped, each answered 2xx; at least two progress posts in the first viewing and zero or
//   more in the second; in the first viewing two progress positions 8 s or more apart, one progress post paused, and a
//   Stopped with failed false at position 20 or later; the second viewing's Playing within 10 s of the first Stopped;
//   every report's method DirectPlay; and the media requests as judgePlayerCapture holds them.
// - judgeRun (scripts/tv-wire.mjs) judges a player-viewing pair with judgeRecords and these rules; its summary line is
//   "player-viewing jellyscale T8-03 pass|fail".
import { createServer, request as httpRequest, type Server } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const wireDir = join(repo, "apps", "tv", "src", "e2e", "wire");

type Report = { position: number | null; paused: boolean | null; failed: boolean | null; method: string | null };
type ViewingRecord = {
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
  range: boolean;
  staticTrue: boolean;
  report?: Report;
};
type Words = Record<string, string>;
type JudgeModule = {
  judgeViewingCapture: (records: ViewingRecord[], words: Words) => string[];
  WIRE_JUDGES: Record<string, unknown>;
};
type RunInput = {
  pairs: { test: string; target: string; task: string; devicePort: number; records: ViewingRecord[] }[];
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
type RunnerModule = {
  judgeRun: (input: RunInput, deps: { write: (evidence: unknown) => string[] }) => { summary: string[]; errors: string[]; failed: boolean };
  selectTests: (options: { task?: string }) => { id: string; task: string; targets: string[] }[];
};
type Recorder = { port: number; records: ViewingRecord[]; close: () => Promise<void> };
type ProxyModule = { startRecorder: (options: { upstream: { port: number }; secrets: Set<string> }) => Promise<Recorder> };

const load = async <T>(path: string) => (await import(pathToFileURL(join(repo, path)).href)) as T;
const loadJudge = () => load<JudgeModule>("scripts/tv-wire-judge.mjs");
const loadRunner = () => load<RunnerModule>("scripts/tv-wire.mjs");
const loadProxy = () => load<ProxyModule>("scripts/tv-wire-proxy.mjs");

const SERIES = "5e2d9c4b7a1f4083b6c5d4e3f2a19087";
const EPISODE = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const STREAM = `/Videos/${EPISODE}/stream`;
const PORT = 47311;
const HOST = `127.0.0.1:${PORT}`;
const TOKEN = "tok/7c1e+3a9b=5d0f";

const PLAYING = "/Sessions/Playing";
const PROGRESS = "/Sessions/Playing/Progress";
const STOPPED = "/Sessions/Playing/Stopped";

function rec(method: string, path: string, extra: Partial<ViewingRecord> = {}): ViewingRecord {
  const tokenless = path === "/System/Info/Public" || path === "/Users/AuthenticateByName";
  return {
    method,
    path,
    queryNames: [],
    authorization: true,
    scheme: "MediaBrowser",
    token: !tokenless,
    host: HOST,
    status: 200,
    retryAfter: null,
    secretInUrl: false,
    range: false,
    staticTrue: false,
    ...extra,
  };
}

const stream = (extra: Partial<ViewingRecord> = {}) =>
  rec("GET", STREAM, { queryNames: ["Static", "MediaSourceId", "PlaySessionId"], staticTrue: true, range: true, status: 206, ...extra });

// One playstate post. Only a Stopped body carries Failed (gateway.ts, report).
function post(path: string, position: number, change: Partial<Report> = {}): ViewingRecord {
  const failed = path === STOPPED ? false : null;
  return rec("POST", path, { status: 204, report: { position, paused: false, failed, method: "DirectPlay", ...change } });
}

const negotiation = (): ViewingRecord[] => [
  rec("GET", `/Items/${EPISODE}`, { queryNames: ["userId"] }),
  rec("POST", `/Items/${EPISODE}/PlaybackInfo`, { queryNames: ["UserId", "StartTimeTicks"] }),
  stream({ range: false, status: 200 }),
  stream(),
];

// The first viewing: start, the 10 s tick, pause and resume at 12 s, the 20 s tick, then Back at 25 s.
const firstViewing = (): ViewingRecord[] => [post(PLAYING, 0), post(PROGRESS, 9), post(PROGRESS, 12, { paused: true }), post(PROGRESS, 12), post(PROGRESS, 20), post(STOPPED, 25)];

// The second viewing stops right after its first frame, here before any progress post.
const secondViewing = (): ViewingRecord[] => [post(PLAYING, 25), post(STOPPED, 26)];

function capture(first: ViewingRecord[] = firstViewing(), second: ViewingRecord[] = secondViewing()): ViewingRecord[] {
  return [
    rec("GET", "/System/Info/Public", { token: false }),
    rec("POST", "/Users/AuthenticateByName", { token: false }),
    rec("GET", "/Items", { queryNames: ["searchTerm", "IncludeItemTypes", "Recursive"] }),
    rec("GET", `/Shows/${SERIES}/Seasons`, { queryNames: ["userId"] }),
    rec("GET", `/Shows/${SERIES}/Episodes`, { queryNames: ["userId", "seasonId"] }),
    rec("DELETE", `/UserPlayedItems/${EPISODE}`, { queryNames: ["userId"] }),
    ...negotiation(),
    ...first,
    rec("GET", "/UserItems/Resume", { queryNames: ["userId"] }),
    rec("GET", "/UserItems/Resume", { queryNames: ["userId"] }),
    ...negotiation(),
    ...second,
    rec("POST", "/Sessions/Logout", { status: 204 }),
  ];
}

// `viewing` with the report facts of its nth record changed.
function withReport(viewing: ViewingRecord[], nth: number, change: Partial<Report>): ViewingRecord[] {
  return viewing.map((record, index) => {
    if (index !== nth || record.report === undefined) return record;
    return { ...record, report: { ...record.report, ...change } };
  });
}

function withRecord(viewing: ViewingRecord[], nth: number, change: Partial<ViewingRecord>): ViewingRecord[] {
  return viewing.map((record, index) => (index === nth ? { ...record, ...change } : record));
}

const without = (viewing: ViewingRecord[], nth: number) => viewing.filter((_record, index) => index !== nth);

const words = (line: string): Words => Object.fromEntries([...line.matchAll(/(\S+?)=(\S*)/g)].map(([, key, value]) => [key, value]));

const OK = "outcome=ok start=after-first-frame resume=at-reported resumed=within-10s";
const said = (change: Words = {}): Words => ({ ...words(OK), ...change });

async function judge(records: ViewingRecord[], line: Words = said()): Promise<string[]> {
  const { judgeViewingCapture } = await loadJudge();
  return judgeViewingCapture(records, line);
}

function runInput(records: ViewingRecord[], line: string = OK): RunInput {
  return {
    pairs: [{ test: "player-viewing", target: "jellyscale", task: "T8-03", devicePort: PORT, records }],
    counts: { canaryOrigin: 0, redirector: 0, privateLan: 0 },
    lines: [`OCTAVE_WIRE result test=player-viewing target=jellyscale task=T8-03 ${line}`, "OCTAVE_WIRE done"],
    logLines: ["01-01 00:00:00.000  1  1 I ReactNativeJS: fine"],
    seen: [],
    devicePorts: [PORT],
    secrets: [TOKEN],
    voids: [],
    kept: { how: "stream", lines: 900, start: true, end: true, open: true },
    deviceLines: [],
  };
}

async function run(records: ViewingRecord[], line: string = OK) {
  const { judgeRun } = await loadRunner();
  return judgeRun(runInput(records, line), { write: () => [] });
}

async function expectPass(records: ViewingRecord[], name = "the capture") {
  expect(await judge(records), name).toEqual([]);
}

async function expectFail(records: ViewingRecord[], name: string, line: Words = said()) {
  expect((await judge(records, line)).length, name).toBeGreaterThan(0);
}

// ---- item 2: the three reports ----

describe("T8-03 item 2: the wire shows a start, progress through the viewing and one stop", () => {
  it("T8-03 item 2: judgeViewingCapture passes two viewings with their reports in order", async () => {
    await expectPass(capture());
  });

  it("T8-03 item 2: passes a second viewing with no progress post, and one with a progress post", async () => {
    await expectPass(capture(firstViewing(), [post(PLAYING, 25), post(STOPPED, 26)]), "no progress post");
    await expectPass(capture(firstViewing(), [post(PLAYING, 25), post(PROGRESS, 25), post(STOPPED, 26)]), "one progress post");
  });

  it("T8-03 item 2: fails a first viewing with fewer than two progress posts", async () => {
    await expectFail(capture([post(PLAYING, 0), post(PROGRESS, 12, { paused: true }), post(STOPPED, 25)]), "one progress post");
    await expectFail(capture([post(PLAYING, 0), post(STOPPED, 25)]), "no progress post");
  });

  it("T8-03 item 2: fails the words when the start did not come after the first frame, or the run did not finish", async () => {
    await expectPass(capture());
    await expectFail(capture(), "start before the first frame", said({ start: "before-first-frame" }));
    await expectFail(capture(), "outcome threw", said({ outcome: "threw" }));
    for (const key of ["outcome", "start", "resume", "resumed"]) {
      const missing = said();
      delete missing[key];
      await expectFail(capture(), `no ${key}`, missing);
    }
  });

  it("T8-03 item 2: needs two progress positions of the first viewing 8 s or more apart", async () => {
    const positions = (late: number) => [post(PLAYING, 0), post(PROGRESS, 10), post(PROGRESS, 12, { paused: true }), post(PROGRESS, late), post(STOPPED, 25)];
    await expectPass(capture(positions(18)), "exactly 8 s apart");
    await expectFail(capture(positions(17)), "7 s apart");
    const stale = [post(PLAYING, 0), post(PROGRESS, 0), post(PROGRESS, 0, { paused: true }), post(PROGRESS, 0), post(STOPPED, 25)];
    await expectFail(capture(stale, [post(PLAYING, 25), post(PROGRESS, 40), post(STOPPED, 41)]), "stale in the first viewing, apart only against the second");
    const unread = withReport(withReport(positions(18), 1, { position: null }), 2, { position: null });
    await expectFail(capture(unread), "only one position was read");
  });

  it("T8-03 item 2: needs a paused progress post in the first viewing", async () => {
    await expectPass(capture());
    await expectFail(capture(withReport(firstViewing(), 2, { paused: false })), "no paused progress");
    await expectFail(capture(withReport(firstViewing(), 2, { paused: null })), "paused was not read");
    const pausedElsewhere = capture(withReport(firstViewing(), 2, { paused: false }), [post(PLAYING, 25), post(PROGRESS, 25, { paused: true }), post(STOPPED, 26)]);
    await expectFail(pausedElsewhere, "paused only in the second viewing");
  });

  it("T8-03 item 2: needs the first Stopped not failed, at 20 s or later", async () => {
    await expectPass(capture(withReport(firstViewing(), 5, { position: 20 }), [post(PLAYING, 20), post(STOPPED, 21)]), "stopped at 20 s");
    await expectFail(capture(withReport(firstViewing(), 5, { position: 19 }), [post(PLAYING, 19), post(STOPPED, 20)]), "stopped at 19 s");
    await expectFail(capture(withReport(firstViewing(), 5, { failed: true })), "a Stopped with failed true");
    await expectFail(capture(withReport(firstViewing(), 5, { failed: null })), "failed was not read");
    await expectFail(capture(withReport(firstViewing(), 5, { position: null })), "the stop position was not read");
  });

  it("T8-03 item 2: fails a broken order in the first viewing", async () => {
    await expectPass(capture());
    const good = firstViewing();
    const [start, tick, paused, resumed, later, stop] = good;
    const cases: [string, ViewingRecord[]][] = [
      ["no start", without(good, 0)],
      ["no stop", without(good, 5)],
      ["a second start", [start, start, tick, paused, resumed, later, stop]],
      ["a second stop", [...good, stop]],
      ["a progress post before the start", [tick, start, paused, resumed, later, stop]],
      ["a progress post after the stop", [start, tick, paused, resumed, stop, later]],
      ["the stop before the start", [stop, tick, paused, resumed, later, start]],
    ];
    for (const [name, first] of cases) await expectFail(capture(first), name);
  });

  it("T8-03 item 2: fails a broken order in the second viewing, one viewing only, or a third", async () => {
    await expectPass(capture());
    const [start, stop] = secondViewing();
    const tick = post(PROGRESS, 25);
    const cases: [string, ViewingRecord[]][] = [
      ["no second viewing", []],
      ["no start", [stop]],
      ["no stop", [start]],
      ["a second start", [start, start, stop]],
      ["a second stop", [start, stop, stop]],
      ["the stop before the start", [stop, start]],
      ["a progress post before the start", [tick, start, stop]],
      ["a progress post after the stop", [start, stop, tick]],
      ["a third viewing", [start, stop, post(PLAYING, 26), post(STOPPED, 27)]],
    ];
    for (const [name, second] of cases) await expectFail(capture(firstViewing(), second), name);
    const [secondStart, secondStop] = secondViewing();
    const overlapping = [...firstViewing().slice(0, 5), secondStart, firstViewing()[5], secondStop];
    await expectFail(capture(overlapping, []), "the second start before the first stop");
  });

  it("T8-03 item 2: needs every report answered 2xx", async () => {
    await expectPass(capture(withRecord(firstViewing(), 1, { status: 200 })), "answered 200");
    for (const status of [500, 401, 302, null]) {
      await expectFail(capture(withRecord(firstViewing(), 0, { status })), `the first start answered ${status}`);
      await expectFail(capture(withRecord(firstViewing(), 1, { status })), `a progress post answered ${status}`);
      await expectFail(capture(withRecord(firstViewing(), 5, { status })), `the first stop answered ${status}`);
      await expectFail(capture(firstViewing(), withRecord(secondViewing(), 1, { status })), `the second stop answered ${status}`);
    }
  });

  it("T8-03 item 2: needs the method DirectPlay on every report", async () => {
    await expectPass(capture());
    for (const method of ["Transcode", "DirectStream", null]) {
      for (const nth of [0, 1, 5]) {
        await expectFail(capture(withReport(firstViewing(), nth, { method })), `first viewing report ${nth} with ${method}`);
      }
      for (const nth of [0, 1]) {
        await expectFail(capture(firstViewing(), withReport(secondViewing(), nth, { method })), `second viewing report ${nth} with ${method}`);
      }
    }
  });

  it("T8-03 item 2: fails a report the recorder kept no facts for", async () => {
    await expectPass(capture());
    for (const nth of [0, 1, 5]) {
      await expectFail(capture(withRecord(firstViewing(), nth, { report: undefined })), `report ${nth}`);
    }
  });
});

// ---- item 4: resuming on another client ----

describe("T8-03 item 4: another client's resume list holds the title at the stop position", () => {
  it("T8-03 item 4: passes the resume point read at the reported position, with the next start there", async () => {
    await expectPass(capture());
  });

  it("T8-03 item 4: fails a resume list that is far from the stop, missing the title, or not at the reported position", async () => {
    await expectPass(capture());
    for (const resume of ["far", "missing", "within-10s"]) {
      await expectFail(capture(), `resume=${resume}`, said({ resume }));
    }
  });

  it("T8-03 item 4: judgeRun passes the whole run, and fails it with resume=far or resume=missing", async () => {
    const good = await run(capture());
    expect(good.errors).toEqual([]);
    expect(good.summary).toEqual(["player-viewing jellyscale T8-03 pass"]);
    for (const resume of ["far", "missing"]) {
      const result = await run(capture(), OK.replace("resume=at-reported", `resume=${resume}`));
      expect(result.failed, resume).toBe(true);
      expect(result.summary, resume).toEqual(["player-viewing jellyscale T8-03 fail"]);
    }
  });
});

// ---- item 7: the second viewing starts where the first stopped ----

describe("T8-03 item 7: the second viewing starts at the saved position and reaches its first frame there", () => {
  it("T8-03 item 7: passes a second start up to 9 s either side of the first stop", async () => {
    for (const position of [16, 25, 34]) {
      await expectPass(capture(firstViewing(), withReport(secondViewing(), 0, { position })), `second start at ${position}`);
    }
  });

  it("T8-03 item 7: fails a second start far from the first stop", async () => {
    await expectPass(capture());
    for (const position of [0, 14, 36, 200, null]) {
      await expectFail(capture(firstViewing(), withReport(secondViewing(), 0, { position })), `second start at ${position}`);
    }
  });

  it("T8-03 item 7: fails a first frame that did not resume within 10 s of the saved position", async () => {
    await expectPass(capture());
    for (const resumed of ["far", "timeout"]) {
      await expectFail(capture(), `resumed=${resumed}`, said({ resumed }));
    }
  });
});

// ---- item 8: the wire test against the pinned Jellyscale ----

describe("T8-03 item 8: player-viewing runs on Jellyscale with the header on every report", () => {
  it("T8-03 item 8: player-viewing is listed once for jellyscale under T8-03, with a device file and a judge", async () => {
    const list = JSON.parse(readFileSync(join(wireDir, "wire-tests.json"), "utf8")) as { tests: { id: string; task: string; targets: string[] }[] };
    const entries = list.tests.filter((entry) => entry.id === "player-viewing");
    expect(entries, "wire-tests.json lists player-viewing once").toHaveLength(1);
    expect(entries[0].task).toBe("T8-03");
    expect(entries[0].targets).toEqual(["jellyscale"]);
    expect(existsSync(join(wireDir, "player-viewing.ts")), "apps/tv/src/e2e/wire/player-viewing.ts exists").toBe(true);
    expect(readFileSync(join(wireDir, "run-wire.ts"), "utf8"), "run-wire.ts names player-viewing in TESTS").toContain('"player-viewing"');
    expect(typeof (await loadJudge()).WIRE_JUDGES["player-viewing"], "WIRE_JUDGES has player-viewing").toBe("function");
    const { selectTests } = await loadRunner();
    expect(selectTests({ task: "T8-03" }).map((entry) => entry.id)).toEqual(["player-viewing"]);
  });

  it("T8-03 item 8: judgeViewingCapture fails any media request other than the original file", async () => {
    await expectPass(capture());
    for (const bad of [
      rec("GET", `/Videos/${EPISODE}/master.m3u8`, { queryNames: ["MediaSourceId"] }),
      rec("GET", `/videos/${EPISODE}/hls1/main/0.ts`),
      rec("GET", `/Audio/${EPISODE}/universal`),
      rec("GET", STREAM, { queryNames: ["MediaSourceId"], range: true, status: 206 }),
    ]) {
      await expectFail([...capture(), bad], `${bad.method} ${bad.path}`);
    }
    await expectFail(
      capture().filter((record) => record.path !== STREAM),
      "no stream request",
    );
  });

  it("T8-03 item 8: judgeRun fails a report without the header or the token, or with a credential name or a redirect", async () => {
    const good = await run(capture());
    expect(good.errors).toEqual([]);
    expect(good.summary).toEqual(["player-viewing jellyscale T8-03 pass"]);
    const cases: [string, Partial<ViewingRecord>][] = [
      ["no header", { authorization: false, scheme: null, token: false }],
      ["no token", { token: false }],
      ["a credential name", { queryNames: ["api_key"] }],
      ["a redirect", { status: 302 }],
      ["a secret in the URL", { secretInUrl: true }],
    ];
    for (const [name, change] of cases) {
      for (const nth of [0, 1, 5]) {
        const result = await run(capture(withRecord(firstViewing(), nth, change)));
        expect(result.failed, `${name} on report ${nth}`).toBe(true);
      }
    }
  });

  it("T8-03 item 8: judgeRun fails a run with a master.m3u8 request, a failed stop, a far second start or a broken order", async () => {
    const good = await run(capture());
    expect(good.errors).toEqual([]);
    const [start, stop] = secondViewing();
    const cases: [string, ViewingRecord[]][] = [
      ["a playlist", [...capture(), rec("GET", `/Videos/${EPISODE}/master.m3u8`)]],
      ["a failed stop", capture(withReport(firstViewing(), 5, { failed: true }))],
      ["a far second start", capture(firstViewing(), withReport(secondViewing(), 0, { position: 0 }))],
      ["a broken order", capture(firstViewing(), [stop, start])],
    ];
    for (const [name, records] of cases) expect((await run(records)).failed, name).toBe(true);
  });
});

describe("T8-03 item 8: the recorder keeps each playstate post's four report facts and nothing else of its body", () => {
  let upstream: Server;
  let recorder: Recorder;
  const secrets = new Set<string>([TOKEN]);
  const MARKER = "octave-body-marker-4b8e";

  function send(method: string, path: string, body?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const headers: Record<string, string> = { authorization: `MediaBrowser Client="Octave", Token="x"` };
      if (body !== undefined) Object.assign(headers, { "content-type": "application/json", "content-length": String(Buffer.byteLength(body)) });
      const req = httpRequest({ host: "127.0.0.1", port: recorder.port, method, path, headers }, (res) => {
        res.resume();
        res.on("end", () => resolve());
      });
      req.on("error", reject);
      req.end(body);
    });
  }

  async function recordOf(method: string, path: string, body?: string): Promise<ViewingRecord> {
    const before = recorder.records.length;
    await send(method, path, body);
    const [made] = recorder.records.slice(before);
    return made;
  }

  // The gateway's report body (gateway.ts, report), with a marker in every value the recorder must not keep.
  const reportBody = (change: Record<string, unknown> = {}) =>
    JSON.stringify({
      ItemId: `${MARKER}-item`,
      MediaSourceId: `${MARKER}-source`,
      PlaySessionId: `${MARKER}-session`,
      PositionTicks: 123_000_000,
      IsPaused: true,
      IsMuted: false,
      VolumeLevel: 100,
      AudioStreamIndex: 1,
      CanSeek: true,
      PlayMethod: "DirectPlay",
      ...change,
    });

  beforeAll(async () => {
    upstream = createServer((req, res) => {
      req.resume();
      req.on("end", () => res.writeHead(204).end());
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", () => resolve()));
    const { startRecorder } = await loadProxy();
    recorder = await startRecorder({ upstream: { port: (upstream.address() as { port: number }).port }, secrets });
  });

  afterAll(async () => {
    await recorder?.close();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  });

  it("T8-03 item 8: a start, a progress and a stopped post are recorded with position, paused, failed and method", async () => {
    const cases: [string, string, Report][] = [
      [PLAYING, reportBody({ IsPaused: false }), { position: 12, paused: false, failed: null, method: "DirectPlay" }],
      [PROGRESS, reportBody(), { position: 12, paused: true, failed: null, method: "DirectPlay" }],
      [STOPPED, reportBody({ Failed: false, PositionTicks: 250_000_000 }), { position: 25, paused: true, failed: false, method: "DirectPlay" }],
      [STOPPED, reportBody({ Failed: true, PlayMethod: "Transcode" }), { position: 12, paused: true, failed: true, method: "Transcode" }],
    ];
    for (const [path, body, expected] of cases) {
      const made = await recordOf("POST", path, body);
      expect(made.report, path).toEqual(expected);
      expect(JSON.stringify(made), path).not.toContain(MARKER);
    }
  });

  it("T8-03 item 8: a position is whole seconds of the ticks", async () => {
    const made = await recordOf("POST", PROGRESS, reportBody({ PositionTicks: 123_000_001 }));
    expect(made.report?.position).toBe(12);
    const zero = await recordOf("POST", PLAYING, reportBody({ PositionTicks: 0 }));
    expect(zero.report?.position).toBe(0);
  });

  it("T8-03 item 8: each fact is null when its JSON type is wrong or the field is absent", async () => {
    const empty: Report = { position: null, paused: null, failed: null, method: null };
    const wrongTypes: [string, unknown][] = [
      ["strings", { PositionTicks: "123000000", IsPaused: "true", Failed: "false", PlayMethod: 1 }],
      ["numbers and objects", { PositionTicks: { ticks: 1 }, IsPaused: 1, Failed: 0, PlayMethod: [MARKER] }],
      ["nulls", { PositionTicks: null, IsPaused: null, Failed: null, PlayMethod: null }],
      ["absent fields", { ItemId: MARKER }],
      ["an array", [MARKER]],
    ];
    for (const [name, body] of wrongTypes) {
      const made = await recordOf("POST", STOPPED, JSON.stringify(body));
      expect(made.report, name).toEqual(empty);
      expect(JSON.stringify(made), name).not.toContain(MARKER);
    }
    expect((await recordOf("POST", STOPPED, `not json ${MARKER}`)).report, "not JSON").toEqual(empty);
    const mixed = await recordOf("POST", STOPPED, reportBody({ IsPaused: "yes", Failed: false }));
    expect(mixed.report, "one wrong field leaves the others read").toEqual({ position: 12, paused: null, failed: false, method: "DirectPlay" });
  });

  it("T8-03 item 8: no other request has a report", async () => {
    const reported = await recordOf("POST", PLAYING, reportBody());
    expect(reported.report).toBeDefined();
    const others: [string, string][] = [
      ["GET", PLAYING],
      ["POST", "/Sessions/Playing/Ping"],
      ["POST", "/Sessions/Logout"],
      ["POST", "/Sessions/Capabilities"],
      ["POST", `/Items/${EPISODE}/PlaybackInfo`],
      ["GET", "/UserItems/Resume"],
    ];
    for (const [method, path] of others) {
      const made = await recordOf(method, path, method === "POST" ? reportBody() : undefined);
      expect(made.report, `${method} ${path}`).toBeUndefined();
    }
  });
});
