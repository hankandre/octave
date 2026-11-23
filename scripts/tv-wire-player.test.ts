// @vitest-environment node
// T8-02 items 5, 6 and 7, the host half of the player's wire tests (docs/specs/T8-02.md, "The wire tests"). The device
// half (the same judges on a real run of `pnpm tv:wire --task T8-02`) is item 7's gate: release-evidence/wire/
// summary.txt from CI's wire job on the pull request's head.
//
// The contract frozen here, beside T3-05's (scripts/tv-wire.test.ts):
// - apps/tv/src/e2e/wire/wire-tests.json lists player-original-file (jellyscale), player-samples (jellyscale) and
//   player-redirect (mock), each with task "T8-02" and a device file apps/tv/src/e2e/wire/<id>.ts that run-wire.ts
//   names in TESTS.
// - The recorder (scripts/tv-wire-proxy.mjs, startRecorder) adds two booleans to every record: `range` (the request
//   carried a Range header) and `staticTrue` (exactly one query parameter named Static, whose decoded value is
//   "true"). It adds the PlaySessionId of every PlaybackInfo answer it relays to the run's `secrets` set.
// - scripts/tv-wire-judge.mjs exports judgePlayerCapture(records) -> ERROR lines: at least one GET of a stream path;
//   every request whose path holds /Videos/ or /Audio/ (any case) is exactly GET /Videos/{32 hex}/stream with
//   staticTrue; at least one stream request with range; no path ending .m3u8 or holding /hls, /universal,
//   /Subtitles/ or /Trickplay/ (any case; spec check issue 10).
// - WIRE_JUDGES["player-original-file"](pair, said) needs outcome=ok plan=original firstFrame=after-loaded pause=ok
//   seek=ok stop=ok relaunch=ok.
// - WIRE_JUDGES["player-samples"](pair, said) reads the device's decoder list from pair.decoders:
//   { hevc: { type, profile }, av1: { type, profile } }, where `type` says a listed decoder takes the sample's MIME
//   type (video/hevc, video/av01) and `profile` that one takes its profile too (HEVC Main 10; AV1 Main); null or
//   missing when the list could not be read. It needs h264=first-frame, nodecoder=decoder-unavailable,
//   label=present, decode-h264 hardware or software; for HEVC and AV1, first-frame when a decoder takes type and
//   profile, decoder-unavailable when none takes the type; an unread list, a timeout or any other code fails. What a
//   decoder that takes the type but not the profile must answer is left unpinned (spec check issue 4).
// - WIRE_JUDGES["player-redirect"](pair, said) needs code=server-error and, in pair.records, exactly one stream
//   request, answered 302. judgeWire fails any request at the canary origin (T3-05).
// - judgeRun (scripts/tv-wire.mjs) judges player-original-file and player-samples with judgeRecords and
//   judgePlayerCapture, and player-redirect with judgeRecords allowing its 3xx and with its records on the pair.
import { createServer, request as httpRequest, type Server } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const wireDir = join(repo, "apps", "tv", "src", "e2e", "wire");

type PlayerRecord = {
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
};
type Decoders = { hevc: { type: boolean; profile: boolean }; av1: { type: boolean; profile: boolean } } | null;
type Pair = { test: string; target: string; task: string; requests: number; canaryOrigin?: number; records?: PlayerRecord[]; decoders?: Decoders };
type Judge = (pair: Pair, said: Record<string, string>) => string[];
type JudgeModule = {
  judgePlayerCapture: (records: PlayerRecord[]) => string[];
  judgeWire: (run: { pairs: Pair[]; lines: string[] }) => string[];
  WIRE_JUDGES: Record<string, Judge>;
};
type RunPair = { test: string; target: string; task: string; devicePort: number; records: PlayerRecord[] };
type RunInput = {
  pairs: RunPair[];
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
type Recorder = { port: number; records: PlayerRecord[]; close: () => Promise<void> };
type ProxyModule = { startRecorder: (options: { upstream: { port: number }; secrets: Set<string> }) => Promise<Recorder> };

const load = async <T>(path: string) => (await import(pathToFileURL(join(repo, path)).href)) as T;
const loadJudge = () => load<JudgeModule>("scripts/tv-wire-judge.mjs");
const loadRunner = () => load<RunnerModule>("scripts/tv-wire.mjs");

const ITEM = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const STREAM = `/Videos/${ITEM}/stream`;
const PLAY_SESSION = "9c1e5a7b3d2f4e6a8b0c1d2e3f4a5b6c";
const PORT = 47305;
const HOST = `127.0.0.1:${PORT}`;
const TOKEN = "tok/7c1e+3a9b=5d0f";

function rec(method: string, path: string, extra: Partial<PlayerRecord> = {}): PlayerRecord {
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

const stream = (extra: Partial<PlayerRecord> = {}) =>
  rec("GET", STREAM, { queryNames: ["Static", "MediaSourceId", "PlaySessionId"], staticTrue: true, range: true, status: 206, ...extra });

// A play from the pinned Jellyscale: probe, sign-in, the item, PlaybackInfo, a first stream request and a ranged one.
function playCapture(): PlayerRecord[] {
  return [
    rec("GET", "/System/Info/Public", { token: false }),
    rec("POST", "/Users/AuthenticateByName", { token: false }),
    rec("GET", "/Items", { queryNames: ["searchTerm", "IncludeItemTypes", "Recursive"] }),
    rec("POST", `/Items/${ITEM}/PlaybackInfo`, { queryNames: ["UserId", "StartTimeTicks", "MediaSourceId"] }),
    stream({ range: false, status: 200 }),
    stream(),
  ];
}

function withRecord(records: PlayerRecord[], index: number, change: Partial<PlayerRecord>): PlayerRecord[] {
  const copy = records.map((r) => ({ ...r }));
  copy[index] = { ...copy[index], ...change };
  return copy;
}

function wireList(): { tests: { id: string; task: string; targets: string[] }[] } {
  return JSON.parse(readFileSync(join(wireDir, "wire-tests.json"), "utf8")) as { tests: { id: string; task: string; targets: string[] }[] };
}

function expectEntry(id: string, targets: string[]) {
  const entries = wireList().tests.filter((entry) => entry.id === id);
  expect(entries, `wire-tests.json lists ${id} once`).toHaveLength(1);
  expect(entries[0].task).toBe("T8-02");
  expect(entries[0].targets).toEqual(targets);
  expect(existsSync(join(wireDir, `${id}.ts`)), `apps/tv/src/e2e/wire/${id}.ts exists`).toBe(true);
  const runWire = readFileSync(join(wireDir, "run-wire.ts"), "utf8");
  expect(runWire, `run-wire.ts names ${id} in TESTS`).toContain(`"${id}"`);
}

async function judgeOf(id: string): Promise<Judge> {
  const judge = (await loadJudge()).WIRE_JUDGES[id];
  expect(typeof judge, `WIRE_JUDGES has ${id}`).toBe("function");
  return judge;
}

const words = (line: string) => Object.fromEntries([...line.matchAll(/(\S+?)=(\S*)/g)].map(([, key, value]) => [key, value]));

function runInput(test: string, target: string, records: PlayerRecord[], line: string, extra: Partial<RunInput> = {}): RunInput {
  return {
    pairs: [{ test, target, task: "T8-02", devicePort: PORT, records }],
    counts: { canaryOrigin: 0, redirector: 0, privateLan: 0 },
    lines: [`OCTAVE_WIRE result test=${test} target=${target} task=T8-02 ${line}`, "OCTAVE_WIRE done"],
    logLines: ["01-01 00:00:00.000  1  1 I ReactNativeJS: fine"],
    seen: [],
    devicePorts: [PORT],
    secrets: [TOKEN],
    voids: [],
    kept: { how: "stream", lines: 900, start: true, end: true, open: true },
    deviceLines: [],
    ...extra,
  };
}

const ORIGINAL_OK = "outcome=ok plan=original firstFrame=after-loaded pause=ok seek=ok stop=ok relaunch=ok";

// ---- item 7 ----

describe("T8-02 item 7: the capture of a play shows the header on every request, ranges included, and only original-file URLs", () => {
  it("T8-02 item 7: player-original-file is listed for jellyscale under T8-02, with a device file and a judge", async () => {
    expectEntry("player-original-file", ["jellyscale"]);
    await judgeOf("player-original-file");
    const { selectTests } = await loadRunner();
    expect(selectTests({ task: "T8-02" }).map((entry) => entry.id).sort()).toEqual(["player-original-file", "player-redirect", "player-samples"]);
  });

  it("T8-02 item 7: judgePlayerCapture passes a play with a static stream request and a ranged one", async () => {
    const { judgePlayerCapture } = await loadJudge();
    expect(judgePlayerCapture(playCapture())).toEqual([]);
  });

  it("T8-02 item 7: judgePlayerCapture fails a capture with no stream request", async () => {
    const { judgePlayerCapture } = await loadJudge();
    expect(judgePlayerCapture(playCapture().slice(0, 4)).length).toBeGreaterThan(0);
  });

  it("T8-02 item 7: judgePlayerCapture fails a stream request without Static=true", async () => {
    const { judgePlayerCapture } = await loadJudge();
    expect(judgePlayerCapture(withRecord(playCapture(), 5, { staticTrue: false })).length).toBeGreaterThan(0);
  });

  it("T8-02 item 7: judgePlayerCapture fails a play with no range request", async () => {
    const { judgePlayerCapture } = await loadJudge();
    const records = playCapture().map((r) => ({ ...r, range: false }));
    expect(judgePlayerCapture(records).length).toBeGreaterThan(0);
  });

  it("T8-02 item 7: judgePlayerCapture fails an HLS playlist, a universal audio path, subtitles and trickplay", async () => {
    const { judgePlayerCapture } = await loadJudge();
    for (const bad of [
      rec("GET", `/Videos/${ITEM}/master.m3u8`, { queryNames: ["MediaSourceId"] }),
      rec("GET", `/videos/${ITEM}/main.m3u8`),
      rec("GET", `/Videos/${ITEM}/hls1/main/0.ts`),
      rec("GET", `/Audio/${ITEM}/universal`, { staticTrue: true }),
      rec("GET", `/Videos/${ITEM}/${ITEM}/Subtitles/3/0/Stream.vtt`),
      rec("GET", `/Videos/${ITEM}/Trickplay/320/0.jpg`),
    ]) {
      expect(judgePlayerCapture([...playCapture(), bad]).length, `${bad.method} ${bad.path}`).toBeGreaterThan(0);
    }
  });

  it("T8-02 item 7: judgePlayerCapture fails any other media path, in any case, and a stream request that is not a GET of a 32-hex id", async () => {
    const { judgePlayerCapture } = await loadJudge();
    for (const bad of [
      rec("GET", `/videos/${ITEM}/Download`, { staticTrue: true }),
      rec("GET", `/VIDEOS/${ITEM}/stream.mkv`, { staticTrue: true }),
      rec("GET", `/audio/${ITEM}/stream.mp3`, { staticTrue: true }),
      rec("GET", `/Videos/${ITEM}/stream.mkv`, { staticTrue: true }),
      rec("GET", "/Videos/not-an-id/stream", { staticTrue: true }),
      rec("POST", STREAM, { staticTrue: true }),
    ]) {
      expect(judgePlayerCapture([...playCapture(), bad]).length, `${bad.method} ${bad.path}`).toBeGreaterThan(0);
    }
  });

  it("T8-02 item 7: player-original-file's judge needs every step of the play", async () => {
    const judge = await judgeOf("player-original-file");
    const pair: Pair = { test: "player-original-file", target: "jellyscale", task: "T8-02", requests: 6 };
    expect(judge(pair, words(ORIGINAL_OK))).toEqual([]);
    for (const [key, wrong] of [
      ["outcome", "threw"],
      ["plan", "transcode"],
      ["firstFrame", "before-loaded"],
      ["firstFrame", "timeout"],
      ["pause", "failed"],
      ["seek", "timeout"],
      ["stop", "failed"],
      ["relaunch", "timeout"],
    ]) {
      const said = { ...words(ORIGINAL_OK), [key]: wrong };
      expect(judge(pair, said).length, `${key}=${wrong}`).toBeGreaterThan(0);
    }
    const missing = words(ORIGINAL_OK);
    delete missing.relaunch;
    expect(judge(pair, missing).length).toBeGreaterThan(0);
  });

  it("T8-02 item 7: judgeRun passes a whole player-original-file run", async () => {
    const { judgeRun } = await loadRunner();
    const result = judgeRun(runInput("player-original-file", "jellyscale", playCapture(), ORIGINAL_OK), { write: () => [] });
    expect(result.errors).toEqual([]);
    expect(result.summary).toEqual(["player-original-file jellyscale T8-02 pass"]);
  });

  it("T8-02 item 7: judgeRun fails a play with a request without the header, a credential name or no range request", async () => {
    const { judgeRun } = await loadRunner();
    const cases: [string, PlayerRecord[]][] = [
      ["no header", withRecord(playCapture(), 5, { authorization: false, scheme: null, token: false })],
      ["credential name", withRecord(playCapture(), 5, { queryNames: ["Static", "api_key"] })],
      ["no range", playCapture().map((r) => ({ ...r, range: false }))],
      ["a playlist", [...playCapture(), rec("GET", `/Videos/${ITEM}/master.m3u8`)]],
    ];
    for (const [name, records] of cases) {
      const result = judgeRun(runInput("player-original-file", "jellyscale", records, ORIGINAL_OK), { write: () => [] });
      expect(result.failed, name).toBe(true);
      expect(result.summary, name).toEqual(["player-original-file jellyscale T8-02 fail"]);
    }
  });

  it("T8-02 item 7: judgeRun fails a run whose logcat holds a play-session id among the secrets", async () => {
    const { judgeRun } = await loadRunner();
    const input = runInput("player-original-file", "jellyscale", playCapture(), ORIGINAL_OK, {
      secrets: [TOKEN, PLAY_SESSION],
      logLines: [`01-01 00:00:00.000  1  1 I ExoPlayerImpl: opened ${PLAY_SESSION}`],
    });
    expect(judgeRun(input, { write: () => [] }).failed).toBe(true);
  });
});

describe("T8-02 item 7: the recorder marks ranges and the static flag and learns each play-session id", () => {
  let upstream: Server;
  let recorder: Recorder;
  const secrets = new Set<string>([TOKEN]);

  function send(method: string, path: string, headers: Record<string, string> = {}): Promise<string> {
    return new Promise((resolve, reject) => {
      const req = httpRequest({ host: "127.0.0.1", port: recorder.port, method, path, headers }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      });
      req.on("error", reject);
      req.end();
    });
  }

  beforeAll(async () => {
    upstream = createServer((req, res) => {
      if ((req.url ?? "").includes("/PlaybackInfo")) {
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ MediaSources: [{ Id: ITEM, SupportsDirectPlay: true }], PlaySessionId: PLAY_SESSION }));
        return;
      }
      res.writeHead(req.headers.range ? 206 : 200, { "content-type": "video/x-matroska" }).end("bytes");
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", () => resolve()));
    const { startRecorder } = await load<ProxyModule>("scripts/tv-wire-proxy.mjs");
    recorder = await startRecorder({ upstream: { port: (upstream.address() as { port: number }).port }, secrets });
  });

  afterAll(async () => {
    await recorder?.close();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  });

  const auth = { authorization: `MediaBrowser Client="Octave", Token="x"` };

  it("T8-02 item 7: a stream request with a Range header and Static=true is recorded with range and staticTrue", async () => {
    const before = recorder.records.length;
    await send("GET", `${STREAM}?Static=true&MediaSourceId=${ITEM}`, { ...auth, range: "bytes=1000-" });
    const [made] = recorder.records.slice(before);
    expect(made.range).toBe(true);
    expect(made.staticTrue).toBe(true);
  });

  it("T8-02 item 7: a request without Range is recorded with range false", async () => {
    const before = recorder.records.length;
    await send("GET", `${STREAM}?Static=true`, auth);
    const [made] = recorder.records.slice(before);
    expect(made.range).toBe(false);
    expect(made.staticTrue).toBe(true);
  });

  it("T8-02 item 7: staticTrue needs exactly one Static parameter whose decoded value is true", async () => {
    const cases: [string, boolean][] = [
      [`${STREAM}?Static=%74rue`, true],
      [`${STREAM}?MediaSourceId=${ITEM}&Static=true`, true],
      [`${STREAM}?Static=false`, false],
      [`${STREAM}?Static=true&Static=true`, false],
      [`${STREAM}?Static=`, false],
      [STREAM, false],
      [`${STREAM}?MediaSourceId=${ITEM}`, false],
    ];
    for (const [path, expected] of cases) {
      const before = recorder.records.length;
      await send("GET", path, auth);
      const [made] = recorder.records.slice(before);
      expect(made.staticTrue, path).toBe(expected);
    }
  });

  it("T8-02 item 7: the PlaySessionId of a relayed PlaybackInfo answer joins the run's secrets", async () => {
    expect(secrets.has(PLAY_SESSION)).toBe(false);
    const body = await send("POST", `/Items/${ITEM}/PlaybackInfo?UserId=u`, auth);
    expect(body).toContain(PLAY_SESSION);
    expect(secrets.has(PLAY_SESSION)).toBe(true);
  });
});

// ---- item 5 ----

describe("T8-02 item 5: a redirect on the media request ends in a typed error and the other origin receives nothing", () => {
  const redirectCapture = (): PlayerRecord[] => [
    rec("GET", "/System/Info/Public", { token: false }),
    rec("POST", "/Users/AuthenticateByName", { token: false }),
    rec("GET", "/Items", { queryNames: ["searchTerm"] }),
    rec("POST", `/Items/${ITEM}/PlaybackInfo`),
    stream({ status: 302, range: false }),
  ];
  const pair = (records: PlayerRecord[], canaryOrigin = 0): Pair => ({ test: "player-redirect", target: "mock", task: "T8-02", requests: records.length, canaryOrigin, records });

  it("T8-02 item 5: player-redirect is listed for the mock under T8-02, with a device file and a judge", async () => {
    expectEntry("player-redirect", ["mock"]);
    await judgeOf("player-redirect");
  });

  it("T8-02 item 5: the judge passes server-error after exactly one stream request answered 302", async () => {
    const judge = await judgeOf("player-redirect");
    expect(judge(pair(redirectCapture()), { code: "server-error" })).toEqual([]);
  });

  it("T8-02 item 5: the judge fails any other code", async () => {
    const judge = await judgeOf("player-redirect");
    for (const code of ["network", "unknown", "unsupported-request", "timeout", "first-frame"]) {
      expect(judge(pair(redirectCapture()), { code }).length, code).toBeGreaterThan(0);
    }
    expect(judge(pair(redirectCapture()), {}).length).toBeGreaterThan(0);
  });

  it("T8-02 item 5: the judge fails no stream request, two, or one not answered 302", async () => {
    const judge = await judgeOf("player-redirect");
    const base = redirectCapture();
    expect(judge(pair(base.slice(0, 4)), { code: "server-error" }).length, "none").toBeGreaterThan(0);
    expect(judge(pair([...base, stream({ status: 302, range: false })]), { code: "server-error" }).length, "two").toBeGreaterThan(0);
    expect(judge(pair(withRecord(base, 4, { status: 200 })), { code: "server-error" }).length, "answered 200").toBeGreaterThan(0);
    expect(judge(pair(withRecord(base, 4, { status: null })), { code: "server-error" }).length, "not answered").toBeGreaterThan(0);
    const unread: Pair = { test: "player-redirect", target: "mock", task: "T8-02", requests: 5, canaryOrigin: 0 };
    expect(judge(unread, { code: "server-error" }).length, "no records on the pair").toBeGreaterThan(0);
  });

  it("T8-02 item 5: judgeWire fails a player-redirect run whose canary origin received a request", async () => {
    const { judgeWire } = await loadJudge();
    const lines = ["OCTAVE_WIRE result test=player-redirect target=mock task=T8-02 code=server-error", "OCTAVE_WIRE done"];
    expect(judgeWire({ pairs: [pair(redirectCapture())], lines })).toEqual([]);
    expect(judgeWire({ pairs: [pair(redirectCapture(), 1)], lines }).join("\n")).toMatch(/canary/i);
  });

  it("T8-02 item 5: judgeRun passes the redirect run, allowing its 302, and fails it when the canary origin was reached", async () => {
    const { judgeRun } = await loadRunner();
    const ok = judgeRun(runInput("player-redirect", "mock", redirectCapture(), "code=server-error"), { write: () => [] });
    expect(ok.errors).toEqual([]);
    expect(ok.summary).toEqual(["player-redirect mock T8-02 pass"]);
    const reached = judgeRun(runInput("player-redirect", "mock", redirectCapture(), "code=server-error", { counts: { canaryOrigin: 1, redirector: 0, privateLan: 0 } }), {
      write: () => [],
    });
    expect(reached.failed).toBe(true);
    const followed = judgeRun(runInput("player-redirect", "mock", redirectCapture(), "code=network"), { write: () => [] });
    expect(followed.failed).toBe(true);
  });
});

// ---- item 6 ----

describe("T8-02 item 6: the samples reach first frame where the emulator has a decoder, and no decoder is the typed code", () => {
  const SAMPLES_OK = "h264=first-frame hevc=first-frame av1=first-frame nodecoder=decoder-unavailable decode-h264=software label=present";
  const both = (type: boolean, profile: boolean) => ({ type, profile });
  const pair = (decoders: Decoders | undefined): Pair => ({
    test: "player-samples",
    target: "jellyscale",
    task: "T8-02",
    requests: 12,
    ...(decoders === undefined ? {} : { decoders }),
  });
  const said = (change: Record<string, string> = {}) => ({ ...words(SAMPLES_OK), ...change });
  const ALL = { hevc: both(true, true), av1: both(true, true) };
  const NONE = { hevc: both(false, false), av1: both(false, false) };

  it("T8-02 item 6: player-samples is listed for jellyscale under T8-02, with a device file and a judge", async () => {
    expectEntry("player-samples", ["jellyscale"]);
    await judgeOf("player-samples");
  });

  it("T8-02 item 6: passes first frame for every sample a listed decoder takes, and the no-decoder sample's typed code", async () => {
    const judge = await judgeOf("player-samples");
    expect(judge(pair(ALL), said())).toEqual([]);
    expect(judge(pair(ALL), said({ "decode-h264": "hardware" }))).toEqual([]);
  });

  it("T8-02 item 6: passes decoder-unavailable for HEVC and AV1 when no listed decoder takes their type", async () => {
    const judge = await judgeOf("player-samples");
    expect(judge(pair(NONE), said({ hevc: "decoder-unavailable", av1: "decoder-unavailable" }))).toEqual([]);
    expect(judge(pair({ hevc: both(false, false), av1: both(true, true) }), said({ hevc: "decoder-unavailable" }))).toEqual([]);
    expect(judge(pair({ hevc: both(true, true), av1: both(false, false) }), said({ av1: "decoder-unavailable" }))).toEqual([]);
  });

  it("T8-02 item 6: fails HEVC Main 10 or AV1 that does not reach first frame when a listed decoder takes it", async () => {
    const judge = await judgeOf("player-samples");
    for (const key of ["hevc", "av1"]) {
      for (const outcome of ["decoder-unavailable", "decoder-failed", "timeout", "unknown", "network"]) {
        expect(judge(pair(ALL), said({ [key]: outcome })).length, `${key}=${outcome}`).toBeGreaterThan(0);
      }
    }
  });

  it("T8-02 item 6: fails first frame or another code for a sample no listed decoder takes", async () => {
    const judge = await judgeOf("player-samples");
    for (const key of ["hevc", "av1"]) {
      for (const outcome of ["first-frame", "decoder-failed", "timeout", "unknown"]) {
        expect(judge(pair(NONE), said({ hevc: "decoder-unavailable", av1: "decoder-unavailable", [key]: outcome })).length, `${key}=${outcome}`).toBeGreaterThan(0);
      }
    }
  });

  it("T8-02 item 6: fails a decoder list that could not be read, whatever the samples said", async () => {
    const judge = await judgeOf("player-samples");
    expect(judge(pair(null), said()).length).toBeGreaterThan(0);
    expect(judge(pair(undefined), said()).length).toBeGreaterThan(0);
    expect(judge(pair(null), said({ hevc: "decoder-unavailable", av1: "decoder-unavailable" })).length).toBeGreaterThan(0);
  });

  it("T8-02 item 6: fails H.264 without first frame, the no-decoder sample without decoder-unavailable, and an unknown or absent decoder", async () => {
    const judge = await judgeOf("player-samples");
    const changes: Record<string, string>[] = [
      { h264: "timeout" },
      { h264: "decoder-unavailable" },
      { nodecoder: "first-frame" },
      { nodecoder: "decoder-failed" },
      { nodecoder: "timeout" },
      { "decode-h264": "unknown" },
      { label: "absent" },
    ];
    for (const change of changes) {
      expect(judge(pair(ALL), said(change)).length, JSON.stringify(change)).toBeGreaterThan(0);
    }
    const missing = said();
    delete missing.nodecoder;
    expect(judge(pair(ALL), missing).length).toBeGreaterThan(0);
  });

  it("T8-02 item 6: the generator writes the no-decoder sample and checks its codec, and the samples README lists it", () => {
    const generator = readFileSync(join(repo, "scripts", "generate-samples.sh"), "utf8");
    expect(generator).toContain("Synthetic No Decoder (2024)/Synthetic No Decoder (2024).mkv");
    expect(generator).toMatch(/-c:v\s+(?:msmpeg4v3|libtheora)\b/);
    expect(generator).toMatch(/probe_value[^\n]*(?:msmpeg4v3|theora)|(?:msmpeg4v3|theora)[^\n]*probe_value/);
    expect(readFileSync(join(repo, "tests", "samples", "README.md"), "utf8")).toContain("Synthetic No Decoder (2024)");
  });
});
