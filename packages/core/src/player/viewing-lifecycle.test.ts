import { describe, expect, it, vi } from "vitest";
import type { ItemDetail } from "../domain/catalog";
import { PLAYER_ERROR_MESSAGES, PlayerEngineError, startOverChoice, type PlaybackPlan, type PlaybackSnapshot } from "../domain/playback";
import type { PlayRequest } from "../domain/home-hero";
import type { FailureLog } from "../ports/failure-log";
import { FakeClock } from "../ports/fake-clock";
import { PlayerStopError } from "./coordinator";
import { createFakePlayerEngine } from "./fake-player-engine";
import { Viewing, type ViewingPhase, type ViewingSource } from "./viewing";

// T8-03 follow-ups: how a viewing ends, when another may start, what is refused, what a failure records and where a
// title played again starts.

const SECOND = 10_000_000;

function detailOf(id: string, type: ItemDetail["type"], userData: Partial<ItemDetail["userData"]> = {}): ItemDetail {
  return {
    id,
    type,
    title: `Title ${id}`,
    runTimeTicks: 3_000 * SECOND,
    genres: [],
    cast: [],
    userData: { played: false, favorite: false, resumePositionTicks: 0, ...userData },
    versions: [],
  };
}

function snapshotAt(positionSeconds: number): PlaybackSnapshot {
  return {
    positionSeconds,
    paused: false,
    buffering: false,
    volume: 100,
    muted: false,
    tracks: [],
    diagnostics: { decodeMode: "software", decodeLabel: "Software — CPU", droppedFrames: 0 },
  };
}

const request: PlayRequest = { itemId: "film", start: startOverChoice() };
const resumeAt = (seconds: number): PlayRequest => ({ itemId: "film", start: { kind: "resume", startPositionTicks: seconds * SECOND } });

// A promise the test settles when it chooses.
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

// A server that keeps each title's position: a Stopped report that is not failed moves what the next item read gives.
function setup() {
  const positions = new Map<string, number>();
  const played = new Set<string>();
  let sessions = 0;
  const source = {
    itemDetail: vi.fn<ViewingSource["itemDetail"]>(async (id) =>
      detailOf(id, "Movie", { resumePositionTicks: positions.get(id) ?? 0, played: played.has(id) }),
    ),
    createPlaybackPlan: vi.fn<ViewingSource["createPlaybackPlan"]>(async (item, startPositionTicks) => {
      sessions += 1;
      return {
        itemId: item.id,
        title: item.name,
        streamUrl: `https://media.test/Videos/${item.id}/stream?Static=true`,
        mediaSourceId: "source",
        playSessionId: `play-session-${sessions}`,
        startPositionTicks,
        tracks: [],
        delivery: "static",
        playMethod: "DirectPlay",
        conversionReasons: [],
      } satisfies PlaybackPlan;
    }),
    reportStart: vi.fn<ViewingSource["reportStart"]>(async () => undefined),
    reportProgress: vi.fn<ViewingSource["reportProgress"]>(async () => undefined),
    reportStopped: vi.fn<ViewingSource["reportStopped"]>(async (plan, snapshot) => {
      positions.set(plan.itemId, snapshot.positionSeconds * SECOND);
    }),
    sessionId: () => "session-1",
    stopActiveEncoding: vi.fn<ViewingSource["stopActiveEncoding"]>(async () => undefined),
  } satisfies ViewingSource;
  const fake = createFakePlayerEngine();
  const launch = vi.spyOn(fake.engine, "launch");
  const engineStop = vi.spyOn(fake.engine, "stop");
  const log = vi.fn<FailureLog>();
  const clock = new FakeClock();
  const viewing = new Viewing(source, fake.engine, clock, log);
  const viewed = vi.fn<(itemId: string) => void>();
  viewing.afterViewing(viewed);
  const phases: ViewingPhase[] = [];
  viewing.subscribe(() => {
    const { phase } = viewing.state();
    if (phases.at(-1) !== phase) phases.push(phase);
  });
  return { positions, played, source, fake, launch, engineStop, log, clock, viewing, viewed, phases };
}

type Setup = ReturnType<typeof setup>;

const settle = (context: Setup) => context.clock.advance(0);

// Past every report and drain deadline, so a late call would have happened by now.
const outlast = (context: Setup) => context.clock.advance(60_000);

async function playToFirstFrame(context: Setup, asked: PlayRequest = request): Promise<void> {
  expect(context.viewing.play(asked)).toBe(true);
  await settle(context);
  context.fake.emit({ kind: "loaded", snapshot: snapshotAt(0) });
  context.fake.emit({ kind: "first-frame" });
  await settle(context);
}

async function reach(context: Setup, positionSeconds: number): Promise<void> {
  context.fake.emit({ kind: "state", snapshot: snapshotAt(positionSeconds), cause: "property" });
  await settle(context);
}

async function endOfFile(context: Setup): Promise<void> {
  context.fake.emit({ kind: "ended", reason: "eof", snapshot: snapshotAt(3_000) });
  await settle(context);
}

async function engineFailure(context: Setup): Promise<void> {
  context.fake.emit({ kind: "error", code: "audio-output-failed" });
  context.fake.emit({ kind: "ended", reason: "error", snapshot: snapshotAt(100) });
  await settle(context);
}

const plannedStarts = (context: Setup): number[] => context.source.createPlaybackPlan.mock.calls.map((call) => call[1]);

describe("T8-03 follow-up: the end of a viewing", () => {
  it("T8-03 follow-up: the end of the file closes the player and ends the viewing, and afterViewing fires once after the earlier reports drained", async () => {
    const context = setup();
    const progress = deferred<void>();
    const stopped = deferred<void>();
    context.source.reportProgress.mockImplementation(() => progress.promise);
    context.source.reportStopped.mockImplementation(() => stopped.promise);
    await playToFirstFrame(context);
    context.fake.emit({ kind: "state", snapshot: snapshotAt(2_990), cause: "seek" });
    await settle(context);

    await endOfFile(context);

    expect(context.engineStop).toHaveBeenCalledTimes(1);
    expect(context.viewing.state().phase).toBe("ended");
    expect(context.source.reportStopped).not.toHaveBeenCalled();
    expect(context.viewed).not.toHaveBeenCalled();

    progress.resolve();
    await settle(context);
    expect(context.source.reportStopped).toHaveBeenCalledTimes(1);
    expect(context.viewed).not.toHaveBeenCalled();

    stopped.resolve();
    await settle(context);
    expect(context.viewed.mock.calls).toEqual([["film"]]);

    await context.viewing.stop();
    await outlast(context);
    expect(context.viewed).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["the end of the file", endOfFile],
    ["an engine error", engineFailure],
    ["the viewer's stop", async (context: Setup) => context.viewing.stop()],
  ])("T8-03 follow-up: afterViewing fires exactly once for a viewing ended by %s, even when it is stopped again", async (_ending, finish) => {
    const context = setup();
    await playToFirstFrame(context);

    await finish(context);
    await settle(context);
    expect(context.viewed.mock.calls).toEqual([["film"]]);

    await context.viewing.stop();
    await context.viewing.stop();
    await outlast(context);
    expect(context.viewed).toHaveBeenCalledTimes(1);
    expect(context.source.reportStopped).toHaveBeenCalledTimes(1);
  });
});

describe("T8-03 follow-up: one viewing at a time", () => {
  it("T8-03 follow-up: a play while a viewing is loading or playing is refused and says so", async () => {
    const context = setup();
    expect(context.viewing.play(request)).toBe(true);

    expect(context.viewing.play({ itemId: "other", start: startOverChoice() })).toBe(false);
    await settle(context);
    context.fake.emit({ kind: "loaded", snapshot: snapshotAt(0) });
    context.fake.emit({ kind: "first-frame" });
    await settle(context);
    expect(context.viewing.state().phase).toBe("playing");
    expect(context.viewing.play(request)).toBe(false);
    await outlast(context);

    expect(context.viewing.state()).toMatchObject({ itemId: "film", phase: "playing" });
    expect(context.source.itemDetail).toHaveBeenCalledTimes(1);
    expect(context.launch).toHaveBeenCalledTimes(1);
    expect(context.engineStop).not.toHaveBeenCalled();
    await context.viewing.stop();
  });

  it.each([
    ["ended at the end of the file", endOfFile],
    ["failed", engineFailure],
    ["was stopped", async (context: Setup) => context.viewing.stop()],
  ])("T8-03 follow-up: a play is accepted after the viewing %s", async (_ending, finish) => {
    const context = setup();
    await playToFirstFrame(context);
    await finish(context);
    await settle(context);

    expect(context.viewing.play({ itemId: "other", start: startOverChoice() })).toBe(true);
    await settle(context);

    expect(context.viewing.state()).toMatchObject({ itemId: "other", phase: "loading" });
    expect(context.launch).toHaveBeenCalledTimes(2);
    await context.viewing.stop();
  });
});

describe("T8-03 follow-up: what has nothing to play", () => {
  it.each(["Series", "Season", "BoxSet", "Folder", "CollectionFolder", "UserView", "AggregateFolder"])(
    "T8-03 follow-up: a %s is refused rather than played",
    async (type) => {
      const context = setup();
      context.source.itemDetail.mockImplementation(async (id) => detailOf(id, type as ItemDetail["type"]));

      context.viewing.play(request);
      await outlast(context);

      expect(context.viewing.state().phase).toBe("failed");
      expect(context.viewing.state().session.failure).toBe("request-failed");
      expect(context.source.createPlaybackPlan).not.toHaveBeenCalled();
      expect(context.launch).not.toHaveBeenCalled();
      expect(context.source.reportStart).not.toHaveBeenCalled();
      expect(context.viewed).toHaveBeenCalledTimes(1);
    },
  );
});

describe("T8-03 follow-up: a failure is recorded once", () => {
  it("T8-03 follow-up: an error event records its code, and the viewing fails only when the session ends, with one log entry", async () => {
    const context = setup();
    await playToFirstFrame(context);

    context.fake.emit({ kind: "error", code: "audio-output-failed" });
    await settle(context);
    expect(context.viewing.state().phase).toBe("playing");
    expect(context.viewing.state().session.failure).toBe("audio-output-failed");
    expect(context.viewed).not.toHaveBeenCalled();

    context.fake.emit({ kind: "ended", reason: "error", snapshot: snapshotAt(100) });
    await outlast(context);

    expect(context.phases).toEqual(["loading", "playing", "failed"]);
    expect(context.viewing.state().session.failure).toBe("audio-output-failed");
    expect(context.log.mock.calls).toEqual([[PLAYER_ERROR_MESSAGES["audio-output-failed"]]]);
  });

  it("T8-03 follow-up: a launch that fails records the engine's own code once, not an invented one", async () => {
    const context = setup();
    context.launch.mockImplementation(async () => {
      throw new PlayerEngineError("session-ended");
    });
    const failures: (string | undefined)[] = [];
    context.viewing.subscribe(() => failures.push(context.viewing.state().session.failure));

    context.viewing.play(request);
    await outlast(context);

    expect(context.phases).toEqual(["loading", "failed"]);
    expect(new Set(failures)).toEqual(new Set([undefined, "session-ended"]));
    expect(context.log.mock.calls).toEqual([[PLAYER_ERROR_MESSAGES["session-ended"]]]);
    expect(context.viewed).toHaveBeenCalledTimes(1);
  });

  it("T8-03 follow-up: a session that ends in error while its launch is pending, with no cause named, still fails once", async () => {
    const context = setup();
    const launching = deferred<void>();
    context.launch.mockImplementation(() => launching.promise);
    context.viewing.play(request);
    await settle(context);

    context.fake.emit({ kind: "ended", reason: "error" });
    await settle(context);
    expect(context.viewing.state().phase).toBe("loading");

    launching.resolve();
    await outlast(context);

    expect(context.phases).toEqual(["loading", "failed"]);
    expect(context.viewing.state().session.failure).toBe("request-failed");
    expect(context.log).toHaveBeenCalledTimes(1);
    expect(context.viewed).toHaveBeenCalledTimes(1);
  });
});

describe("T8-03 follow-up: after a player that did not stop", () => {
  it("T8-03 follow-up: the next play stops that session again and waits for its one Stopped report before reading the item", async () => {
    const context = setup();
    await playToFirstFrame(context);
    await reach(context, 100);
    context.engineStop.mockRejectedValueOnce(new Error("native stop text"));
    await expect(context.viewing.stop()).rejects.toThrow(PlayerStopError);
    await settle(context);
    expect(context.source.reportStopped).not.toHaveBeenCalled();
    const stopped = deferred<void>();
    context.source.reportStopped.mockImplementation(async (plan, snapshot) => {
      await stopped.promise;
      context.positions.set(plan.itemId, snapshot.positionSeconds * SECOND);
    });

    expect(context.viewing.play(request)).toBe(true);
    await settle(context);

    expect(context.engineStop).toHaveBeenCalledTimes(2);
    expect(context.source.reportStopped).toHaveBeenCalledTimes(1);
    expect(context.source.itemDetail).toHaveBeenCalledTimes(1);

    stopped.resolve();
    await settle(context);

    expect(context.source.itemDetail).toHaveBeenCalledTimes(2);
    expect(context.launch).toHaveBeenCalledTimes(2);
    expect(plannedStarts(context)).toEqual([0, 100 * SECOND]);
    expect(context.source.reportStopped.mock.calls.map((call) => call[0].playSessionId)).toEqual(["play-session-1"]);
    await context.viewing.stop();
  });

  it("T8-03 follow-up: a play whose retried stop fails again says so, and the play after it works", async () => {
    const context = setup();
    await playToFirstFrame(context);
    context.engineStop.mockRejectedValueOnce(new Error("first")).mockRejectedValueOnce(new Error("second"));
    await expect(context.viewing.stop()).rejects.toThrow(PlayerStopError);

    context.viewing.play(request);
    await settle(context);
    expect(context.viewing.state()).toMatchObject({ phase: "failed", session: { failure: "stop-failed" } });
    expect(context.launch).toHaveBeenCalledTimes(1);

    expect(context.viewing.play(request)).toBe(true);
    await settle(context);

    expect(context.launch).toHaveBeenCalledTimes(2);
    expect(context.source.reportStopped).toHaveBeenCalledTimes(1);
    await context.viewing.stop();
  });
});

describe("T8-03 follow-up: where a title starts", () => {
  it("T8-03 follow-up: a title played for the first time starts from the card's position, whatever the item read says", async () => {
    const context = setup();
    context.positions.set("film", 900 * SECOND);

    await playToFirstFrame(context, resumeAt(300));
    await context.viewing.stop();
    context.positions.set("other", 900 * SECOND);
    await playToFirstFrame(context, { itemId: "other", start: startOverChoice() });
    await context.viewing.stop();

    expect(plannedStarts(context)).toEqual([300 * SECOND, 0]);
  });

  it("T8-03 follow-up: a title this viewing already played starts from the item read taken after the earlier report settled, not an older card", async () => {
    const context = setup();
    await playToFirstFrame(context, resumeAt(300));
    await reach(context, 600);
    const stopped = deferred<void>();
    context.source.reportStopped.mockImplementation(async (plan, snapshot) => {
      await stopped.promise;
      context.positions.set(plan.itemId, snapshot.positionSeconds * SECOND);
    });
    const stopping = context.viewing.stop();
    await settle(context);

    context.viewing.play(resumeAt(300));
    await settle(context);
    expect(context.source.itemDetail).toHaveBeenCalledTimes(1);
    stopped.resolve();
    await stopping;
    await settle(context);

    expect(plannedStarts(context)).toEqual([300 * SECOND, 600 * SECOND]);
    await context.viewing.stop();
  });

  it("T8-03 follow-up: a title this viewing already played and the server now calls watched starts over", async () => {
    const context = setup();
    await playToFirstFrame(context, resumeAt(300));
    await endOfFile(context);
    context.played.add("film");

    await playToFirstFrame(context, resumeAt(300));

    expect(plannedStarts(context)).toEqual([300 * SECOND, 0]);
    await context.viewing.stop();
  });
});
