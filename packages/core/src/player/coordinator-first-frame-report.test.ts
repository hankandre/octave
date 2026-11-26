import { describe, expect, it, vi } from "vitest";
import type { LibraryItem } from "../domain/catalog";
import { secondsToTicks, type PlaybackPlan, type PlaybackSnapshot, type PlayerEvent } from "../domain/playback";
import { FakeClock } from "../ports/fake-clock";
import { PlaybackCoordinator, type PlaybackGateway } from "./coordinator";
import { createFakePlayerEngine } from "./fake-player-engine";

// T8-03 items 2, 3, 4 and 6 in the coordinator: the start report waits for the first frame (D1), progress carries the
// engine's current position (D4 feeds a `state` event every second), and the stop reports its own position.

const item: LibraryItem = { id: "one", name: "One", type: "Movie", resumePositionTicks: 0, played: false };
const plan: PlaybackPlan = {
  itemId: "one",
  title: "One",
  streamUrl: "https://media.test/Videos/one/stream?Static=true",
  mediaSourceId: "source",
  playSessionId: "session",
  startPositionTicks: 0,
  tracks: [],
  delivery: "static",
  playMethod: "DirectPlay",
  conversionReasons: [],
};

function snapshotAt(positionSeconds: number, paused = false): PlaybackSnapshot {
  return {
    positionSeconds,
    paused,
    buffering: false,
    volume: 100,
    muted: false,
    tracks: [],
    diagnostics: { decodeMode: "software", decodeLabel: "Software — CPU", droppedFrames: 0 },
  };
}

function setup() {
  const gateway = {
    createPlaybackPlan: vi.fn<PlaybackGateway["createPlaybackPlan"]>(async () => plan),
    reportStart: vi.fn<PlaybackGateway["reportStart"]>(async () => undefined),
    reportProgress: vi.fn<PlaybackGateway["reportProgress"]>(async () => undefined),
    reportStopped: vi.fn<PlaybackGateway["reportStopped"]>(async () => undefined),
    sessionId: () => "session-1",
    stopActiveEncoding: vi.fn<PlaybackGateway["stopActiveEncoding"]>(async () => undefined),
  } satisfies PlaybackGateway;
  const fake = createFakePlayerEngine();
  const engineStop = vi.spyOn(fake.engine, "stop");
  const onEvent = vi.fn<(event: PlayerEvent) => void>();
  const clock = new FakeClock();
  const coordinator = new PlaybackCoordinator(gateway, fake.engine, { onEvent, onReportingError: vi.fn() }, clock);
  return { gateway, fake, engineStop, onEvent, clock, coordinator };
}

type Setup = ReturnType<typeof setup>;

// Lets the coordinator's event queue and the reporter's queue run. FakeClock.advance(0) yields enough microtasks.
const settle = (context: Setup) => context.clock.advance(0);

async function playing(context: Setup): Promise<void> {
  await context.coordinator.start(item);
  context.fake.emit({ kind: "loaded", snapshot: snapshotAt(0) });
  context.fake.emit({ kind: "first-frame" });
  await settle(context);
}

// One second of playback at a time: the engine reports its position (D4), then that second passes.
async function playSeconds(context: Setup, from: number, to: number): Promise<void> {
  for (let second = from; second <= to; second += 1) {
    context.fake.emit({ kind: "state", snapshot: snapshotAt(second), cause: "property" });
    await context.clock.advance(1_000);
  }
}

const positions = (calls: readonly (readonly [PlaybackPlan, PlaybackSnapshot, ...unknown[]])[]) =>
  calls.map((call) => call[1].positionSeconds);

const failedFlags = (context: Setup) => context.gateway.reportStopped.mock.calls.map((call) => call[3]);

describe("PlaybackCoordinator playstate reports", () => {
  it("T8-03 item 2: sends no start report on loaded alone", async () => {
    const context = setup();
    await context.coordinator.start(item);

    context.fake.emit({ kind: "loaded", snapshot: snapshotAt(0) });
    await settle(context);
    await context.clock.advance(30_000);

    expect(context.gateway.reportStart).not.toHaveBeenCalled();
    expect(context.gateway.reportProgress).not.toHaveBeenCalled();
    await context.coordinator.stop();
  });

  it("T8-03 item 2: reports the start once, after the first frame", async () => {
    const context = setup();
    await playing(context);

    expect(context.gateway.reportStart).toHaveBeenCalledTimes(1);
    expect(context.gateway.reportStart).toHaveBeenCalledWith(plan, snapshotAt(0), expect.any(AbortSignal));

    context.fake.emit({ kind: "first-frame" });
    await settle(context);
    expect(context.gateway.reportStart).toHaveBeenCalledTimes(1);
    await context.coordinator.stop();
  });

  it("T8-03 item 2: reports progress every 10 s with the position the engine last reported", async () => {
    const context = setup();
    await playing(context);

    await playSeconds(context, 1, 9);
    expect(context.gateway.reportProgress).not.toHaveBeenCalled();

    // The position event of second 10 lands before the 10 s tick fires at the end of that second.
    await playSeconds(context, 10, 10);
    expect(positions(context.gateway.reportProgress.mock.calls)).toEqual([10]);

    await playSeconds(context, 11, 20);
    expect(positions(context.gateway.reportProgress.mock.calls)).toEqual([10, 20]);
    await context.coordinator.stop();
  });

  it.each([
    ["pause", snapshotAt(4, true)],
    ["seek", snapshotAt(90)],
  ] as const)("T8-03 item 2: reports one progress on %s", async (cause, at) => {
    const context = setup();
    await playing(context);

    context.fake.emit({ kind: "state", snapshot: at, cause });
    await settle(context);

    expect(context.gateway.reportProgress).toHaveBeenCalledTimes(1);
    expect(context.gateway.reportProgress).toHaveBeenCalledWith(plan, at, expect.any(AbortSignal));
    await context.coordinator.stop();
  });

  it("T8-03 item 2: reports one stop when the viewer stops", async () => {
    const context = setup();
    await playing(context);
    context.fake.emit({ kind: "state", snapshot: snapshotAt(12), cause: "property" });
    await settle(context);

    await context.coordinator.stop();
    await context.coordinator.flush();

    expect(context.gateway.reportStopped).toHaveBeenCalledTimes(1);
    expect(positions(context.gateway.reportStopped.mock.calls)).toEqual([12]);
  });

  it("T8-03 item 2: reports one stop at the end of the file", async () => {
    const context = setup();
    await playing(context);

    context.fake.emit({ kind: "ended", snapshot: snapshotAt(330), reason: "eof" });
    await context.coordinator.flush();

    expect(context.gateway.reportStopped).toHaveBeenCalledTimes(1);
    expect(positions(context.gateway.reportStopped.mock.calls)).toEqual([330]);
  });

  it("T8-03 item 2: reports one stop when playback ends in an error", async () => {
    const context = setup();
    await playing(context);

    context.fake.emit({ kind: "error", code: "network" });
    context.fake.emit({ kind: "ended", snapshot: snapshotAt(15), reason: "error" });
    await context.coordinator.flush();

    expect(context.gateway.reportStopped).toHaveBeenCalledTimes(1);
    expect(positions(context.gateway.reportStopped.mock.calls)).toEqual([15]);
  });

  // Replaces the premise of the frozen coordinator case that held the start report pending after `loaded` alone.
  it("T8-03 item 2: delivers a later event while the start report is still pending after the first frame", async () => {
    const context = setup();
    let finishStart: () => void = () => undefined;
    let startSettled = false;
    context.gateway.reportStart.mockImplementation(() => new Promise<void>((resolve) => {
      finishStart = () => {
        startSettled = true;
        resolve();
      };
    }));
    await playing(context);
    expect(context.gateway.reportStart).toHaveBeenCalledTimes(1);

    const later: PlayerEvent = { kind: "state", snapshot: snapshotAt(1), cause: "property" };
    context.fake.emit(later);
    await settle(context);

    expect(context.onEvent).toHaveBeenLastCalledWith(later);
    expect(startSettled).toBe(false);
    finishStart();
    await context.coordinator.stop();
  });

  it("T8-03 item 3: reports an engine error after the first frame as exactly one failed stop", async () => {
    const context = setup();
    await playing(context);

    context.fake.emit({ kind: "error", code: "network" });
    context.fake.emit({ kind: "ended", snapshot: snapshotAt(15), reason: "error" });
    await context.coordinator.flush();
    await context.coordinator.stop();
    await context.coordinator.flush();

    expect(failedFlags(context)).toEqual([true]);
  });

  it("T8-03 item 3: reports the end of the file as a stop that did not fail", async () => {
    const context = setup();
    await playing(context);

    context.fake.emit({ kind: "ended", snapshot: snapshotAt(330), reason: "eof" });
    await context.coordinator.flush();

    expect(failedFlags(context)).toEqual([false]);
  });

  it("T8-03 item 3: reports the viewer's stop as a stop that did not fail", async () => {
    const context = setup();
    await playing(context);

    await context.coordinator.stop();
    await context.coordinator.flush();

    expect(failedFlags(context)).toEqual([false]);
  });

  it("T8-03 item 4: reports the stop at the position where playback stopped", async () => {
    const context = setup();
    await playing(context);
    await playSeconds(context, 1, 35);
    // A stop carries the engine's own last snapshot.
    context.engineStop.mockImplementationOnce(async () => {
      context.fake.emit({ kind: "ended", snapshot: snapshotAt(35), reason: "stopped" });
    });

    await context.coordinator.stop();
    await context.coordinator.flush();

    const stopped = context.gateway.reportStopped.mock.calls.map((call) => secondsToTicks(call[1].positionSeconds));
    expect(stopped).toEqual([secondsToTicks(35)]);
  });

  it("T8-03 item 4: leaves the last delivered progress within 10 s when the stopped report fails", async () => {
    const context = setup();
    const delivered: number[] = [];
    context.gateway.reportProgress.mockImplementation(async (_plan, at) => {
      delivered.push(at.positionSeconds);
    });
    context.gateway.reportStopped.mockRejectedValue(new Error("the server is gone"));
    await playing(context);
    await playSeconds(context, 1, 35);

    await context.coordinator.stop();
    await context.coordinator.flush();

    expect(delivered.at(-1)).toBe(30);
  });

  it("T8-03 item 6: sends no report for a stop between loaded and the first frame", async () => {
    const context = setup();
    await context.coordinator.start(item);
    context.fake.emit({ kind: "loaded", snapshot: snapshotAt(0) });
    await settle(context);

    await context.coordinator.stop();
    await context.coordinator.flush();

    expect(context.gateway.reportStart).not.toHaveBeenCalled();
    expect(context.gateway.reportProgress).not.toHaveBeenCalled();
    expect(context.gateway.reportStopped).not.toHaveBeenCalled();
  });
});
