// T8-03 items 5 and 6 on the player screen (D6), reached the way a viewer reaches it: one select on Home in the signed-in
// app. A failed report is one plain notice for five seconds and touches nothing; Back while loading returns to Home and
// sends no report.
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, screen } from "@testing-library/react-native";
import type { PlaybackPlan } from "@octave/core/src/domain/playback";
import { PlaybackCoordinator } from "@octave/core/src/player/coordinator";
import { pressSelect } from "../design/test-support/select-key";
import { cwEpisode, deferred } from "../home/test-support/home-doubles";
import { resetFocusBridge } from "../shell/test-support/focus-bridge-double";
import {
  captureBack,
  drain,
  emit,
  lastFocused,
  outlast,
  planOf,
  renderSignedInApp,
  settle,
  snapshotAt,
  type SignedInRig,
} from "../signed-in/test-support/signed-in-doubles";

jest.mock("@shopify/flash-list", () => require("../design/rows/test-support/flash-list-double"));
jest.mock("../shell/focus-bridge", () => require("../shell/test-support/focus-bridge-double"));

const NOTICE = "Couldn't save your progress to Fixture Server. Playback continues.";

let pressBack: () => Promise<void>;

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "queueMicrotask"] });
  resetFocusBridge();
  pressBack = captureBack();
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

async function playHero(): Promise<SignedInRig> {
  const rig = await renderSignedInApp();
  await pressSelect(screen.getByTestId("home-hero-primary"));
  await settle();
  expect(screen.getByTestId("player-screen")).toBeTruthy();
  return rig;
}

/** One progress report from a pause or a seek, which the server refuses. */
const failProgress = (rig: SignedInRig, cause: "pause" | "seek"): Promise<void> =>
  emit(rig, { kind: "state", snapshot: snapshotAt(1300, cause === "pause"), cause });

async function advance(milliseconds: number): Promise<void> {
  await act(async () => {
    jest.advanceTimersByTime(milliseconds);
  });
  await drain();
}

const notices = (): number => screen.queryAllByText(NOTICE).length;

describe("T8-03 item 5: a failed report is said once and stops nothing", () => {
  it("T8-03 item 5: three failing progress reports show one notice for five seconds, never again, and playback is left alone", async () => {
    const coordinatorStop = jest.spyOn(PlaybackCoordinator.prototype, "stop");
    const rig = await playHero();
    rig.gateway.reportProgress.mockImplementation(async () => {
      throw new Error("progress-failure-xyz");
    });
    await emit(rig, { kind: "loaded", snapshot: snapshotAt(1200) }, { kind: "first-frame" });
    expect(notices()).toBe(0);

    await failProgress(rig, "pause");
    expect(notices()).toBe(1);
    expect(screen.getByTestId("player-osd")).toBeTruthy();
    await advance(3000);
    await failProgress(rig, "seek");
    await failProgress(rig, "pause");
    expect(rig.gateway.reportProgress).toHaveBeenCalledTimes(3);
    expect(notices()).toBe(1);
    await advance(1999);
    expect(notices()).toBe(1);
    await advance(1);
    expect(notices()).toBe(0);
    expect(screen.queryByTestId("player-osd")).toBeNull();

    await failProgress(rig, "seek");
    await outlast(rig);
    await advance(10_000);
    expect(rig.gateway.reportProgress.mock.calls.length).toBeGreaterThan(4);
    expect(notices()).toBe(0);

    expect(JSON.stringify(screen.toJSON())).not.toContain("progress-failure-xyz");
    expect(rig.stop).not.toHaveBeenCalled();
    expect(rig.setPaused).not.toHaveBeenCalled();
    expect(coordinatorStop).not.toHaveBeenCalled();
    expect(screen.getByTestId("player-screen")).toBeTruthy();
    expect(screen.getByTestId("fake-engine-view")).toBeTruthy();
  });
});

function expectNoReport(rig: SignedInRig): void {
  expect(rig.gateway.reportStart).not.toHaveBeenCalled();
  expect(rig.gateway.reportProgress).not.toHaveBeenCalled();
  expect(rig.gateway.reportStopped).not.toHaveBeenCalled();
}

function expectHomeWithHeroFocused(): void {
  expect(screen.queryByTestId("player-screen")).toBeNull();
  expect(screen.getByTestId("home-hero-primary")).toBeTruthy();
  expect(lastFocused()).toBe("home-hero-primary");
}

describe("T8-03 item 6: Back while loading", () => {
  it("T8-03 item 6: Back while the plan is pending returns to Home with the hero focused, launches nothing and sends no report", async () => {
    const negotiation = deferred<PlaybackPlan>();
    const rig = await renderSignedInApp();
    rig.gateway.createPlaybackPlan.mockImplementation(() => negotiation.promise);
    await pressSelect(screen.getByTestId("home-hero-primary"));
    await settle();
    expect(screen.getByTestId("player-screen")).toBeTruthy();
    expect(rig.gateway.createPlaybackPlan).toHaveBeenCalledTimes(1);

    await pressBack();
    await act(async () => negotiation.resolve(planOf(cwEpisode.id, 0)));
    await outlast(rig);

    expectHomeWithHeroFocused();
    expect(rig.gateway.createPlaybackPlan.mock.calls[0]?.[2]?.aborted).toBe(true);
    expect(rig.launch).not.toHaveBeenCalled();
    expectNoReport(rig);
  });

  it("T8-03 item 6: Back after the engine loaded and before the first frame returns to Home with the hero focused, stops the engine and sends no report", async () => {
    const rig = await playHero();
    await emit(rig, { kind: "loaded", snapshot: snapshotAt(1200) });

    await pressBack();
    await outlast(rig);

    expectHomeWithHeroFocused();
    expect(rig.stop).toHaveBeenCalled();
    expectNoReport(rig);
  });
});
