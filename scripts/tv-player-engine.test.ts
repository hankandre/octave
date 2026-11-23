// @vitest-environment node
// T8-01 (docs/specs/T8-01.md, "The adapter"): apps/tv/src/host/player-engine.ts turns the player module into the
// core's PlayerEngine port. Items 1, 2 and 4, the JavaScript half; the Kotlin half is under modules/player.
//
// The contract frozen here:
// - player-engine.ts exports createPlayerEngine(native): PlayerEngine. `native` has initialize(), launch(map),
//   setPaused(map), seek(map), selectTrack(map), stop(), each resolving one plain map, and
//   addListener("playerEvent", listener) returning a subscription with remove().
// - initialize: readCapabilities(await native.initialize()); a rejection is { probe: "failed" }.
// - subscribe(listener): one addListener("playerEvent", …); every payload goes through the core's playerEvent, and
//   one it cannot read is dropped; it resolves a function that removes the subscription.
// - launch(request): the argument map is built key by key from the launch table (kind, sessionId,
//   startPositionSeconds, tracks, audioStreamIndex, subtitleStreamIndex, then url for an original file, or
//   masterUrl, serverUrl and mediaKind for HLS; a track holds only MediaTrack's fields). An absent optional key is
//   absent, not undefined, and a field a caller added at run time does not cross.
// - setPaused → { paused }, seek → { positionSeconds }, selectTrack → { type, playerId? }; initialize and stop take
//   no argument.
// - Each command: {} resolves; { error } throws PlayerEngineError(playerErrorCode(error)); a rejection, a non-object
//   or a missing shape throws PlayerEngineError("unknown") with the core's fixed message, no cause, and nothing of
//   the native message.
// - The shared launch vectors (packages/core/tests/fixtures/launch-requests.json, spec check issue 2) are what the
//   core's launchRequest builds today, and the adapter sends each unchanged; the Kotlin reader must accept them.
// - Item 4's Kotlin lists: the wire names in seam/PlayerEvent.kt (`PlayerEvent("<kind>")`) are PLAYER_EVENT_KINDS,
//   and those in seam/PlayerErrorCode.kt (`NAME("<code>")`) are PLAYER_ERROR_CODES in the port's order.
//
// Errors are compared by code, name and the core's fixed message, not by instanceof, so the test does not depend on
// the app and this file resolving @octave/core to one module instance. The adapter is loaded at run time from a path
// built here, so `pnpm typecheck` does not depend on it existing.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import type { PlaybackPlan } from "../packages/core/src/domain/playback";
import {
  PLAYER_ERROR_CODES,
  PLAYER_ERROR_MESSAGES,
  PLAYER_EVENT_KINDS,
  type LaunchRequest,
  type PlayerEngine,
  type PlayerEvent,
} from "../packages/core/src/domain/player-engine";
import { readCapabilities } from "../packages/core/src/domain/player-capabilities";
import { launchRequest } from "../packages/core/src/player/launch-request";
import { playerEvent } from "../packages/core/src/player/player-event";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const SEAM = "modules/player/android/src/main/java/dev/octave/player/seam";

type NativeMap = Record<string, unknown>;
type Listener = (payload: unknown) => void;
type Method = "initialize" | "launch" | "setPaused" | "seek" | "selectTrack" | "stop";
type Call = { method: Method; args: unknown[] };

interface PlayerNative {
  initialize(): Promise<unknown>;
  launch(args: NativeMap): Promise<unknown>;
  setPaused(args: NativeMap): Promise<unknown>;
  seek(args: NativeMap): Promise<unknown>;
  selectTrack(args: NativeMap): Promise<unknown>;
  stop(): Promise<unknown>;
  addListener(eventName: string, listener: Listener): { remove(): void };
}

type CreatePlayerEngine = (native: PlayerNative) => PlayerEngine;

async function loadCreate(): Promise<CreatePlayerEngine> {
  const path = join(repo, "apps/tv/src/host/player-engine.ts");
  const module = (await import(pathToFileURL(path).href)) as { createPlayerEngine: CreatePlayerEngine };
  return module.createPlayerEngine;
}

// A fake native module: records every call, answers with the function the test sets, and keeps its listeners.
function fakeNative(answers: Partial<Record<Method, (...args: unknown[]) => unknown>> = {}) {
  const calls: Call[] = [];
  const listeners = new Map<number, { eventName: string; listener: Listener }>();
  let next = 0;
  const make =
    (method: Method, fallback: unknown) =>
    async (...args: unknown[]) => {
      calls.push({ method, args });
      const answer = answers[method];
      return answer ? answer(...args) : fallback;
    };
  const native: PlayerNative = {
    initialize: make("initialize", { probe: "failed" }),
    launch: make("launch", {}),
    setPaused: make("setPaused", {}),
    seek: make("seek", {}),
    selectTrack: make("selectTrack", {}),
    stop: make("stop", {}),
    addListener(eventName, listener) {
      const id = next;
      next += 1;
      listeners.set(id, { eventName, listener });
      return { remove: () => listeners.delete(id) };
    },
  };
  const emit = (payload: unknown) => {
    for (const { eventName, listener } of [...listeners.values()]) if (eventName === "playerEvent") listener(payload);
  };
  return { native, calls, listeners, emit };
}

async function engineWith(answers: Parameters<typeof fakeNative>[0] = {}) {
  const create = await loadCreate();
  const fake = fakeNative(answers);
  return { engine: create(fake.native), ...fake };
}

async function failureOf(promise: Promise<unknown>): Promise<Error & { code?: string }> {
  return promise.then(
    () => {
      throw new Error("expected a failure");
    },
    (error: unknown) => error as Error & { code?: string },
  );
}

function expectEngineError(error: Error & { code?: string }, code: string) {
  expect(error.name).toBe("PlayerEngineError");
  expect(error.code).toBe(code);
  expect(error.message).toBe(PLAYER_ERROR_MESSAGES[code as keyof typeof PLAYER_ERROR_MESSAGES]);
  expect((error as { cause?: unknown }).cause).toBeUndefined();
}

const SESSION = "3f1c9a7e5b2d4c6e8a0b1c2d3e4f5a6b";
const ORIGINAL_URL = "https://media.test/Videos/one/stream?Static=true&MediaSourceId=source";
const TRACK_KEYS = ["index", "type", "displayTitle", "external", "codec", "language", "deliveryUrl", "title", "channels", "isDefault", "isForced", "isHearingImpaired"];
const COMMON_KEYS = ["kind", "sessionId", "startPositionSeconds", "tracks", "audioStreamIndex", "subtitleStreamIndex"];

const fullTrack = {
  index: 3,
  type: "Subtitle" as const,
  displayTitle: "English - SRT",
  codec: "srt",
  language: "eng",
  external: true,
  deliveryUrl: "https://media.test/Videos/one/source/Subtitles/3/0/Stream.vtt",
  title: "Full",
  channels: 2,
  isDefault: true,
  isForced: false,
  isHearingImpaired: true,
};

const original = (): LaunchRequest => ({
  kind: "original",
  url: ORIGINAL_URL,
  sessionId: SESSION,
  startPositionSeconds: 12.5,
  tracks: [{ index: 1, type: "Audio", displayTitle: "English - AAC", external: false }, fullTrack],
  audioStreamIndex: 1,
  subtitleStreamIndex: 3,
});

const hls = (): LaunchRequest => ({
  kind: "hls",
  masterUrl: "https://media.test/jellyfin/videos/one/master.m3u8?MediaSourceId=source",
  serverUrl: "https://media.test/jellyfin",
  mediaKind: "videos",
  sessionId: SESSION,
  startPositionSeconds: 0,
  tracks: [],
});

const snapshot = {
  positionSeconds: 10,
  paused: false,
  buffering: false,
  volume: 100,
  muted: false,
  tracks: [{ playerId: 1, type: "Audio", title: "English", external: false, selected: true }],
  diagnostics: { decodeMode: "hardware", decodeLabel: "c2.example.avc.decoder", droppedFrames: 0 },
};

describe("the player engine adapter: launch", () => {
  it("T8-01 item 2: an original-file launch sends exactly the table's keys, tracks included", async () => {
    const { engine, calls } = await engineWith();
    const request = original();
    await expect(engine.launch(request)).resolves.toBeUndefined();
    expect(calls.map((call) => call.method)).toEqual(["launch"]);
    const args = calls[0].args[0] as NativeMap;
    expect(calls[0].args).toHaveLength(1);
    expect(args).not.toBe(request);
    expect(Object.keys(args).sort()).toEqual([...COMMON_KEYS, "url"].sort());
    expect(args).toEqual(request);
    const tracks = args.tracks as NativeMap[];
    expect(tracks).not.toBe(request.tracks);
    expect(Object.keys(tracks[0]).sort()).toEqual(["displayTitle", "external", "index", "type"]);
    expect(Object.keys(tracks[1]).sort()).toEqual([...TRACK_KEYS].sort());
  });

  it("T8-01 item 2: an HLS launch sends exactly its keys, and absent optional keys stay absent", async () => {
    const { engine, calls } = await engineWith();
    await engine.launch(hls());
    const args = calls[0].args[0] as NativeMap;
    expect(Object.keys(args).sort()).toEqual(["kind", "masterUrl", "mediaKind", "serverUrl", "sessionId", "startPositionSeconds", "tracks"]);
    expect(args).toEqual(hls());
  });

  it("T8-01 item 2: a header, a token, an option or another kind's URL added at run time does not cross", async () => {
    const { engine, calls } = await engineWith();
    const smuggled = {
      ...original(),
      headers: { Authorization: "MediaBrowser Token=\"x\"" },
      header: "x",
      authorization: "x",
      Authorization: "x",
      token: "x",
      accessToken: "x",
      apiKey: "x",
      options: { "http-header-fields": "x" },
      httpHeaders: "x",
      masterUrl: "https://media.test/jellyfin/videos/one/master.m3u8",
      tracks: [{ ...fullTrack, headers: "x", token: "x", url: "https://other.test/x" }],
    } as unknown as LaunchRequest;
    await engine.launch(smuggled);
    const args = calls[0].args[0] as NativeMap;
    expect(Object.keys(args).sort()).toEqual([...COMMON_KEYS, "url"].sort());
    for (const key of ["headers", "header", "authorization", "Authorization", "token", "accessToken", "apiKey", "options", "httpHeaders", "masterUrl"]) {
      expect(args, `${key} crossed`).not.toHaveProperty(key);
    }
    expect(Object.keys((args.tracks as NativeMap[])[0]).sort()).toEqual([...TRACK_KEYS].sort());

    const hlsSmuggled = { ...hls(), url: ORIGINAL_URL, token: "x" } as unknown as LaunchRequest;
    await engine.launch(hlsSmuggled);
    expect(calls[1].args[0], "an HLS launch carries no url").not.toHaveProperty("url");
    expect(calls[1].args[0]).not.toHaveProperty("token");
  });

  it("T8-01 item 2: the shared launch vectors are what the core builds, and the adapter sends each unchanged", async () => {
    const fixture = JSON.parse(readFileSync(join(repo, "packages/core/tests/fixtures/launch-requests.json"), "utf8")) as {
      vectors: { name: string; sessionId: string; plan: PlaybackPlan; request: LaunchRequest }[];
    };
    expect(fixture.vectors.length).toBeGreaterThanOrEqual(4);
    expect(new Set(fixture.vectors.map((vector) => vector.request.kind))).toEqual(new Set(["original", "hls"]));
    const { engine, calls } = await engineWith();
    for (const [index, vector] of fixture.vectors.entries()) {
      expect(launchRequest(vector.plan, vector.sessionId), `the core builds ${vector.name}`).toEqual(vector.request);
      await engine.launch(vector.request);
      expect(calls[index].args[0], `the adapter sends ${vector.name} unchanged`).toEqual(vector.request);
    }
  });
});

describe("the player engine adapter: commands", () => {
  it("T8-01 item 1: each command calls its one native function with its typed map", async () => {
    const { engine, calls } = await engineWith();
    await engine.setPaused(true);
    await engine.seek(42.5);
    await engine.selectTrack("audio", 2);
    await engine.selectTrack("subtitle");
    await engine.stop();
    expect(calls.map((call) => call.method)).toEqual(["setPaused", "seek", "selectTrack", "selectTrack", "stop"]);
    expect(calls[0].args).toEqual([{ paused: true }]);
    expect(calls[1].args).toEqual([{ positionSeconds: 42.5 }]);
    expect(calls[2].args).toEqual([{ type: "audio", playerId: 2 }]);
    expect(calls[3].args).toHaveLength(1);
    expect(Object.keys(calls[3].args[0] as NativeMap)).toEqual(["type"]);
    expect(calls[3].args[0]).toEqual({ type: "subtitle" });
    expect(calls[4].args).toEqual([]);
  });

  it("T8-01 item 4: each command's { error } becomes PlayerEngineError with that code", async () => {
    for (const code of PLAYER_ERROR_CODES) {
      const answer = () => ({ error: code });
      const { engine } = await engineWith({ launch: answer, setPaused: answer, seek: answer, selectTrack: answer, stop: answer });
      const commands: [string, () => Promise<unknown>][] = [
        ["launch", () => engine.launch(original())],
        ["setPaused", () => engine.setPaused(false)],
        ["seek", () => engine.seek(1)],
        ["selectTrack", () => engine.selectTrack("audio", 1)],
        ["stop", () => engine.stop()],
      ];
      for (const [name, run] of commands) {
        const error = await failureOf(run());
        expect(error.code, `${name} with { error: ${code} }`).toBe(code);
        expectEngineError(error, code);
      }
    }
  });

  it("T8-01 item 4: an unknown code, a non-object or a missing shape is unknown", async () => {
    for (const answer of [{ error: "SECRET-native-text" }, { error: 7 }, null, undefined, "ok", 1, [], [{}], true]) {
      const { engine } = await engineWith({ launch: () => answer, setPaused: () => answer, seek: () => answer, selectTrack: () => answer, stop: () => answer });
      for (const run of [() => engine.launch(original()), () => engine.setPaused(true), () => engine.seek(0), () => engine.selectTrack("subtitle"), () => engine.stop()]) {
        const error = await failureOf(run());
        expectEngineError(error, "unknown");
        expect(JSON.stringify(error)).not.toContain("SECRET");
        expect(String(error)).not.toContain("SECRET");
      }
    }
  });

  it("T8-01 item 4: a rejection carrying a URL becomes PlayerEngineError(unknown) and drops the message, cause and stack", async () => {
    const url = "https://media.test/Videos/one/stream?Static=true&PlaySessionId=play-canary-77";
    const reject = () => {
      const error = new Error(`ExoPlaybackException: Source error at ${url}`);
      (error as Error & { cause?: unknown }).cause = new Error(url);
      (error as Error & { code?: string }).code = "network";
      throw error;
    };
    const { engine } = await engineWith({ launch: reject, setPaused: reject, seek: reject, selectTrack: reject, stop: reject });
    for (const run of [() => engine.launch(original()), () => engine.setPaused(true), () => engine.seek(0), () => engine.selectTrack("audio", 1), () => engine.stop()]) {
      const error = await failureOf(run());
      expectEngineError(error, "unknown");
      for (const text of [error.message, String(error.stack), JSON.stringify(error), String(error)]) {
        expect(text).not.toContain("media.test");
        expect(text).not.toContain("play-canary-77");
      }
    }
  });
});

describe("the player engine adapter: initialize and events", () => {
  it("T8-01 item 4: initialize reads the native answer through readCapabilities, and a rejection is failed", async () => {
    const raw = {
      probe: "complete",
      videoDecoders: [{ codec: "h264", hardware: true, profile: "High", maxBitDepth: 8, maxWidth: 3840, maxHeight: 2160, extra: "x" }, { codec: "theora", hardware: false }],
      audioDecoders: ["aac", "ac3", "bogus"],
      hdr: ["hdr10", "nope"],
      passthrough: ["eac3"],
      url: "https://media.test/x",
    };
    const { engine, calls } = await engineWith({ initialize: () => raw });
    await expect(engine.initialize()).resolves.toEqual(readCapabilities(raw));
    expect(calls[0]).toEqual({ method: "initialize", args: [] });
    const failing = await engineWith({
      initialize: () => {
        throw new Error("https://media.test/x");
      },
    });
    await expect(failing.engine.initialize()).resolves.toEqual({ probe: "failed" });
    const odd = await engineWith({ initialize: () => "complete" });
    await expect(odd.engine.initialize()).resolves.toEqual({ probe: "failed" });
  });

  it("T8-01 item 4: events are rebuilt through playerEvent, and an unknown kind or shape is dropped", async () => {
    const { engine, emit, listeners } = await engineWith();
    const seen: PlayerEvent[] = [];
    await engine.subscribe((event) => seen.push(event));
    expect([...listeners.values()].map((entry) => entry.eventName)).toEqual(["playerEvent"]);
    const payloads: unknown[] = [
      { kind: "loaded", snapshot: { ...snapshot, url: "https://media.test/x" }, playSessionId: "play-canary-77" },
      { kind: "first-frame", url: "https://media.test/x" },
      { kind: "state", snapshot, cause: "seek", path: "/Videos/one/stream" },
      { kind: "tracks-changed", snapshot: { ...snapshot, diagnostics: { ...snapshot.diagnostics, message: "player text" } } },
      { kind: "ended", reason: "eof" },
      { kind: "ended", reason: "crashed", snapshot },
      { kind: "error", code: "decoder-failed", message: "MediaCodec failed at https://media.test/x" },
      { kind: "error", code: "SECRET-native-text" },
      { kind: "progress", snapshot },
      { kind: "loaded" },
      null,
      "first-frame",
      42,
    ];
    for (const payload of payloads) emit(payload);
    const expected = payloads.map((payload) => playerEvent(payload)).filter((event): event is PlayerEvent => event !== undefined);
    expect(seen).toEqual(expected);
    expect(seen.map((event) => event.kind)).toEqual(["loaded", "first-frame", "state", "tracks-changed", "ended", "ended", "error", "error"]);
    expect(seen[7]).toEqual({ kind: "error", code: "unknown" });
    for (const text of [JSON.stringify(seen)]) {
      expect(text).not.toContain("media.test");
      expect(text).not.toContain("play-canary-77");
      expect(text).not.toContain("player text");
      expect(text).not.toContain("SECRET");
    }
  });

  it("T8-01 item 4: the function subscribe resolves removes the native subscription", async () => {
    const { engine, emit, listeners } = await engineWith();
    const seen: PlayerEvent[] = [];
    const unsubscribe = await engine.subscribe((event) => seen.push(event));
    expect(typeof unsubscribe).toBe("function");
    emit({ kind: "first-frame" });
    unsubscribe();
    expect(listeners.size).toBe(0);
    emit({ kind: "first-frame" });
    expect(seen).toEqual([{ kind: "first-frame" }]);
  });

  it("T8-01 item 4: the Kotlin event kinds and error codes are the port's", () => {
    const events = readFileSync(join(repo, SEAM, "PlayerEvent.kt"), "utf8");
    const kinds = [...events.replace(/\/\/.*$/gm, "").matchAll(/\bPlayerEvent\s*\(\s*"([^"]*)"\s*\)/g)].map((match) => match[1]);
    expect([...kinds].sort()).toEqual([...PLAYER_EVENT_KINDS].sort());
    const codes = readFileSync(join(repo, SEAM, "PlayerErrorCode.kt"), "utf8").replace(/\/\/.*$/gm, "");
    const enumBody = /enum\s+class\s+PlayerErrorCode\b[^{]*\{([\s\S]*?)(;|\}\s*$)/.exec(codes)?.[1] ?? "";
    const wires = [...enumBody.matchAll(/\b[A-Z][A-Z0-9_]*\s*\(\s*"([^"]*)"\s*\)/g)].map((match) => match[1]);
    expect(wires).toEqual([...PLAYER_ERROR_CODES]);
    expect(existsSync(join(repo, SEAM, "PlayerEventMaps.kt")), "PlayerEventMaps.kt exists").toBe(true);
  });
});
