// T8-04 review findings on the player screen: a session that ended with a player that did not stop, Back while loading,
// TalkBack's steps on the scrubber, and an episode whose server names no series.
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, screen } from "@testing-library/react-native";
import { pressSelect } from "../design/test-support/select-key";
import { deferred } from "../home/test-support/home-doubles";
import { resetFocusBridge } from "../shell/test-support/focus-bridge-double";
import { captureBack, emit, renderSignedInApp, settle, snapshotAt, type SignedInRig } from "../signed-in/test-support/signed-in-doubles";
import { focusTracker } from "./test-support/focus-follow";
import { renderAfterFirstFrame } from "./test-support/player-rig";
import { pressRemoteKey, pressRemoteSelect } from "./test-support/remote";

jest.mock("@shopify/flash-list", () => require("../design/rows/test-support/flash-list-double"));
jest.mock("../shell/focus-bridge", () => require("../shell/test-support/focus-bridge-double"));
jest.mock("../../node_modules/react-native/src/private/specs_DEPRECATED/modules/NativeTVNavigationEventEmitter", () =>
  require("./test-support/tv-emitter-double"),
);

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

async function openPlayer(): Promise<SignedInRig> {
  const rig = await renderSignedInApp();
  await pressSelect(screen.getByTestId("home-hero-primary"));
  await settle();
  await emit(rig, { kind: "loaded", snapshot: snapshotAt(1800) });
  return rig;
}

describe("T8-04: a session that ends with a player that does not stop", () => {
  const leaveWays = [
    ["Back to details", () => pressRemoteSelect(screen.getByLabelText("Back to details"))],
    ["the next Back", () => pressBack()],
  ] as const;

  for (const reason of ["eof", "error"] as const) {
    it.each(leaveWays)(`after ${reason}, %s stops the player again and then leaves`, async (_name, leave) => {
      const rig = await openPlayer();
      await emit(rig, { kind: "first-frame" });
      rig.stop.mockImplementationOnce(async () => {
        throw new Error("the player would not stop");
      });

      await emit(rig, { kind: "ended", reason, snapshot: snapshotAt(3480) });
      expect(screen.getByText("Couldn't stop playback")).toBeTruthy();
      expect(rig.stop).toHaveBeenCalledTimes(1);

      await leave();
      await settle();

      expect(rig.stop).toHaveBeenCalledTimes(2);
      expect(screen.queryByTestId("player-screen")).toBeNull();
    });
  }
});

describe("T8-04: Back while loading", () => {
  it("keeps the loading layer until the player has stopped", async () => {
    const rig = await openPlayer();
    const stopping = deferred<undefined>();
    rig.stop.mockImplementation(() => stopping.promise);

    await pressBack();
    expect(screen.getByTestId("player-loading")).toBeTruthy();

    stopping.resolve(undefined);
    await settle();
    expect(screen.queryByTestId("player-screen")).toBeNull();
  });
});

describe("T8-04: TalkBack on the scrubber", () => {
  it.each([
    ["increment", 10],
    ["decrement", -10],
  ])("the %s action seeks %d s", async (actionName, seconds) => {
    const rig = await renderAfterFirstFrame();
    await pressRemoteKey("up");
    await focusTracker().follow();
    const scrubber = screen.getByLabelText("Seek");
    expect(scrubber.props.accessibilityActions).toContainEqual({ name: actionName });

    await fireEvent(scrubber, "accessibilityAction", { nativeEvent: { actionName } });

    expect(rig.viewing.seekBy.mock.calls).toEqual([[seconds]]);
  });
});

describe("T8-04 item 4: an episode with no series name", () => {
  it("T8-04 item 4: draws the numbers and the title, with no series line and no empty row", async () => {
    const rig = await renderAfterFirstFrame();
    await rig.viewing.publish({ title: { name: "Episode 1", season: 1, episode: 1 } });

    await pressRemoteKey("up");

    const title = screen.getByTestId("player-title");
    expect(title).toHaveTextContent("S1 · E1 Episode 1");
    expect(screen.queryByTestId("player-title-series")).toBeNull();
    expect(title.parent?.children).toHaveLength(1);
  });
});
