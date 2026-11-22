// @vitest-environment node
// T8-22 items 1 to 5 (docs/specs/T8-22.md): the launch request forwards the parsed href, refuses a fragment, a
// bracketed credential name, `Token=` and `MediaBrowser` in the query, allows only the two URL shapes, applies host
// rules R1 and R2 to every URL, and never sends a start position that is not finite.
//
// Every refusal case below starts from a URL the request accepts and changes one thing. The comment on each table
// names the rule the change isolates (L1 to L5, S1, S2), so a case fails when its own rule alone is removed.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { webCrypto } from "../adapters/web-crypto";
import type { LibraryItem } from "../domain/catalog";
import type { MediaTrack, PlaybackPlan } from "../domain/playback";
import { PlaybackRefusedError } from "../domain/playback";
import { JellyfinGateway } from "../jellyfin/gateway";
import type { PlaybackInfoResponse } from "../jellyfin/types";
import type { SignInRequest, SignInResult, Transport, TransportRequest, TransportResponse } from "../ports/transport";
import { FakeClock } from "../ports/fake-clock";
import { PlaybackCoordinator, type PlaybackGateway } from "./coordinator";
import { createFakePlayerEngine } from "./fake-player-engine";
import { LaunchRefusedError, launchRequest } from "./launch-request";

const REFUSED = "Octave will not send this stream address to the player.";
const FIXTURES = join(__dirname, "../../tests/fixtures");

const audio: MediaTrack = { index: 1, type: "Audio", displayTitle: "English - AAC - Stereo", codec: "aac", language: "eng", external: false, channels: 2 };
const subtitleAt = (deliveryUrl: string): MediaTrack => ({
  index: 3,
  type: "Subtitle",
  displayTitle: "English - SRT",
  codec: "srt",
  language: "eng",
  external: true,
  deliveryUrl,
});

const STATIC_URL = "https://media.test/Videos/one/stream?Static=true&MediaSourceId=source&PlaySessionId=play-1";
const STATIC_SUBTITLE = "https://media.test/Videos/one/source/Subtitles/3/0/Stream.vtt";
const SERVER = "https://media.test/jellyfin";
const MASTER = "https://media.test/jellyfin/videos/one/master.m3u8?MediaSourceId=source&PlaySessionId=play-2";
const HLS_SUBTITLE = "https://media.test/jellyfin/Videos/one/source/Subtitles/3/0/Stream.vtt";

function staticPlan(overrides: Record<string, unknown> = {}): PlaybackPlan {
  return {
    itemId: "one",
    title: "The Quiet Title Of The Film",
    streamUrl: STATIC_URL,
    mediaSourceId: "source",
    playSessionId: "play-1",
    startPositionTicks: 12_345_000_000,
    tracks: [audio],
    defaultAudioStreamIndex: 1,
    delivery: "static",
    playMethod: "DirectPlay",
    conversionReasons: [],
    ...overrides,
  } as PlaybackPlan;
}

function hlsPlan(overrides: Record<string, unknown> = {}): PlaybackPlan {
  return {
    itemId: "one",
    title: "The Quiet Title Of The Film",
    streamUrl: MASTER,
    mediaSourceId: "source",
    playSessionId: "play-2",
    startPositionTicks: 0,
    tracks: [audio],
    delivery: "hls",
    playMethod: "Transcode",
    conversionReasons: ["AudioCodecNotSupported"],
    serverUrl: SERVER,
    mediaKind: "videos",
    ...overrides,
  } as PlaybackPlan;
}

// One URL kind: how to put `url` into a plan that is otherwise accepted.
interface Kind {
  kind: string;
  base: string;
  plan(url: string): PlaybackPlan;
}

const STREAM_KINDS: Kind[] = [
  { kind: "original-file URL", base: STATIC_URL, plan: (url) => staticPlan({ streamUrl: url }) },
  { kind: "HLS master URL", base: MASTER, plan: (url) => hlsPlan({ streamUrl: url }) },
  { kind: "subtitle URL on an original file", base: STATIC_SUBTITLE, plan: (url) => staticPlan({ tracks: [audio, subtitleAt(url)] }) },
  { kind: "subtitle URL on an HLS session", base: HLS_SUBTITLE, plan: (url) => hlsPlan({ tracks: [audio, subtitleAt(url)] }) },
];

function attempt(plan: PlaybackPlan): unknown {
  try {
    launchRequest(plan, "session-1");
  } catch (error) {
    return error;
  }
  return undefined;
}

// The refusal is the existing error with its fixed sentence, and nothing of the URL is in it.
function expectRefused(plan: PlaybackPlan, leaks: readonly string[] = []): void {
  const error = attempt(plan);
  expect(error).toBeInstanceOf(LaunchRefusedError);
  const refused = error as LaunchRefusedError;
  expect(refused.message).toBe(REFUSED);
  expect(Object.keys(refused).filter((key) => key !== "name")).toEqual([]);
  expect("cause" in refused).toBe(false);
  const shown = [String(refused), JSON.stringify(refused), JSON.stringify(Object.getOwnPropertyNames(refused)), refused.message].join("\n");
  for (const leak of ["media.test", "SECRET-TOKEN", "play-1", "play-2", ...leaks]) expect(shown).not.toContain(leak);
}

function expectLaunches(plan: PlaybackPlan): void {
  expect(attempt(plan)).toBeUndefined();
}

function withQuery(url: string, extra: string): string {
  return url.includes("?") ? `${url}&${extra}` : `${url}?${extra}`;
}

describe("T8-22 item 1: the request forwards the parsed URL's href", () => {
  it("T8-22 item 1: sends an original file's href, not the string it was given", () => {
    const raw = "HTTPS://MEDIA.test:443/Videos\\one/stream?Static=true&MediaSourceId=source";
    const request = launchRequest(staticPlan({ streamUrl: raw }), "session-1");
    expect(request).toMatchObject({ kind: "original", url: "https://media.test/Videos/one/stream?Static=true&MediaSourceId=source" });
    expect((request as { url: string }).url).not.toBe(raw);
    expect((request as { url: string }).url).toBe(new URL(raw).href);
  });

  it("T8-22 item 1: sends an HLS master, the server URL and a subtitle as their hrefs", () => {
    const raw = "HTTPS://MEDIA.test:443/jellyfin/videos\\one/master.m3u8?MediaSourceId=source&PlaySessionId=play-2";
    const rawSubtitle = "HTTPS://MEDIA.test:443/jellyfin/Videos\\one/source/Subtitles/3/0/Stream.vtt";
    const request = launchRequest(
      hlsPlan({ streamUrl: raw, serverUrl: "https://MEDIA.test:443/jellyfin/", tracks: [audio, subtitleAt(rawSubtitle)] }),
      "session-1",
    );
    expect(request).toMatchObject({
      kind: "hls",
      masterUrl: "https://media.test/jellyfin/videos/one/master.m3u8?MediaSourceId=source&PlaySessionId=play-2",
      serverUrl: "https://media.test/jellyfin",
    });
    expect(request.tracks[1].deliveryUrl).toBe("https://media.test/jellyfin/Videos/one/source/Subtitles/3/0/Stream.vtt");
    expect(request.tracks[1].deliveryUrl).not.toBe(rawSubtitle);
  });

  it("T8-22 item 1: sends a subtitle on an original file as its href", () => {
    const rawSubtitle = "https://MEDIA.test:443/Videos\\one/source/Subtitles/3/0/Stream.vtt";
    const request = launchRequest(staticPlan({ tracks: [audio, subtitleAt(rawSubtitle)] }), "session-1");
    expect(request.tracks[1].deliveryUrl).toBe("https://media.test/Videos/one/source/Subtitles/3/0/Stream.vtt");
  });

  it("T8-22 item 1: forwards a server URL with no base path without the slash the parser adds", () => {
    const request = launchRequest(
      hlsPlan({ serverUrl: "https://media.test", streamUrl: "https://media.test/videos/one/master.m3u8?MediaSourceId=source" }),
      "session-1",
    );
    expect(request).toMatchObject({ kind: "hls", serverUrl: "https://media.test" });
  });

  it("T8-22 item 1: keeps the request's keys", () => {
    expect(Object.keys(launchRequest(staticPlan(), "session-1")).sort()).toEqual(["audioStreamIndex", "kind", "sessionId", "startPositionSeconds", "tracks", "url"]);
    expect(Object.keys(launchRequest(hlsPlan(), "session-1")).sort()).toEqual(["kind", "masterUrl", "mediaKind", "serverUrl", "sessionId", "startPositionSeconds", "tracks"]);
  });
});

describe("T8-22 item 2: a fragment, a bracketed credential name, Token= and MediaBrowser in the query are refused", () => {
  // L3 isolated: the URL is accepted without the fragment.
  const FRAGMENTS = ["#t=10", "#", "#Token=SECRET-TOKEN"];
  it.each(STREAM_KINDS.flatMap((k) => FRAGMENTS.map((fragment) => [k.kind, k, fragment] as const)))(
    "T8-22 item 2: refuses a fragment (L3) on the %s",
    (_kind, k, fragment) => {
      expectLaunches(k.plan(k.base));
      expectRefused(k.plan(`${k.base}${fragment}`), ["#t=10"]);
    },
  );

  it("T8-22 item 2: refuses a fragment on the server URL (L3)", () => {
    expectLaunches(hlsPlan());
    for (const fragment of FRAGMENTS) expectRefused(hlsPlan({ serverUrl: `${SERVER}${fragment}` }), ["#t=10"]);
  });

  // L4 isolated: a bracketed name whose pieces are credential names, with no `Token=` text and no MediaBrowser.
  const BRACKETED = ["api_key[]=x", "api_key%5B%5D=x", "ApiKey[0]=x", "x[token]=x", "%5Bapikey%5D=x"];
  it.each(STREAM_KINDS.flatMap((k) => BRACKETED.map((query) => [k.kind, k, query] as const)))(
    "T8-22 item 2: refuses a bracketed credential name (L4) on the %s",
    (_kind, k, query) => {
      expectRefused(k.plan(withQuery(k.base, query)), [query]);
    },
  );

  // L5, `Token=`: anywhere, in the query raw or decoded once, and in a path segment.
  const TOKEN_QUERIES = ["x=Token=SECRET-TOKEN", "x=Token%3DSECRET-TOKEN", "PlayToken=1", "token=1"];
  it.each(STREAM_KINDS.flatMap((k) => TOKEN_QUERIES.map((query) => [k.kind, k, query] as const)))(
    "T8-22 item 2: refuses Token= (L5) in the query of the %s",
    (_kind, k, query) => {
      expectRefused(k.plan(withQuery(k.base, query)), [query]);
    },
  );

  it("T8-22 item 2: refuses Token= in a path segment (L5) of each URL kind", () => {
    expectRefused(staticPlan({ streamUrl: "https://media.test/Token=SECRET-TOKEN/Videos/one/stream?Static=true" }));
    expectRefused(staticPlan({ tracks: [audio, subtitleAt("https://media.test/Token=SECRET-TOKEN/Videos/one/source/Subtitles/3/0/Stream.vtt")] }));
    expectRefused(hlsPlan({ serverUrl: "https://media.test/Token=SECRET-TOKEN", streamUrl: "https://media.test/Token=SECRET-TOKEN/videos/one/master.m3u8?MediaSourceId=source" }));
    expectRefused(hlsPlan({ tracks: [audio, subtitleAt("https://media.test/jellyfin/Token=SECRET-TOKEN/Subtitles/3/0/Stream.vtt")] }));
  });

  // L5, `MediaBrowser`: in the query only, in any case, raw or decoded once.
  const MEDIABROWSER_QUERIES = ["h=MediaBrowser%20SECRET-TOKEN", "Authorization=mediabrowser", "h=%4DediaBrowser", "h=MEDIABROWSER"];
  it.each(STREAM_KINDS.flatMap((k) => MEDIABROWSER_QUERIES.map((query) => [k.kind, k, query] as const)))(
    "T8-22 item 2: refuses MediaBrowser (L5) in the query of the %s",
    (_kind, k, query) => {
      expectRefused(k.plan(withQuery(k.base, query)), [query]);
    },
  );

  it("T8-22 item 2: does not refuse MediaBrowser in a host or a base path", () => {
    expectLaunches(staticPlan({ streamUrl: "https://mediabrowser.test/Videos/one/stream?Static=true", tracks: [audio, subtitleAt("https://mediabrowser.test/Videos/one/source/Subtitles/3/0/Stream.vtt")] }));
    expectLaunches(hlsPlan({
      serverUrl: "https://mediabrowser.test/jellyfin",
      streamUrl: "https://mediabrowser.test/jellyfin/videos/one/master.m3u8?MediaSourceId=source",
      tracks: [audio, subtitleAt("https://mediabrowser.test/jellyfin/Videos/one/source/Subtitles/3/0/Stream.vtt")],
    }));
    expectLaunches(staticPlan({ streamUrl: "https://media.test/mediabrowser/Videos/one/stream?Static=true", tracks: [audio, subtitleAt("https://media.test/mediabrowser/Videos/one/source/Subtitles/3/0/Stream.vtt")] }));
    expectLaunches(hlsPlan({
      serverUrl: "https://media.test/mediabrowser",
      streamUrl: "https://media.test/mediabrowser/videos/one/master.m3u8?MediaSourceId=source",
      tracks: [audio, subtitleAt("https://media.test/mediabrowser/Videos/one/source/Subtitles/3/0/Stream.vtt")],
    }));
  });

  it("T8-22 item 2: refuses a server URL whose href cannot be decoded and names no part of it", () => {
    expectRefused(hlsPlan({ serverUrl: "https://media.test/jellyfin%E0%A4%A" }), ["%E0%A4%A"]);
  });

  describe("through the coordinator", () => {
    const item: LibraryItem = { id: "one", name: "One", type: "Movie", resumePositionTicks: 0, played: false };

    it.each([
      ["a fragment", staticPlan({ streamUrl: `${STATIC_URL}#t=10` })],
      ["a bracketed credential name", staticPlan({ streamUrl: withQuery(STATIC_URL, "api_key[]=x") })],
      ["Token=", staticPlan({ streamUrl: withQuery(STATIC_URL, "x=Token=SECRET-TOKEN") })],
      ["MediaBrowser in the query", staticPlan({ streamUrl: withQuery(STATIC_URL, "h=MediaBrowser") })],
    ])("T8-22 item 2: a plan with %s is not subscribed, launched or reported", async (_name, plan) => {
      const gateway = {
        createPlaybackPlan: vi.fn(async () => plan),
        reportStart: vi.fn(async () => undefined),
        reportProgress: vi.fn(async () => undefined),
        reportStopped: vi.fn(async () => undefined),
        sessionId: vi.fn(() => "session-1"),
        stopActiveEncoding: vi.fn(async () => undefined),
      } satisfies PlaybackGateway;
      const fake = createFakePlayerEngine();
      const subscribe = vi.spyOn(fake.engine, "subscribe");
      const launch = vi.spyOn(fake.engine, "launch");
      const coordinator = new PlaybackCoordinator(gateway, fake.engine, { onEvent: vi.fn(), onReportingError: vi.fn() }, new FakeClock());
      const error = await coordinator.start(item).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(LaunchRefusedError);
      expect(String(error)).not.toContain("SECRET-TOKEN");
      await coordinator.flush();
      expect(subscribe).not.toHaveBeenCalled();
      expect(launch).not.toHaveBeenCalled();
      expect(gateway.reportStart).not.toHaveBeenCalled();
    });
  });
});

describe("T8-22 item 3: only an original file with Static=true and a master.m3u8 under the base path reach the engine", () => {
  const STATIC_ACCEPTED = [
    "https://media.test/Videos/one/stream?Static=true",
    "https://media.test/jellyfin/Videos/one/stream?Static=true",
    "https://media.test/a/b/Videos/one/stream?Static=true",
    "https://media.test/Videos/one/stream?Static=true&MediaSourceId=source&PlaySessionId=play-1",
    "https://media.test/Videos/one/stream?MediaSourceId=source&static=true",
  ];
  it.each(STATIC_ACCEPTED)("T8-22 item 3: launches the original file %s", (url) => {
    expectLaunches(staticPlan({ streamUrl: url }));
  });

  // S1 isolated: each URL is a fine URL in every other rule, and only its shape is wrong.
  const STATIC_REFUSED = [
    "https://media.test/video",
    "https://media.test/Videos/one/stream",
    "https://media.test/Videos/one/stream?Static=false",
    "https://media.test/Videos/one/stream?Static=true&static=true",
    "https://media.test/Videos/one/stream?Static=TRUE",
    "https://media.test/Videos/one/stream.mkv?Static=true",
    "https://media.test/videos/one/stream?Static=true",
    "https://media.test/Videos/one/x/stream?Static=true",
    "https://media.test/Videos/one/main.m3u8?Static=true",
    "https://media.test/videos/one/master.m3u8?Static=true",
    "https://media.test/Videos/stream?Static=true",
  ];
  it.each(STATIC_REFUSED)("T8-22 item 3: refuses %s on the original-file branch (S1)", (url) => {
    expectRefused(staticPlan({ streamUrl: url }));
  });

  const HLS_ACCEPTED: [string, string, string, string][] = [
    ["a video master under a base path", "videos", SERVER, "https://media.test/jellyfin/videos/one/master.m3u8"],
    ["an audio master", "audio", SERVER, "https://media.test/jellyfin/audio/one/master.m3u8"],
    ["a master in any case", "videos", SERVER, "https://media.test/jellyfin/Videos/one/MASTER.M3U8"],
    ["a master with no base path", "videos", "https://media.test", "https://media.test/videos/one/master.m3u8"],
    ["a master under two base path segments", "videos", "https://media.test/a/b", "https://media.test/a/b/videos/one/master.m3u8"],
    ["a master with a trailing slash on the server URL", "videos", `${SERVER}/`, "https://media.test/jellyfin/videos/one/master.m3u8"],
    ["a master with its query", "videos", SERVER, MASTER],
  ];
  it.each(HLS_ACCEPTED)("T8-22 item 3: launches %s", (_name, mediaKind, serverUrl, streamUrl) => {
    expectLaunches(hlsPlan({ mediaKind, serverUrl, streamUrl }));
  });

  // S2 isolated.
  const HLS_REFUSED: [string, Record<string, unknown>][] = [
    ["a master outside the base path", { streamUrl: "https://media.test/videos/one/master.m3u8?MediaSourceId=source" }],
    ["a master under a longer sibling of the base path", { streamUrl: "https://media.test/jellyfin2/videos/one/master.m3u8" }],
    ["a main playlist", { streamUrl: "https://media.test/jellyfin/videos/one/main.m3u8?MediaSourceId=source" }],
    ["a segment", { streamUrl: "https://media.test/jellyfin/videos/one/hls1/main/0.ts" }],
    ["a master one segment too deep", { streamUrl: "https://media.test/jellyfin/x/videos/one/master.m3u8" }],
    ["a video master for an audio plan", { mediaKind: "audio" }],
    ["an audio master for a video plan", { streamUrl: "https://media.test/jellyfin/audio/one/master.m3u8" }],
    ["an original-file URL", { streamUrl: "https://media.test/jellyfin/Videos/one/stream?Static=true" }],
    ["a server URL with a query", { serverUrl: `${SERVER}?x=1` }],
  ];
  it.each(HLS_REFUSED)("T8-22 item 3: refuses %s on the HLS branch (S2)", (_name, overrides) => {
    expectRefused(hlsPlan(overrides));
  });

  describe("recorded plans", () => {
    interface Vector {
      name: string;
      plan: PlaybackPlan;
    }
    const readJson = <T>(path: string): T => JSON.parse(readFileSync(join(FIXTURES, path), "utf8")) as T;
    const recorded: Vector[] = [
      ...readJson<{ vectors: Vector[] }>("hls-master-urls.json").vectors,
      ...readJson<{ vectors: Vector[] }>("hls-master-urls-device-conversion.json").vectors,
    ];

    it("T8-22 item 3: launches every accepted plan of the shared HLS vector files", () => {
      expect(recorded.length).toBe(56);
      for (const { name, plan } of recorded) {
        const error = attempt(plan);
        expect(error, name).toBeUndefined();
      }
    });

    class AnswerTransport implements Transport {
      constructor(private readonly answer: PlaybackInfoResponse) {}
      async signIn(_request: SignInRequest): Promise<SignInResult> {
        return { session: "session-1", userId: "user-test", userName: "tester" };
      }
      async request(request: TransportRequest): Promise<TransportResponse> {
        if (request.method !== "POST") throw new Error(`unexpected ${request.method}`);
        return { status: 200, body: structuredClone(this.answer) };
      }
      async endSession(): Promise<void> {}
    }

    const answerFiles = [
      ...["10.11.7", "12.4.0"].flatMap((version) =>
        readdirSync(join(FIXTURES, "jellyfin", version))
          .filter((file) => /^(playbackinfo|conversion)-.*\.json$/.test(file))
          .map((file) => `jellyfin/${version}/${file}`),
      ),
      ...readdirSync(join(FIXTURES, "jellyscale/b920b193cd6f"))
        .filter((file) => /^playbackinfo-.*\.json$/.test(file))
        .map((file) => `jellyscale/b920b193cd6f/${file}`),
    ];

    it("T8-22 item 3: launches every plan the negotiation builds from the recorded PlaybackInfo answers", async () => {
      const built: PlaybackPlan[] = [];
      for (const file of answerFiles) {
        const answer = readJson<PlaybackInfoResponse>(file);
        // The item id the recorder scrubbed the answer to, so the negotiation accepts the answer's master URL.
        const itemId = /\/(?:videos|audio)\/([^/"]+)\/master\.m3u8/i.exec(JSON.stringify(answer))?.[1] ?? "item-x";
        const item: LibraryItem = { id: itemId, name: "Fixture", type: "Movie", resumePositionTicks: 0, played: false };
        for (const server of ["http://127.0.0.1:8096", "https://media.test/jellyfin"]) {
          const gateway = new JellyfinGateway(server, webCrypto, new AnswerTransport(answer), "install-1");
          await gateway.login("tester", "password");
          let plan: PlaybackPlan;
          try {
            plan = await gateway.createPlaybackPlan(item);
          } catch (error) {
            if (error instanceof PlaybackRefusedError) continue;
            throw error;
          }
          built.push(plan);
          expect(attempt(plan), `${file} on ${server}`).toBeUndefined();
        }
      }
      expect(built.some((plan) => plan.delivery === "static")).toBe(true);
      expect(built.some((plan) => plan.delivery === "hls")).toBe(true);
      expect(built.some((plan) => plan.tracks.some((track) => track.deliveryUrl !== undefined))).toBe(true);
    });
  });
});

describe("T8-22 item 4: every launch URL passes host rules R1 and R2", () => {
  // [input as written, the host a WHATWG parser maps it to]. The other URLs of the plan use the mapped host, so the
  // origin comparison alone cannot refuse the case: only R1 does.
  const HOSTS: [string, string][] = [
    ["https://bücher.test", "https://xn--bcher-kva.test"],
    ["https://ｍedia.test", "https://media.test"],
    ["https://media%2Etest", "https://media.test"],
    ["https://media.test\\@other.test", "https://media.test"],
  ];

  it.each(HOSTS)("T8-22 item 4: refuses %s as the host of an original-file URL (R1)", (written, parsed) => {
    expectLaunches(staticPlan({ streamUrl: `${parsed}/Videos/one/stream?Static=true` }));
    expectRefused(staticPlan({ streamUrl: `${written}/Videos/one/stream?Static=true` }), [written]);
  });

  it.each(HOSTS)("T8-22 item 4: refuses %s as the host of an HLS master URL (R1)", (written, parsed) => {
    expectRefused(
      hlsPlan({ serverUrl: `${parsed}/jellyfin`, streamUrl: `${written}/jellyfin/videos/one/master.m3u8?MediaSourceId=source` }),
      [written],
    );
  });

  it.each(HOSTS)("T8-22 item 4: refuses %s as the host of the server URL (R1)", (written, parsed) => {
    expectRefused(hlsPlan({ serverUrl: `${written}/jellyfin`, streamUrl: `${parsed}/jellyfin/videos/one/master.m3u8?MediaSourceId=source` }), [written]);
  });

  it.each(HOSTS)("T8-22 item 4: refuses %s as the host of a subtitle URL (R1)", (written, parsed) => {
    expectRefused(
      staticPlan({ streamUrl: `${parsed}/Videos/one/stream?Static=true`, tracks: [audio, subtitleAt(`${written}/Videos/one/source/Subtitles/3/0/Stream.vtt`)] }),
      [written],
    );
    expectRefused(
      hlsPlan({
        serverUrl: `${parsed}/jellyfin`,
        streamUrl: `${parsed}/jellyfin/videos/one/master.m3u8?MediaSourceId=source`,
        tracks: [audio, subtitleAt(`${written}/jellyfin/Videos/one/source/Subtitles/3/0/Stream.vtt`)],
      }),
      [written],
    );
  });

  describe("with a parser that leaves the host as written (R2)", () => {
    const RealURL = URL;
    afterEach(() => {
      globalThis.URL = RealURL;
    });

    // A URL whose parsed host is not plain ASCII, for the one input `isTarget` picks. Its string passes R1 and its
    // origin is the real one, so only R2 on the parsed host refuses it.
    function installParser(isTarget: (input: string) => boolean): void {
      class AsWritten extends RealURL {
        private readonly asWritten: boolean;
        constructor(input: string | URL, base?: string | URL) {
          super(input, base);
          this.asWritten = typeof input === "string" && isTarget(input);
        }
        override get hostname(): string {
          return this.asWritten ? "bücher.test" : super.hostname;
        }
      }
      globalThis.URL = AsWritten as unknown as typeof URL;
    }

    it("T8-22 item 4: refuses an original-file URL whose parsed host is not plain ASCII (R2)", () => {
      expectLaunches(staticPlan());
      installParser((input) => input.includes("/Videos/one/stream"));
      expectRefused(staticPlan());
    });

    it("T8-22 item 4: refuses an HLS master URL whose parsed host is not plain ASCII (R2)", () => {
      expectLaunches(hlsPlan());
      installParser((input) => input.includes("/master.m3u8"));
      expectRefused(hlsPlan());
    });

    it("T8-22 item 4: refuses a server URL whose parsed host is not plain ASCII (R2)", () => {
      installParser((input) => input === SERVER);
      expectRefused(hlsPlan());
    });

    it("T8-22 item 4: refuses a subtitle URL whose parsed host is not plain ASCII (R2)", () => {
      installParser((input) => input.includes("Stream.vtt"));
      expectRefused(staticPlan({ tracks: [audio, subtitleAt(STATIC_SUBTITLE)] }));
      expectRefused(hlsPlan({ tracks: [audio, subtitleAt(HLS_SUBTITLE)] }));
    });
  });
});

describe("T8-22 item 5: a start position that is not a finite number is never sent as NaN", () => {
  it.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
    ["undefined", undefined],
    ["a string", "12345"],
    ["null", null],
  ])("T8-22 item 5: sends %s as a start at 0, on both deliveries", (_name, ticks) => {
    for (const plan of [staticPlan({ startPositionTicks: ticks }), hlsPlan({ startPositionTicks: ticks })]) {
      const request = launchRequest(plan, "session-1");
      expect(request.startPositionSeconds).toBe(0);
      expect(Number.isNaN(request.startPositionSeconds)).toBe(false);
    }
  });

  it("T8-22 item 5: still sends a finite start in seconds", () => {
    expect(launchRequest(staticPlan({ startPositionTicks: 12_345_000_000 }), "session-1").startPositionSeconds).toBe(1234.5);
    expect(launchRequest(hlsPlan({ startPositionTicks: 12_345_000_000 }), "session-1").startPositionSeconds).toBe(1234.5);
    expect(launchRequest(staticPlan({ startPositionTicks: 0 }), "session-1").startPositionSeconds).toBe(0);
  });
});
