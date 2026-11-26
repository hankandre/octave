import { describe, expect, it, vi } from "vitest";
import type { ItemDetail } from "../domain/catalog";
import { startOverChoice, type PlaybackPlan, type PlaybackSnapshot } from "../domain/playback";
import { FakeClock } from "../ports/fake-clock";
import { createFakePlayerEngine } from "./fake-player-engine";
import { Viewing, type ViewingSource } from "./viewing";

// What the viewing asks the engine while earlier requests are still on their way (T8-04 D3), and what leaving drops.

const detail: ItemDetail = {
  id: "movie-1",
  type: "Movie",
  title: "Salt Road",
  runTimeTicks: 6_000_000_000,
  genres: [],
  cast: [],
  userData: { played: false, favorite: false, resumePositionTicks: 0 },
  versions: [],
};

const plan: PlaybackPlan = {
  itemId: "movie-1",
  title: "Salt Road",
  mediaSourceId: "source",
  playSessionId: "session",
  startPositionTicks: 0,
  tracks: [],
  streamUrl: "https://media.test/Videos/movie-1/stream?Static=true",
  delivery: "static",
  playMethod: "DirectPlay",
  conversionReasons: [],
};

const snapshotAt = (positionSeconds: number, paused = false): PlaybackSnapshot => ({
  positionSeconds,
  durationSeconds: 600,
  paused,
  buffering: false,
  volume: 100,
  muted: false,
  tracks: [],
  diagnostics: { decodeMode: "software", decodeLabel: "Software — CPU", droppedFrames: 0 },
});

async function playingAt(positionSeconds: number) {
  const source: ViewingSource = {
    itemDetail: async () => detail,
    createPlaybackPlan: async () => plan,
    reportStart: async () => undefined,
    reportProgress: async () => undefined,
    reportStopped: async () => undefined,
    sessionId: () => "session-1",
    stopActiveEncoding: async () => undefined,
  };
  const fake = createFakePlayerEngine();
  const seek = vi.spyOn(fake.engine, "seek");
  const setPaused = vi.spyOn(fake.engine, "setPaused");
  const clock = new FakeClock();
  const viewing = new Viewing(source, fake.engine, clock, () => undefined);
  const settle = () => clock.advance(0);
  viewing.play({ itemId: "movie-1", start: startOverChoice() });
  await settle();
  fake.emit({ kind: "loaded", snapshot: snapshotAt(positionSeconds) });
  fake.emit({ kind: "first-frame" });
  await settle();
  return { viewing, fake, seek, setPaused, settle };
}

describe("T8-04: requests the engine has not reported yet", () => {
  it("builds on the newest seek when an earlier one's event lands between two presses", async () => {
    const { viewing, fake, seek, settle } = await playingAt(100);
    viewing.seekBy(10);
    viewing.seekBy(10);
    await settle();

    fake.emit({ kind: "state", snapshot: snapshotAt(110), cause: "seek" });
    await settle();
    viewing.seekBy(10);
    await settle();

    expect(seek.mock.calls).toEqual([[110], [120], [130]]);
    expect(viewing.state().seekingTo).toBe(130);
  });

  it("two toggles before the pause event ask for one pause, then a resume", async () => {
    const { viewing, setPaused, settle } = await playingAt(100);

    viewing.togglePaused();
    viewing.togglePaused();
    await settle();

    expect(setPaused.mock.calls).toEqual([[true], [false]]);
  });

  it("withdraws a refused seek, so the next press starts from the picture", async () => {
    const { viewing, seek, settle } = await playingAt(100);
    seek.mockRejectedValueOnce(new Error("seek was refused"));

    viewing.seekBy(10);
    await settle();
    expect(viewing.state().seekingTo).toBeUndefined();
    viewing.seekBy(10);
    await settle();

    expect(seek.mock.calls).toEqual([[110], [110]]);
  });

  it.each(["leave", "stop"] as const)("forgets a seek that has not landed on %s", async (way) => {
    const { viewing, settle } = await playingAt(100);
    viewing.seekBy(10);

    const left = viewing[way]();
    expect(viewing.state().seekingTo).toBeUndefined();
    await settle();
    await left;
  });
});
