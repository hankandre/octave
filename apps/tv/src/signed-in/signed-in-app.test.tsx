// T8-03 items 1 and 7 in the signed-in app (D2, D7, D8, D11): one select on Home plays through the core and shows the
// player screen, and Back returns to Home, whose cards show the server's new position without a reload. Jest has no focus
// engine, so a select is the press events (`pressSelect`) and the focused card is the one the shell asks the bridge to focus.
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { screen, within } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import { Viewing } from "@octave/core/src/player/viewing";
import { pressSelect } from "../design/test-support/select-key";
import { MINUTE, cwEpisode, cwFilm, rowCard, shownRows, textOf } from "../home/test-support/home-doubles";
import { resetFocusBridge } from "../shell/test-support/focus-bridge-double";
import {
  SESSION_ID,
  captureBack,
  cardTitles,
  emit,
  lastFocused,
  outlast,
  renderSignedInApp,
  settle,
  snapshotAt,
  streamUrlOf,
  ticksToWholeSeconds,
  type SignedInRig,
} from "./test-support/signed-in-doubles";

jest.mock("@shopify/flash-list", () => require("../design/rows/test-support/flash-list-double"));
jest.mock("../shell/focus-bridge", () => require("../shell/test-support/focus-bridge-double"));

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

async function select(testID: string): Promise<void> {
  await pressSelect(screen.getByTestId(testID));
  await settle();
}

function listReads(rig: SignedInRig): number[] {
  const { resumeItems, nextUp, recentlyPlayed, latestItems } = rig.gateway;
  return [resumeItems, nextUp, recentlyPlayed, latestItems].map((read) => read.mock.calls.length);
}

/** Plays what is selected up to `positionSeconds`, then presses Back. */
async function watchUntil(rig: SignedInRig, startSeconds: number, positionSeconds: number): Promise<void> {
  await emit(rig, { kind: "loaded", snapshot: snapshotAt(startSeconds) }, { kind: "first-frame" });
  await emit(rig, { kind: "state", snapshot: snapshotAt(positionSeconds), cause: "property" });
  await pressBack();
  await outlast(rig);
}

describe("T8-03 item 1: one select plays through the core", () => {
  it("T8-03 item 1: one select on the hero reads the item, negotiates, launches the plan and shows the player screen, and Home hands playback only an id and a start", async () => {
    const play = jest.spyOn(Viewing.prototype, "play");
    const rig = await renderSignedInApp();
    expect(rig.launch).not.toHaveBeenCalled();
    rig.gateway.itemDetail.mockClear();

    await select("home-hero-primary");

    expect(rig.gateway.itemDetail).toHaveBeenCalledTimes(1);
    expect(rig.gateway.itemDetail.mock.calls[0]?.[0]).toBe(cwEpisode.id);
    expect(rig.gateway.createPlaybackPlan).toHaveBeenCalledTimes(1);
    expect(rig.gateway.itemDetail.mock.invocationCallOrder[0]).toBeLessThan(rig.gateway.createPlaybackPlan.mock.invocationCallOrder[0] ?? 0);
    expect(rig.gateway.createPlaybackPlan.mock.calls[0]?.[0]).toMatchObject({ id: cwEpisode.id, type: "Episode" });
    expect(rig.gateway.createPlaybackPlan.mock.calls[0]?.[1]).toBe(20 * MINUTE);

    expect(rig.launch).toHaveBeenCalledTimes(1);
    expect(rig.launch.mock.calls[0]?.[0]).toMatchObject({ kind: "original", url: streamUrlOf(cwEpisode.id), sessionId: SESSION_ID });

    expect(play).toHaveBeenCalledTimes(1);
    expect(play.mock.calls[0]).toStrictEqual([{ itemId: cwEpisode.id, start: { kind: "resume", startPositionTicks: 20 * MINUTE } }]);

    const player = screen.getByTestId("player-screen");
    expect(within(player).getByTestId("player-view")).toBeTruthy();
    expect(within(player).getByTestId("fake-engine-view")).toBeTruthy();
  });
});

describe("T8-03 item 7: Resume from Home, and the new position on return", () => {
  it("T8-03 item 7: one select on the hero's Resume launches at the saved position, and after Back the hero shows the new time left without reading the lists again", async () => {
    const rig = await renderSignedInApp();
    expect(textOf("home-hero-facts")).toBe("S1 · E2 · 38 min left");
    const rows = shownRows();
    const titles = cardTitles();

    await select("home-hero-primary");
    expect(rig.launch).toHaveBeenCalledTimes(1);
    expect(rig.launch.mock.calls[0]?.[0].startPositionSeconds).toBe(ticksToWholeSeconds(20 * MINUTE));
    await watchUntil(rig, 20 * 60, 30 * 60);

    expect(rig.gateway.reportStopped).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("player-screen")).toBeNull();
    expect(textOf("home-hero-facts")).toBe("S1 · E2 · 28 min left");
    expect(listReads(rig)).toEqual([1, 1, 1, 1]);
    expect(shownRows()).toEqual(rows);
    expect(cardTitles()).toEqual(titles);
    expect(lastFocused()).toBe("home-hero-primary");

    await select("home-hero-primary");
    expect(rig.launch).toHaveBeenCalledTimes(2);
    expect(rig.launch.mock.calls[1]?.[0].startPositionSeconds).toBe(ticksToWholeSeconds(30 * MINUTE));
  });

  it("T8-03 item 7: after a Continue watching card is watched and Back is pressed, that card shows the new time left and progress, keeps its place and keeps focus", async () => {
    const rig = await renderSignedInApp();
    const card = rowCard("continue-watching", 0);
    expect(textOf(`${card}-title`)).toBe(cwFilm.title);
    const rows = shownRows();
    const titles = cardTitles();

    await select(card);
    expect(rig.launch.mock.calls[0]?.[0].startPositionSeconds).toBe(ticksToWholeSeconds(30 * MINUTE));
    await watchUntil(rig, 30 * 60, 75 * 60);

    expect(screen.queryByTestId("player-screen")).toBeNull();
    expect(textOf(`${card}-subtitle`)).toBe("25 min left");
    expect(StyleSheet.flatten(screen.getByTestId(`${card}-progress-fill`).props.style)?.width).toBe("75%");
    expect(listReads(rig)).toEqual([1, 1, 1, 1]);
    expect(shownRows()).toEqual(rows);
    expect(cardTitles()).toEqual(titles);
    expect(lastFocused()).toBe(card);
  });
});
