import { describe, expect, it, vi } from "vitest";
import type { ItemDetail } from "../domain/catalog";
import { startOverChoice, type PlaybackPlan, type PlaybackSnapshot } from "../domain/playback";
import { FakeClock } from "../ports/fake-clock";
import type { FailureLog } from "../ports/failure-log";
import { PlayerStopError } from "./coordinator";
import { createFakePlayerEngine } from "./fake-player-engine";
import { Viewing, type ViewingSource } from "./viewing";

// T8-04 items 2, 4, 5, 6 and 9 in the viewing use case (spec D3): pause, seek, leave and what the player screen shows.

const backdrop = { itemId: "episode-1", type: "Backdrop" as const, tag: "episode-1-backdrop" };

const detail: ItemDetail = {
  id: "episode-1",
  type: "Episode",
  title: "The Keeper's Log",
  seriesName: "Harbor Lights",
  seasonNumber: 1,
  episodeNumber: 2,
  runTimeTicks: 6_000_000_000,
  genres: [],
  cast: [],
  userData: { played: false, favorite: false, resumePositionTicks: 0 },
  versions: [],
  backdrop,
};

const planBase = {
  itemId: "episode-1",
  title: "The Keeper's Log",
  mediaSourceId: "source",
  playSessionId: "session",
  startPositionTicks: 0,
  tracks: [],
};

const directPlan: PlaybackPlan = {
  ...planBase,
  streamUrl: "https://media.test/Videos/episode-1/stream?Static=true",
  delivery: "static",
  playMethod: "DirectPlay",
  conversionReasons: [],
};

const convertedPlan: PlaybackPlan = {
  ...planBase,
  streamUrl: "https://media.test/videos/episode-1/master.m3u8",
  delivery: "hls",
  playMethod: "Transcode",
  conversionReasons: ["DirectPlayError"],
  serverUrl: "https://media.test",
  mediaKind: "videos",
};

const DURATION_SECONDS = 600;

function snapshotAt(positionSeconds: number, paused = false): PlaybackSnapshot {
  return {
    positionSeconds,
    durationSeconds: DURATION_SECONDS,
    paused,
    buffering: false,
    volume: 100,
    muted: false,
    tracks: [],
    diagnostics: { decodeMode: "software", decodeLabel: "Software — CPU", droppedFrames: 0 },
  };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function setup(plan: PlaybackPlan = directPlan) {
  const source = {
    itemDetail: vi.fn<ViewingSource["itemDetail"]>(async () => detail),
    createPlaybackPlan: vi.fn<ViewingSource["createPlaybackPlan"]>(async () => plan),
    reportStart: vi.fn<ViewingSource["reportStart"]>(async () => undefined),
    reportProgress: vi.fn<ViewingSource["reportProgress"]>(async () => undefined),
    reportStopped: vi.fn<ViewingSource["reportStopped"]>(async () => undefined),
    sessionId: () => "session-1",
    stopActiveEncoding: vi.fn<ViewingSource["stopActiveEncoding"]>(async () => undefined),
  } satisfies ViewingSource;
  const fake = createFakePlayerEngine();
  const launch = vi.spyOn(fake.engine, "launch");
  const stop = vi.spyOn(fake.engine, "stop");
  const seek = vi.spyOn(fake.engine, "seek");
  const setPaused = vi.spyOn(fake.engine, "setPaused");
  const log = vi.fn<FailureLog>();
  const clock = new FakeClock();
  const viewing = new Viewing(source, fake.engine, clock, log);
  return { source, fake, launch, stop, seek, setPaused, log, clock, viewing };
}

type Setup = ReturnType<typeof setup>;

const settle = (context: Setup) => context.clock.advance(0);

async function start(context: Setup): Promise<void> {
  context.viewing.play({ itemId: "episode-1", start: startOverChoice() });
  await settle(context);
}

/** Plays up to the first frame, with the picture at `positionSeconds`. */
async function playAt(context: Setup, positionSeconds: number): Promise<void> {
  await start(context);
  context.fake.emit({ kind: "loaded", snapshot: snapshotAt(positionSeconds) });
  context.fake.emit({ kind: "first-frame" });
  await settle(context);
}

async function engineSends(context: Setup, snapshot: PlaybackSnapshot, cause: "pause" | "seek" | "property"): Promise<void> {
  context.fake.emit({ kind: "state", snapshot, cause });
  await settle(context);
}

const askedSeeks = (context: Setup): number[] => context.seek.mock.calls.map(([position]) => position);

describe("T8-04 item 2: seeking by 10 s", () => {
  it("T8-04 item 2: at 100 s, 10 s forward asks the engine for 110 and says where it is going at once", async () => {
    const context = setup();
    await playAt(context, 100);

    context.viewing.seekBy(10);

    expect(context.viewing.state().seekingTo).toBe(110);
    await settle(context);
    expect(askedSeeks(context)).toEqual([110]);
  });

  it("T8-04 item 2: three presses before any seek lands ask for 110, 120 and 130, one seek each", async () => {
    const context = setup();
    await playAt(context, 100);

    context.viewing.seekBy(10);
    context.viewing.seekBy(10);
    context.viewing.seekBy(10);
    await settle(context);

    expect(askedSeeks(context)).toEqual([110, 120, 130]);
    expect(context.viewing.state().seekingTo).toBe(130);
  });

  it("T8-04 item 2: once the seek has landed, the next press starts from the picture's position", async () => {
    const context = setup();
    await playAt(context, 100);
    context.viewing.seekBy(10);
    await settle(context);

    await engineSends(context, snapshotAt(110), "seek");
    expect(context.viewing.state().seekingTo).toBeUndefined();
    await engineSends(context, snapshotAt(115), "property");
    context.viewing.seekBy(-10);
    await settle(context);

    expect(askedSeeks(context)).toEqual([110, 105]);
  });

  it("T8-04 item 2: back from 4 s asks for the start", async () => {
    const context = setup();
    await playAt(context, 4);

    context.viewing.seekBy(-10);
    await settle(context);

    expect(askedSeeks(context)).toEqual([0]);
  });

  it("T8-04 item 2: forward near the end stops at the duration", async () => {
    const context = setup();
    await playAt(context, 595);

    context.viewing.seekBy(10);
    context.viewing.seekBy(10);
    await settle(context);

    expect(askedSeeks(context)).toEqual([DURATION_SECONDS, DURATION_SECONDS]);
  });

  it("T8-04 item 2: before the first frame nothing is asked", async () => {
    const context = setup();
    await start(context);
    context.fake.emit({ kind: "loaded", snapshot: snapshotAt(100) });
    await settle(context);

    context.viewing.seekBy(10);
    await settle(context);

    expect(askedSeeks(context)).toEqual([]);
    expect(context.viewing.state().seekingTo).toBeUndefined();
  });
});

describe("T8-04 item 4: what the player screen is told it plays", () => {
  it("T8-04 item 4: the state holds the title block and the backdrop after the item read, and neither before", async () => {
    const context = setup();
    const read = deferred<ItemDetail>();
    context.source.itemDetail.mockImplementation(() => read.promise);
    await start(context);

    expect(context.viewing.state().title).toBeUndefined();
    expect(context.viewing.state().backdrop).toBeUndefined();

    read.resolve(detail);
    await settle(context);

    expect(context.viewing.state().title).toEqual({ name: "The Keeper's Log", seriesName: "Harbor Lights", season: 1, episode: 2 });
    expect(context.viewing.state().backdrop).toEqual(backdrop);
  });

  it("T8-04 item 4: a film's title block is its name alone", async () => {
    const context = setup();
    context.source.itemDetail.mockImplementation(async () => ({
      ...detail,
      type: "Movie",
      title: "Salt Road",
      seriesName: undefined,
      seasonNumber: undefined,
      episodeNumber: undefined,
      backdrop: undefined,
    }));
    await start(context);

    expect(context.viewing.state().title).toEqual({ name: "Salt Road" });
    expect(context.viewing.state().backdrop).toBeUndefined();
  });
});

describe("T8-04 item 5: pause, resume and leave", () => {
  it("T8-04 item 5: toggling follows the engine's latest snapshot, and pause and resume ask for exactly that", async () => {
    const context = setup();
    await playAt(context, 100);

    context.viewing.togglePaused();
    await settle(context);
    await engineSends(context, snapshotAt(100, true), "pause");
    context.viewing.togglePaused();
    await settle(context);
    await engineSends(context, snapshotAt(100, false), "pause");
    context.viewing.setPaused(true);
    context.viewing.setPaused(false);
    await settle(context);

    expect(context.setPaused.mock.calls).toEqual([[true], [false], [true], [false]]);
  });

  it("T8-04 item 5: before the first frame, pause and toggle ask the engine nothing", async () => {
    const context = setup();
    await start(context);

    context.viewing.setPaused(true);
    context.viewing.togglePaused();
    await settle(context);

    expect(context.setPaused).not.toHaveBeenCalled();
  });

  it("T8-04 item 5: a pause the engine refuses changes no state and goes to the failure log", async () => {
    const context = setup();
    await playAt(context, 100);
    context.setPaused.mockRejectedValueOnce(new Error("pause was refused"));
    const before = context.viewing.state();

    context.viewing.setPaused(true);
    await settle(context);

    expect(context.viewing.state()).toEqual(before);
    expect(context.log).toHaveBeenCalledTimes(1);
  });

  it("T8-04 item 5: leaving resolves when the engine has stopped, without waiting for the Stopped report", async () => {
    const context = setup();
    await playAt(context, 100);
    const engineStopped = deferred<void>();
    context.stop.mockImplementationOnce(() => engineStopped.promise);
    context.source.reportStopped.mockImplementation(() => new Promise<void>(() => undefined));
    const left = vi.fn();

    void context.viewing.leave().then(left);
    await settle(context);
    expect(context.stop).toHaveBeenCalledTimes(1);
    expect(left).not.toHaveBeenCalled();

    engineStopped.resolve(undefined);
    await settle(context);

    expect(left).toHaveBeenCalledTimes(1);
    expect(context.source.reportStopped).toHaveBeenCalledTimes(1);
  });

  it("T8-04 item 5: leaving before anything was launched resolves at once", async () => {
    const context = setup();
    context.source.itemDetail.mockImplementation(() => new Promise<ItemDetail>(() => undefined));
    await start(context);
    const left = vi.fn();

    void context.viewing.leave().then(left);
    await settle(context);

    expect(left).toHaveBeenCalledTimes(1);
    expect(context.launch).not.toHaveBeenCalled();
  });
});

describe("T8-04 item 6: what is known while loading", () => {
  it("T8-04 item 6: a direct-play plan makes the state say the original is opening, before the launch resolves and not before the plan", async () => {
    const context = setup();
    const negotiation = deferred<PlaybackPlan>();
    context.source.createPlaybackPlan.mockImplementation(() => negotiation.promise);
    context.launch.mockImplementation(() => new Promise<void>(() => undefined));
    await start(context);
    expect(context.viewing.state().opening).toBeUndefined();

    negotiation.resolve(directPlan);
    await settle(context);

    expect(context.launch).toHaveBeenCalledTimes(1);
    expect(context.viewing.state().phase).toBe("loading");
    expect(context.viewing.state().opening).toBe("original");
  });

  it("T8-04 item 6: a converted plan never says the original is opening", async () => {
    const context = setup(convertedPlan);
    await start(context);

    expect(context.launch).toHaveBeenCalledTimes(1);
    expect(context.viewing.state().title).toBeDefined();
    expect(context.viewing.state().opening).toBeUndefined();
  });
});

/** Playing, and an engine that refuses to stop once. */
async function playingWithOneFailedStop(): Promise<Setup> {
  const context = setup();
  await playAt(context, 100);
  context.stop.mockRejectedValueOnce(new Error("the player would not stop"));
  return context;
}

describe("T8-04 item 9: a stop that fails", () => {
  it("T8-04 item 9: leaving rejects with the typed stop error and the state is failed with stop-failed", async () => {
    const context = await playingWithOneFailedStop();

    await expect(context.viewing.leave()).rejects.toBeInstanceOf(PlayerStopError);

    expect(context.viewing.state().phase).toBe("failed");
    expect(context.viewing.state().session.failure).toBe("stop-failed");
  });

  it("T8-04 item 9: leaving again stops the engine again, and resolves when it stopped", async () => {
    const context = await playingWithOneFailedStop();
    await expect(context.viewing.leave()).rejects.toBeInstanceOf(PlayerStopError);

    await context.viewing.leave();

    expect(context.stop).toHaveBeenCalledTimes(2);
  });

  it("T8-04 item 9: a plain stop after a failed one tries the engine again", async () => {
    const context = await playingWithOneFailedStop();
    await expect(context.viewing.leave()).rejects.toBeInstanceOf(PlayerStopError);

    await context.viewing.stop();

    expect(context.stop).toHaveBeenCalledTimes(2);
  });
});
