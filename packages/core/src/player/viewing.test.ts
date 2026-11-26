import { describe, expect, it, vi } from "vitest";
import type { ItemDetail } from "../domain/catalog";
import { startOverChoice, type PlaybackPlan, type PlaybackSnapshot } from "../domain/playback";
import type { FailureLog } from "../ports/failure-log";
import { FakeClock } from "../ports/fake-clock";
import { createFakePlayerEngine } from "./fake-player-engine";
import { Viewing, type ViewingSource } from "./viewing";

// T8-03 items 1, 5 and 6 in the viewing use case (D5): it reads the item, negotiates, launches, and Back at any point
// before the first frame sends no report.

const detail: ItemDetail = {
  id: "episode-1",
  type: "Episode",
  title: "Pilot",
  seriesName: "Synthetic Show",
  seasonNumber: 1,
  episodeNumber: 1,
  runTimeTicks: 3_300_000_000,
  genres: [],
  cast: [],
  userData: { played: false, favorite: false, resumePositionTicks: 0 },
  versions: [],
};

const plan: PlaybackPlan = {
  itemId: "episode-1",
  title: "Pilot",
  streamUrl: "https://media.test/Videos/episode-1/stream?Static=true",
  mediaSourceId: "source",
  playSessionId: "session",
  startPositionTicks: 0,
  tracks: [],
  delivery: "static",
  playMethod: "DirectPlay",
  conversionReasons: [],
};

const snapshot: PlaybackSnapshot = {
  positionSeconds: 0,
  paused: false,
  buffering: false,
  volume: 100,
  muted: false,
  tracks: [],
  diagnostics: { decodeMode: "software", decodeLabel: "Software — CPU", droppedFrames: 0 },
};

const request = { itemId: "episode-1", start: startOverChoice() };

// A promise the test settles when it chooses.
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function setup() {
  const order: string[] = [];
  const source = {
    itemDetail: vi.fn<ViewingSource["itemDetail"]>(async () => {
      order.push("itemDetail");
      return detail;
    }),
    createPlaybackPlan: vi.fn<ViewingSource["createPlaybackPlan"]>(async () => {
      order.push("createPlaybackPlan");
      return plan;
    }),
    reportStart: vi.fn<ViewingSource["reportStart"]>(async () => undefined),
    reportProgress: vi.fn<ViewingSource["reportProgress"]>(async () => undefined),
    reportStopped: vi.fn<ViewingSource["reportStopped"]>(async () => undefined),
    sessionId: () => "session-1",
    stopActiveEncoding: vi.fn<ViewingSource["stopActiveEncoding"]>(async () => undefined),
  } satisfies ViewingSource;
  const fake = createFakePlayerEngine();
  const launch = vi.spyOn(fake.engine, "launch").mockImplementation(async () => {
    order.push("launch");
  });
  const log = vi.fn<FailureLog>();
  const clock = new FakeClock();
  const viewing = new Viewing(source, fake.engine, clock, log);
  return { order, source, fake, launch, log, clock, viewing };
}

type Setup = ReturnType<typeof setup>;

const settle = (context: Setup) => context.clock.advance(0);

// Runs the clock past every report and drain deadline, so a late report would have been sent by now.
const outlast = (context: Setup) => context.clock.advance(60_000);

function expectNoReport(context: Setup): void {
  expect(context.source.reportStart).not.toHaveBeenCalled();
  expect(context.source.reportProgress).not.toHaveBeenCalled();
  expect(context.source.reportStopped).not.toHaveBeenCalled();
}

describe("Viewing", () => {
  it("T8-03 item 1: reads the item, then negotiates, then launches", async () => {
    const context = setup();

    context.viewing.play(request);
    await settle(context);

    expect(context.order).toEqual(["itemDetail", "createPlaybackPlan", "launch"]);
    expect(context.source.itemDetail).toHaveBeenCalledWith("episode-1", expect.any(AbortSignal));
    expect(context.source.createPlaybackPlan).toHaveBeenCalledWith(
      expect.objectContaining({ id: "episode-1", type: "Episode" }),
      0,
      expect.any(AbortSignal),
    );
    expect(context.launch).toHaveBeenCalledWith(expect.objectContaining({ url: plan.streamUrl, sessionId: "session-1" }));
    await context.viewing.stop();
  });

  it("T8-03 item 5: sends a reporter message that is not a warning code to the failure log and leaves the state", async () => {
    const context = setup();
    // A Stopped report that never settles makes the reporter say so in words, which is not a warning code.
    context.source.reportStopped.mockImplementation(() => new Promise<void>(() => undefined));
    context.viewing.play(request);
    await settle(context);
    context.fake.emit({ kind: "loaded", snapshot });
    context.fake.emit({ kind: "first-frame" });
    await settle(context);

    const stopping = context.viewing.stop();
    await settle(context);
    const before = context.viewing.state();
    expect(context.log).not.toHaveBeenCalled();
    await outlast(context);
    await stopping;

    expect(context.log).toHaveBeenCalledWith("The stopped report did not finish before the shutdown deadline.");
    expect(context.viewing.state().session).toEqual(before.session);
    expect(context.viewing.state().session.reportingWarning).toBeUndefined();
  });

  it("T8-03 item 6: Back while the item is being read negotiates nothing and sends no report", async () => {
    const context = setup();
    const read = deferred<ItemDetail>();
    context.source.itemDetail.mockImplementation(() => read.promise);
    context.viewing.play(request);
    await settle(context);
    expect(context.source.itemDetail).toHaveBeenCalledTimes(1);

    const stopping = context.viewing.stop();
    read.resolve(detail);
    await stopping;
    await outlast(context);

    expect(context.source.itemDetail.mock.calls[0]?.[1]?.aborted).toBe(true);
    expect(context.source.createPlaybackPlan).not.toHaveBeenCalled();
    expect(context.launch).not.toHaveBeenCalled();
    expectNoReport(context);
  });

  it("T8-03 item 6: Back while the plan is being negotiated launches nothing and sends no report", async () => {
    const context = setup();
    const negotiation = deferred<PlaybackPlan>();
    context.source.createPlaybackPlan.mockImplementation(() => negotiation.promise);
    context.viewing.play(request);
    await settle(context);
    expect(context.source.createPlaybackPlan).toHaveBeenCalledTimes(1);

    const stopping = context.viewing.stop();
    negotiation.resolve(plan);
    await stopping;
    await outlast(context);

    expect(context.source.createPlaybackPlan.mock.calls[0]?.[2]?.aborted).toBe(true);
    expect(context.launch).not.toHaveBeenCalled();
    expectNoReport(context);
  });

  it("T8-03 item 6: Back while the engine is launching stops it and sends no report", async () => {
    const context = setup();
    const launching = deferred<void>();
    context.launch.mockImplementation(() => launching.promise);
    const stop = vi.spyOn(context.fake.engine, "stop");
    context.viewing.play(request);
    await settle(context);
    expect(context.launch).toHaveBeenCalledTimes(1);

    const stopping = context.viewing.stop();
    await settle(context);
    expect(stop).toHaveBeenCalled();
    launching.resolve();
    await stopping;
    await outlast(context);

    expectNoReport(context);
  });

  it("T8-03 item 6: Back after loaded and before the first frame sends no report", async () => {
    const context = setup();
    const stop = vi.spyOn(context.fake.engine, "stop");
    context.viewing.play(request);
    await settle(context);
    context.fake.emit({ kind: "loaded", snapshot });
    await settle(context);

    await context.viewing.stop();
    await outlast(context);

    expect(stop).toHaveBeenCalled();
    expectNoReport(context);
  });
});
