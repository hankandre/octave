// T8-03 follow-ups in the signed-in app: one player however often a card is selected, and a way back to Home however a
// viewing goes: failed, ended at the end of the file, or with a Stopped report the server did not take.
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { screen, within } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import { PLAYBACK_FAILURE_COPY } from "@octave/core/src/domain/playback-failure";
import { pressSelect } from "../design/test-support/select-key";
import { MINUTE, cwFilm, rowCard, textOf } from "../home/test-support/home-doubles";
import { resetFocusBridge } from "../shell/test-support/focus-bridge-double";
import {
  SERVER_NAME,
  captureBack,
  emit,
  lastFocused,
  outlast,
  renderSignedInApp,
  settle,
  snapshotAt,
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

const players = (): number => screen.queryAllByTestId("player-screen", { includeHiddenElements: true }).length;

const startPlaying = (rig: SignedInRig, positionSeconds: number): Promise<void> =>
  emit(rig, { kind: "loaded", snapshot: snapshotAt(positionSeconds) }, { kind: "first-frame" });

function expectHomeWithHeroFocused(): void {
  expect(players()).toBe(0);
  expect(screen.getByTestId("home-hero-primary")).toBeTruthy();
  expect(lastFocused()).toBe("home-hero-primary");
}

describe("T8-03 follow-up: one player at a time", () => {
  it("T8-03 follow-up: two selects on Home open one player screen, and one Back returns to Home", async () => {
    const rig = await renderSignedInApp();
    const primary = screen.getByTestId("home-hero-primary");

    // Both before the navigator has drawn the player, as two quick presses of the remote.
    await pressSelect(primary);
    await pressSelect(primary);
    await settle();

    expect(players()).toBe(1);
    expect(rig.launch).toHaveBeenCalledTimes(1);

    await pressBack();
    await outlast(rig);

    expectHomeWithHeroFocused();
  });
});

describe("T8-03 follow-up: a viewing that fails", () => {
  it("T8-03 follow-up: a failed viewing shows the copy table's title and body, and Back still returns to Home", async () => {
    const rig = await renderSignedInApp();
    await select("home-hero-primary");
    await startPlaying(rig, 1200);
    expect(screen.queryByTestId("player-failure")).toBeNull();

    await emit(rig, { kind: "error", code: "server-error" }, { kind: "ended", reason: "error", snapshot: snapshotAt(1200) });
    await outlast(rig);

    const copy = PLAYBACK_FAILURE_COPY["server-error"];
    const failure = within(screen.getByTestId("player-failure"));
    expect(failure.getByText(copy.title ?? "")).toBeTruthy();
    expect(failure.getByText(`${SERVER_NAME} had a problem starting playback. Try again in a moment.`)).toBeTruthy();
    expect(players()).toBe(1);

    await pressBack();
    await outlast(rig);

    expectHomeWithHeroFocused();
  });
});

describe("T8-03 follow-up: a Stopped report the server does not take", () => {
  it.each([
    [
      "fails",
      async (): Promise<undefined> => {
        throw new Error("stopped-failure-xyz");
      },
    ],
    ["never answers", () => new Promise<undefined>(() => undefined)],
  ])("T8-03 follow-up: Back still returns to Home when the Stopped report %s", async (_outcome, answer) => {
    const rig = await renderSignedInApp();
    rig.gateway.reportStopped.mockImplementation(answer);
    await select("home-hero-primary");
    await startPlaying(rig, 1200);

    await pressBack();

    expect(rig.gateway.reportStopped).toHaveBeenCalledTimes(1);
    expectHomeWithHeroFocused();
    await outlast(rig);
    expectHomeWithHeroFocused();
    expect(JSON.stringify(screen.toJSON())).not.toContain("stopped-failure-xyz");

    await select("home-hero-primary");
    expect(players()).toBe(1);
    expect(rig.launch).toHaveBeenCalledTimes(2);
  });
});

describe("T8-03 follow-up: the end of the file", () => {
  it("T8-03 follow-up: the end of the file closes the player and returns to Home with the card updated and focused", async () => {
    const rig = await renderSignedInApp();
    const card = rowCard("continue-watching", 0);
    expect(textOf(`${card}-title`)).toBe(cwFilm.title);
    await select(card);
    await startPlaying(rig, 30 * 60);

    await emit(rig, { kind: "ended", reason: "eof", snapshot: snapshotAt((90 * MINUTE) / (MINUTE / 60)) });
    await settle();
    await outlast(rig);

    expect(players()).toBe(0);
    expect(rig.stop).toHaveBeenCalledTimes(1);
    expect(rig.gateway.reportStopped).toHaveBeenCalledTimes(1);
    expect(textOf(`${card}-subtitle`)).toBe("10 min left");
    expect(StyleSheet.flatten(screen.getByTestId(`${card}-progress-fill`).props.style)?.width).toBe("90%");
    expect(lastFocused()).toBe(card);
  });
});
