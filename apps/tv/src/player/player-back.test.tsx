// T8-04 items 5 and 9 on the player screen (spec D9), reached the way a viewer reaches it, in the signed-in app over the
// real viewing: Back stops the player first and only then leaves, and a player that did not stop keeps the screen.
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { screen } from "@testing-library/react-native";
import { pressSelect } from "../design/test-support/select-key";
import { cwFilm, deferred, rowCard, textOf } from "../home/test-support/home-doubles";
import { focusView, resetFocusBridge } from "../shell/test-support/focus-bridge-double";
import {
  captureBack,
  emit,
  lastFocused,
  renderSignedInApp,
  settle,
  snapshotAt,
  type SignedInRig,
} from "../signed-in/test-support/signed-in-doubles";
import { focusRequests, focusTracker } from "./test-support/focus-follow";
import { pressRemoteKey, pressRemoteSelect } from "./test-support/remote";

jest.mock("@shopify/flash-list", () => require("../design/rows/test-support/flash-list-double"));
jest.mock("../shell/focus-bridge", () => require("../shell/test-support/focus-bridge-double"));
jest.mock("../../node_modules/react-native/src/private/specs_DEPRECATED/modules/NativeTVNavigationEventEmitter", () =>
  require("./test-support/tv-emitter-double"),
);

const STOP_FAILED_TITLE = "Couldn't stop playback";
const STOP_FAILED_BODY = "The player didn't close properly. Go back to try again, or quit Octave if you can still hear it.";
const BACK_TO_DETAILS = "Back to details";
const CARD = rowCard("continue-watching", 0);

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

/** Starts what `testID` plays, and nothing more: the player is still loading. */
async function openPlayer(testID: string): Promise<SignedInRig> {
  const rig = await renderSignedInApp();
  if (testID === CARD) expect(textOf(`${CARD}-title`)).toBe(cwFilm.title);
  await pressSelect(screen.getByTestId(testID));
  await settle();
  expect(screen.getByTestId("player-screen")).toBeTruthy();
  return rig;
}

/** Plays what `testID` plays up to its first frame. */
async function play(testID: string): Promise<SignedInRig> {
  const rig = await openPlayer(testID);
  await emit(rig, { kind: "loaded", snapshot: snapshotAt(1800) }, { kind: "first-frame" });
  focusView.mockClear();
  return rig;
}

function expectPlayerKept(): void {
  expect(screen.getByTestId("player-screen")).toBeTruthy();
}

function expectHomeFocused(testID: string): void {
  expect(screen.queryByTestId("player-screen")).toBeNull();
  expect(screen.getByTestId("home-hero-primary")).toBeTruthy();
  expect(lastFocused()).toBe(testID);
}

/** Playing the Continue watching card, with the engine's stop held open and the Stopped report never answered. */
async function playCardWithSlowStop() {
  const rig = await play(CARD);
  const stopping = deferred<undefined>();
  rig.stop.mockImplementation(() => stopping.promise);
  rig.gateway.reportStopped.mockImplementation(() => new Promise<undefined>(() => undefined));
  const finishStop = async (): Promise<void> => {
    stopping.resolve(undefined);
    await settle();
  };
  return { rig, finishStop };
}

describe("T8-04 item 5: Back stops the player and returns to the same card", () => {
  it("T8-04 item 5: one Back keeps the player until the engine has stopped, then shows Home with the same card focused without waiting for the Stopped report", async () => {
    const { rig, finishStop } = await playCardWithSlowStop();

    await pressBack();
    expectPlayerKept();
    expect(rig.stop).toHaveBeenCalledTimes(1);

    await finishStop();

    expectHomeFocused(CARD);
    expect(rig.stop).toHaveBeenCalledTimes(1);
    expect(rig.gateway.reportStopped).toHaveBeenCalledTimes(1);
  });

  it("T8-04 item 5: a second Back while the first is still stopping does nothing more", async () => {
    const { rig, finishStop } = await playCardWithSlowStop();

    await pressBack();
    expectPlayerKept();
    await pressBack();
    expectPlayerKept();
    expect(rig.stop).toHaveBeenCalledTimes(1);

    await finishStop();

    expectHomeFocused(CARD);
    expect(rig.stop).toHaveBeenCalledTimes(1);
  });

  it("T8-04 item 5: the top bar's Back control does the same", async () => {
    const { rig, finishStop } = await playCardWithSlowStop();
    await pressRemoteKey("up");
    await focusTracker().follow();

    await pressRemoteSelect(screen.getByTestId("player-back"));
    await settle();
    expectPlayerKept();
    expect(rig.stop).toHaveBeenCalledTimes(1);

    await finishStop();

    expectHomeFocused(CARD);
    expect(rig.stop).toHaveBeenCalledTimes(1);
  });

  it("T8-04 item 5: the loading layer's Back control leaves, launches no more and sends no report", async () => {
    const rig = await openPlayer(CARD);
    await emit(rig, { kind: "loaded", snapshot: snapshotAt(1800) });

    await pressRemoteSelect(screen.getByLabelText("Back"));
    await settle();

    expectHomeFocused(CARD);
    expect(rig.stop).toHaveBeenCalledTimes(1);
    expect(rig.launch).toHaveBeenCalledTimes(1);
    expect(rig.gateway.reportStart).not.toHaveBeenCalled();
    expect(rig.gateway.reportStopped).not.toHaveBeenCalled();
  });
});

/** Playing the hero when the engine refuses to stop `failures` times, and one Back. */
async function backOntoFailedStop(failures: number): Promise<SignedInRig> {
  const rig = await play("home-hero-primary");
  for (let failure = 0; failure < failures; failure += 1) {
    rig.stop.mockImplementationOnce(async () => {
      throw new Error("native-stop-reason-xyz");
    });
  }
  await pressBack();
  return rig;
}

function expectStopFailedRow(): void {
  expectPlayerKept();
  expect(screen.getByText(STOP_FAILED_TITLE)).toBeTruthy();
  expect(screen.getByText(STOP_FAILED_BODY)).toBeTruthy();
  expect(screen.getByLabelText(BACK_TO_DETAILS)).toBeTruthy();
  expect(JSON.stringify(screen.toJSON())).not.toContain("native-stop-reason-xyz");
}

async function pressBackToDetails(): Promise<void> {
  await pressRemoteSelect(screen.getByLabelText(BACK_TO_DETAILS));
  await settle();
}

describe("T8-04 item 9: a stop that fails keeps the player up", () => {
  it("T8-04 item 9: Back onto a failed stop keeps the player, shows Couldn't stop playback and focuses its Back to details button", async () => {
    const rig = await backOntoFailedStop(1);

    expectStopFailedRow();
    expect(focusRequests().at(-1)).toBe(BACK_TO_DETAILS);
    expect(rig.stop).toHaveBeenCalledTimes(1);
  });

  it("T8-04 item 9: Back to details tries the stop once more and then leaves", async () => {
    const rig = await backOntoFailedStop(1);
    expectStopFailedRow();

    await pressBackToDetails();

    expect(rig.stop).toHaveBeenCalledTimes(2);
    expectHomeFocused("home-hero-primary");
  });

  it("T8-04 item 9: the next Back tries the stop once more and then leaves", async () => {
    const rig = await backOntoFailedStop(1);
    expectStopFailedRow();

    await pressBack();

    expect(rig.stop).toHaveBeenCalledTimes(2);
    expectHomeFocused("home-hero-primary");
  });

  it.each([
    ["Back to details", pressBackToDetails],
    ["the next Back", () => pressBack()],
  ])("T8-04 item 9: when the second try fails too, %s still leaves", async (_name, leaveAgain) => {
    const rig = await backOntoFailedStop(2);
    expectStopFailedRow();

    await leaveAgain();

    expect(rig.stop.mock.calls.length).toBeGreaterThanOrEqual(2);
    expectHomeFocused("home-hero-primary");
  });
});
