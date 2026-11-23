// @vitest-environment node
// T8-07 items 4, 6, 7 and 8, the host half of the wire test player-capabilities (docs/specs/T8-07.md, "The wire test"
// and Test plan 8). The device half (the same judges on a real run of `pnpm tv:wire --task T8-07`) is the gate of items
// 6 and 7: release-evidence/wire/summary.txt from CI's wire job on the pull request's head.
//
// The contract frozen here, beside T3-05's (scripts/tv-wire.test.ts) and T8-02's (scripts/tv-wire-player.test.ts):
// - apps/tv/src/e2e/wire/wire-tests.json lists { "id": "player-capabilities", "task": "T8-07", "targets":
//   ["jellyscale", "jellyfin-12"] }, with a device file apps/tv/src/e2e/wire/player-capabilities.ts that run-wire.ts
//   names in TESTS.
// - scripts/tv-wire-proxy.mjs exports canonicalDigest(value): the SHA-256 hex of the canonical JSON of value (no
//   whitespace, object keys sorted at every level, arrays in order), and playbackInfoFacts(body, rawUrl):
//   { body: Flags, query: Flags, profile } where Flags holds the six PLAYBACK_INFO_FLAGS names, each true, false or
//   null. body: the JSON boolean of that name in the request body; query: exactly one parameter of that name whose
//   value is true or false in any case; anything else null. profile: canonicalDigest of the body's DeviceProfile with
//   MaxStreamingBitrate removed, or null. The recorder adds `playbackInfo` (these facts) to every POST …/PlaybackInfo
//   record and to no other, and keeps no other value of the body or query.
// - scripts/tv-wire-judge.mjs exports OCTAVE_PROFILE_DIGEST, CAPABILITY_EXPECTATIONS ({ jellyscale, "jellyfin-12" }:
//   the T2-09 expectation of each server for a sample whose codec the device lacks), judgeCapabilityCapture(records)
//   -> ERROR lines, and WIRE_JUDGES["player-capabilities"](pair, said), which reads pair.records and pair.decoders.
// - scripts/tv-wire.mjs's judgeRun judges player-capabilities with judgeRecords and judgePlayerCapture (a play) and
//   hands the judge the pair's records and decoders.
import { createHash } from "node:crypto";
import { createServer, request as httpRequest, type Server } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OCTAVE_PROFILE } from "../packages/core/src/jellyfin/device-profile";
import { PLAYBACK_INFO_FLAGS } from "../packages/core/src/jellyfin/gateway";
import { expectationFor } from "../tests/integration/tripwire-expectations";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const wireDir = join(repo, "apps", "tv", "src", "e2e", "wire");

const FLAG_NAMES = Object.keys(PLAYBACK_INFO_FLAGS) as (keyof typeof PLAYBACK_INFO_FLAGS)[];
type Flags = Record<keyof typeof PLAYBACK_INFO_FLAGS, boolean | null>;
type Facts = { body: Flags; query: Flags; profile: string | null };
type CapRecord = {
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
  playbackInfo?: Facts;
};
type Decoders = { hevc: { type: boolean; profile: boolean }; av1: { type: boolean; profile: boolean } } | null;
type Pair = { test: string; target: string; task: string; requests: number; records?: CapRecord[]; decoders?: Decoders };
type Judge = (pair: Pair, said: Record<string, string>) => string[];
type JudgeModule = {
  OCTAVE_PROFILE_DIGEST: string;
  CAPABILITY_EXPECTATIONS: Record<string, unknown>;
  judgeCapabilityCapture: (records: CapRecord[]) => string[];
  WIRE_JUDGES: Record<string, Judge>;
};
type ProxyModule = {
  canonicalDigest: (value: unknown) => string;
  playbackInfoFacts: (body: string, rawUrl: string) => Facts;
  startRecorder: (options: { upstream: { port: number }; secrets: Set<string> }) => Promise<Recorder>;
};
type Recorder = { port: number; records: CapRecord[]; close: () => Promise<void> };
type RunPair = { test: string; target: string; task: string; devicePort: number; records: CapRecord[]; decoders?: Decoders };
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

const load = async <T>(path: string) => (await import(pathToFileURL(join(repo, path)).href)) as T;
const loadJudge = () => load<JudgeModule>("scripts/tv-wire-judge.mjs");
const loadProxy = () => load<ProxyModule>("scripts/tv-wire-proxy.mjs");
const loadRunner = () => load<RunnerModule>("scripts/tv-wire.mjs");

const H264_ITEM = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const NO_DECODER_ITEM = "0f9e8d7c6b5a49382716a5b4c3d2e1f0";
const PORT = 47309;
const HOST = `127.0.0.1:${PORT}`;
const TOKEN = "tok/7c1e+3a9b=5d0f";
const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const HEX64 = /^[0-9a-f]{64}$/;

const flags = (change: Partial<Flags> = {}): Flags => ({ ...PLAYBACK_INFO_FLAGS, ...change });
const FIRST = flags();
const FORCED = flags({ EnableDirectPlay: false, AllowVideoStreamCopy: false });

function rec(method: string, path: string, extra: Partial<CapRecord> = {}): CapRecord {
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

const info = (item: string, body: Flags, query: Flags, profile: string) =>
  rec("POST", `/Items/${item}/PlaybackInfo`, { queryNames: ["UserId", "StartTimeTicks", ...FLAG_NAMES], playbackInfo: { body, query, profile } });

const stream = (extra: Partial<CapRecord> = {}) =>
  rec("GET", `/Videos/${H264_ITEM}/stream`, { queryNames: ["Static", "MediaSourceId", "PlaySessionId"], staticTrue: true, range: true, status: 206, ...extra });

// The capture of one pair: probe and sign-in, the H.264 item's one PlaybackInfo and its play, then the no-decoder
// item's first and forced PlaybackInfo. Nothing of the converted plan is fetched.
function capture(digest: string): CapRecord[] {
  return [
    rec("GET", "/System/Info/Public", { token: false }),
    rec("POST", "/Users/AuthenticateByName", { token: false }),
    rec("GET", "/Items", { queryNames: ["searchTerm", "IncludeItemTypes", "Recursive"] }),
    info(H264_ITEM, FIRST, FIRST, digest),
    stream({ range: false, status: 200 }),
    stream(),
    rec("GET", "/Items", { queryNames: ["searchTerm", "IncludeItemTypes", "Recursive"] }),
    info(NO_DECODER_ITEM, FIRST, FIRST, digest),
    info(NO_DECODER_ITEM, FORCED, FORCED, digest),
  ];
}

const infoIndexes = (records: CapRecord[]) => records.flatMap((record, index) => (record.playbackInfo ? [index] : []));

function withFacts(records: CapRecord[], nth: number, change: (facts: Facts) => Facts): CapRecord[] {
  const copy = records.map((record) => ({ ...record }));
  const index = infoIndexes(copy)[nth];
  copy[index] = { ...copy[index], playbackInfo: change(copy[index].playbackInfo!) };
  return copy;
}

const words = (line: string) => Object.fromEntries([...line.matchAll(/(\S+?)=(\S*)/g)].map(([, key, value]) => [key, value]));

const COMMON = "outcome=ok probe=complete h264main=listed hevcmain=listed h264plan=original h264=first-frame";
const SAID = {
  jellyscale: `${COMMON} nodecoder=refused reason=device-cannot-play`,
  "jellyfin-12": `${COMMON} nodecoder=transcode client=DeviceCannotPlay`,
} as const;
const HEVC_LISTED: Decoders = { hevc: { type: true, profile: true }, av1: { type: true, profile: true } };
const NO_HEVC: Decoders = { hevc: { type: false, profile: false }, av1: { type: true, profile: true } };

async function digestOfProfile(): Promise<string> {
  const { canonicalDigest } = await loadProxy();
  const { MaxStreamingBitrate: _limit, ...profile } = OCTAVE_PROFILE;
  return canonicalDigest(profile);
}

async function judgeOf(): Promise<Judge> {
  const judge = (await loadJudge()).WIRE_JUDGES["player-capabilities"];
  expect(typeof judge, "WIRE_JUDGES has player-capabilities").toBe("function");
  return judge;
}

function pairOf(target: keyof typeof SAID, records: CapRecord[] | undefined, decoders: Decoders = HEVC_LISTED): Pair {
  return { test: "player-capabilities", target, task: "T8-07", requests: records?.length ?? 9, ...(records ? { records } : {}), decoders };
}

// ---- item 4 ----

describe("T8-07 item 4: every PlaybackInfo on the wire carries the one Octave profile", () => {
  it("T8-07 item 4: canonicalDigest is the SHA-256 hex of the JSON with keys sorted at every level and no whitespace", async () => {
    const { canonicalDigest } = await loadProxy();
    const value = { b: 1, a: { d: [{ f: 1, e: "x" }, 2], c: null }, g: [true, false] };
    expect(canonicalDigest(value)).toBe(sha256('{"a":{"c":null,"d":[{"e":"x","f":1},2]},"b":1,"g":[true,false]}'));
    expect(canonicalDigest({ g: [true, false], a: { c: null, d: [{ e: "x", f: 1 }, 2] }, b: 1 })).toBe(canonicalDigest(value));
    expect(canonicalDigest({ ...value, g: [false, true] })).not.toBe(canonicalDigest(value));
  });

  it("T8-07 item 4: OCTAVE_PROFILE_DIGEST is canonicalDigest of OCTAVE_PROFILE without MaxStreamingBitrate", async () => {
    const { OCTAVE_PROFILE_DIGEST } = await loadJudge();
    expect(OCTAVE_PROFILE_DIGEST).toMatch(HEX64);
    expect(OCTAVE_PROFILE_DIGEST).toBe(await digestOfProfile());
  });

  it("T8-07 item 4: playbackInfoFacts digests the body's DeviceProfile without its MaxStreamingBitrate", async () => {
    const { playbackInfoFacts } = await loadProxy();
    const { OCTAVE_PROFILE_DIGEST } = await loadJudge();
    const url = `/Items/${H264_ITEM}/PlaybackInfo?UserId=u`;
    for (const limit of [8_000_000, 120_000_000]) {
      const body = JSON.stringify({ ...PLAYBACK_INFO_FLAGS, DeviceProfile: { ...OCTAVE_PROFILE, MaxStreamingBitrate: limit }, MaxStreamingBitrate: limit });
      expect(playbackInfoFacts(body, url).profile, `limit ${limit}`).toBe(OCTAVE_PROFILE_DIGEST);
    }
    const changed = JSON.stringify({ DeviceProfile: { ...OCTAVE_PROFILE, CodecProfiles: [{ Type: "Video", Codec: "h264" }] } });
    expect(playbackInfoFacts(changed, url).profile).not.toBe(OCTAVE_PROFILE_DIGEST);
    expect(playbackInfoFacts(JSON.stringify({ EnableDirectPlay: true }), url).profile).toBeNull();
    expect(playbackInfoFacts("not json", url).profile).toBeNull();
  });

  it("T8-07 item 4: the judge fails a PlaybackInfo whose profile digest differs, or is missing", async () => {
    const { judgeCapabilityCapture, OCTAVE_PROFILE_DIGEST } = await loadJudge();
    const good = capture(OCTAVE_PROFILE_DIGEST);
    expect(judgeCapabilityCapture(good)).toEqual([]);
    for (const nth of [0, 1, 2]) {
      const other = withFacts(good, nth, (facts) => ({ ...facts, profile: sha256("another profile") }));
      expect(judgeCapabilityCapture(other).length, `request ${nth}`).toBeGreaterThan(0);
      const none = withFacts(good, nth, (facts) => ({ ...facts, profile: null }));
      expect(judgeCapabilityCapture(none).length, `request ${nth} without a profile`).toBeGreaterThan(0);
    }
  });
});

// ---- item 6 ----

describe("T8-07 item 6: player-capabilities plays one sample each way and judges the requests sent", () => {
  const wireList = () => JSON.parse(readFileSync(join(wireDir, "wire-tests.json"), "utf8")) as { tests: { id: string; task: string; targets: string[] }[] };

  it("T8-07 item 6: player-capabilities is listed for jellyscale and jellyfin-12 under T8-07, with a device file and a judge", async () => {
    const entries = wireList().tests.filter((entry) => entry.id === "player-capabilities");
    expect(entries).toHaveLength(1);
    expect(entries[0].task).toBe("T8-07");
    expect(entries[0].targets).toEqual(["jellyscale", "jellyfin-12"]);
    expect(existsSync(join(wireDir, "player-capabilities.ts")), "apps/tv/src/e2e/wire/player-capabilities.ts exists").toBe(true);
    expect(readFileSync(join(wireDir, "run-wire.ts"), "utf8"), "run-wire.ts names player-capabilities in TESTS").toContain('"player-capabilities"');
    await judgeOf();
    const { selectTests } = await loadRunner();
    expect(selectTests({ task: "T8-07" }).map((entry) => entry.id)).toEqual(["player-capabilities"]);
  });

  it("T8-07 item 6: judgeCapabilityCapture passes one H.264 request, then the no-decoder item's first and forced requests", async () => {
    const { judgeCapabilityCapture, OCTAVE_PROFILE_DIGEST } = await loadJudge();
    expect(judgeCapabilityCapture(capture(OCTAVE_PROFILE_DIGEST))).toEqual([]);
  });

  it("T8-07 item 6: judgeCapabilityCapture fails a second H.264 request, a missing or third no-decoder request, and the items out of order", async () => {
    const { judgeCapabilityCapture, OCTAVE_PROFILE_DIGEST: d } = await loadJudge();
    const good = capture(d);
    const cases: [string, CapRecord[]][] = [
      ["a second H.264 request", [...good.slice(0, 4), info(H264_ITEM, FORCED, FORCED, d), ...good.slice(4)]],
      ["no forced request", good.slice(0, 8)],
      ["a third no-decoder request", [...good, info(NO_DECODER_ITEM, FORCED, FORCED, d)]],
      ["no PlaybackInfo at all", good.filter((record) => !record.playbackInfo)],
      ["the no-decoder item first", [info(NO_DECODER_ITEM, FIRST, FIRST, d), info(NO_DECODER_ITEM, FORCED, FORCED, d), info(H264_ITEM, FIRST, FIRST, d)]],
      ["a third item", [...good, info("ffffffffffffffffffffffffffffffff", FIRST, FIRST, d)]],
    ];
    for (const [name, records] of cases) expect(judgeCapabilityCapture(records).length, name).toBeGreaterThan(0);
  });

  it("T8-07 item 6: judgeCapabilityCapture fails a PlaybackInfo record the recorder kept no facts for", async () => {
    const { judgeCapabilityCapture, OCTAVE_PROFILE_DIGEST } = await loadJudge();
    const records = capture(OCTAVE_PROFILE_DIGEST).map((record) => ({ ...record }));
    delete records[3].playbackInfo;
    expect(judgeCapabilityCapture(records).length).toBeGreaterThan(0);
  });

  it("T8-07 item 6: the judge passes each server's words over a good capture", async () => {
    const judge = await judgeOf();
    const { OCTAVE_PROFILE_DIGEST } = await loadJudge();
    for (const target of ["jellyscale", "jellyfin-12"] as const) {
      expect(judge(pairOf(target, capture(OCTAVE_PROFILE_DIGEST)), words(SAID[target])), target).toEqual([]);
    }
  });

  it("T8-07 item 6: the judge fails a bad capture, and a pair with no records", async () => {
    const judge = await judgeOf();
    const { OCTAVE_PROFILE_DIGEST } = await loadJudge();
    expect(judge(pairOf("jellyfin-12", capture(OCTAVE_PROFILE_DIGEST).slice(0, 8)), words(SAID["jellyfin-12"])).length).toBeGreaterThan(0);
    expect(judge(pairOf("jellyfin-12", undefined), words(SAID["jellyfin-12"])).length).toBeGreaterThan(0);
  });

  it("T8-07 item 6: the judge fails the H.264 sample not planned as the original or not reaching first frame, and any other outcome", async () => {
    const judge = await judgeOf();
    const { OCTAVE_PROFILE_DIGEST } = await loadJudge();
    const pair = pairOf("jellyscale", capture(OCTAVE_PROFILE_DIGEST));
    for (const [key, wrong] of [
      ["outcome", "threw"],
      ["probe", "failed"],
      ["h264plan", "transcode"],
      ["h264plan", "direct-stream"],
      ["h264", "timeout"],
      ["h264", "decoder-unavailable"],
    ]) {
      expect(judge(pair, { ...words(SAID.jellyscale), [key]: wrong }).length, `${key}=${wrong}`).toBeGreaterThan(0);
    }
    for (const key of ["outcome", "probe", "h264plan", "h264", "nodecoder"]) {
      const missing = words(SAID.jellyscale);
      delete missing[key];
      expect(judge(pair, missing).length, `no ${key}`).toBeGreaterThan(0);
    }
  });

  it("T8-07 item 6: judgeRun passes a whole player-capabilities run, judged as a play", async () => {
    const { judgeRun } = await loadRunner();
    const { OCTAVE_PROFILE_DIGEST } = await loadJudge();
    for (const target of ["jellyscale", "jellyfin-12"] as const) {
      const result = judgeRun(runInput(target, capture(OCTAVE_PROFILE_DIGEST), SAID[target]), { write: () => [] });
      expect(result.errors, target).toEqual([]);
      expect(result.summary).toEqual([`player-capabilities ${target} T8-07 pass`]);
    }
  });

  it("T8-07 item 6: judgeRun fails a run that fetched the converted plan, or a play without the header or a range request", async () => {
    const { judgeRun } = await loadRunner();
    const { OCTAVE_PROFILE_DIGEST } = await loadJudge();
    const good = capture(OCTAVE_PROFILE_DIGEST);
    const cases: [string, CapRecord[]][] = [
      ["the converted plan's playlist", [...good, rec("GET", `/videos/${NO_DECODER_ITEM}/master.m3u8`, { queryNames: ["MediaSourceId", "PlaySessionId"] })]],
      ["the converted plan's media", [...good, rec("GET", `/videos/${NO_DECODER_ITEM}/hls1/main/0.mp4`)]],
      ["no header", good.map((record, index) => (index === 5 ? { ...record, authorization: false, scheme: null, token: false } : record))],
      ["no range", good.map((record) => ({ ...record, range: false }))],
      ["a credential name", good.map((record, index) => (index === 8 ? { ...record, queryNames: [...record.queryNames, "api_key"] } : record))],
    ];
    for (const [name, records] of cases) {
      const result = judgeRun(runInput("jellyfin-12", records, SAID["jellyfin-12"]), { write: () => [] });
      expect(result.failed, name).toBe(true);
    }
  });
});

function runInput(target: keyof typeof SAID, records: CapRecord[], line: string, decoders: Decoders = HEVC_LISTED): RunInput {
  return {
    pairs: [{ test: "player-capabilities", target, task: "T8-07", devicePort: PORT, records, decoders }],
    counts: { canaryOrigin: 0, redirector: 0, privateLan: 0 },
    lines: [`OCTAVE_WIRE result test=player-capabilities target=${target} task=T8-07 ${line}`, "OCTAVE_WIRE done"],
    logLines: ["01-01 00:00:00.000  1  1 I ReactNativeJS: fine"],
    seen: [],
    devicePorts: [PORT],
    secrets: [TOKEN],
    voids: [],
    kept: { how: "stream", lines: 900, start: true, end: true, open: true },
    deviceLines: [],
  };
}

describe("T8-07 item 6: the recorder keeps each PlaybackInfo's six flags and its profile digest, and no value", () => {
  let upstream: Server;
  let recorder: Recorder;
  const secrets = new Set<string>([TOKEN]);
  const MARKER = "octave-body-marker-6d2f";

  function send(method: string, path: string, body?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const headers: Record<string, string> = { authorization: `MediaBrowser Client="Octave", Token="x"` };
      if (body !== undefined) Object.assign(headers, { "content-type": "application/json", "content-length": String(Buffer.byteLength(body)) });
      const req = httpRequest({ host: "127.0.0.1", port: recorder.port, method, path, headers }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      });
      req.on("error", reject);
      req.end(body);
    });
  }

  beforeAll(async () => {
    upstream = createServer((req, res) => {
      req.resume();
      req.on("end", () => {
        if ((req.url ?? "").includes("/PlaybackInfo")) {
          res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ MediaSources: [], PlaySessionId: "5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e" }));
          return;
        }
        res.writeHead(200, { "content-type": "application/json" }).end("{}");
      });
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", () => resolve()));
    const { startRecorder } = await loadProxy();
    recorder = await startRecorder({ upstream: { port: (upstream.address() as { port: number }).port }, secrets });
  });

  afterAll(async () => {
    await recorder?.close();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  });

  it("T8-07 item 6: a PlaybackInfo post is recorded with its body and query flags and its profile digest", async () => {
    const query = new URLSearchParams({ UserId: MARKER, ...Object.fromEntries(Object.entries(FORCED).map(([name, value]) => [name, String(value)])) });
    const body = JSON.stringify({ ...FORCED, UserId: MARKER, DeviceProfile: { ...OCTAVE_PROFILE, Name: MARKER, MaxStreamingBitrate: 1 } });
    const before = recorder.records.length;
    await send("POST", `/Items/${NO_DECODER_ITEM}/PlaybackInfo?${query}`, body);
    const [made] = recorder.records.slice(before);
    const { canonicalDigest } = await loadProxy();
    const { MaxStreamingBitrate: _limit, ...profile } = { ...OCTAVE_PROFILE, Name: MARKER };
    expect(made.playbackInfo).toEqual({ body: FORCED, query: FORCED, profile: canonicalDigest(profile) });
    expect(JSON.stringify(made)).not.toContain(MARKER);
  });

  it("T8-07 item 6: a request that is not a PlaybackInfo post has no playbackInfo field", async () => {
    const before = recorder.records.length;
    await send("GET", `/Items/${H264_ITEM}/PlaybackInfo?EnableDirectPlay=true`);
    await send("POST", "/Sessions/Playing", JSON.stringify({ EnableDirectPlay: true }));
    const made = recorder.records.slice(before);
    expect(made).toHaveLength(2);
    for (const record of made) expect(record.playbackInfo, `${record.method} ${record.path}`).toBeUndefined();
  });
});

// ---- item 7 ----

describe("T8-07 item 7: the forced request carries both flags in body and query, and the app shows T2-09's result", () => {
  it("T8-07 item 7: playbackInfoFacts reads each flag from the body's JSON boolean and from exactly one query parameter", async () => {
    const { playbackInfoFacts } = await loadProxy();
    const body = JSON.stringify({ ...FORCED });
    const query = FLAG_NAMES.map((name) => `${name}=${FORCED[name]}`).join("&");
    expect(playbackInfoFacts(body, `/Items/${H264_ITEM}/PlaybackInfo?UserId=u&${query}`)).toEqual({ body: FORCED, query: FORCED, profile: null });
  });

  it("T8-07 item 7: a query flag is true or false in any case, and null when duplicated, missing or another word", async () => {
    const { playbackInfoFacts } = await loadProxy();
    const facts = (search: string) => playbackInfoFacts("{}", `/Items/${H264_ITEM}/PlaybackInfo?${search}`).query;
    expect(facts("EnableDirectPlay=FALSE").EnableDirectPlay).toBe(false);
    expect(facts("EnableDirectPlay=True").EnableDirectPlay).toBe(true);
    expect(facts("EnableDirectPlay=false&EnableDirectPlay=false").EnableDirectPlay).toBeNull();
    expect(facts("EnableDirectPlay=false&EnableDirectPlay=true").EnableDirectPlay).toBeNull();
    expect(facts("EnableDirectPlay=no").EnableDirectPlay).toBeNull();
    expect(facts("EnableDirectPlay=").EnableDirectPlay).toBeNull();
    expect(facts("UserId=u").EnableDirectPlay).toBeNull();
    expect(Object.keys(facts("UserId=u")).sort()).toEqual([...FLAG_NAMES].sort());
  });

  it("T8-07 item 7: a body flag is only a JSON boolean; a body that is not JSON gives nulls", async () => {
    const { playbackInfoFacts } = await loadProxy();
    const url = `/Items/${H264_ITEM}/PlaybackInfo`;
    expect(playbackInfoFacts(JSON.stringify({ EnableDirectPlay: "false" }), url).body.EnableDirectPlay).toBeNull();
    expect(playbackInfoFacts(JSON.stringify({ EnableDirectPlay: 0 }), url).body.EnableDirectPlay).toBeNull();
    expect(playbackInfoFacts(JSON.stringify({ EnableDirectPlay: false }), url).body.EnableDirectPlay).toBe(false);
    const broken = playbackInfoFacts("{not json", url);
    expect(Object.keys(broken.body).sort()).toEqual([...FLAG_NAMES].sort());
    for (const name of FLAG_NAMES) expect(broken.body[name], name).toBeNull();
    expect(broken.profile).toBeNull();
  });

  it("T8-07 item 7: judgeCapabilityCapture fails a forced flag only in the body, only in the query, or a flag the first request lacks", async () => {
    const { judgeCapabilityCapture, OCTAVE_PROFILE_DIGEST } = await loadJudge();
    const good = capture(OCTAVE_PROFILE_DIGEST);
    const cases: [string, number, (facts: Facts) => Facts][] = [
      ["EnableDirectPlay false only in the body", 2, (facts) => ({ ...facts, query: { ...facts.query, EnableDirectPlay: true } })],
      ["EnableDirectPlay false only in the query", 2, (facts) => ({ ...facts, body: { ...facts.body, EnableDirectPlay: true } })],
      ["AllowVideoStreamCopy false only in the body", 2, (facts) => ({ ...facts, query: { ...facts.query, AllowVideoStreamCopy: true } })],
      ["AllowVideoStreamCopy false only in the query", 2, (facts) => ({ ...facts, body: { ...facts.body, AllowVideoStreamCopy: true } })],
      ["a forced flag missing from the query", 2, (facts) => ({ ...facts, query: { ...facts.query, EnableDirectPlay: null } })],
      ["AllowAudioStreamCopy false on the forced request", 2, (facts) => ({ ...facts, body: { ...facts.body, AllowAudioStreamCopy: false }, query: { ...facts.query, AllowAudioStreamCopy: false } })],
      ["EnableTranscoding changed on the forced request", 2, (facts) => ({ ...facts, body: { ...facts.body, EnableTranscoding: false }, query: { ...facts.query, EnableTranscoding: false } })],
      ["AutoOpenLiveStream true on the forced request", 2, (facts) => ({ ...facts, body: { ...facts.body, AutoOpenLiveStream: true }, query: { ...facts.query, AutoOpenLiveStream: true } })],
      ["the H.264 request with direct play off", 0, (facts) => ({ ...facts, body: { ...facts.body, EnableDirectPlay: false }, query: { ...facts.query, EnableDirectPlay: false } })],
      ["the no-decoder first request with video copy off", 1, (facts) => ({ ...facts, body: { ...facts.body, AllowVideoStreamCopy: false }, query: { ...facts.query, AllowVideoStreamCopy: false } })],
      ["a first request's flag only in the body", 0, (facts) => ({ ...facts, query: { ...facts.query, EnableDirectStream: null } })],
    ];
    for (const [name, nth, change] of cases) expect(judgeCapabilityCapture(withFacts(good, nth, change)).length, name).toBeGreaterThan(0);
  });

  it("T8-07 item 7: CAPABILITY_EXPECTATIONS is T2-09's expectation per server for a sample whose codec the device lacks", async () => {
    const { CAPABILITY_EXPECTATIONS } = await loadJudge();
    expect(Object.keys(CAPABILITY_EXPECTATIONS).sort()).toEqual(["jellyfin-12", "jellyscale"]);
    for (const server of ["jellyscale", "jellyfin-12"]) {
      expect(CAPABILITY_EXPECTATIONS[server], server).toEqual(expectationFor(server, "no-av1", "av1"));
    }
  });

  it("T8-07 item 7: the judge fails the Jellyfin words on the Jellyscale pair, the reverse, and any other no-decoder result", async () => {
    const judge = await judgeOf();
    const { OCTAVE_PROFILE_DIGEST } = await loadJudge();
    const records = capture(OCTAVE_PROFILE_DIGEST);
    expect(judge(pairOf("jellyscale", records), words(SAID["jellyfin-12"])).length).toBeGreaterThan(0);
    expect(judge(pairOf("jellyfin-12", records), words(SAID.jellyscale)).length).toBeGreaterThan(0);
    for (const tail of [
      "nodecoder=original",
      "nodecoder=refused reason=conversion-not-allowed",
      "nodecoder=transcode client=none",
      "nodecoder=direct-stream client=DeviceCannotPlay",
      "nodecoder=plan-error",
    ]) {
      expect(judge(pairOf("jellyscale", records), words(`${COMMON} ${tail}`)).length, `jellyscale ${tail}`).toBeGreaterThan(0);
      expect(judge(pairOf("jellyfin-12", records), words(`${COMMON} ${tail}`)).length, `jellyfin-12 ${tail}`).toBeGreaterThan(0);
    }
  });

  it("T8-07 item 7: judgeRun fails the Jellyscale pair when a request lacks the header", async () => {
    const { judgeRun } = await loadRunner();
    const { OCTAVE_PROFILE_DIGEST } = await loadJudge();
    const records = capture(OCTAVE_PROFILE_DIGEST).map((record, index) => (index === 8 ? { ...record, authorization: false, scheme: null, token: false } : record));
    const result = judgeRun(runInput("jellyscale", records, SAID.jellyscale), { write: () => [] });
    expect(result.failed).toBe(true);
    expect(result.summary).toEqual(["player-capabilities jellyscale T8-07 fail"]);
  });
});

// ---- item 8 ----

describe("T8-07 item 8: the emulator's probe lists H.264 Main, and HEVC Main where it has an HEVC decoder", () => {
  it("T8-07 item 8: the judge fails h264main=absent", async () => {
    const judge = await judgeOf();
    const { OCTAVE_PROFILE_DIGEST } = await loadJudge();
    const said = { ...words(SAID.jellyscale), h264main: "absent" };
    expect(judge(pairOf("jellyscale", capture(OCTAVE_PROFILE_DIGEST)), said).length).toBeGreaterThan(0);
  });

  it("T8-07 item 8: the judge fails hevcmain=absent when the device's decoder list has an HEVC decoder, and passes it when not", async () => {
    const judge = await judgeOf();
    const { OCTAVE_PROFILE_DIGEST } = await loadJudge();
    const said = { ...words(SAID.jellyscale), hevcmain: "absent" };
    expect(judge(pairOf("jellyscale", capture(OCTAVE_PROFILE_DIGEST), HEVC_LISTED), said).length).toBeGreaterThan(0);
    expect(judge(pairOf("jellyscale", capture(OCTAVE_PROFILE_DIGEST), NO_HEVC), said)).toEqual([]);
  });
});
