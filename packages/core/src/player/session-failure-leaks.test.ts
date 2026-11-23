// T8-25 item 3: failures whose native message holds a host, a path, a URL or a MAC address leave none of it in what a
// screen reads, because the state holds only a code. Includes T9-07's leftover strings (tasks/backlog.jsonl).
import { describe, expect, it, vi } from "vitest";
import type { LibraryItem } from "../domain/catalog";
import type { PlaybackPlan, PlayerEvent } from "../domain/playback";
import { PlaybackRefusedError } from "../domain/playback";
import { PlayerEngineError } from "../domain/player-engine";
import { FakeClock } from "../ports/fake-clock";
import { PlaybackCoordinator, type PlaybackGateway } from "./coordinator";
import { createFakePlayerEngine } from "./fake-player-engine";
import { failureAction } from "./session-failure";
import { initialPlaybackSessionState, playbackSessionReducer, type PlaybackSessionAction } from "./session-state";

const TEXTS = [
  "cannot open /home/u/My Movies",
  "connect to nas failed",
  "pts:8096 java.home.lan",
  "link aa:bb:cc:dd:ee:ff down",
  "https://media.test/Videos/x/stream?api_key=SECRET-TOKEN",
  "jellyfin.home.lan:8096",
  "/storage/emulated/0/Movies/x.mkv",
  "fe80::1%wlan0",
];
const LEAKS = ["nas", "Movies", "aa:bb", "java.home", "pts:", "media.test", "/home/u", "x.mkv", "8096", "fe80", "SECRET"];

const item: LibraryItem = { id: "one", name: "One", type: "Movie", resumePositionTicks: 0, played: false };
const plan: PlaybackPlan = {
  itemId: "one",
  title: "One",
  streamUrl: "https://server.test/Videos/one/stream?Static=true",
  mediaSourceId: "source",
  playSessionId: "play-1",
  startPositionTicks: 0,
  tracks: [],
  delivery: "static",
  playMethod: "DirectPlay",
  conversionReasons: [],
};

function reduce(action: PlaybackSessionAction) {
  return playbackSessionReducer(initialPlaybackSessionState, action);
}

function expectClean(state: unknown, failure: string): void {
  expect(state).toEqual({ firstFrameReady: false, failure });
  const text = JSON.stringify(state);
  for (const leak of LEAKS) expect(text, `state holds ${leak}`).not.toContain(leak);
}

function setup() {
  const gateway = {
    createPlaybackPlan: vi.fn(async () => plan),
    reportStart: vi.fn(async () => undefined),
    reportProgress: vi.fn(async () => undefined),
    reportStopped: vi.fn(async () => undefined),
    sessionId: () => "session-1",
    stopActiveEncoding: vi.fn(async () => undefined),
  } satisfies PlaybackGateway;
  const fake = createFakePlayerEngine();
  const launch = vi.spyOn(fake.engine, "launch");
  const coordinator = new PlaybackCoordinator(gateway, fake.engine, { onEvent: vi.fn(), onReportingError: vi.fn() }, new FakeClock());
  return { gateway, launch, coordinator };
}

describe.each(TEXTS.map((text) => [text] as const))("T8-25 item 3: native text %j", (text) => {
  it("T8-25 item 3: through failureAction as a string, an Error, a cause, a refusal detail and an engine error", () => {
    const log = vi.fn();
    const withCause = new Error("failed", { cause: text });
    const altered = new PlayerEngineError("network");
    altered.message = text;
    expectClean(reduce(failureAction(text, log)), "request-failed");
    expectClean(reduce(failureAction(new Error(text), log)), "request-failed");
    expectClean(reduce(failureAction(withCause, log)), "request-failed");
    expectClean(reduce(failureAction(new PlaybackRefusedError({ reason: "device-cannot-play", detail: text }), log)), "request-failed");
    expectClean(reduce(failureAction(altered, log)), "server-unreachable");
  });

  it("T8-25 item 3: through the coordinator when launch rejects", async () => {
    const { launch, coordinator } = setup();
    launch.mockRejectedValue(new Error(text));
    const error = await coordinator.start(item).catch((caught: unknown) => caught);
    expectClean(reduce(failureAction(error, vi.fn())), "request-failed");
  });

  it("T8-25 item 3: through the coordinator when the plan cannot be created", async () => {
    const { gateway, coordinator } = setup();
    gateway.createPlaybackPlan.mockRejectedValue(new Error(text));
    const error = await coordinator.start(item).catch((caught: unknown) => caught);
    expectClean(reduce(failureAction(error, vi.fn())), "request-failed");
  });

  it("T8-25 item 3: as an engine error event whose code is the text", () => {
    const event = { kind: "error", code: text } as unknown as PlayerEvent;
    expectClean(reduce({ type: "event", event }), "request-failed");
  });
});
