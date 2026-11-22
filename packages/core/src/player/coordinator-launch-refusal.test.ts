// T8-22 item 6 (docs/specs/T8-22.md): when the coordinator refuses to launch a negotiated converted plan it stops
// that play session on the server. A refused direct play sends nothing, and a throwing sessionId() sends no stop,
// because the stop could not be delivered without a session (Product Owner decision 2).
import { describe, expect, it, vi } from "vitest";
import type { LibraryItem } from "../domain/catalog";
import type { PlaybackPlan } from "../domain/playback";
import { FakeClock } from "../ports/fake-clock";
import { PlaybackCoordinator, type PlaybackGateway } from "./coordinator";
import { createFakePlayerEngine } from "./fake-player-engine";
import { LaunchRefusedError } from "./launch-request";

const item: LibraryItem = { id: "one", name: "One", type: "Movie", resumePositionTicks: 0, played: false };
const MASTER = "https://media.test/videos/one/master.m3u8?PlaySessionId=play-1";

function converted(overrides: Partial<PlaybackPlan> = {}): PlaybackPlan {
  return {
    itemId: "one",
    title: "One",
    streamUrl: MASTER,
    mediaSourceId: "source",
    playSessionId: "play-1",
    startPositionTicks: 0,
    tracks: [{ index: 1, type: "Audio", displayTitle: "AAC", codec: "aac", external: false }],
    defaultAudioStreamIndex: 1,
    delivery: "hls",
    playMethod: "Transcode",
    conversionReasons: ["AudioCodecNotSupported"],
    serverUrl: "https://media.test",
    mediaKind: "videos",
    ...overrides,
  } as PlaybackPlan;
}

const refusedConverted = () => converted({ streamUrl: `${MASTER}&api_key=SECRET-TOKEN` });
const goodConverted = () => converted({ playSessionId: "play-2", streamUrl: "https://media.test/videos/one/master.m3u8?PlaySessionId=play-2" });
const refusedStatic = (): PlaybackPlan =>
  ({
    ...converted(),
    streamUrl: "https://media.test/Videos/one/stream?Static=true&api_key=SECRET-TOKEN",
    delivery: "static",
    playMethod: "DirectPlay",
    conversionReasons: [],
  }) as PlaybackPlan;

function setup(plans: PlaybackPlan[], sessionId: () => string = () => "session-1") {
  const queue = [...plans];
  const gateway = {
    createPlaybackPlan: vi.fn(async () => queue.length > 1 ? (queue.shift() as PlaybackPlan) : queue[0]),
    reportStart: vi.fn(async () => undefined),
    reportProgress: vi.fn(async () => undefined),
    reportStopped: vi.fn(async () => undefined),
    sessionId: vi.fn(sessionId),
    stopActiveEncoding: vi.fn(async () => undefined),
  } satisfies PlaybackGateway;
  const fake = createFakePlayerEngine();
  const subscribe = vi.spyOn(fake.engine, "subscribe");
  const launch = vi.spyOn(fake.engine, "launch");
  const onReportingError = vi.fn();
  const coordinator = new PlaybackCoordinator(gateway, fake.engine, { onEvent: vi.fn(), onReportingError }, new FakeClock());
  return { gateway, subscribe, launch, onReportingError, coordinator };
}

describe("the coordinator after a refused launch", () => {
  it("T8-22 item 6: stops the refused converted plan's play session once, and launches nothing", async () => {
    const { coordinator, gateway, subscribe, launch, onReportingError } = setup([refusedConverted()]);
    const error = await coordinator.start(item).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(LaunchRefusedError);
    expect(String(error)).not.toContain("SECRET-TOKEN");
    await coordinator.flush();
    expect(gateway.stopActiveEncoding).toHaveBeenCalledTimes(1);
    expect(gateway.stopActiveEncoding).toHaveBeenCalledWith("play-1", expect.any(AbortSignal));
    expect(subscribe).not.toHaveBeenCalled();
    expect(launch).not.toHaveBeenCalled();
    expect(gateway.reportStart).not.toHaveBeenCalled();
    expect(gateway.reportProgress).not.toHaveBeenCalled();
    expect(gateway.reportStopped).not.toHaveBeenCalled();
    expect(onReportingError).not.toHaveBeenCalled();
  });

  it("T8-22 item 6: launches a good plan on the next start, with no second stop for the refused session", async () => {
    const { coordinator, gateway, launch } = setup([refusedConverted(), goodConverted()]);
    await expect(coordinator.start(item)).rejects.toBeInstanceOf(LaunchRefusedError);
    await coordinator.start(item);
    expect(launch).toHaveBeenCalledTimes(1);
    await coordinator.flush();
    const stops = gateway.stopActiveEncoding.mock.calls.map((call) => call[0]);
    expect(stops.filter((id) => id === "play-1")).toHaveLength(1);
  });

  it("T8-22 item 6: sends no DELETE and no report for a refused direct play", async () => {
    const { coordinator, gateway, launch } = setup([refusedStatic()]);
    await expect(coordinator.start(item)).rejects.toBeInstanceOf(LaunchRefusedError);
    await coordinator.flush();
    expect(gateway.stopActiveEncoding).not.toHaveBeenCalled();
    expect(gateway.reportStart).not.toHaveBeenCalled();
    expect(gateway.reportStopped).not.toHaveBeenCalled();
    expect(launch).not.toHaveBeenCalled();
  });

  it("T8-22 item 6: sends no DELETE and raises no reporting warning when sessionId() throws for a converted plan", async () => {
    const { coordinator, gateway, launch, onReportingError } = setup([converted()], () => {
      throw new Error("Sign in before using the library.");
    });
    await expect(coordinator.start(item)).rejects.toThrow("Sign in before using the library.");
    await coordinator.flush();
    expect(gateway.stopActiveEncoding).not.toHaveBeenCalled();
    expect(onReportingError).not.toHaveBeenCalled();
    expect(launch).not.toHaveBeenCalled();
  });
});
